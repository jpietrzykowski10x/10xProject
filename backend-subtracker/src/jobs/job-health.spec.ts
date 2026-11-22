import { JOB_STALE_AFTER_HOURS, jobHealth } from './job-health.js';
import type { JobName, LatestJobRun } from './job-run.types.js';

const NOW = new Date('2026-11-22T10:00:00.000Z');
const MINUTE_MS = 60 * 1000;

function finishedAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE_MS);
}

function latestOf(
  runs: Partial<Record<JobName, LatestJobRun>>,
): Map<JobName, LatestJobRun> {
  return new Map(Object.entries(runs) as [JobName, LatestJobRun][]);
}

const RECENT: LatestJobRun = {
  finishedAt: finishedAgo(60),
  outcome: 'success',
};

describe('jobHealth', () => {
  it('reports ok for each job whose latest run succeeded recently', () => {
    expect(
      jobHealth(
        latestOf({
          'subscription-lifecycle': RECENT,
          'auth-cleanup': RECENT,
          'trial-reminder': RECENT,
        }),
        NOW,
      ),
    ).toEqual({
      'subscription-lifecycle': 'ok',
      'auth-cleanup': 'ok',
      'trial-reminder': 'ok',
    });
  });

  it('reports a job without a finished run as stale', () => {
    expect(jobHealth(latestOf({ 'auth-cleanup': RECENT }), NOW)).toEqual({
      'subscription-lifecycle': 'stale',
      'auth-cleanup': 'ok',
      'trial-reminder': 'stale',
    });
  });

  it(`keeps a run finished 25 h 59 min ago ok (threshold ${JOB_STALE_AFTER_HOURS} h)`, () => {
    const health = jobHealth(
      latestOf({
        'auth-cleanup': {
          finishedAt: finishedAgo(25 * 60 + 59),
          outcome: 'success',
        },
      }),
      NOW,
    );

    expect(health['auth-cleanup']).toBe('ok');
  });

  it(`reports a run finished 26 h 1 min ago as stale (threshold ${JOB_STALE_AFTER_HOURS} h)`, () => {
    const health = jobHealth(
      latestOf({
        'auth-cleanup': {
          finishedAt: finishedAgo(26 * 60 + 1),
          outcome: 'success',
        },
      }),
      NOW,
    );

    expect(health['auth-cleanup']).toBe('stale');
  });

  it('reports a recent failed run as failed', () => {
    const health = jobHealth(
      latestOf({
        'subscription-lifecycle': {
          finishedAt: finishedAgo(5),
          outcome: 'failed',
        },
      }),
      NOW,
    );

    expect(health['subscription-lifecycle']).toBe('failed');
  });

  it('reports an old failed run as stale', () => {
    const health = jobHealth(
      latestOf({
        'subscription-lifecycle': {
          finishedAt: finishedAgo(27 * 60),
          outcome: 'failed',
        },
      }),
      NOW,
    );

    expect(health['subscription-lifecycle']).toBe('stale');
  });

  it('counts a partial run as ok: the API has mailed the operator already', () => {
    const health = jobHealth(
      latestOf({
        'trial-reminder': { finishedAt: finishedAgo(5), outcome: 'partial' },
      }),
      NOW,
    );

    expect(health['trial-reminder']).toBe('ok');
  });

  it('ignores a skipped run: it does not prove the job ran', () => {
    const health = jobHealth(
      latestOf({
        'trial-reminder': { finishedAt: finishedAgo(5), outcome: 'skipped' },
      }),
      NOW,
    );

    expect(health['trial-reminder']).toBe('stale');
  });
});
