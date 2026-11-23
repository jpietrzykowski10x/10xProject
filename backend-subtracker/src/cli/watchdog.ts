// The watchdog run: `deploy/mydevil/watchdog.sh` starts it from crontab every 5 minutes (on the
// server `cli/watchdog.js` with the API's .env exported). Checks the API, the frontend and the
// jobs reported by /health, and mails the operator by the policy in src/watchdog/. Uses no
// database and no Nest: it must work exactly when the API or the database is down. Exit code 1
// only when it cannot run at all (bad env); every other problem is one line in its log.
import { existsSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { type EnvConfig, validateEnv } from '../config/env.js';
import { createMailTransport } from '../mail/mail.transport.js';
import type { MailContent } from '../mail/mail.types.js';
import {
  type HttpAnswer,
  WATCHDOG_TIMEOUT_MS,
  type WatchdogConfig,
  parseWatchdogState,
  readWatchdogConfig,
  runWatchdog,
} from '../watchdog/run-watchdog.js';
import type { WatchdogState } from '../watchdog/watchdog-policy.js';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function log(line: string): void {
  console.log(`[watchdog ${new Date().toISOString()}] ${line}`);
}

async function get(
  url: string,
  readJson: boolean,
): Promise<HttpAnswer | undefined> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(WATCHDOG_TIMEOUT_MS),
    });
    if (!readJson) {
      await response.body?.cancel();
      return { status: response.status };
    }
    try {
      const json: unknown = await response.json();
      return { status: response.status, json };
    } catch {
      return { status: response.status };
    }
  } catch {
    // Refused, reset or timed out: the target did not answer.
    return undefined;
  }
}

async function readState(file: string): Promise<WatchdogState> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    // No file yet (first run) is normal; anything else is worth a line.
    if (!(
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    )) {
      log(
        `cannot read the state file, starting from an empty state: ${errorText(error)}`,
      );
    }
    return {};
  }
  try {
    return parseWatchdogState(JSON.parse(text));
  } catch {
    log('the state file is damaged, starting from an empty state');
    return {};
  }
}

// Written next to the target and renamed over it, so a run cut short never leaves half a file.
async function writeState(file: string, state: WatchdogState): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function mailSender(env: EnvConfig): (content: MailContent) => Promise<void> {
  const transport = createMailTransport(env);
  const to = env.NOTIFICATION_ADMINISTRATOR_MAIL;
  return async (content) => {
    if (to === undefined) {
      // Reachable only in DEV: validateEnv requires the address in PROD.
      log(
        `NOTIFICATION_ADMINISTRATOR_MAIL is not set, mail only logged: ${content.subject}`,
      );
      return;
    }
    // Straight through the operator transport: no MailService and no `mail` row, the database
    // may be the thing that is down.
    await transport.send({ channel: 'operator', to, ...content });
  };
}

function setup(): { env: EnvConfig; config: WatchdogConfig } | undefined {
  try {
    // Locally, like the role scripts; on the server watchdog.sh exports the variables, which a
    // .env file never overrides.
    if (existsSync('.env')) {
      process.loadEnvFile('.env');
    }
    return {
      env: validateEnv(process.env),
      config: readWatchdogConfig(process.env),
    };
  } catch (error) {
    log(`cannot run: ${errorText(error)}`);
    return undefined;
  }
}

const ready = setup();
if (ready === undefined) {
  process.exitCode = 1;
} else {
  const { env, config } = ready;
  await runWatchdog(config, {
    get,
    readState: () => readState(config.stateFile),
    writeState: (state) => writeState(config.stateFile, state),
    sendMail: mailSender(env),
    log,
    now: () => new Date(),
  });
}
