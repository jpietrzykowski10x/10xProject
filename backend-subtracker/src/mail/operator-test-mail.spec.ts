import { validateEnv } from '../config/env.js';
import type { MailTransport } from './mail.transport.js';
import type { MailMessage } from './mail.types.js';
import {
  OPERATOR_TEST_MAIL_SUBJECT,
  sendOperatorTestMail,
} from './operator-test-mail.js';

const devEnv = {
  MODE: 'DEV',
  POSTGRES_HOST: 'localhost',
  POSTGRES_USER: 'subtracker-adm',
  POSTGRES_PASSWORD: 'secret',
  POSTGRES_DATABASE: 'subtracker-db',
  POSTGRES_DATABASE_DEV: 'subtracker-db-dev',
  CORS_ORIGINS: 'http://localhost:4200',
  NOTIFICATION_ADMINISTRATOR_MAIL: 'operator@example.com',
};

const smtp = {
  SMTP_HOST: 'mail.example.com',
  SMTP_USERNAME: 'noreply@example.com',
  SMTP_PASSWORD: 'smtp-secret',
  SMTP_FROM_EMAIL: 'noreply@example.com',
};

const notificationSmtp = {
  NOTIFICATION_SMTP_HOST: 'alerts.example.com',
  NOTIFICATION_SMTP_USERNAME: 'alerts-login@example.com',
  NOTIFICATION_SMTP_PASSWORD: 'alerts-secret',
  NOTIFICATION_SMTP_FROM_EMAIL: 'alerts@example.com',
};

function fakeTransport(failure?: unknown): {
  transport: MailTransport;
  sent: MailMessage[];
} {
  const sent: MailMessage[] = [];
  return {
    sent,
    transport: {
      send: (message) => {
        sent.push(message);
        return failure === undefined
          ? Promise.resolve()
          : Promise.reject(failure);
      },
    },
  };
}

describe('sendOperatorTestMail', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends nothing without NOTIFICATION_ADMINISTRATOR_MAIL', async () => {
    const { transport, sent } = fakeTransport();
    const lines: string[] = [];

    const ok = await sendOperatorTestMail(
      validateEnv({ ...devEnv, NOTIFICATION_ADMINISTRATOR_MAIL: '' }),
      transport,
      (line) => lines.push(line),
    );

    expect(ok).toBe(false);
    expect(sent).toEqual([]);
    expect(lines).toEqual(['NOTIFICATION_ADMINISTRATOR_MAIL is not set']);
  });

  it('sends one mail to the operator through the operator channel', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-23T10:15:00Z') });
    const { transport, sent } = fakeTransport();
    const lines: string[] = [];

    const ok = await sendOperatorTestMail(
      validateEnv({ ...devEnv, ...smtp, ...notificationSmtp }),
      transport,
      (line) => lines.push(line),
    );

    expect(ok).toBe(true);
    expect(sent).toHaveLength(1);
    const [mail] = sent;
    expect(mail).toMatchObject({
      channel: 'operator',
      to: 'operator@example.com',
      subject: OPERATOR_TEST_MAIL_SUBJECT,
    });
    // Sent at 11:15 Warsaw time; no host or password in the body.
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain('11:15');
      expect(body).not.toContain('alerts.example.com');
      expect(body).not.toContain('alerts-secret');
    }
  });

  it('reports a refused mail by its code only', async () => {
    const failure = Object.assign(
      new Error('550 mailbox operator@example.com unavailable'),
      {
        code: 'EENVELOPE',
        response: '550 5.7.1 <operator@example.com>: Relay access denied',
      },
    );
    const { transport } = fakeTransport(failure);
    const lines: string[] = [];

    const ok = await sendOperatorTestMail(
      validateEnv({ ...devEnv, ...smtp, ...notificationSmtp }),
      transport,
      (line) => lines.push(line),
    );

    expect(ok).toBe(false);
    expect(lines).toContain(
      'test mail failed (code: EENVELOPE, status: 5.7.1)',
    );
    expect(lines.join('\n')).not.toContain('operator@example.com');
  });

  it('reports a failure without a code as unknown', async () => {
    const { transport } = fakeTransport(new Error('socket hang up'));
    const lines: string[] = [];

    const ok = await sendOperatorTestMail(
      validateEnv(devEnv),
      transport,
      (line) => lines.push(line),
    );

    expect(ok).toBe(false);
    expect(lines).toContain('test mail failed (code: unknown)');
  });

  it.each([
    [
      'separate',
      { ...smtp, ...notificationSmtp },
      'operator channel: separate (alerts@example.com)',
    ],
    ['shared', smtp, 'operator channel: shared with SMTP_* (DEV)'],
    ['console', {}, 'operator channel: console (DEV)'],
  ])(
    'names the %s operator channel before sending',
    async (_name, extra, expected) => {
      const { transport } = fakeTransport();
      const lines: string[] = [];

      await sendOperatorTestMail(
        validateEnv({ ...devEnv, ...extra }),
        transport,
        (line) => lines.push(line),
      );

      expect(lines[0]).toBe(expected);
      const output = lines.join('\n');
      for (const secret of [
        'alerts.example.com',
        'alerts-login@example.com',
        'alerts-secret',
        'mail.example.com',
        'smtp-secret',
      ]) {
        expect(output).not.toContain(secret);
      }
    },
  );
});
