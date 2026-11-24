import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { type EnvConfig, envFromConfig } from '../../config/env.js';
import { failureCodeOf } from '../../shared/database/failure-code.js';
import { User } from '../../users/entities/user.entity.js';
import {
  Mail,
  MAIL_ERROR_MESSAGE_MAX_LENGTH,
} from '../entities/mail.entity.js';
import { escapeHtml } from '../escape-html.js';
import { MAIL_TRANSPORT, type MailTransport } from '../mail.transport.js';
import {
  ACCOUNT_ACCESS_MAIL_TYPES,
  ANONYMIZED_RECIPIENT,
  type MailChannel,
  type MailContent,
  type MailOutcome,
  MailStatus,
  MailType,
  type UserMailType,
} from '../mail.types.js';
import { isRecipientTypo, smtpFailureDetails } from '../smtp-error.js';

// Quiet time for one mail type after an accepted failure alert.
export const OPERATOR_ALERT_INTERVAL_MS = 15 * 60 * 1000;
// Reserved while an alert is on the way, and kept as the retry delay when it fails.
export const OPERATOR_ALERT_RETRY_MS = 60 * 1000;

// The error_message of the FAILED row of a mail whose recipient could not be checked.
export const ACCOUNT_LOOKUP_FAILED_MESSAGE = 'account lookup failed';

interface OperatorAlertState {
  // Until then a failure of this type sends no alert and only counts as skipped.
  blockedUntil: number;
  // Failures not reported yet; the next alert names them.
  skipped: number;
  // An alert of this type is being sent. The reservation alone is not enough: a send can outlast
  // it (three nodemailer timeouts of 30 s each), and a second alert would then go out in parallel.
  inFlight: boolean;
}

type AccountLookup =
  | { kind: 'present'; isActive: boolean }
  | { kind: 'missing' }
  | { kind: 'lookup_failed'; error: unknown };

// The text of a FAILED row. An SMTP message can quote the address, so it goes together with the
// address of a deleted account; a fixed text of ours stays.
interface AuditFailure {
  message: string;
  mayQuoteAddress: boolean;
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Neither public method rejects: callers fire mail after their response or transaction, and a
// mail problem must not change their outcome. Failures end up in the audit row and in the logs.
// sendToUser resolves to a MailOutcome; only 'sent' means the transport accepted the mail ('sent'
// even when the audit row could not be saved), so a caller that keeps a "sent" marker can release
// it after anything else. It mails only addresses that still have an account: a deleted account
// gets nothing, and one deleted while its mail was on the way leaves an audit row without its
// address. Each outcome leaves one log line with the type and the reason, never the address.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly operatorMail: string | undefined;
  private readonly operatorAlerts = new Map<MailType, OperatorAlertState>();

  constructor(
    @InjectRepository(Mail) private readonly mails: Repository<Mail>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    config: ConfigService<EnvConfig, true>,
  ) {
    this.operatorMail = envFromConfig(config).NOTIFICATION_ADMINISTRATOR_MAIL;
  }

  async sendToUser(
    type: UserMailType,
    to: string,
    content: MailContent,
  ): Promise<MailOutcome> {
    const account = await this.lookUpAccount(to);
    if (account.kind === 'lookup_failed') {
      // A database problem, not a missing account: a FAILED row (if the database takes it) and
      // an alert, like a failed send.
      this.logger.error(
        `Checking the recipient of ${type} mail failed (code: ${failureCodeOf(account.error)})`,
      );
      const rowId = await this.saveAudit('user', type, to, MailStatus.FAILED, {
        message: ACCOUNT_LOOKUP_FAILED_MESSAGE,
        mayQuoteAddress: false,
      });
      await this.alertOperatorAboutFailure(type, rowId);
      return 'lookup_failed';
    }
    // Nothing to audit or alert about in the two skips, and no address in the log, as everywhere
    // here.
    if (account.kind === 'missing') {
      this.logger.warn(`Skipped ${type} mail: no account with this address`);
      return 'no_account';
    }
    // A blocked account gets only the mail about the access to it; the rest waits until it is
    // unblocked (the jobs catch up) or is lost, like a sign-in link it could not use anyway.
    if (!account.isActive && !ACCOUNT_ACCESS_MAIL_TYPES.includes(type)) {
      this.logger.log(`Skipped ${type} mail: the account is blocked`);
      return 'blocked';
    }
    const { outcome, rowId } = await this.deliver('user', type, to, content);
    if (outcome === 'send_failed') {
      await this.alertOperatorAboutFailure(type, rowId);
    }
    return outcome;
  }

  // Resolves to whether the transport accepted the mail; false without an operator address.
  async notifyOperator(content: MailContent): Promise<boolean> {
    if (this.operatorMail === undefined) {
      this.logger.warn(
        `NOTIFICATION_ADMINISTRATOR_MAIL is not set, operator notification only logged: ${content.subject}`,
      );
      return false;
    }
    // A failed alert is only logged and audited by deliver(), so it cannot trigger another alert.
    const { outcome } = await this.deliver(
      'operator',
      MailType.OPERATOR_ALERT,
      this.operatorMail,
      content,
    );
    return outcome === 'sent';
  }

  // send_failed needs an alert (sendToUser's job); recipient_typo, a refused address, does not.
  private async deliver(
    channel: MailChannel,
    type: MailType,
    to: string,
    content: MailContent,
  ): Promise<{
    outcome: 'sent' | 'send_failed' | 'recipient_typo';
    rowId: string | null;
  }> {
    try {
      await this.transport.send({ channel, to, ...content });
    } catch (error) {
      const rowId = await this.saveAudit(channel, type, to, MailStatus.FAILED, {
        message: errorMessageOf(error).slice(0, MAIL_ERROR_MESSAGE_MAX_LENGTH),
        mayQuoteAddress: true,
      });
      const recipientTypo = isRecipientTypo(error);
      this.logFailure(type, error, rowId, recipientTypo);
      return {
        outcome: recipientTypo ? 'recipient_typo' : 'send_failed',
        rowId,
      };
    }
    const rowId = await this.saveAudit(
      channel,
      type,
      to,
      MailStatus.SENT,
      null,
    );
    return { outcome: 'sent', rowId };
  }

  // Logs nothing itself: sendToUser logs a failed lookup, and saveAudit only anonymizes after one.
  private async lookUpAccount(address: string): Promise<AccountLookup> {
    try {
      const user = await this.users.findOne({
        select: { id: true, isActive: true },
        where: { email: address },
      });
      return user === null
        ? { kind: 'missing' }
        : { kind: 'present', isActive: user.isActive };
    } catch (error) {
      return { kind: 'lookup_failed', error };
    }
  }

  // SMTP messages can quote the address, so the full text stays in the audit row, next to it; the
  // log gets the enhanced status only.
  private logFailure(
    type: MailType,
    error: unknown,
    rowId: string | null,
    recipientTypo: boolean,
  ): void {
    const details = `${smtpFailureDetails(error)}, audit row: ${rowId ?? 'none'}`;
    if (recipientTypo) {
      this.logger.warn(`Recipient of ${type} mail rejected (${details})`);
    } else {
      this.logger.error(`Sending ${type} mail failed (${details})`);
    }
  }

  // A user's account is checked again here: if it was deleted while the mail was on the way, its
  // mail rows have already been anonymized, so this row must not bring the address back, nor an
  // SMTP message quoting it. A check that fails counts as a deleted account. It is logged, except
  // after a failed lookup in sendToUser, which has logged it already (one failed lookup, one error
  // line).
  private async saveAudit(
    channel: MailChannel,
    type: MailType,
    to: string,
    status: MailStatus,
    failure: AuditFailure | null,
  ): Promise<string | null> {
    let accountGone = false;
    if (channel === 'user') {
      const account = await this.lookUpAccount(to);
      accountGone = account.kind !== 'present';
      if (
        account.kind === 'lookup_failed' &&
        failure?.message !== ACCOUNT_LOOKUP_FAILED_MESSAGE
      ) {
        this.logger.error(
          `Checking the recipient of the ${type} mail audit row failed (code: ${failureCodeOf(account.error)}); the row is anonymized`,
        );
      }
    }
    const errorMessage =
      failure === null || (accountGone && failure.mayQuoteAddress)
        ? null
        : failure.message;
    try {
      const row = await this.mails.save(
        this.mails.create({
          type,
          recipient: accountGone ? ANONYMIZED_RECIPIENT : to,
          status,
          errorMessage,
          sentAt: status === MailStatus.SENT ? new Date() : null,
        }),
      );
      return row.id;
    } catch (error) {
      this.logger.error(
        `Saving the ${type} mail audit row failed: ${errorMessageOf(error)}`,
      );
      return null;
    }
  }

  // The alert names the audit row only: never the mail body, which can hold a sign-in link.
  // Each mail type has its own window. While an alert is on the way, the type is reserved for the
  // retry delay, so failures arriving meanwhile (parallel sign-in requests) count as skipped
  // instead of sending a second alert. An accepted alert extends the window to the full interval
  // from its acceptance and takes the number it reported off the counter; after a failed one the
  // reservation stays as the retry delay and the counter keeps that number plus this failure.
  private async alertOperatorAboutFailure(
    type: MailType,
    rowId: string | null,
  ): Promise<void> {
    let state = this.operatorAlerts.get(type);
    if (state === undefined) {
      state = { blockedUntil: 0, skipped: 0, inFlight: false };
      this.operatorAlerts.set(type, state);
    }
    if (state.inFlight || Date.now() < state.blockedUntil) {
      state.skipped += 1;
      return;
    }
    state.blockedUntil = Date.now() + OPERATOR_ALERT_RETRY_MS;
    state.inFlight = true;
    const reported = state.skipped;

    const id = rowId ?? 'brak (nie zapisano wiersza audytu)';
    const skippedLine = `pominięte od poprzedniego alarmu: ${reported}`;
    let sent: boolean;
    try {
      sent = await this.notifyOperator({
        subject: 'SubTracker: nieudana wysyłka maila',
        text: `Nie udało się wysłać maila.\nid: ${id}\ntyp: ${type}\n${skippedLine}`,
        html: `<p>Nie udało się wysłać maila.</p><p>id: ${escapeHtml(id)}<br>typ: ${escapeHtml(type)}<br>${escapeHtml(skippedLine)}</p>`,
      });
    } finally {
      state.inFlight = false;
    }
    if (sent) {
      state.blockedUntil = Date.now() + OPERATOR_ALERT_INTERVAL_MS;
      state.skipped -= reported;
    } else {
      state.skipped += 1;
    }
  }
}
