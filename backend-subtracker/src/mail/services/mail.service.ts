import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { type FindOptionsWhere, Repository } from 'typeorm';
import { type EnvConfig, envFromConfig } from '../../config/env.js';
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
  MailStatus,
  MailType,
  type UserMailType,
} from '../mail.types.js';

export const OPERATOR_ALERT_INTERVAL_MS = 15 * 60 * 1000;

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface SmtpErrorFields {
  code?: unknown;
  command?: unknown;
  responseCode?: unknown;
}

function smtpFieldsOf(error: unknown): SmtpErrorFields {
  return typeof error === 'object' && error !== null ? error : {};
}

// The server permanently refused this address, most likely a typo. Anything else, including a
// refused sender or a temporary refusal, points at our side or the server.
function isRecipientRejected(error: unknown): boolean {
  const { code, command, responseCode } = smtpFieldsOf(error);
  return (
    code === 'EENVELOPE' &&
    command === 'RCPT TO' &&
    typeof responseCode === 'number' &&
    responseCode >= 500
  );
}

// Neither public method rejects: callers fire mail after their response or transaction, and a
// mail problem must not change their outcome. Failures end up in the audit row and in the logs.
// sendToUser resolves to whether the transport accepted the mail (true even when the audit row
// could not be saved), so a caller that keeps a "sent" marker can release it after a failure.
// It mails only addresses that still have an account: a deleted account gets nothing, and one
// deleted while its mail was on the way leaves an audit row without its address.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly operatorMail: string | undefined;
  private lastOperatorAlertAt: number | undefined;

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
  ): Promise<boolean> {
    if (!(await this.mayReceive(type, to))) {
      // Nothing to audit or alert about, and no address in the log, as everywhere here.
      this.logger.warn(
        `Skipped ${type} mail: no account with this address may receive it`,
      );
      return false;
    }
    const { sent, needsAlert, rowId } = await this.deliver(
      'user',
      type,
      to,
      content,
    );
    if (needsAlert) {
      await this.alertOperatorAboutFailure(type, rowId);
    }
    return sent;
  }

  async notifyOperator(content: MailContent): Promise<void> {
    if (this.operatorMail === undefined) {
      this.logger.warn(
        `NOTIFICATION_ADMINISTRATOR_MAIL is not set, operator notification only logged: ${content.subject}`,
      );
      return;
    }
    // A failed alert is only logged and audited by deliver(), so it cannot trigger another alert.
    await this.deliver(
      'operator',
      MailType.OPERATOR_ALERT,
      this.operatorMail,
      content,
    );
  }

  private async deliver(
    channel: MailChannel,
    type: MailType,
    to: string,
    content: MailContent,
  ): Promise<{ sent: boolean; needsAlert: boolean; rowId: string | null }> {
    try {
      await this.transport.send({ channel, to, ...content });
    } catch (error) {
      const errorMessage = errorMessageOf(error).slice(
        0,
        MAIL_ERROR_MESSAGE_MAX_LENGTH,
      );
      const rowId = await this.saveAudit(
        channel,
        type,
        to,
        MailStatus.FAILED,
        errorMessage,
      );
      const recipientRejected = isRecipientRejected(error);
      this.logFailure(type, error, rowId, recipientRejected);
      return { sent: false, needsAlert: !recipientRejected, rowId };
    }
    const rowId = await this.saveAudit(
      channel,
      type,
      to,
      MailStatus.SENT,
      null,
    );
    return { sent: true, needsAlert: false, rowId };
  }

  // A blocked account gets only the mail about the access to it; the rest waits until it is
  // unblocked (the jobs catch up) or is lost, like a sign-in link it could not use anyway.
  private mayReceive(type: UserMailType, address: string): Promise<boolean> {
    return this.accountExists(
      ACCOUNT_ACCESS_MAIL_TYPES.includes(type)
        ? { email: address }
        : { email: address, isActive: true },
    );
  }

  // A failed lookup counts as a missing account: no mail before sending, no address in the audit.
  private async accountExists(where: FindOptionsWhere<User>): Promise<boolean> {
    try {
      return await this.users.exists({ where });
    } catch (error) {
      this.logger.error(
        `Checking the account of a mail recipient failed: ${errorMessageOf(error)}`,
      );
      return false;
    }
  }

  // SMTP messages can quote the address, so the full text stays in the audit row, next to it.
  private logFailure(
    type: MailType,
    error: unknown,
    rowId: string | null,
    recipientRejected: boolean,
  ): void {
    const { code } = smtpFieldsOf(error);
    const details = `code: ${typeof code === 'string' ? code : 'unknown'}, audit row: ${rowId ?? 'none'}`;
    if (recipientRejected) {
      this.logger.warn(`Recipient of ${type} mail rejected (${details})`);
    } else {
      this.logger.error(`Sending ${type} mail failed (${details})`);
    }
  }

  // A user's account is checked again here: if it was deleted while the mail was on the way, its
  // mail rows have already been anonymized, so this row must not bring the address back, nor an
  // SMTP message quoting it.
  private async saveAudit(
    channel: MailChannel,
    type: MailType,
    to: string,
    status: MailStatus,
    errorMessage: string | null,
  ): Promise<string | null> {
    const accountGone =
      channel === 'user' && !(await this.accountExists({ email: to }));
    try {
      const row = await this.mails.save(
        this.mails.create({
          type,
          recipient: accountGone ? ANONYMIZED_RECIPIENT : to,
          status,
          errorMessage: accountGone ? null : errorMessage,
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
  private async alertOperatorAboutFailure(
    type: MailType,
    rowId: string | null,
  ): Promise<void> {
    const now = Date.now();
    if (
      this.lastOperatorAlertAt !== undefined &&
      now - this.lastOperatorAlertAt < OPERATOR_ALERT_INTERVAL_MS
    ) {
      return;
    }
    this.lastOperatorAlertAt = now;

    const id = rowId ?? 'brak (nie zapisano wiersza audytu)';
    await this.notifyOperator({
      subject: 'SubTracker: nieudana wysyłka maila',
      text: `Nie udało się wysłać maila.\nid: ${id}\ntyp: ${type}`,
      html: `<p>Nie udało się wysłać maila.</p><p>id: ${escapeHtml(id)}<br>typ: ${escapeHtml(type)}</p>`,
    });
  }
}
