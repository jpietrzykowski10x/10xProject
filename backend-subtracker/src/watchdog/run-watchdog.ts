import type { JobHealth } from '../jobs/job-health.js';
import { JOB_NAMES } from '../jobs/job-run.types.js';
import type { MailContent } from '../mail/mail.types.js';
import { type JobsProblem, watchdogMail } from './watchdog-mail.js';
import {
  type Decision,
  type TargetState,
  WATCHDOG_TARGETS,
  type WatchdogState,
  type WatchdogTarget,
  decide,
  keepUnsent,
} from './watchdog-policy.js';

// A check that gets no answer within this time counts as a failure.
export const WATCHDOG_TIMEOUT_MS = 5_000;

export interface WatchdogConfig {
  apiPort: number;
  frontendPort: number;
  stateFile: string;
}

// The answer to a GET, or undefined when there was none (refused, timed out). `json` is the
// parsed body when asked for and readable.
export interface HttpAnswer {
  status: number;
  json?: unknown;
}

// Everything the run touches outside itself, so the tests can replace it.
export interface WatchdogDeps {
  get(url: string, readJson: boolean): Promise<HttpAnswer | undefined>;
  readState(): Promise<WatchdogState>;
  writeState(state: WatchdogState): Promise<void>;
  sendMail(content: MailContent): Promise<void>;
  log(line: string): void;
  now(): Date;
}

function readPort(raw: Record<string, unknown>, key: string): number {
  const value = raw[key];
  const port = typeof value === 'string' ? Number(value.trim()) : Number.NaN;
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`${key} must be a TCP port, got "${String(value)}"`);
  }
  return port;
}

// The settings watchdog.sh passes next to the API's .env.
export function readWatchdogConfig(
  raw: Record<string, unknown>,
): WatchdogConfig {
  const stateFile = raw.WATCHDOG_STATE_FILE;
  if (typeof stateFile !== 'string' || stateFile.trim().length === 0) {
    throw new Error(
      'Missing required environment variable WATCHDOG_STATE_FILE',
    );
  }
  return {
    apiPort: readPort(raw, 'WATCHDOG_API_PORT'),
    frontendPort: readPort(raw, 'WATCHDOG_FRONTEND_PORT'),
    stateFile: stateFile.trim(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTargetState(value: unknown): value is TargetState {
  return (
    isRecord(value) &&
    typeof value.failures === 'number' &&
    Number.isInteger(value.failures) &&
    value.failures >= 0 &&
    typeof value.alerted === 'boolean' &&
    (value.lastMailAt === undefined || typeof value.lastMailAt === 'string') &&
    (value.firstFailureAt === undefined ||
      typeof value.firstFailureAt === 'string')
  );
}

// The stored state from the parsed file. Anything unexpected counts as no state for that target,
// so a damaged file costs at most a delayed alert, never a crash.
export function parseWatchdogState(raw: unknown): WatchdogState {
  const state: WatchdogState = {};
  if (!isRecord(raw)) {
    return state;
  }
  for (const target of WATCHDOG_TARGETS) {
    const entry = raw[target];
    if (isTargetState(entry)) {
      state[target] = entry;
    }
  }
  return state;
}

const JOB_HEALTH_VALUES: readonly JobHealth[] = ['ok', 'stale', 'failed'];

// What /health says about the jobs: undefined when all is well. A `failed` job is not a problem
// here, the API mails the operator about it itself. A missing or malformed `jobs` field is: /health
// leaves it out when the job register cannot be read.
export function jobsProblemOf(
  body: Record<string, unknown>,
): JobsProblem | undefined {
  const jobs = body.jobs;
  if (!isRecord(jobs)) {
    return { kind: 'unreadable' };
  }
  const stale: string[] = [];
  for (const job of JOB_NAMES) {
    const health = jobs[job];
    if (!JOB_HEALTH_VALUES.some((value) => value === health)) {
      return { kind: 'unreadable' };
    }
    if (health === 'stale') {
      stale.push(job);
    }
  }
  return stale.length > 0 ? { kind: 'stale', jobs: stale } : undefined;
}

function is2xx(answer: HttpAnswer | undefined): answer is HttpAnswer {
  return answer !== undefined && answer.status >= 200 && answer.status < 300;
}

interface Checks {
  // undefined = not judged this time (the `jobs` target while the API is down).
  healthy: Partial<Record<WatchdogTarget, boolean>>;
  jobsProblem?: JobsProblem;
}

async function check(
  config: WatchdogConfig,
  deps: WatchdogDeps,
): Promise<Checks> {
  const [api, frontend] = await Promise.all([
    deps.get(`http://localhost:${config.apiPort}/health`, true),
    deps.get(`http://localhost:${config.frontendPort}/`, false),
  ]);
  const apiBody =
    is2xx(api) && isRecord(api.json) && api.json.status === 'ok'
      ? api.json
      : undefined;
  const checks: Checks = {
    healthy: { api: apiBody !== undefined, frontend: is2xx(frontend) },
  };
  if (apiBody !== undefined) {
    checks.jobsProblem = jobsProblemOf(apiBody);
    checks.healthy.jobs = checks.jobsProblem === undefined;
  }
  return checks;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'non-error value thrown';
}

// One watchdog run: check the targets, decide per target, mail the operator, store the state.
// Logs one line per mail (sent or not) and per own error; a quiet run logs nothing. Never throws.
export async function runWatchdog(
  config: WatchdogConfig,
  deps: WatchdogDeps,
): Promise<void> {
  try {
    const now = deps.now();
    const [state, checks] = await Promise.all([
      deps.readState(),
      check(config, deps),
    ]);
    const next: WatchdogState = { ...state };

    for (const target of WATCHDOG_TARGETS) {
      const healthy = checks.healthy[target];
      if (healthy === undefined) {
        continue;
      }
      const previous = state[target];
      const decision: Decision = decide(previous, healthy, now);
      next[target] = decision.next;
      if (decision.action === 'none') {
        continue;
      }

      const failed = decision.action === 'recovered' ? previous : decision.next;
      const mail = watchdogMail({
        target,
        action: decision.action,
        failures: failed?.failures ?? 0,
        firstFailureAt: failed?.firstFailureAt,
        now,
        ...(target === 'jobs' &&
          checks.jobsProblem !== undefined && { jobs: checks.jobsProblem }),
      });
      try {
        await deps.sendMail(mail);
        deps.log(`${target}: ${decision.action}, mail sent: ${mail.subject}`);
      } catch (error) {
        next[target] = keepUnsent(previous, decision);
        deps.log(
          `${target}: ${decision.action}, mail FAILED (retried on the next run): ${errorText(error)}`,
        );
      }
    }

    await deps.writeState(next);
  } catch (error) {
    deps.log(`watchdog run failed: ${errorText(error)}`);
  }
}
