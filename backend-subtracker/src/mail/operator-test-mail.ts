import type { EnvConfig } from '../config/env.js';
import { APP_TIME_ZONE } from '../shared/date/calendar-day.js';
import { escapeHtml } from './escape-html.js';
import type { MailTransport } from './mail.transport.js';
import type { MailContent } from './mail.types.js';
import { smtpFailureDetails } from './smtp-error.js';

export const OPERATOR_TEST_MAIL_SUBJECT = 'SubTracker: test kanału alarmów';

// Which transporter createMailTransport picks for the operator channel. Names only the sender
// address, never the host, login or password: the line ends up in a terminal or a server log.
function channelLine(env: EnvConfig): string {
  if (env.NOTIFICATION_SMTP_HOST !== undefined) {
    return `operator channel: separate (${env.NOTIFICATION_SMTP_FROM_EMAIL ?? 'unknown'})`;
  }
  // Reachable only in DEV: validateEnv requires NOTIFICATION_SMTP_HOST in PROD.
  return env.SMTP_HOST !== undefined
    ? 'operator channel: shared with SMTP_* (DEV)'
    : 'operator channel: console (DEV)';
}

function testMail(now: Date): MailContent {
  const sentAt = `${now.toLocaleString('pl-PL', { timeZone: APP_TIME_ZONE })} (${APP_TIME_ZONE})`;
  const sentence =
    'To jest mail testowy kanału alarmów. Skoro dotarł, alarmy o awariach też dotrą.';
  const line = `wysłano: ${sentAt}`;
  const footer = 'Wysłany ręcznie skryptem operator:test-mail.';
  return {
    subject: OPERATOR_TEST_MAIL_SUBJECT,
    text: `${sentence}\n${line}\n${footer}`,
    html: `<p>${escapeHtml(sentence)}</p><p>${escapeHtml(line)}</p><p>${escapeHtml(footer)}</p>`,
  };
}

// Sends one test mail through the operator channel, the way the alerts go (no MailService, no
// `mail` row). Resolves to whether the transport accepted it; never rejects. On failure it logs
// the error code and the SMTP enhanced status only: the full message can quote the address.
export async function sendOperatorTestMail(
  env: EnvConfig,
  transport: MailTransport,
  log: (line: string) => void,
): Promise<boolean> {
  const to = env.NOTIFICATION_ADMINISTRATOR_MAIL;
  if (to === undefined) {
    log('NOTIFICATION_ADMINISTRATOR_MAIL is not set');
    return false;
  }
  log(channelLine(env));
  try {
    await transport.send({ channel: 'operator', to, ...testMail(new Date()) });
  } catch (error) {
    log(`test mail failed (${smtpFailureDetails(error)})`);
    return false;
  }
  log('test mail accepted by the operator transport');
  return true;
}
