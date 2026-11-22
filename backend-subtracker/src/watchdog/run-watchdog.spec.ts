import type { MailContent } from '../mail/mail.types.js';
import {
  type HttpAnswer,
  type WatchdogConfig,
  type WatchdogDeps,
  jobsProblemOf,
  parseWatchdogState,
  readWatchdogConfig,
  runWatchdog,
} from './run-watchdog.js';
import type { WatchdogState } from './watchdog-policy.js';

const CONFIG: WatchdogConfig = {
  apiPort: 3000,
  frontendPort: 4000,
  stateFile: 'state.json',
};
const API_URL = 'http://localhost:3000/health';
const FRONTEND_URL = 'http://localhost:4000/';
const NOW = new Date('2026-11-22T10:00:00.000Z');

const ALL_OK = {
  'subscription-lifecycle': 'ok',
  'auth-cleanup': 'ok',
  'trial-reminder': 'ok',
};

function apiAnswer(jobs: unknown = ALL_OK): HttpAnswer {
  return { status: 200, json: { status: 'ok', db: 'ok', jobs } };
}

interface Fake {
  deps: WatchdogDeps;
  mails: MailContent[];
  lines: string[];
  written: () => WatchdogState | undefined;
}

function fake(options: {
  api?: HttpAnswer;
  frontend?: HttpAnswer;
  state?: WatchdogState;
  mailFails?: boolean;
}): Fake {
  const mails: MailContent[] = [];
  const lines: string[] = [];
  let written: WatchdogState | undefined;
  const deps: WatchdogDeps = {
    get: (url) =>
      Promise.resolve(url === API_URL ? options.api : options.frontend),
    readState: () => Promise.resolve(options.state ?? {}),
    writeState: (state) => {
      written = state;
      return Promise.resolve();
    },
    sendMail: (content) => {
      if (options.mailFails) {
        return Promise.reject(new Error('SMTP down'));
      }
      mails.push(content);
      return Promise.resolve();
    },
    log: (line) => lines.push(line),
    now: () => NOW,
  };
  return { deps, mails, lines, written: () => written };
}

const DOWN_TWICE = {
  failures: 2,
  alerted: false,
  firstFailureAt: '2026-11-22T09:50:00.000Z',
};

describe('runWatchdog', () => {
  it('stays quiet and stores a clean state when everything is healthy', async () => {
    const run = fake({ api: apiAnswer(), frontend: { status: 200 } });

    await runWatchdog(CONFIG, run.deps);

    expect(run.mails).toEqual([]);
    expect(run.lines).toEqual([]);
    expect(run.written()).toEqual({
      api: { failures: 0, alerted: false },
      frontend: { failures: 0, alerted: false },
      jobs: { failures: 0, alerted: false },
    });
  });

  it('checks the API health and the frontend root on localhost', async () => {
    const run = fake({ api: apiAnswer(), frontend: { status: 200 } });
    const get = vi.spyOn(run.deps, 'get');

    await runWatchdog(CONFIG, run.deps);

    expect(get).toHaveBeenCalledWith(API_URL, true);
    expect(get).toHaveBeenCalledWith(FRONTEND_URL, false);
  });

  it('mails "API nie odpowiada" on the third failure without an answer', async () => {
    const run = fake({ frontend: { status: 200 }, state: { api: DOWN_TWICE } });

    await runWatchdog(CONFIG, run.deps);

    expect(run.mails.map((mail) => mail.subject)).toEqual([
      'SubTracker: API nie odpowiada',
    ]);
    expect(run.mails[0].text).toContain('kolejne nieudane sprawdzenia: 3');
    expect(run.lines).toHaveLength(1);
    expect(run.written()?.api).toMatchObject({ failures: 3, alerted: true });
  });

  it.each<[string, HttpAnswer]>([
    ['a 503', { status: 503, json: { status: 'error', db: 'error' } }],
    ['a 200 that is not JSON', { status: 200 }],
    ['a 200 without status ok', { status: 200, json: { status: 'error' } }],
  ])('counts %s from /health as an API failure', async (_name, answer) => {
    const run = fake({ api: answer, frontend: { status: 200 } });

    await runWatchdog(CONFIG, run.deps);

    expect(run.written()?.api).toMatchObject({ failures: 1 });
  });

  it('counts a non-2xx frontend answer as a failure', async () => {
    const run = fake({ api: apiAnswer(), frontend: { status: 502 } });

    await runWatchdog(CONFIG, run.deps);

    expect(run.written()?.frontend).toMatchObject({ failures: 1 });
  });

  it('leaves the jobs target untouched while the API is down', async () => {
    const jobsDown = {
      failures: 7,
      alerted: true,
      lastMailAt: '2026-11-22T09:00:00.000Z',
      firstFailureAt: '2026-11-22T08:00:00.000Z',
    };
    const run = fake({ frontend: { status: 200 }, state: { jobs: jobsDown } });

    await runWatchdog(CONFIG, run.deps);

    expect(run.written()?.jobs).toEqual(jobsDown);
    expect(run.mails).toEqual([]);
  });

  it('alerts about a stale job on its third failed check', async () => {
    const run = fake({
      api: apiAnswer({ ...ALL_OK, 'trial-reminder': 'stale' }),
      frontend: { status: 200 },
      state: { jobs: DOWN_TWICE },
    });

    await runWatchdog(CONFIG, run.deps);

    expect(run.mails.map((mail) => mail.subject)).toEqual([
      'SubTracker: zadanie cykliczne nie ruszyło od 26 h',
    ]);
    expect(run.mails[0].text).toContain('trial-reminder');
  });

  it('does not count a failed job: the API mails about it itself', async () => {
    const run = fake({
      api: apiAnswer({ ...ALL_OK, 'auth-cleanup': 'failed' }),
      frontend: { status: 200 },
      state: { jobs: DOWN_TWICE },
    });

    await runWatchdog(CONFIG, run.deps);

    expect(run.written()?.jobs).toEqual({ failures: 0, alerted: false });
    expect(run.mails).toEqual([]);
  });

  it('counts a 200 from /health without a readable jobs field as a jobs failure', async () => {
    const run = fake({
      api: { status: 200, json: { status: 'ok', db: 'ok' } },
      frontend: { status: 200 },
      state: { jobs: DOWN_TWICE },
    });

    await runWatchdog(CONFIG, run.deps);

    expect(run.written()?.api).toEqual({ failures: 0, alerted: false });
    expect(run.mails.map((mail) => mail.subject)).toEqual([
      'SubTracker: stan zadań cyklicznych nieczytelny',
    ]);
  });

  it('keeps the state unsent when the mail fails, so the next run tries again', async () => {
    const run = fake({
      frontend: { status: 200 },
      state: { api: DOWN_TWICE },
      mailFails: true,
    });

    await runWatchdog(CONFIG, run.deps);

    expect(run.written()?.api).toEqual({ ...DOWN_TWICE, failures: 3 });
    expect(run.lines).toEqual([
      'api: alert-down, mail FAILED (retried on the next run): SMTP down',
    ]);
  });

  it('mails "API działa ponownie" once the API answers after an alert', async () => {
    const run = fake({
      api: apiAnswer(),
      frontend: { status: 200 },
      state: {
        api: {
          failures: 5,
          alerted: true,
          lastMailAt: '2026-11-22T09:45:00.000Z',
          firstFailureAt: '2026-11-22T09:35:00.000Z',
        },
      },
    });

    await runWatchdog(CONFIG, run.deps);

    expect(run.mails.map((mail) => mail.subject)).toEqual([
      'SubTracker: API działa ponownie',
    ]);
    expect(run.mails[0].text).toContain('kolejne nieudane sprawdzenia: 5');
    expect(run.written()?.api).toEqual({ failures: 0, alerted: false });
  });

  it('logs its own error and does not throw when the state cannot be written', async () => {
    const run = fake({ api: apiAnswer(), frontend: { status: 200 } });
    run.deps.writeState = () => Promise.reject(new Error('disk full'));

    await expect(runWatchdog(CONFIG, run.deps)).resolves.toBeUndefined();

    expect(run.lines).toEqual(['watchdog run failed: disk full']);
  });
});

describe('jobsProblemOf', () => {
  it('reports nothing when every job is ok or failed', () => {
    expect(
      jobsProblemOf({ jobs: { ...ALL_OK, 'auth-cleanup': 'failed' } }),
    ).toBeUndefined();
  });

  it('lists the stale jobs', () => {
    expect(
      jobsProblemOf({
        jobs: { ...ALL_OK, 'auth-cleanup': 'stale', 'trial-reminder': 'stale' },
      }),
    ).toEqual({ kind: 'stale', jobs: ['auth-cleanup', 'trial-reminder'] });
  });

  it.each([
    ['missing', {}],
    ['not an object', { jobs: 'ok' }],
    ['missing a job', { jobs: { 'auth-cleanup': 'ok' } }],
    [
      'with an unknown value',
      { jobs: { ...ALL_OK, 'auth-cleanup': 'broken' } },
    ],
  ])('reports an unreadable jobs field when it is %s', (_name, body) => {
    expect(jobsProblemOf(body)).toEqual({ kind: 'unreadable' });
  });
});

describe('parseWatchdogState', () => {
  it('keeps valid targets and drops anything else', () => {
    expect(
      parseWatchdogState({
        api: { failures: 2, alerted: false },
        frontend: { failures: 'two', alerted: false },
        jobs: null,
        other: { failures: 1, alerted: false },
      }),
    ).toEqual({ api: { failures: 2, alerted: false } });
  });

  it.each([null, [], 'text', 42])('treats %j as an empty state', (raw) => {
    expect(parseWatchdogState(raw)).toEqual({});
  });
});

describe('readWatchdogConfig', () => {
  it('reads the ports and the state file', () => {
    expect(
      readWatchdogConfig({
        WATCHDOG_API_PORT: '3000',
        WATCHDOG_FRONTEND_PORT: ' 4000 ',
        WATCHDOG_STATE_FILE: '/home/x/state.json',
      }),
    ).toEqual({
      apiPort: 3000,
      frontendPort: 4000,
      stateFile: '/home/x/state.json',
    });
  });

  it.each([
    [
      { WATCHDOG_FRONTEND_PORT: '4000', WATCHDOG_STATE_FILE: 's' },
      /WATCHDOG_API_PORT/,
    ],
    [
      {
        WATCHDOG_API_PORT: 'x',
        WATCHDOG_FRONTEND_PORT: '4000',
        WATCHDOG_STATE_FILE: 's',
      },
      /WATCHDOG_API_PORT/,
    ],
    [
      {
        WATCHDOG_API_PORT: '3000',
        WATCHDOG_FRONTEND_PORT: '0',
        WATCHDOG_STATE_FILE: 's',
      },
      /WATCHDOG_FRONTEND_PORT/,
    ],
    [
      {
        WATCHDOG_API_PORT: '3000',
        WATCHDOG_FRONTEND_PORT: '4000',
        WATCHDOG_STATE_FILE: ' ',
      },
      /WATCHDOG_STATE_FILE/,
    ],
  ])('refuses a bad setting', (raw, message) => {
    expect(() => readWatchdogConfig(raw)).toThrow(message);
  });
});
