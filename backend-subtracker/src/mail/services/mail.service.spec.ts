import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { QueryFailedError, type Repository } from 'typeorm';
import { type EnvConfig, validateEnv } from '../../config/env.js';
import type { User } from '../../users/entities/user.entity.js';
import type { Mail } from '../entities/mail.entity.js';
import type { MailTransport } from '../mail.transport.js';
import {
  ACCOUNT_ACCESS_MAIL_TYPES,
  ANONYMIZED_RECIPIENT,
  type MailContent,
  type MailMessage,
  MailStatus,
  MailType,
  type UserMailType,
} from '../mail.types.js';
import {
  MailService,
  OPERATOR_ALERT_INTERVAL_MS,
  OPERATOR_ALERT_RETRY_MS,
} from './mail.service.js';

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

type AccountRow = Pick<User, 'id' | 'isActive'>;

interface FindAccountOptions {
  select: unknown;
  where: { email?: unknown };
}

const activeAccount: AccountRow = { id: 'user-1', isActive: true };
const blockedAccount: AccountRow = { id: 'user-1', isActive: false };

// Shaped like a lost database connection reported by pg through TypeORM.
const lookupError = () =>
  new QueryFailedError(
    'SELECT',
    [USER],
    Object.assign(new Error(`terminating connection for ${USER}`), {
      code: '57P01',
    }),
  );

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
  // Every user address has an active account unless a test says otherwise.
  const users = {
    findOne: vi.fn<(options: FindAccountOptions) => Promise<AccountRow | null>>(
      () => Promise.resolve(activeAccount),
    ),
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
  let logInfo: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logInfo = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
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
    it('sends through the user channel, audits SENT and resolves to sent', async () => {
      const { service, send, rows } = setup();

      await expect(
        service.sendToUser(MailType.MAGIC_LINK, USER, content),
      ).resolves.toBe('sent');

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

    it('audits FAILED with a truncated error and resolves to send_failed after an SMTP error', async () => {
      const { service, send, rows } = setup();
      send.mockRejectedValueOnce(new Error('x'.repeat(600)));

      await expect(
        service.sendToUser(MailType.MAGIC_LINK, USER, content),
      ).resolves.toBe('send_failed');

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
        expect(part).toContain('pominięte od poprzedniego alarmu: 0');
        expect(part).not.toContain('sekret');
        expect(part).not.toContain(USER);
      }
      expect(alert.subject).not.toContain('sekret');
      expect(rows[1]).toMatchObject({
        type: MailType.OPERATOR_ALERT,
        recipient: OPERATOR,
        status: MailStatus.SENT,
      });
    });

    describe('recognising who caused a failure', () => {
      // Shaped like nodemailer's envelope errors: the reply in `response`, its code in
      // `responseCode`, and the reply (which can quote the address) in the message too.
      const refused = (command: string, reply: string) => {
        const response = `${reply} <${USER}>`;
        return Object.assign(
          new Error(`Recipient command failed: ${response}`),
          {
            code: 'EENVELOPE',
            command,
            response,
            responseCode: Number(reply.slice(0, 3)),
          },
        );
      };

      it('does not alert about a mistyped recipient (5.1.x), but audits it', async () => {
        const { service, send, rows } = setup();
        send.mockRejectedValueOnce(
          refused('RCPT TO', '550 5.1.1 user unknown'),
        );

        await expect(
          service.sendToUser(MailType.MAGIC_LINK, USER, content),
        ).resolves.toBe('recipient_typo');

        expect(send).toHaveBeenCalledTimes(1);
        expect(rows[0]).toMatchObject({
          status: MailStatus.FAILED,
          errorMessage: `Recipient command failed: 550 5.1.1 user unknown <${USER}>`,
        });
        expect(logWarn).toHaveBeenCalledExactlyOnceWith(
          'Recipient of MAGIC_LINK mail rejected (code: EENVELOPE, status: 5.1.1, audit row: row-1)',
        );
        expect(logError).not.toHaveBeenCalled();
      });

      it.each([
        [
          'a recipient refused by policy',
          'RCPT TO',
          '550 5.7.1 relaying denied',
          ', status: 5.7.1',
        ],
        [
          'a recipient refused without a status',
          'RCPT TO',
          '550 mailbox unavailable',
          '',
        ],
        [
          'a refused sender',
          'MAIL FROM',
          '550 5.1.8 bad sender',
          ', status: 5.1.8',
        ],
        [
          'a temporarily refused recipient',
          'RCPT TO',
          '450 4.2.1 try later',
          ', status: 4.2.1',
        ],
      ])('alerts about %s', async (_name, command, reply, status) => {
        const { service, send } = setup();
        send.mockRejectedValueOnce(refused(command, reply));

        await service.sendToUser(MailType.MAGIC_LINK, USER, content);

        expect(send).toHaveBeenCalledTimes(2);
        expect(logError).toHaveBeenCalledExactlyOnceWith(
          `Sending MAGIC_LINK mail failed (code: EENVELOPE${status}, audit row: row-1)`,
        );
      });

      it('keeps the address out of the log', async () => {
        const { service, send } = setup();
        send.mockRejectedValueOnce(
          refused('RCPT TO', '550 5.1.1 user unknown'),
        );
        await service.sendToUser(MailType.MAGIC_LINK, USER, content);
        send.mockRejectedValueOnce(refused('RCPT TO', '550 5.7.1 denied'));
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

    describe('alert windows', () => {
      // User mail always fails; the operator channel follows `operatorUp`.
      function failingSetup() {
        vi.useFakeTimers();
        const ctx = setup();
        let operatorUp = true;
        ctx.send.mockImplementation((message) =>
          message.channel === 'user' || !operatorUp
            ? Promise.reject(new Error('smtp down'))
            : Promise.resolve(),
        );
        const alertMessages = () =>
          ctx.send.mock.calls
            .map(([message]) => message)
            .filter((message) => message.channel === 'operator');
        return {
          ...ctx,
          alerts: () => alertMessages().length,
          lastAlert: () => alertMessages().at(-1),
          setOperatorUp: (up: boolean) => {
            operatorUp = up;
          },
        };
      }
      const fail = (
        service: MailService,
        type: UserMailType = MailType.MAGIC_LINK,
      ) => service.sendToUser(type, USER, content);

      it('alerts at most once per interval after an accepted alert', async () => {
        const { service, alerts } = failingSetup();

        await fail(service);
        await fail(service);
        expect(alerts()).toBe(1);

        vi.advanceTimersByTime(OPERATOR_ALERT_INTERVAL_MS - 1);
        await fail(service);
        expect(alerts()).toBe(1);

        vi.advanceTimersByTime(1);
        await fail(service);
        expect(alerts()).toBe(2);
      });

      it('keeps a separate window for each mail type', async () => {
        const { service, alerts, lastAlert } = failingSetup();

        await fail(service, MailType.MAGIC_LINK);
        await fail(service, MailType.TRIAL_REMINDER);

        expect(alerts()).toBe(2);
        expect(lastAlert()?.text).toContain(`typ: ${MailType.TRIAL_REMINDER}`);
      });

      it('retries a failed alert after the retry delay, not the interval', async () => {
        const { service, alerts, setOperatorUp } = failingSetup();
        setOperatorUp(false);

        await fail(service);
        expect(alerts()).toBe(1);

        setOperatorUp(true);
        vi.advanceTimersByTime(OPERATOR_ALERT_RETRY_MS - 1000);
        await fail(service);
        expect(alerts()).toBe(1);

        vi.advanceTimersByTime(1000);
        await fail(service);
        expect(alerts()).toBe(2);
      });

      it('reports the skipped failures in the next alert and resets them after it', async () => {
        const { service, alerts, lastAlert } = failingSetup();

        await fail(service);
        await fail(service);
        await fail(service);
        vi.advanceTimersByTime(OPERATOR_ALERT_INTERVAL_MS);
        await fail(service);
        expect(alerts()).toBe(2);
        for (const part of [lastAlert()?.text, lastAlert()?.html]) {
          expect(part).toContain('pominięte od poprzedniego alarmu: 2');
        }

        vi.advanceTimersByTime(OPERATOR_ALERT_INTERVAL_MS);
        await fail(service);
        expect(alerts()).toBe(3);
        expect(lastAlert()?.text).toContain(
          'pominięte od poprzedniego alarmu: 0',
        );
      });

      it('counts a failure whose alert failed, and what that alert reported, in the next one', async () => {
        const { service, alerts, lastAlert, setOperatorUp } = failingSetup();

        await fail(service);
        await fail(service);
        vi.advanceTimersByTime(OPERATOR_ALERT_INTERVAL_MS);
        setOperatorUp(false);
        await fail(service);
        expect(lastAlert()?.text).toContain(
          'pominięte od poprzedniego alarmu: 1',
        );

        setOperatorUp(true);
        vi.advanceTimersByTime(OPERATOR_ALERT_RETRY_MS);
        await fail(service);
        expect(alerts()).toBe(3);
        expect(lastAlert()?.text).toContain(
          'pominięte od poprzedniego alarmu: 2',
        );
      });

      it('sends one alert for parallel failures and counts the other as skipped', async () => {
        const { service, send, alerts, lastAlert } = failingSetup();
        let acceptAlert: () => void = () => undefined;
        send.mockImplementationOnce(() =>
          Promise.reject(new Error('smtp down')),
        );
        send.mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              acceptAlert = resolve;
            }),
        );

        const first = fail(service);
        await vi.waitFor(() => expect(alerts()).toBe(1));
        await fail(service);
        acceptAlert();
        await first;
        expect(alerts()).toBe(1);

        vi.advanceTimersByTime(OPERATOR_ALERT_INTERVAL_MS);
        await fail(service);
        expect(alerts()).toBe(2);
        expect(lastAlert()?.text).toContain(
          'pominięte od poprzedniego alarmu: 1',
        );
      });

      it('sends no second alert while one outlasts its reservation', async () => {
        const { service, send, alerts, lastAlert } = failingSetup();
        let acceptAlert: () => void = () => undefined;
        send.mockImplementationOnce(() =>
          Promise.reject(new Error('smtp down')),
        );
        send.mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              acceptAlert = resolve;
            }),
        );

        const first = fail(service);
        await vi.waitFor(() => expect(alerts()).toBe(1));
        // Three nodemailer timeouts of 30 s: longer than the 60 s reservation.
        vi.advanceTimersByTime(OPERATOR_ALERT_RETRY_MS + 30_000);
        await fail(service);
        expect(alerts()).toBe(1);
        acceptAlert();
        await first;

        vi.advanceTimersByTime(OPERATOR_ALERT_INTERVAL_MS);
        await fail(service);
        expect(alerts()).toBe(2);
        expect(lastAlert()?.text).toContain(
          'pominięte od poprzedniego alarmu: 1',
        );
      });
    });

    it('does not loop when the operator alert fails too', async () => {
      const { service, send, rows } = setup();
      send.mockRejectedValue(new Error('smtp down'));

      await expect(
        service.sendToUser(MailType.MAGIC_LINK, USER, content),
      ).resolves.toBe('send_failed');

      expect(send).toHaveBeenCalledTimes(2);
      expect(rows.map((row) => [row.type, row.status])).toEqual([
        [MailType.MAGIC_LINK, MailStatus.FAILED],
        [MailType.OPERATOR_ALERT, MailStatus.FAILED],
      ]);
    });

    it('only logs when the audit write fails, and still resolves to sent', async () => {
      const { service, mails, send } = setup();
      mails.save.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.sendToUser(MailType.MAGIC_LINK, USER, content),
      ).resolves.toBe('sent');

      expect(send).toHaveBeenCalledTimes(1);
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('db down'));
    });

    it('still alerts when both the send and the audit write fail', async () => {
      const { service, mails, send } = setup();
      send.mockRejectedValueOnce(new Error('smtp down'));
      mails.save.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.sendToUser(MailType.MAGIC_LINK, USER, content),
      ).resolves.toBe('send_failed');

      expect(send.mock.calls[1][0].text).toContain('brak');
    });

    describe('only to an address that still has an account', () => {
      it('reads the account of the address it mails, before sending and before the audit row', async () => {
        const { service, users } = setup();

        await service.sendToUser(MailType.MAGIC_LINK, USER, content);

        expect(users.findOne).toHaveBeenCalledTimes(2);
        for (const [options] of users.findOne.mock.calls) {
          expect(options).toEqual({
            select: { id: true, isActive: true },
            where: { email: USER },
          });
        }
      });

      describe('to a blocked account', () => {
        it.each<UserMailType>([MailType.MAGIC_LINK, MailType.TRIAL_REMINDER])(
          'skips %s mail without a row or an alert, and resolves to blocked',
          async (type) => {
            const { service, users, send, mails } = setup();
            users.findOne.mockResolvedValue(blockedAccount);

            await expect(service.sendToUser(type, USER, content)).resolves.toBe(
              'blocked',
            );

            expect(send).not.toHaveBeenCalled();
            expect(mails.save).not.toHaveBeenCalled();
            expect(logInfo).toHaveBeenCalledExactlyOnceWith(
              `Skipped ${type} mail: the account is blocked`,
            );
            expect(logWarn).not.toHaveBeenCalled();
            expect(logError).not.toHaveBeenCalled();
          },
        );

        it.each<UserMailType>([...ACCOUNT_ACCESS_MAIL_TYPES])(
          'sends and audits %s mail',
          async (type) => {
            const { service, users, send, rows } = setup();
            users.findOne.mockResolvedValue(blockedAccount);

            await expect(service.sendToUser(type, USER, content)).resolves.toBe(
              'sent',
            );

            expect(send).toHaveBeenCalledOnce();
            expect(rows).toEqual([
              expect.objectContaining({ type, recipient: USER }),
            ]);
          },
        );
      });

      it('neither sends, audits nor alerts without an account, and resolves to no_account', async () => {
        const { service, users, send, mails } = setup();
        users.findOne.mockResolvedValue(null);

        await expect(
          service.sendToUser(MailType.TRIAL_REMINDER, USER, content),
        ).resolves.toBe('no_account');

        expect(send).not.toHaveBeenCalled();
        expect(mails.save).not.toHaveBeenCalled();
        expect(logWarn).toHaveBeenCalledExactlyOnceWith(
          'Skipped TRIAL_REMINDER mail: no account with this address',
        );
        expect(logError).not.toHaveBeenCalled();
      });

      describe('when the account cannot be checked', () => {
        it('audits FAILED, alerts the operator and resolves to lookup_failed', async () => {
          const { service, users, send, rows } = setup();
          // The check before sending fails; the one before the audit row works again.
          users.findOne.mockRejectedValueOnce(lookupError());

          await expect(
            service.sendToUser(MailType.MAGIC_LINK, USER, content),
          ).resolves.toBe('lookup_failed');

          expect(rows[0]).toEqual({
            type: MailType.MAGIC_LINK,
            recipient: USER,
            status: MailStatus.FAILED,
            errorMessage: 'account lookup failed',
            sentAt: null,
          });
          expect(send).toHaveBeenCalledOnce();
          const alert = send.mock.calls[0][0];
          expect(alert).toMatchObject({ channel: 'operator', to: OPERATOR });
          expect(alert.text).toContain('id: row-1');
          expect(alert.text).toContain(`typ: ${MailType.MAGIC_LINK}`);
          expect(logError).toHaveBeenCalledExactlyOnceWith(
            'Checking the recipient of MAGIC_LINK mail failed (code: 57P01)',
          );
        });

        it('logs one lookup error and audits the marker when the database stays down', async () => {
          const { service, users, send, rows } = setup();
          users.findOne.mockRejectedValue(lookupError());

          await expect(
            service.sendToUser(MailType.TRIAL_REMINDER, USER, content),
          ).resolves.toBe('lookup_failed');

          expect(rows[0]).toEqual({
            type: MailType.TRIAL_REMINDER,
            recipient: ANONYMIZED_RECIPIENT,
            status: MailStatus.FAILED,
            errorMessage: 'account lookup failed',
            sentAt: null,
          });
          expect(send).toHaveBeenCalledOnce();
          expect(logError).toHaveBeenCalledExactlyOnceWith(
            'Checking the recipient of TRIAL_REMINDER mail failed (code: 57P01)',
          );
          const logged = JSON.stringify([
            ...logWarn.mock.calls,
            ...logError.mock.calls,
          ]);
          expect(logged).not.toContain(USER);
        });

        it('still alerts, without a row id, when the audit row cannot be saved either', async () => {
          const { service, users, mails, send } = setup();
          users.findOne.mockRejectedValue(lookupError());
          mails.save.mockRejectedValueOnce(new Error('db down'));

          await expect(
            service.sendToUser(MailType.MAGIC_LINK, USER, content),
          ).resolves.toBe('lookup_failed');

          expect(send).toHaveBeenCalledOnce();
          expect(send.mock.calls[0][0].text).toContain(
            'id: brak (nie zapisano wiersza audytu)',
          );
        });

        it('shares the alert window of its mail type with failed sends', async () => {
          const { service, users, send } = setup();
          send.mockRejectedValueOnce(new Error('smtp down'));
          await service.sendToUser(MailType.MAGIC_LINK, USER, content);
          users.findOne.mockRejectedValueOnce(lookupError());

          await service.sendToUser(MailType.MAGIC_LINK, USER, content);

          const alerts = send.mock.calls.filter(
            ([message]) => message.channel === 'operator',
          );
          expect(alerts).toHaveLength(1);
        });

        it('names the class of an error without a database code', async () => {
          const { service, users } = setup();
          users.findOne.mockRejectedValueOnce(new TypeError('x is undefined'));

          await service.sendToUser(MailType.MAGIC_LINK, USER, content);

          expect(logError).toHaveBeenCalledExactlyOnceWith(
            'Checking the recipient of MAGIC_LINK mail failed (code: TypeError)',
          );
        });
      });

      it('audits the marker instead of the address when the account goes during sending', async () => {
        const { service, users, rows } = setup();
        users.findOne
          .mockResolvedValueOnce(activeAccount)
          .mockResolvedValueOnce(null);

        await expect(
          service.sendToUser(MailType.MAGIC_LINK, USER, content),
        ).resolves.toBe('sent');

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

      it('logs a failed re-check of a sent mail and anonymizes its row', async () => {
        const { service, users, rows } = setup();
        users.findOne
          .mockResolvedValueOnce(activeAccount)
          .mockRejectedValueOnce(lookupError());

        await expect(
          service.sendToUser(MailType.MAGIC_LINK, USER, content),
        ).resolves.toBe('sent');

        expect(rows[0]).toMatchObject({
          recipient: ANONYMIZED_RECIPIENT,
          status: MailStatus.SENT,
        });
        expect(logError).toHaveBeenCalledExactlyOnceWith(
          'Checking the recipient of the MAGIC_LINK mail audit row failed (code: 57P01); the row is anonymized',
        );
      });

      it('drops the error message, which can quote the address, from such a failed mail', async () => {
        const { service, users, send, rows } = setup();
        users.findOne
          .mockResolvedValueOnce(activeAccount)
          .mockResolvedValueOnce(null);
        send.mockRejectedValueOnce(new Error(`550 refused ${USER}`));

        await expect(
          service.sendToUser(MailType.MAGIC_LINK, USER, content),
        ).resolves.toBe('send_failed');

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

        expect(users.findOne).not.toHaveBeenCalled();
        expect(rows[0]).toMatchObject({ recipient: OPERATOR });
      });
    });
  });

  describe('notifyOperator', () => {
    it('sends through the operator channel, audits OPERATOR_ALERT and resolves to true', async () => {
      const { service, send, rows } = setup();

      await expect(service.notifyOperator(content)).resolves.toBe(true);

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

      await expect(service.notifyOperator(content)).resolves.toBe(false);

      expect(send).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe(MailStatus.FAILED);
      expect(logError).toHaveBeenCalled();
    });

    it('only logs in DEV without NOTIFICATION_ADMINISTRATOR_MAIL', async () => {
      const { service, send, rows } = setup(null);

      await expect(service.notifyOperator(content)).resolves.toBe(false);

      expect(send).not.toHaveBeenCalled();
      expect(rows).toEqual([]);
    });
  });
});
