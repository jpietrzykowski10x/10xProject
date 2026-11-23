import { JOB_NAMES, type JobName, type LatestJobRun } from './job-run.types.js';

// A job whose latest finished run ended longer ago than this is stale: it runs daily, so two
// hours of slack cover a slow run and a restart around the cron minute.
export const JOB_STALE_AFTER_HOURS = 26;

const HOUR_MS = 60 * 60 * 1000;

// What /health reports per job. No dates and no counters: the endpoint is public.
export type JobHealth = 'ok' | 'stale' | 'failed';

// The state of each job from its latest finished run (JobRunService.latestFinished). A job without
// one, or whose latest one is a `skipped` run (it does not prove the job ran), is stale; `partial`
// counts as ok, because the API has already mailed the operator about it.
export function jobHealth(
  latest: ReadonlyMap<JobName, LatestJobRun>,
  now: Date,
): Record<JobName, JobHealth> {
  const staleBefore = now.getTime() - JOB_STALE_AFTER_HOURS * HOUR_MS;
  const health = {} as Record<JobName, JobHealth>;
  for (const job of JOB_NAMES) {
    const run = latest.get(job);
    if (
      run === undefined ||
      run.outcome === 'skipped' ||
      run.finishedAt.getTime() < staleBefore
    ) {
      health[job] = 'stale';
    } else if (run.outcome === 'failed') {
      health[job] = 'failed';
    } else {
      health[job] = 'ok';
    }
  }
  return health;
}
