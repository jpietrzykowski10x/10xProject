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

// What a job's run returns to JobRunService.track: the numbers of its service's result. lost: part
// of the work of a partial run will not be retried (e.g. a reminder whose marker could not be
// released), so the alert does not promise a retry.
export interface JobRunReport {
  counters: Record<string, number>;
  partial?: boolean;
  lost?: boolean;
}

// The failure of a named step of a job (e.g. roll_billing_dates). JobRunService.track records it
// as `<step>: <code of the cause>` (failureCodeOf), never with the cause's message.
export class JobStepError extends Error {
  override readonly name = 'JobStepError';

  constructor(
    readonly step: string,
    override readonly cause: unknown,
  ) {
    super(`Job step ${step} failed`, { cause });
  }
}

// Runs one step of a job and turns its failure into a JobStepError naming the step. A failure that
// already names a step (a nested inStep) keeps it.
export async function inStep<T>(
  step: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw error instanceof JobStepError ? error : new JobStepError(step, error);
  }
}

// The longest job_run.failure (varchar(200)).
export const JOB_FAILURE_MAX_LENGTH = 200;

// The latest run of a job that ended with something other than `skipped`.
export interface LatestJobRun {
  finishedAt: Date;
  outcome: JobOutcome;
}

// Rows of runs started longer ago than this are deleted when a run of the same job starts.
export const JOB_RUN_RETENTION_DAYS = 90;
