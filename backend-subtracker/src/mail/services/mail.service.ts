import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { type EnvConfig, envFromConfig } from '../../config/env.js';
import {
  Mail,
  MAIL_ERROR_MESSAGE_MAX_LENGTH,
} from '../entities/mail.entity.js';
import { escapeHtml } from '../escape-html.js';
import { MAIL_TRANSPORT, type MailTransport } from '../mail.transport.js';
import {
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

// Neither public method rejects: callers fire mail after their response or transaction, and a
// mail problem must not change their outcome. Failures end up in the audit row and in the logs.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly operatorMail: string | undefined;
  private lastOperatorAlertAt: number | undefined;

  constructor(
    @InjectRepository(Mail) private readonly mails: Repository<Mail>,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    config: ConfigService<EnvConfig, true>,
  ) {
    this.operatorMail = envFromConfig(config).NOTIFICATION_ADMINISTRATOR_MAIL;
  }

  async sendToUser(
    type: UserMailType,
    to: string,
    content: MailContent,
  ): Promise<void> {
    const { failed, rowId } = await this.deliver('user', type, to, content);
    if (failed) {
      await this.alertOperatorAboutFailure(type, rowId);
    }
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
  ): Promise<{ failed: boolean; rowId: string | null }> {
    let errorMessage: string | null = null;
    try {
      await this.transport.send({ channel, to, ...content });
    } catch (error) {
      errorMessage = errorMessageOf(error).slice(
        0,
        MAIL_ERROR_MESSAGE_MAX_LENGTH,
      );
      this.logger.error(`Sending ${type} mail failed: ${errorMessage}`);
    }
    const rowId = await this.saveAudit(type, to, errorMessage);
    return { failed: errorMessage !== null, rowId };
  }

  private async saveAudit(
    type: MailType,
    recipient: string,
    errorMessage: string | null,
  ): Promise<string | null> {
    try {
      const row = await this.mails.save(
        this.mails.create({
          type,
          recipient,
          status: errorMessage === null ? MailStatus.SENT : MailStatus.FAILED,
          errorMessage,
          sentAt: errorMessage === null ? new Date() : null,
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
