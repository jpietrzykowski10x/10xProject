import { Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { type Mock } from 'vitest';
import { validateEnv } from '../config/env.js';
import { createMailTransport } from './mail.transport.js';
import type { MailMessage } from './mail.types.js';

vi.mock('nodemailer', () => ({ createTransport: vi.fn() }));

const devEnv = {
  MODE: 'DEV',
  POSTGRES_HOST: 'localhost',
  POSTGRES_USER: 'subtracker-adm',
  POSTGRES_PASSWORD: 'secret',
  POSTGRES_DATABASE: 'subtracker-db',
  POSTGRES_DATABASE_DEV: 'subtracker-db-dev',
  CORS_ORIGINS: 'http://localhost:4200',
};

const smtp = {
  SMTP_HOST: 'mail.example.com',
  SMTP_USERNAME: 'noreply@example.com',
  SMTP_PASSWORD: 'smtp-secret',
  SMTP_FROM_EMAIL: 'noreply@example.com',
};

const notificationSmtp = {
  NOTIFICATION_SMTP_HOST: 'alerts.example.com',
  NOTIFICATION_SMTP_USERNAME: 'alerts@example.com',
  NOTIFICATION_SMTP_PASSWORD: 'alerts-secret',
  NOTIFICATION_SMTP_FROM_EMAIL: 'alerts@example.com',
};

const message = (channel: MailMessage['channel']): MailMessage => ({
  channel,
  to: 'jan@example.com',
  subject: 'Temat',
  text: 'link-w-tekscie',
  html: '<p>link-w-tekscie</p>',
});

describe('createMailTransport', () => {
  const sendMailByHost = new Map<string, Mock>();

  beforeEach(() => {
    sendMailByHost.clear();
    vi.mocked(createTransport).mockImplementation(((options: {
      host: string;
    }) => {
      const sendMail = vi.fn().mockResolvedValue({});
      sendMailByHost.set(options.host, sendMail);
      return { sendMail };
    }) as unknown as typeof createTransport);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(createTransport).mockReset();
  });

  it('logs recipient and body in DEV without SMTP_HOST', async () => {
    const log = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    const transport = createMailTransport(validateEnv(devEnv));
    await expect(transport.send(message('user'))).resolves.toBeUndefined();

    expect(createTransport).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/jan@example\.com[\s\S]*link-w-tekscie/),
    );
  });

  it('requires STARTTLS unless the connection is already TLS', () => {
    createMailTransport(validateEnv({ ...devEnv, ...smtp }));
    expect(createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ secure: false, requireTLS: true }),
    );

    createMailTransport(
      validateEnv({ ...devEnv, ...smtp, SMTP_SECURE: 'true' }),
    );
    expect(createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ secure: true, requireTLS: false }),
    );
  });

  it('sends operator mail through SMTP_* when NOTIFICATION_SMTP_HOST is empty', async () => {
    const transport = createMailTransport(
      validateEnv({ ...devEnv, ...smtp, NOTIFICATION_SMTP_HOST: '' }),
    );
    await transport.send(message('operator'));

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(sendMailByHost.get('mail.example.com')).toHaveBeenCalledTimes(1);
  });

  it('routes each channel to its own transporter', async () => {
    const transport = createMailTransport(
      validateEnv({ ...devEnv, ...smtp, ...notificationSmtp }),
    );
    await transport.send(message('user'));
    await transport.send(message('operator'));

    expect(sendMailByHost.get('mail.example.com')).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: 'SubTracker', address: 'noreply@example.com' },
      }),
    );
    expect(sendMailByHost.get('alerts.example.com')).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: 'SubTracker', address: 'alerts@example.com' },
      }),
    );
  });

  it('propagates an SMTP failure to the caller', async () => {
    const transport = createMailTransport(validateEnv({ ...devEnv, ...smtp }));
    sendMailByHost
      .get('mail.example.com')
      ?.mockRejectedValue(new Error('connection refused'));

    await expect(transport.send(message('user'))).rejects.toThrow(
      'connection refused',
    );
  });
});
