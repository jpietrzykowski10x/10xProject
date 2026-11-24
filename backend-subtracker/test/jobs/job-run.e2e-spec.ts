import { Logger } from '@nestjs/common';
import { MoreThanOrEqual, QueryFailedError, UpdateQueryBuilder } from 'typeorm';
import { AuthCleanupScheduler } from '../../src/auth/auth-cleanup.scheduler.js';
import {
  type AuthCleanupResult,
  AuthCleanupService,
} from '../../src/auth/services/auth-cleanup.service.js';
import { JobRun } from '../../src/jobs/entities/job-run.entity.js';
import { JOB_NAMES } from '../../src/jobs/job-run.types.js';
import { Mail } from '../../src/mail/entities/mail.entity.js';
import { MailType } from '../../src/mail/mail.types.js';
import {
  type LifecycleRunResult,
  SubscriptionLifecycleService,
} from '../../src/subscriptions/services/subscription-lifecycle.service.js';
import {
  type TrialReminderRunResult,
  TrialReminderService,
} from '../../src/subscriptions/services/trial-reminder.service.js';
import { SubscriptionLifecycleScheduler } from '../../src/subscriptions/subscription-lifecycle.scheduler.js';
import { TrialReminderScheduler } from '../../src/subscriptions/trial-reminder.scheduler.js';
import {
  addDays,
  APP_TIME_ZONE,
  calendarDayIn,
} from '../../src/shared/date/calendar-day.js';
import { ADDRESS_DOMAIN, createE2eApp } from '../support/e2e-app.js';
import {
  subscriptionBody,
  subscriptionRequests,
} from '../subscriptions/subscriptions-e2e.js';

describe('Jobs — run register (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job). job_run rows are not removed: they hold no user data and go after
  // JOB_RUN_RETENTION_DAYS. e2e files run one after another, so the rows started after `before`
  // are this file's.
  const prefix = 'e2e-jobs-run-';
  const e2e = createE2eApp({ addressPrefix: prefix });
  const { repository, sent } = e2e;

  // An address of this file, so the cleanup removes the alert's audit row and close() waits for it.
  const stubbedOperator = `${prefix}operator${ADDRESS_DOMAIN}`;
  let operator: string;
  let before: Date;

  const runsSince = (since: Date) =>
    repository(JobRun).find({
      where: { startedAt: MoreThanOrEqual(since) },
      order: { startedAt: 'ASC' },
    });

  beforeAll(async () => {
    // .env leaves the operator address empty in DEV and CI, and notifyOperator then only logs.
    // ConfigService falls through to process.env for a key the validated config leaves undefined,
    // and MailService reads it when the app is built in start().
    vi.stubEnv('NOTIFICATION_ADMINISTRATOR_MAIL', stubbedOperator);
    before = new Date();
    // start() awaits the startup runs of the lifecycle job and the cleanup, and waits for the
    // background startup run of the trial reminders.
    await e2e.start();
    operator = e2e.env.NOTIFICATION_ADMINISTRATOR_MAIL ?? stubbedOperator;
  });

  afterAll(async () => {
    try {
      // An address set in a local .env wins over the stub; its alert rows are not this file's.
      if (!e2e.isFileAddress(operator)) {
        await repository(Mail).delete({
          type: MailType.OPERATOR_ALERT,
          recipient: operator,
          createdAt: MoreThanOrEqual(before),
        });
      }
    } finally {
      vi.unstubAllEnvs();
      await e2e.close();
    }
  });

  it('leaves a finished success row for the startup run of each of the three jobs', async () => {
    const startupRuns = (await runsSince(before)).filter(
      (run) => run.trigger === 'startup',
    );

    for (const job of JOB_NAMES) {
      const runs = startupRuns.filter((run) => run.job === job);
      expect(runs, job).toHaveLength(1);
      expect(runs[0].outcome, job).toBe('success');
      expect(runs[0].finishedAt, job).toBeInstanceOf(Date);
      expect(runs[0].counters, job).toEqual(expect.any(Object));
    }
  });

  it('records the counters of the startup cleanup run', async () => {
    const [cleanup] = (await runsSince(before)).filter(
      (run) => run.job === 'auth-cleanup' && run.trigger === 'startup',
    );

    expect(Object.keys(cleanup.counters ?? {}).sort()).toEqual([
      'sessions',
      'tokens',
    ]);
  });

  it('records a cron run of the cleanup as a success', async () => {
    const since = new Date();

    await e2e.app.get(AuthCleanupScheduler).daily();

    const runs = await runsSince(since);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      job: 'auth-cleanup',
      trigger: 'cron',
      outcome: 'success',
    });
  });

  it('records a failed lifecycle run with its step and code and mails the operator once, without the error text', async () => {
    const since = new Date();
    const sentBefore = sent.length;
    // The first UPDATE of the run is step 1 (trial_to_active). Failing the query rather than the
    // whole advance() keeps inStep in the path.
    const execute = vi
      .spyOn(UpdateQueryBuilder.prototype, 'execute')
      .mockRejectedValueOnce(
        new QueryFailedError(
          'UPDATE "subscription" …',
          [],
          Object.assign(new Error('forced lifecycle failure'), {
            code: '57014',
          }),
        ),
      );
    const logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    try {
      await e2e.app.get(SubscriptionLifecycleScheduler).daily();
    } finally {
      execute.mockRestore();
      logError.mockRestore();
    }

    const runs = await runsSince(since);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      job: 'subscription-lifecycle',
      trigger: 'cron',
      outcome: 'failed',
      counters: null,
      failure: 'trial_to_active: 57014',
    });
    expect(runs[0].finishedAt).toBeInstanceOf(Date);

    // notifyOperator is awaited by the run, so its audit row is already there.
    const alerts = await repository(Mail).findBy({
      type: MailType.OPERATOR_ALERT,
      recipient: operator,
      // A second of slack: createdAt comes from the database clock, `since` from this process.
      createdAt: MoreThanOrEqual(new Date(since.getTime() - 1000)),
    });
    expect(alerts).toHaveLength(1);

    const mails = sent.slice(sentBefore).filter((mail) => mail.to === operator);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe(
      'SubTracker: zadanie subscription-lifecycle — failed',
    );
    expect(mails[0].text).toContain('przyczyna: trial_to_active: 57014');
    expect(mails[0].text).not.toContain('forced lifecycle failure');
    expect(mails[0].html).not.toContain('forced lifecycle failure');
  });

  // S-11: a run that starts while the previous one is still going leaves a `skipped` row and an
  // error line, and the held run still ends as a success.
  describe('a run while the previous one is still going', () => {
    let logError: ReturnType<typeof vi.spyOn>;

    // A promise the held run waits on, and the function that lets it finish with the value.
    function gate<T>(): { promise: Promise<T>; release: (value: T) => void } {
      let release: (value: T) => void = () => undefined;
      const promise = new Promise<T>((resolve) => {
        release = resolve;
      });
      return { promise, release };
    }

    // The outcomes of the runs started since, sorted: the two runs can start in the same
    // millisecond, and the held run's row is written in parallel with the skipped one.
    const outcomesSince = async (since: Date) =>
      (await runsSince(since)).map((run) => run.outcome ?? 'running').sort();

    beforeEach(() => {
      logError = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
    });

    afterEach(() => {
      logError.mockRestore();
    });

    it('records the second lifecycle run as skipped', async () => {
      const since = new Date();
      const held = gate<LifecycleRunResult>();
      const advance = vi
        .spyOn(e2e.app.get(SubscriptionLifecycleService), 'advance')
        .mockImplementationOnce(() => held.promise);
      const scheduler = e2e.app.get(SubscriptionLifecycleScheduler);

      try {
        const first = scheduler.daily();
        await scheduler.daily();

        await vi.waitFor(async () => {
          expect(await outcomesSince(since)).toEqual(['running', 'skipped']);
        });
        expect(logError).toHaveBeenCalledWith(
          'Skipped: the previous lifecycle run is still going',
        );

        held.release({
          trialsActivated: 0,
          cancellationsCompleted: 0,
          billingDatesRolled: 0,
          billingRollFailed: 0,
        });
        await first;
      } finally {
        advance.mockRestore();
      }

      expect(await outcomesSince(since)).toEqual(['skipped', 'success']);
    });

    it('records the second cleanup run as skipped', async () => {
      const since = new Date();
      const held = gate<AuthCleanupResult>();
      const purge = vi
        .spyOn(e2e.app.get(AuthCleanupService), 'purge')
        .mockImplementationOnce(() => held.promise);
      const scheduler = e2e.app.get(AuthCleanupScheduler);

      try {
        const first = scheduler.daily();
        await scheduler.daily();

        await vi.waitFor(async () => {
          expect(await outcomesSince(since)).toEqual(['running', 'skipped']);
        });
        expect(logError).toHaveBeenCalledWith(
          'Skipped: the previous cleanup run is still going',
        );

        held.release({ tokens: 0, sessions: 0 });
        await first;
      } finally {
        purge.mockRestore();
      }

      expect(await outcomesSince(since)).toEqual(['skipped', 'success']);
    });

    it('records the second trial reminder run as skipped and lets it and idle() resolve only after the first', async () => {
      const since = new Date();
      const held = gate<TrialReminderRunResult>();
      const sendDue = vi
        .spyOn(e2e.app.get(TrialReminderService), 'sendDue')
        .mockImplementationOnce(() => held.promise);
      const scheduler = e2e.app.get(TrialReminderScheduler);
      let secondDone = false;
      let idleDone = false;

      try {
        const first = scheduler.daily();
        const second = scheduler.daily().then(() => {
          secondDone = true;
        });
        const idle = scheduler.idle().then(() => {
          idleDone = true;
        });

        // The skipped row is written before the second call waits for the first run.
        await vi.waitFor(async () => {
          expect(await outcomesSince(since)).toEqual(['running', 'skipped']);
        });
        expect(logError).toHaveBeenCalledWith(
          'Skipped: the previous trial reminder run is still going',
        );
        expect(secondDone).toBe(false);
        expect(idleDone).toBe(false);

        held.release({
          usersNotified: 0,
          remindersSent: 0,
          usersSkipped: 0,
          usersFailed: 0,
          remindersLost: 0,
        });
        await Promise.all([first, second, idle]);
      } finally {
        sendDue.mockRestore();
      }

      expect(secondDone).toBe(true);
      expect(idleDone).toBe(true);
      expect(await outcomesSince(since)).toEqual(['skipped', 'success']);
    });
  });

  // J4: a run in which some users got no reminder must not look like a success.
  it('records a trial reminder run with a failed mail as partial and mails the operator', async () => {
    const { postSubscription } = subscriptionRequests(e2e);
    const failing = await e2e.signIn();
    const trialEndDate = addDays(calendarDayIn(APP_TIME_ZONE, new Date()), 3);
    await postSubscription(
      failing.cookie,
      subscriptionBody({
        name: 'Partial run trial',
        status: 'trial',
        trialEndDate,
        nextBillingDate: trialEndDate,
      }),
    ).expect(201);
    e2e.failMailTo(failing.address, true);
    const since = new Date();
    const sentBefore = sent.length;
    const logOutput = [
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
    ];

    try {
      await e2e.app.get(TrialReminderScheduler).daily();
    } finally {
      e2e.failMailTo(failing.address, false);
      for (const spy of logOutput) {
        spy.mockRestore();
      }
    }

    const runs = await runsSince(since);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      job: 'trial-reminder',
      trigger: 'cron',
      outcome: 'partial',
    });
    expect(runs[0].counters?.usersFailed).toBeGreaterThanOrEqual(1);

    // MailService may add its own "failed mail" alert; the run's alert is the one by subject.
    const runAlerts = sent
      .slice(sentBefore)
      .filter(
        (mail) =>
          mail.to === operator &&
          mail.subject === 'SubTracker: zadanie trial-reminder — partial',
      );
    expect(runAlerts).toHaveLength(1);
  });
});
