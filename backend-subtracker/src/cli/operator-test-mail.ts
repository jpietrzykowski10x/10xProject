// `npm run operator:test-mail`: sends one test mail to NOTIFICATION_ADMINISTRATOR_MAIL through
// the operator channel, so the operator can check, locally or on the server (`cli/
// operator-test-mail.js` with the API's .env exported), that alerts go out. Uses no database and
// no Nest, so neither the API nor the cron runs are touched. Exit code 0 only when the mail was
// accepted by the transport.
import { existsSync } from 'node:fs';
import { type EnvConfig, validateEnv } from '../config/env.js';
import { createMailTransport } from '../mail/mail.transport.js';
import { sendOperatorTestMail } from '../mail/operator-test-mail.js';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function log(line: string): void {
  console.log(`[operator-test-mail ${new Date().toISOString()}] ${line}`);
}

function setup(): EnvConfig | undefined {
  try {
    // Locally, like the watchdog; on the server the exported variables win over a .env file.
    if (existsSync('.env')) {
      process.loadEnvFile('.env');
    }
    return validateEnv(process.env);
  } catch (error) {
    log(`cannot run: ${errorText(error)}`);
    return undefined;
  }
}

const env = setup();
if (env === undefined) {
  process.exitCode = 1;
} else {
  const ok = await sendOperatorTestMail(env, createMailTransport(env), log);
  process.exitCode = ok ? 0 : 1;
}
