import { Logger } from '@nestjs/common';
import { type FindOperator, QueryFailedError, type Repository } from 'typeorm';
import type { MailContent } from '../mail/mail.types.js';
import type { MailService } from '../mail/services/mail.service.js';
import type { JobRun } from './entities/job-run.entity.js';
import { JobRunService } from './job-run.service.js';
import {
  inStep,
  JOB_RUN_RETENTION_DAYS,
  JobStepError,
} from './job-run.types.js';

type RunRow = Omit<JobRun, 'id'>;

interface DeleteCriteria {
  job: string;
  startedAt: FindOperator<Date>;
}

interface FindOneOptions {
  where: { job: string };
}

const NOW = new Date('2026-11-22T10:00:00.000Z');

function setup() {
  const saved: RunRow[] = [];
  const runs = {
    create: vi.fn((row: RunRow) => row),
    save: vi.fn((row: RunRow) => {
      saved.push(row);
      return Promise.resolve({ ...row, id: `run-${saved.length}` });
    }),
    update: vi.fn<
      (where: { id: string }, row: Partial<RunRow>) => Promise<void>
    >(() => Promise.resolve()),
    delete: vi.fn<(criteria: DeleteCriteria) => Promise<void>>(() =>
      Promise.resolve(),
    ),
    findOne: vi.fn<(options: FindOneOptions) => Promise<JobRun | null>>(() =>
      Promise.resolve(null),
    ),
  };
  const notifyOperator = vi.fn<(content: MailContent) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const service = new JobRunService(
    runs as unknown as Repository<JobRun>,
    { notifyOperator } as unknown as MailService,
  );
  return { service, runs, saved, notifyOperator };
}

describe('JobRunService', () => {
  let logLog: ReturnType<typeof vi.spyOn>;
  let logWarn: ReturnType<typeof vi.spyOn>;
  let logError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    logLog = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    logWarn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('track', () => {
    it('records the start before the run and the success with the counters after it', async () => {
      const { service, runs, saved, notifyOperator } = setup();
      const run = vi.fn(() => {
        // The started row is already there while the job runs.
        expect(saved).toEqual([
          {
            job: 'subscription-lifecycle',
            trigger: 'startup',
            startedAt: NOW,
            finishedAt: null,
            outcome: null,
            counters: null,
            failure: null,
          },
        ]);
        return Promise.resolve({ counters: { trialsActivated: 2 } });
      });

      await service.track('subscription-lifecycle', 'startup', run);

      expect(run).toHaveBeenCalledOnce();
      expect(runs.update).toHaveBeenCalledExactlyOnceWith(
        { id: 'run-1' },
        {
          finishedAt: NOW,
          outcome: 'success',
          counters: { trialsActivated: 2 },
          failure: null,
        },
      );
      expect(notifyOperator).not.toHaveBeenCalled();
    });

    it('logs one summary line even when the run changed nothing', async () => {
      const { service } = setup();

      await service.track('auth-cleanup', 'cron', () =>
        Promise.resolve({ counters: { tokens: 0, sessions: 0 } }),
      );

      expect(logLog).toHaveBeenCalledExactlyOnceWith(
        'Job auth-cleanup (cron) for 2026-11-22: success in 0 ms, tokens=0, sessions=0',
      );
      expect(logWarn).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    });

    it('records a partial run, logs it as an error and mails the operator', async () => {
      const { service, runs, notifyOperator } = setup();
      const counters = { usersNotified: 1, remindersSent: 1, usersFailed: 2 };

      await service.track('trial-reminder', 'cron', () =>
        Promise.resolve({ counters, partial: true }),
      );

      expect(runs.update).toHaveBeenCalledExactlyOnceWith(
        { id: 'run-1' },
        { finishedAt: NOW, outcome: 'partial', counters, failure: null },
      );
      // error, so the line goes to err.log (J13).
      expect(logError).toHaveBeenCalledExactlyOnceWith(
        'Job trial-reminder (cron) for 2026-11-22: partial in 0 ms, usersNotified=1, remindersSent=1, usersFailed=2',
      );
      expect(logWarn).not.toHaveBeenCalled();
      expect(notifyOperator).toHaveBeenCalledOnce();
      const mail = notifyOperator.mock.calls[0][0];
      expect(mail.subject).toBe('SubTracker: zadanie trial-reminder — partial');
      // The day of the run in Warsaw.
      expect(mail.text).toContain('dzień: 2026-11-22');
      expect(mail.text).toContain('usersFailed=2');
      expect(mail.text).toContain('zostanie ponowiona');
    });

    it('tells the operator that part of the work of a partial run was lost', async () => {
      const { service, notifyOperator } = setup();

      await service.track('trial-reminder', 'cron', () =>
        Promise.resolve({
          counters: { remindersLost: 1 },
          partial: true,
          lost: true,
        }),
      );

      const mail = notifyOperator.mock.calls[0][0];
      expect(mail.text).toContain('część pracy przepadła, szczegóły w err.log');
      expect(mail.text).not.toContain('ponowiona');
    });

    it('records the step and the code of a failed step, never the message', async () => {
      const { service, runs, notifyOperator } = setup();
      const cause = new QueryFailedError(
        'UPDATE subscription SET …',
        ['jan@example.com'],
        Object.assign(new Error('value violated by jan@example.com'), {
          code: '57014',
        }),
      );

      await expect(
        service.track('subscription-lifecycle', 'cron', () =>
          inStep('roll_billing_dates', () => Promise.reject(cause)),
        ),
      ).resolves.toBeUndefined();

      expect(runs.update).toHaveBeenCalledExactlyOnceWith(
        { id: 'run-1' },
        {
          finishedAt: NOW,
          outcome: 'failed',
          counters: null,
          failure: 'roll_billing_dates: 57014',
        },
      );
      // The stack of the original error goes to the log as the second argument.
      expect(logError).toHaveBeenCalledExactlyOnceWith(
        'Job subscription-lifecycle (cron) for 2026-11-22: failed in 0 ms (roll_billing_dates: 57014)',
        cause.stack,
      );
      expect(notifyOperator).toHaveBeenCalledOnce();
      const mail = notifyOperator.mock.calls[0][0];
      expect(mail.subject).toBe(
        'SubTracker: zadanie subscription-lifecycle — failed',
      );
      expect(mail.text).toContain('przyczyna: roll_billing_dates: 57014');
      // Neither the error text nor the user data it quotes reaches the mail.
      for (const part of [mail.subject, mail.text, mail.html]) {
        expect(part).not.toContain('jan@example.com');
        expect(part).not.toContain('violated');
      }
    });

    it('records a failure outside a named step as unknown with the error class', async () => {
      const { service, runs, notifyOperator } = setup();
      const error = new Error('relation "x" violated by jan@example.com');

      await service.track('subscription-lifecycle', 'cron', () =>
        Promise.reject(error),
      );

      expect(runs.update).toHaveBeenCalledExactlyOnceWith(
        { id: 'run-1' },
        {
          finishedAt: NOW,
          outcome: 'failed',
          counters: null,
          failure: 'unknown: Error',
        },
      );
      expect(logError).toHaveBeenCalledExactlyOnceWith(
        'Job subscription-lifecycle (cron) for 2026-11-22: failed in 0 ms (unknown: Error)',
        error.stack,
      );
      const mail = notifyOperator.mock.calls[0][0];
      expect(mail.text).toContain('przyczyna: unknown: Error');
      expect(mail.text).not.toContain('violated');
    });

    it('reports the duration of the run in the summary', async () => {
      const { service } = setup();

      await service.track('auth-cleanup', 'startup', () => {
        vi.setSystemTime(NOW.getTime() + 1234);
        return Promise.resolve({ counters: { tokens: 1, sessions: 0 } });
      });

      expect(logLog).toHaveBeenCalledExactlyOnceWith(
        'Job auth-cleanup (startup) for 2026-11-22: success in 1234 ms, tokens=1, sessions=0',
      );
    });

    it('names the day of the start in Warsaw, not in UTC', async () => {
      const { service } = setup();
      // 23:05 UTC on 22 November is 00:05 on 23 November in Warsaw (the daily cron).
      vi.setSystemTime(new Date('2026-11-22T23:05:00.000Z'));

      await service.track('subscription-lifecycle', 'cron', () =>
        Promise.resolve({ counters: {} }),
      );

      expect(logLog).toHaveBeenCalledExactlyOnceWith(
        'Job subscription-lifecycle (cron) for 2026-11-23: success in 0 ms',
      );
    });

    it(`deletes the job's rows started more than ${JOB_RUN_RETENTION_DAYS} days ago`, async () => {
      const { service, runs } = setup();

      await service.track('trial-reminder', 'startup', () =>
        Promise.resolve({ counters: {} }),
      );

      expect(runs.delete).toHaveBeenCalledOnce();
      const { job, startedAt } = runs.delete.mock.calls[0][0];
      expect(job).toBe('trial-reminder');
      expect(startedAt.type).toBe('lessThan');
      expect(startedAt.value).toEqual(new Date('2026-08-24T10:00:00.000Z'));
    });

    it('still runs the job and records its end when the start cannot be written', async () => {
      const { service, runs, saved, notifyOperator } = setup();
      runs.save.mockRejectedValueOnce(new Error('database down'));
      const run = vi.fn(() => Promise.resolve({ counters: { tokens: 3 } }));

      await expect(
        service.track('auth-cleanup', 'cron', run),
      ).resolves.toBeUndefined();

      expect(run).toHaveBeenCalledOnce();
      expect(logError).toHaveBeenCalledWith(
        'Recording the start of the auth-cleanup run failed: database down',
      );
      // No id to update, so the whole row is written at the end.
      expect(runs.update).not.toHaveBeenCalled();
      expect(saved).toEqual([
        {
          job: 'auth-cleanup',
          trigger: 'cron',
          startedAt: NOW,
          finishedAt: NOW,
          outcome: 'success',
          counters: { tokens: 3 },
          failure: null,
        },
      ]);
      expect(notifyOperator).not.toHaveBeenCalled();
    });

    it('neither rejects nor stops the job when the retention delete or the end write fails', async () => {
      const { service, runs, notifyOperator } = setup();
      runs.delete.mockRejectedValueOnce(new Error('delete failed'));
      runs.update.mockRejectedValueOnce(new Error('update failed'));
      const run = vi.fn(() => Promise.reject(new Error('job failed')));

      await expect(
        service.track('subscription-lifecycle', 'startup', run),
      ).resolves.toBeUndefined();

      expect(run).toHaveBeenCalledOnce();
      expect(logError).toHaveBeenCalledWith(
        'Deleting old subscription-lifecycle run rows failed: delete failed',
      );
      expect(logError).toHaveBeenCalledWith(
        'Recording the end of the subscription-lifecycle run failed: update failed',
      );
      // The alert still goes out.
      expect(notifyOperator).toHaveBeenCalledOnce();
    });
  });

  describe('recordSkipped', () => {
    it('writes a skipped row that starts and ends now', async () => {
      const { service, saved } = setup();

      await service.recordSkipped('trial-reminder', 'cron');

      expect(saved).toEqual([
        {
          job: 'trial-reminder',
          trigger: 'cron',
          startedAt: NOW,
          finishedAt: NOW,
          outcome: 'skipped',
          counters: null,
          failure: null,
        },
      ]);
    });

    it('only logs a failed write', async () => {
      const { service, runs } = setup();
      runs.save.mockRejectedValueOnce(new Error('database down'));

      await expect(
        service.recordSkipped('auth-cleanup', 'cron'),
      ).resolves.toBeUndefined();

      expect(logError).toHaveBeenCalledExactlyOnceWith(
        'Recording the skipped auth-cleanup run failed: database down',
      );
    });
  });

  describe('latestFinished', () => {
    it('maps each job to its latest run that ran, leaving out jobs without one', async () => {
      const { service, runs } = setup();
      const finishedAt = new Date('2026-11-22T00:05:01.000Z');
      runs.findOne.mockImplementation(({ where }) =>
        Promise.resolve(
          where.job === 'subscription-lifecycle'
            ? ({
                id: 'run-1',
                job: 'subscription-lifecycle',
                trigger: 'cron',
                startedAt: finishedAt,
                finishedAt,
                outcome: 'failed',
                counters: null,
                failure: 'trial_to_active: 57014',
              } satisfies JobRun)
            : null,
        ),
      );

      const latest = await service.latestFinished();

      expect([...latest]).toEqual([
        ['subscription-lifecycle', { finishedAt, outcome: 'failed' }],
      ]);
      expect(runs.findOne).toHaveBeenCalledTimes(3);
    });

    it('asks for runs that ran (not skipped), newest first', async () => {
      const { service, runs } = setup();

      await service.latestFinished();

      const options = runs.findOne.mock.calls[0][0] as unknown as {
        where: { outcome: FindOperator<string[]> };
        order: { startedAt: string };
      };
      expect(options.where.outcome.type).toBe('in');
      expect(options.where.outcome.value).toEqual([
        'success',
        'partial',
        'failed',
      ]);
      expect(options.order).toEqual({ startedAt: 'DESC' });
    });
  });
});

describe('inStep', () => {
  it('returns the result of the step', async () => {
    await expect(
      inStep('expired_sessions', () => Promise.resolve(3)),
    ).resolves.toBe(3);
  });

  it('wraps a failure in a JobStepError naming the step, with the original as the cause', async () => {
    const cause = new Error('boom');

    const error: unknown = await inStep('magic_link_tokens', () =>
      Promise.reject(cause),
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(JobStepError);
    expect((error as JobStepError).step).toBe('magic_link_tokens');
    expect((error as JobStepError).cause).toBe(cause);
    // The message names the step only, not the cause's text.
    expect((error as JobStepError).message).not.toContain('boom');
  });

  it('keeps the step of a failure that already names one', async () => {
    const inner = new JobStepError('trial_to_active', new Error('boom'));

    await expect(inStep('outer', () => Promise.reject(inner))).rejects.toBe(
      inner,
    );
  });
});
