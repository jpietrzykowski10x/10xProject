import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { type EnvConfig, validateEnv } from '../../config/env.js';
import type { User } from '../../users/entities/user.entity.js';
import type { Mail } from '../entities/mail.entity.js';
import type { MailTransport } from '../mail.transport.js';
import {
  ANONYMIZED_RECIPIENT,
  type MailContent,
  type MailMessage,
  MailStatus,
  MailType,
} from '../mail.types.js';
import { MailService, OPERATOR_ALERT_INTERVAL_MS } from './mail.service.js';

const baseEnv = {
  MODE: 'DEV',
  POSTGRES_HOST: 'localhost',
  POSTGRES_USER: 'subtracker-adm',
  POSTGRES_PASSWORD: 'secret',
  POSTGRES_DATABASE: 'subtracker-db',
  POSTGRES_DATABASE_DEV: 'subtracker-db-dev',
  CORS_ORIGINS: 'http://localhost:4200',
};

const OPERATOR = 'operator@example.com';
const USER = 'jan@example.com';
const content: MailContent = {
  subject: 'Link logowania',
  text: 'https://example.com/auth/verify#token=sekret',
  html: '<a href="https://example.com/auth/verify#token=sekret">Zaloguj</a>',
};

function configFor(operatorMail: string | null) {
  const env = validateEnv({
    ...baseEnv,
    NOTIFICATION_ADMINISTRATOR_MAIL: operatorMail ?? undefined,
  });
  return {
    get: (key: keyof EnvConfig) => env[key],
  } as unknown as ConfigService<EnvConfig, true>;
}

function setup(operatorMail: string | null = OPERATOR) {
  const rows: Partial<Mail>[] = [];
  const mails = {
    create: vi.fn((row: Partial<Mail>) => row),
    save: vi.fn((row: Partial<Mail>) => {
      rows.push(row);
      return Promise.resolve({ ...row, id: `row-${rows.length}` });
    }),
  };
  const send = vi.fn<(message: MailMessage) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const transport: MailTransport = { send };
  // Every user address has an account unless a test says otherwise.
  const users = {
    exists: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
  };
  const service = new MailService(
    mails as unknown as Repository<Mail>,
    users as unknown as Repository<User>,
    transport,
    configFor(operatorMail),
  );
  return { service, mails, users, send, rows };
}

describe('MailService', () => {
  let logError: ReturnType<typeof vi.spyOn>;
  let logWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    logWarn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('sendToUser', () => {
    it('sends through the user channel, audits SENT and resolves to true', async () => {
      const { service, send, rows } = setup();

      await expect(
        service.sendToUser(MailType.MAGIC_LINK, USER, content),
      ).resolves.toBe(true);

      expect(send).toHaveBeenCalledExactlyOnceWith({
        channel: 'user',
        to: USER,
        ...content,
      });
      expect(rows).toEqual([
        {
          type: MailType.MAGIC_LINK,
          recipient: USER,
          status: MailStatus.SENT,
          errorMessage: null,
          sentAt: expect.any(Date) as Date,
        },
      ]);
    });

    it('audits FAILED with a truncated error and resolves to false after an SMTP error', async () => {
      const { service, send, rows } = setup();
      send.mockRejectedValueOnce(new Error('x'.repeat(600)));

      await expect(
        service.sendToUser(MailType.MAGIC_LINK, USER, content),
      ).resolves.toBe(false);

      expect(rows[0]).toMatchObject({
        status: MailStatus.FAILED,
        sentAt: null,
        errorMessage: 'x'.repeat(500),
      });
    });

    it('alerts the operator with the row id and type, without the mail body', async () => {
      const { service, send, rows } = setup();
      send.mockRejectedValueOnce(new Error('smtp down'));

      await service.sendToUser(MailType.MAGIC_LINK, USER, content);

      expect(send).toHaveBeenCalledTimes(2);
      const alert = send.mock.calls[1][0];
      expect(alert).toMatchObject({ channel: 'operator', to: OPERATOR });
      for (const part of [alert.text, alert.html]) {
        expect(part).toContain('row-1');
        expect(part).toContain(MailType.MAGIC_LINK);
        expect(part).not.toContain('sekret');
      }
      expect(alert.subject).not.toContain('sekret');
      expect(rows[1]).toMatchObject({
        type: MailType.OPERATOR_ALERT,
        recipient: OPERATOR,
        status: MailStatus.SENT,
      });
    });

    describe('recognising who caused a failure', () => {
      const refused = (command: string, responseCode: number) =>
        Object.assign(new Error(`550 refused ${USER}`), {
          code: 'EENVELOPE',
          command,
          responseCode,
        });

      it('does not alert about a permanently rejected recipient, but audits it', async () => {
        const { service, send, rows } = setup();
        send.mockRejectedValueOnce(refused('RCPT TO', 550));

        await expect(
          service.sendToUser(MailType.MAGIC_LINK, USER, content),
        ).resolves.toBe(false);

        expect(send).toHaveBeenCalledTimes(1);
        expect(rows[0]).toMatchObject({
          status: MailStatus.FAILED,
          errorMessage: `550 refused ${USER}`,
        });
        expect(logWarn).toHaveBeenCalledExactlyOnceWith(
          expect.stringContaining('code: EENVELOPE, audit row: row-1'),
        );
        expect(logError).not.toHaveBeenCalled();
      });

      it.each([
        ['a refused sender', 'MAIL FROM', 550],
        ['a temporarily refused recipient', 'RCPT TO', 450],
      ])('alerts about %s', async (_name, command, responseCode) => {
        const { service, send } = setup();
        send.mockRejectedValueOnce(refused(command, responseCode));

        await service.sendToUser(MailType.MAGIC_LINK, USER, content);

        expect(send).toHaveBeenCalledTimes(2);
        expect(logError).toHaveBeenCalledExactlyOnceWith(
          expect.stringContaining('code: EENVELOPE, audit row: row-1'),
        );
      });

      it('keeps the address out of the log', async () => {
        const { service, send } = setup();
        send.mockRejectedValueOnce(refused('RCPT TO', 550));
        await service.sendToUser(MailType.MAGIC_LINK, USER, content);
        send.mockRejectedValueOnce(new Error(`auth failed for ${USER}`));
        await service.sendToUser(MailType.MAGIC_LINK, USER, content);

        const logged = JSON.stringify([
          ...logWarn.mock.calls,
          ...logError.mock.calls,
        ]);
        expect(logged).not.toContain(USER);
      });
    });

    it('alerts at most once per interval', async () => {
      vi.useFakeTimers();
      const { service, send } = setup();
      const alerts = () =>
        send.mock.calls.filter(([message]) => message.channel === 'operator')
          .length;
      send.mockImplementation((message) =>
        message.channel === 'user'
          ? Promise.reject(new Error('smtp down'))
          : Promise.resolve(),
      );

      await service.sendToUser(MailType.MAGIC_LINK, USER, content);
      await service.sendToUser(MailType.MAGIC_LINK, USER, content);
      expect(alerts()).toBe(1);

      vi.advanceTimersByTime(OPERATOR_ALERT_INTERVAL_MS - 1);
      await service.sendToUser(MailType.MAGIC_LINK, USER, content);
      expect(alerts()).toBe(1);

      vi.advanceTimersByTime(1);
      await service.sendToUser(MailType.MAGIC_LINK, USER, content);
      expect(alerts()).toBe(2);
    });

    it('does not loop when the operator alert fails too', async () => {
      const { service, send, rows } = setup();
      send.mockRejectedValue(new Error('smtp down'));

      await expect(
        service.sendToUser(MailType.MAGIC_LINK, USER, content),
      ).resolves.toBe(false);

      expect(send).toHaveBeenCalledTimes(2);
      expect(rows.map((row) => [row.type, row.status])).toEqual([
        [MailType.MAGIC_LINK, MailStatus.FAILED],
        [MailType.OPERATOR_ALERT, MailStatus.FAILED],
      ]);
    });

    it('only logs when the audit write fails, and still resolves to true', async () => {
      const { service, mails, send } = setup();
      mails.save.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.sendToUser(MailType.MAGIC_LINK, USER, content),
      ).resolves.toBe(true);

      expect(send).toHaveBeenCalledTimes(1);
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('db down'));
    });

    it('still alerts when both the send and the audit write fail', async () => {
      const { service, mails, send } = setup();
      send.mockRejectedValueOnce(new Error('smtp down'));
      mails.save.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.sendToUser(MailType.MAGIC_LINK, USER, content),
      ).resolves.toBe(false);

      expect(send.mock.calls[1][0].text).toContain('brak');
    });

    describe('only to an address that still has an account', () => {
      it('checks the account by the address it mails', async () => {
        const { service, users } = setup();

        await service.sendToUser(MailType.MAGIC_LINK, USER, content);

        expect(users.exists).toHaveBeenCalledWith({ where: { email: USER } });
      });

      it('neither sends, audits nor alerts without an account, and resolves to false', async () => {
        const { service, users, send, mails } = setup();
        users.exists.mockResolvedValue(false);

        await expect(
          service.sendToUser(MailType.TRIAL_REMINDER, USER, content),
        ).resolves.toBe(false);

        expect(send).not.toHaveBeenCalled();
        expect(mails.save).not.toHaveBeenCalled();
        expect(logWarn).toHaveBeenCalledExactlyOnceWith(
          expect.stringContaining('no account'),
        );
        expect(JSON.stringify(logWarn.mock.calls)).not.toContain(USER);
      });

      it('treats a failed account lookup as a missing account', async () => {
        const { service, users, send, mails } = setup();
        users.exists.mockRejectedValue(new Error('db down'));

        await expect(
          service.sendToUser(MailType.MAGIC_LINK, USER, content),
        ).resolves.toBe(false);

        expect(send).not.toHaveBeenCalled();
        expect(mails.save).not.toHaveBeenCalled();
        expect(logError).toHaveBeenCalledWith(
          expect.stringContaining('db down'),
        );
      });

      it('audits the marker instead of the address when the account goes during sending', async () => {
        const { service, users, rows } = setup();
        users.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

        await expect(
          service.sendToUser(MailType.MAGIC_LINK, USER, content),
        ).resolves.toBe(true);

        expect(rows).toEqual([
          {
            type: MailType.MAGIC_LINK,
            recipient: ANONYMIZED_RECIPIENT,
            status: MailStatus.SENT,
            errorMessage: null,
            sentAt: expect.any(Date) as Date,
          },
        ]);
      });

      it('drops the error message, which can quote the address, from such a failed mail', async () => {
        const { service, users, send, rows } = setup();
        users.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        send.mockRejectedValueOnce(new Error(`550 refused ${USER}`));

        await expect(
          service.sendToUser(MailType.MAGIC_LINK, USER, content),
        ).resolves.toBe(false);

        expect(rows[0]).toEqual({
          type: MailType.MAGIC_LINK,
          recipient: ANONYMIZED_RECIPIENT,
          status: MailStatus.FAILED,
          errorMessage: null,
          sentAt: null,
        });
        expect(JSON.stringify(rows)).not.toContain(USER);
      });

      it('does not check accounts for operator mail', async () => {
        const { service, users, rows } = setup();

        await service.notifyOperator(content);

        expect(users.exists).not.toHaveBeenCalled();
        expect(rows[0]).toMatchObject({ recipient: OPERATOR });
      });
    });
  });

  describe('notifyOperator', () => {
    it('sends through the operator channel and audits OPERATOR_ALERT', async () => {
      const { service, send, rows } = setup();

      await service.notifyOperator(content);

      expect(send).toHaveBeenCalledExactlyOnceWith({
        channel: 'operator',
        to: OPERATOR,
        ...content,
      });
      expect(rows[0]).toMatchObject({
        type: MailType.OPERATOR_ALERT,
        recipient: OPERATOR,
        status: MailStatus.SENT,
      });
    });

    it('only logs a failed alert', async () => {
      const { service, send, rows } = setup();
      send.mockRejectedValue(new Error('smtp down'));

      await expect(service.notifyOperator(content)).resolves.toBeUndefined();

      expect(send).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe(MailStatus.FAILED);
      expect(logError).toHaveBeenCalled();
    });

    it('only logs in DEV without NOTIFICATION_ADMINISTRATOR_MAIL', async () => {
      const { service, send, rows } = setup(null);

      await expect(service.notifyOperator(content)).resolves.toBeUndefined();

      expect(send).not.toHaveBeenCalled();
      expect(rows).toEqual([]);
    });
  });
});
