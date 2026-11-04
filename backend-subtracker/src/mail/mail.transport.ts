import { Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import type { EnvConfig } from '../config/env.js';
import type { MailMessage } from './mail.types.js';

// DI token: e2e tests override it with a fake to capture outgoing mail.
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

type Send = MailTransport['send'];

interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
}

function smtpSender(settings: SmtpSettings): Send {
  const transporter = createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    // Without this nodemailer falls back to plaintext when STARTTLS is not offered or gets stripped.
    requireTLS: !settings.secure,
    auth: { user: settings.username, pass: settings.password },
  });
  return async (message) => {
    await transporter.sendMail({
      from: { name: settings.fromName, address: settings.fromEmail },
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  };
}

function consoleSender(): Send {
  const logger = new Logger('ConsoleMailTransport');
  return (message) => {
    logger.log(
      `No SMTP_HOST, not sending. To: ${message.to}\nSubject: ${message.subject}\n${message.text}`,
    );
    return Promise.resolve();
  };
}

function userSmtpSettings(env: EnvConfig): SmtpSettings | undefined {
  const { SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_EMAIL } = env;
  if (!SMTP_HOST || !SMTP_USERNAME || !SMTP_PASSWORD || !SMTP_FROM_EMAIL) {
    return undefined;
  }
  return {
    host: SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    username: SMTP_USERNAME,
    password: SMTP_PASSWORD,
    fromEmail: SMTP_FROM_EMAIL,
    fromName: env.SMTP_FROM_NAME,
  };
}

function notificationSmtpSettings(env: EnvConfig): SmtpSettings | undefined {
  const host = env.NOTIFICATION_SMTP_HOST;
  const username = env.NOTIFICATION_SMTP_USERNAME;
  const password = env.NOTIFICATION_SMTP_PASSWORD;
  const fromEmail = env.NOTIFICATION_SMTP_FROM_EMAIL;
  if (!host || !username || !password || !fromEmail) {
    return undefined;
  }
  return {
    host,
    port: env.NOTIFICATION_SMTP_PORT,
    secure: env.NOTIFICATION_SMTP_SECURE,
    username,
    password,
    fromEmail,
    fromName: env.SMTP_FROM_NAME,
  };
}

// validateEnv guarantees SMTP_HOST in PROD, so the console sender is reachable only in DEV. It
// prints the mail body, sign-in links included, which must never reach production logs.
export function createMailTransport(env: EnvConfig): MailTransport {
  const userSettings = userSmtpSettings(env);
  const notificationSettings = notificationSmtpSettings(env);

  const sendToUser = userSettings ? smtpSender(userSettings) : consoleSender();
  const sendToOperator = notificationSettings
    ? smtpSender(notificationSettings)
    : sendToUser;

  return {
    send: (message) =>
      message.channel === 'operator'
        ? sendToOperator(message)
        : sendToUser(message),
  };
}
