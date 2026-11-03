import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { type EnvConfig, validateEnv } from '../../config/env.js';
import type { Mail } from '../entities/mail.entity.js';
import type { MailTransport } from '../mail.transport.js';
import {
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
  text: 'https://example.com/auth/potwierdz#token=sekret',
  html: '<a href="https://example.com/auth/potwierdz#token=sekret">Zaloguj</a>',
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
  const service = new MailService(
    mails as unknown as Repository<Mail>,
    transport,
    configFor(operatorMail),
  );
  return { service, mails, send, rows };
}

describe('MailService', () => {
  let logError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('sendToUser', () => {
    it('sends through the user channel and audits SENT', async () => {
      const { service, send, rows } = setup();

      await service.sendToUser(MailType.MAGIC_LINK, USER, content);

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

    it('audits FAILED with a truncated error and does not reject', async () => {
      const { service, send, rows } = setup();
      send.mockRejectedValueOnce(new Error('x'.repeat(600)));

      await expect(
        service.sendToUser(MailType.MAGIC_LINK, USER, content),
      ).resolves.toBeUndefined();

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
      ).resolves.toBeUndefined();

      expect(send).toHaveBeenCalledTimes(2);
      expect(rows.map((row) => [row.type, row.status])).toEqual([
        [MailType.MAGIC_LINK, MailStatus.FAILED],
        [MailType.OPERATOR_ALERT, MailStatus.FAILED],
      ]);
    });

    it('only logs when the audit write fails', async () => {
      const { service, mails, send } = setup();
      mails.save.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.sendToUser(MailType.MAGIC_LINK, USER, content),
      ).resolves.toBeUndefined();

      expect(send).toHaveBeenCalledTimes(1);
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('db down'));
    });

    it('still alerts when both the send and the audit write fail', async () => {
      const { service, mails, send } = setup();
      send.mockRejectedValueOnce(new Error('smtp down'));
      mails.save.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.sendToUser(MailType.MAGIC_LINK, USER, content),
      ).resolves.toBeUndefined();

      expect(send.mock.calls[1][0].text).toContain('brak');
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
