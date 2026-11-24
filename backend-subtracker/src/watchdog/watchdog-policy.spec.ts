import {
  FAILURES_BEFORE_ALERT,
  REMIND_EVERY_HOURS,
  type TargetState,
  decide,
  keepUnsent,
} from './watchdog-policy.js';

const HOUR_MS = 60 * 60 * 1000;
const START = new Date('2026-11-22T10:00:00.000Z');

function at(minutes: number): Date {
  return new Date(START.getTime() + minutes * 60 * 1000);
}

// Runs consecutive failed checks 5 minutes apart and returns every action and the last state.
function failChecks(
  count: number,
  from?: TargetState,
): { actions: string[]; state: TargetState | undefined } {
  let state = from;
  const actions: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const decision = decide(state, false, at(i * 5));
    actions.push(decision.action);
    state = decision.next;
  }
  return { actions, state };
}

describe('decide', () => {
  it('uses the policy agreed for S-11', () => {
    expect(FAILURES_BEFORE_ALERT).toBe(3);
    expect(REMIND_EVERY_HOURS).toBe(12);
  });

  it('sends no mail on the first and the second failure', () => {
    const { actions, state } = failChecks(2);

    expect(actions).toEqual(['none', 'none']);
    expect(state).toEqual({
      failures: 2,
      alerted: false,
      firstFailureAt: START.toISOString(),
    });
  });

  it('alerts on the third consecutive failure', () => {
    const { actions, state } = failChecks(3);

    expect(actions).toEqual(['none', 'none', 'alert-down']);
    expect(state).toEqual({
      failures: 3,
      alerted: true,
      lastMailAt: at(10).toISOString(),
      firstFailureAt: START.toISOString(),
    });
  });

  it('starts counting again after a healthy check', () => {
    const { state: twoFailures } = failChecks(2);
    const healthy = decide(twoFailures, true, at(10));

    expect(healthy).toEqual({
      next: { failures: 0, alerted: false },
      action: 'none',
    });
    expect(decide(healthy.next, false, at(15)).action).toBe('none');
  });

  it('stays quiet while the target is down for less than 12 h after the alert', () => {
    const alerted: TargetState = {
      failures: 3,
      alerted: true,
      lastMailAt: START.toISOString(),
      firstFailureAt: at(-10).toISOString(),
    };
    const almost = new Date(START.getTime() + REMIND_EVERY_HOURS * HOUR_MS - 1);

    const decision = decide(alerted, false, almost);

    expect(decision.action).toBe('none');
    expect(decision.next).toEqual({ ...alerted, failures: 4 });
  });

  it('reminds once 12 h have passed since the last mail', () => {
    const alerted: TargetState = {
      failures: 147,
      alerted: true,
      lastMailAt: START.toISOString(),
      firstFailureAt: at(-10).toISOString(),
    };
    const due = new Date(START.getTime() + REMIND_EVERY_HOURS * HOUR_MS);

    const decision = decide(alerted, false, due);

    expect(decision.action).toBe('remind-down');
    expect(decision.next).toEqual({
      failures: 148,
      alerted: true,
      lastMailAt: due.toISOString(),
      firstFailureAt: at(-10).toISOString(),
    });
    expect(decide(decision.next, false, at(12 * 60 + 5)).action).toBe('none');
  });

  // Literal times, so a changed REMIND_EVERY_HOURS shows up here too.
  it('stays quiet at 11 h 59 min after the last mail and reminds at 12 h', () => {
    const alerted: TargetState = {
      failures: 3,
      alerted: true,
      lastMailAt: START.toISOString(),
      firstFailureAt: at(-10).toISOString(),
    };

    expect(decide(alerted, false, at(11 * 60 + 59)).action).toBe('none');
    expect(decide(alerted, false, at(12 * 60)).action).toBe('remind-down');
  });

  it('reminds when the time of the last mail is missing or unreadable', () => {
    expect(decide({ failures: 5, alerted: true }, false, START).action).toBe(
      'remind-down',
    );
    expect(
      decide(
        { failures: 5, alerted: true, lastMailAt: 'garbage' },
        false,
        START,
      ).action,
    ).toBe('remind-down');
  });

  it('sends one recovery mail after an alert and resets the state', () => {
    const { state } = failChecks(3);

    const recovered = decide(state, true, at(20));

    expect(recovered).toEqual({
      next: { failures: 0, alerted: false },
      action: 'recovered',
    });
    expect(decide(recovered.next, true, at(25)).action).toBe('none');
  });

  it('sends no mail for a healthy check without an alert', () => {
    expect(decide(undefined, true, START)).toEqual({
      next: { failures: 0, alerted: false },
      action: 'none',
    });
  });
});

describe('keepUnsent', () => {
  it('retries the alert on the next failure when its mail failed', () => {
    const { state: twoFailures } = failChecks(2);
    const alert = decide(twoFailures, false, at(10));

    const stored = keepUnsent(twoFailures, alert);

    expect(stored).toEqual({
      failures: 3,
      alerted: false,
      firstFailureAt: START.toISOString(),
    });
    expect(decide(stored, false, at(15)).action).toBe('alert-down');
  });

  it('keeps the time of the last mail when a reminder failed', () => {
    const alerted: TargetState = {
      failures: 200,
      alerted: true,
      lastMailAt: START.toISOString(),
      firstFailureAt: at(-10).toISOString(),
    };
    const due = new Date(START.getTime() + REMIND_EVERY_HOURS * HOUR_MS);
    const remind = decide(alerted, false, due);

    const stored = keepUnsent(alerted, remind);

    expect(stored).toEqual({ ...alerted, failures: 201 });
    expect(decide(stored, false, at(12 * 60 + 5)).action).toBe('remind-down');
  });

  it('stays alerted when the recovery mail failed, so the next healthy check sends it', () => {
    const { state } = failChecks(3);
    const recovered = decide(state, true, at(20));

    const stored = keepUnsent(state, recovered);

    expect(stored).toEqual({
      failures: 3,
      alerted: true,
      lastMailAt: at(10).toISOString(),
      firstFailureAt: START.toISOString(),
    });
    expect(decide(stored, true, at(25)).action).toBe('recovered');
  });

  it('continues the failure when the target fails again before the recovery mail went out', () => {
    const { state } = failChecks(3);
    const stored = keepUnsent(state, decide(state, true, at(20)));

    const again = decide(stored, false, at(25));

    expect(again.action).toBe('none');
    expect(again.next).toEqual({
      failures: 4,
      alerted: true,
      lastMailAt: at(10).toISOString(),
      firstFailureAt: START.toISOString(),
    });
  });
});
