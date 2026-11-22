import { Logger } from '@nestjs/common';
import { MoreThanOrEqual } from 'typeorm';
import { AuthCleanupScheduler } from '../../src/auth/auth-cleanup.scheduler.js';
import { JobRun } from '../../src/jobs/entities/job-run.entity.js';
import { JOB_NAMES } from '../../src/jobs/job-run.types.js';
import { Mail } from '../../src/mail/entities/mail.entity.js';
import { MailType } from '../../src/mail/mail.types.js';
import { SubscriptionLifecycleService } from '../../src/subscriptions/services/subscription-lifecycle.service.js';
import { SubscriptionLifecycleScheduler } from '../../src/subscriptions/subscription-lifecycle.scheduler.js';
import { ADDRESS_DOMAIN, createE2eApp } from '../support/e2e-app.js';

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

  it('records a failed lifecycle run and mails the operator once, without the error text', async () => {
    const since = new Date();
    const sentBefore = sent.length;
    vi.spyOn(
      e2e.app.get(SubscriptionLifecycleService),
      'advance',
    ).mockRejectedValueOnce(new Error('forced lifecycle failure'));
    const logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    try {
      await e2e.app.get(SubscriptionLifecycleScheduler).daily();
    } finally {
      logError.mockRestore();
    }

    const runs = await runsSince(since);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      job: 'subscription-lifecycle',
      trigger: 'cron',
      outcome: 'failed',
      counters: null,
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
    expect(mails[0].text).not.toContain('forced lifecycle failure');
    expect(mails[0].html).not.toContain('forced lifecycle failure');
  });
});
