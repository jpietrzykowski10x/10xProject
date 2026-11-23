// The alert policy of the watchdog (deploy/mydevil/watchdog.sh, every 5 minutes from crontab), as
// pure functions: no network, no files, no clock.

// A target is reported down only after this many consecutive failed checks (15 minutes at one
// check per 5 minutes), so a restart or a slow deploy step does not mail the operator.
export const FAILURES_BEFORE_ALERT = 3;

// While a target stays down, the operator is reminded this often.
export const REMIND_EVERY_HOURS = 12;

const HOUR_MS = 60 * 60 * 1000;

// api = GET /health of the API, frontend = GET / of the SSR server, jobs = the `jobs` field of
// /health (judged only while the API itself is healthy).
export const WATCHDOG_TARGETS = ['api', 'frontend', 'jobs'] as const;
export type WatchdogTarget = (typeof WATCHDOG_TARGETS)[number];

export interface TargetState {
  // Consecutive failed checks; 0 after a healthy one.
  failures: number;
  // An alert about the current failure has been sent (and the recovery mail not yet).
  alerted: boolean;
  // ISO time of the last mail about this target.
  lastMailAt?: string;
  // ISO time of the first failed check of the current failure, shown in the mails.
  firstFailureAt?: string;
}

export type WatchdogState = Partial<Record<WatchdogTarget, TargetState>>;

export type WatchdogAction =
  'none' | 'alert-down' | 'remind-down' | 'recovered';

export interface Decision {
  next: TargetState;
  action: WatchdogAction;
}

const HEALTHY_STATE: TargetState = { failures: 0, alerted: false };

function reminderDue(lastMailAt: string | undefined, now: Date): boolean {
  const last = lastMailAt === undefined ? Number.NaN : Date.parse(lastMailAt);
  // A missing or unreadable time must not silence a target that is down for good.
  return (
    Number.isNaN(last) || now.getTime() - last >= REMIND_EVERY_HOURS * HOUR_MS
  );
}

// The next state of one target after a check, and the mail it calls for. `next` assumes the mail
// goes out; when it does not, keepUnsent gives the state to store instead.
export function decide(
  state: TargetState | undefined,
  healthy: boolean,
  now: Date,
): Decision {
  const previous = state ?? HEALTHY_STATE;
  if (healthy) {
    return {
      next: { ...HEALTHY_STATE },
      action: previous.alerted ? 'recovered' : 'none',
    };
  }

  const failures = previous.failures + 1;
  const firstFailureAt =
    previous.failures > 0 && previous.firstFailureAt !== undefined
      ? previous.firstFailureAt
      : now.toISOString();
  const failing: TargetState = { ...previous, failures, firstFailureAt };

  if (!previous.alerted) {
    // `>=`, not `===`: an alert whose mail failed is retried on the next check.
    return failures >= FAILURES_BEFORE_ALERT
      ? {
          next: { ...failing, alerted: true, lastMailAt: now.toISOString() },
          action: 'alert-down',
        }
      : { next: failing, action: 'none' };
  }
  return reminderDue(previous.lastMailAt, now)
    ? {
        next: { ...failing, lastMailAt: now.toISOString() },
        action: 'remind-down',
      }
    : { next: failing, action: 'none' };
}

// The state to store when the mail of a decision could not be sent: the failure count moves on,
// but `alerted` and `lastMailAt` stay as they were, so the next check tries the mail again.
export function keepUnsent(
  state: TargetState | undefined,
  decision: Decision,
): TargetState {
  const previous = state ?? HEALTHY_STATE;
  // A failed recovery mail keeps the failure as it was (its count and start) for the retry on the
  // next check: the operator has not heard of the recovery, so for them the failure goes on. A new
  // failure before that retry continues it (count + 1, same start, reminder 12 h after the last
  // mail the operator did get) instead of opening a new one with a fresh "down" alert.
  const unsentRecovery = decision.action === 'recovered';
  const firstFailureAt = unsentRecovery
    ? previous.firstFailureAt
    : decision.next.firstFailureAt;
  return {
    failures: unsentRecovery ? previous.failures : decision.next.failures,
    alerted: previous.alerted,
    ...(previous.lastMailAt !== undefined && {
      lastMailAt: previous.lastMailAt,
    }),
    ...(firstFailureAt !== undefined && { firstFailureAt }),
  };
}
