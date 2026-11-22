// The scheduled jobs whose runs are recorded in job_run.
export const JOB_NAMES = [
  'subscription-lifecycle',
  'auth-cleanup',
  'trial-reminder',
] as const;
export type JobName = (typeof JOB_NAMES)[number];

// What started a run: the catch-up run at startup or the daily cron.
export type JobTrigger = 'startup' | 'cron';

// How a run ended: partial = the job did its work but part of it failed (e.g. users without their
// reminder) and is retried on the next run; skipped = not run, the previous run was still going.
export type JobOutcome = 'success' | 'partial' | 'failed' | 'skipped';

// The outcomes that mail the operator.
export type JobAlertOutcome = Extract<JobOutcome, 'partial' | 'failed'>;

// What a job's run returns to JobRunService.track: the numbers of its service's result.
export interface JobRunReport {
  counters: Record<string, number>;
  partial?: boolean;
}

// The latest run of a job that ended with something other than `skipped`.
export interface LatestJobRun {
  finishedAt: Date;
  outcome: JobOutcome;
}

// Rows of runs started longer ago than this are deleted when a run of the same job starts.
export const JOB_RUN_RETENTION_DAYS = 90;
