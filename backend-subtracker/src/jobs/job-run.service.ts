import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { MailService } from '../mail/services/mail.service.js';
import { failureCodeOf } from '../shared/database/failure-code.js';
import { APP_TIME_ZONE, calendarDayIn } from '../shared/date/calendar-day.js';
import { JobRun } from './entities/job-run.entity.js';
import { jobRunAlert } from './job-run-alert.js';
import {
  JOB_FAILURE_MAX_LENGTH,
  JOB_NAMES,
  JOB_RUN_RETENTION_DAYS,
  JobStepError,
  type JobName,
  type JobOutcome,
  type JobRunReport,
  type JobTrigger,
  type LatestJobRun,
} from './job-run.types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// The outcomes of a run that actually ran (latestFinished leaves out `skipped`).
const RAN_OUTCOMES: JobOutcome[] = ['success', 'partial', 'failed'];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'non-error value thrown';
}

// The cause of a failed run for job_run.failure, the log and the alert: the step and the code of
// the error, never its message (it can quote the parameters of a failed query).
function failureOf(error: unknown): string {
  const failure =
    error instanceof JobStepError
      ? `${error.step}: ${failureCodeOf(error.cause)}`
      : `unknown: ${failureCodeOf(error)}`;
  return failure.slice(0, JOB_FAILURE_MAX_LENGTH);
}

// The stack for the log: of the original error when a step failed.
function stackOf(error: unknown): string | undefined {
  const original = error instanceof JobStepError ? error.cause : error;
  return original instanceof Error ? original.stack : undefined;
}

function countersText(counters: Record<string, number> | null): string {
  if (counters === null) {
    return '';
  }
  return Object.entries(counters)
    .map(([name, value]) => `, ${name}=${value}`)
    .join('');
}

// Turns a run of a scheduled job into a job_run row, one summary line in the log and, when it
// failed or only partly succeeded, a mail to the operator. Neither method rejects: a failed write
// of the register is only logged and never stops or fails the job itself.
@Injectable()
export class JobRunService {
  private readonly logger = new Logger(JobRunService.name);

  constructor(
    @InjectRepository(JobRun) private readonly runs: Repository<JobRun>,
    private readonly mail: MailService,
  ) {}

  async track(
    job: JobName,
    trigger: JobTrigger,
    run: () => Promise<JobRunReport>,
  ): Promise<void> {
    const startedAt = new Date();
    const id = await this.recordStart(job, trigger, startedAt);

    let outcome: Exclude<JobOutcome, 'skipped'>;
    let counters: Record<string, number> | null = null;
    let lost = false;
    let failure: string | null = null;
    let stack: string | undefined;
    try {
      const report = await run();
      counters = report.counters;
      outcome = report.partial === true ? 'partial' : 'success';
      lost = report.lost === true;
    } catch (error) {
      // The step and the code only in the register and the mail: the message can quote the
      // parameters of a failed query. The log also gets the stack.
      outcome = 'failed';
      failure = failureOf(error);
      stack = stackOf(error);
    }
    const finishedAt = new Date();

    await this.recordFinish(id, {
      job,
      trigger,
      startedAt,
      finishedAt,
      outcome,
      counters,
      failure,
    });

    // The day the run worked for (its start in APP_TIME_ZONE): what the jobs compare their dates
    // with, so a run started around midnight shows which day it handled.
    const day = calendarDayIn(APP_TIME_ZONE, startedAt);
    const summary =
      `Job ${job} (${trigger}) for ${day}: ${outcome} in ${finishedAt.getTime() - startedAt.getTime()} ms` +
      countersText(counters);
    if (outcome === 'failed') {
      this.logger.error(`${summary} (${failure ?? ''})`, stack);
    } else if (outcome === 'partial') {
      // error, not warn: a partial run goes to err.log next to the failures (J13).
      this.logger.error(summary);
    } else {
      this.logger.log(summary);
    }

    if (outcome !== 'success') {
      // notifyOperator never rejects.
      await this.mail.notifyOperator(
        jobRunAlert({
          job,
          trigger,
          outcome,
          day,
          counters,
          failure,
          lost,
        }),
      );
    }
  }

  // A run not started because the previous one was still going: a row that starts and ends now.
  async recordSkipped(job: JobName, trigger: JobTrigger): Promise<void> {
    const now = new Date();
    try {
      await this.runs.save(
        this.runs.create({
          job,
          trigger,
          startedAt: now,
          finishedAt: now,
          outcome: 'skipped',
          counters: null,
          failure: null,
        }),
      );
    } catch (error) {
      this.logger.error(
        `Recording the skipped ${job} run failed: ${messageOf(error)}`,
      );
    }
  }

  // The latest run of each job that ran (any outcome but `skipped`); a job without one is absent.
  async latestFinished(): Promise<Map<JobName, LatestJobRun>> {
    const latest = new Map<JobName, LatestJobRun>();
    for (const job of JOB_NAMES) {
      const row = await this.runs.findOne({
        where: { job, outcome: In(RAN_OUTCOMES) },
        order: { startedAt: 'DESC' },
      });
      if (row?.finishedAt != null && row.outcome !== null) {
        latest.set(job, { finishedAt: row.finishedAt, outcome: row.outcome });
      }
    }
    return latest;
  }

  // Writes the started row and deletes the job's rows past the retention. Returns the row's id, or
  // undefined when it could not be written (recordFinish then writes the whole row).
  private async recordStart(
    job: JobName,
    trigger: JobTrigger,
    startedAt: Date,
  ): Promise<string | undefined> {
    let id: string | undefined;
    try {
      const row = await this.runs.save(
        this.runs.create({
          job,
          trigger,
          startedAt,
          finishedAt: null,
          outcome: null,
          counters: null,
          failure: null,
        }),
      );
      id = row.id;
    } catch (error) {
      this.logger.error(
        `Recording the start of the ${job} run failed: ${messageOf(error)}`,
      );
    }
    try {
      const limit = new Date(
        startedAt.getTime() - JOB_RUN_RETENTION_DAYS * DAY_MS,
      );
      // Per job, so the delete uses the (job, started_at) index.
      await this.runs.delete({ job, startedAt: LessThan(limit) });
    } catch (error) {
      this.logger.error(
        `Deleting old ${job} run rows failed: ${messageOf(error)}`,
      );
    }
    return id;
  }

  private async recordFinish(
    id: string | undefined,
    row: Omit<JobRun, 'id'>,
  ): Promise<void> {
    try {
      if (id === undefined) {
        await this.runs.save(this.runs.create(row));
      } else {
        await this.runs.update(
          { id },
          {
            finishedAt: row.finishedAt,
            outcome: row.outcome,
            counters: row.counters,
            failure: row.failure,
          },
        );
      }
    } catch (error) {
      this.logger.error(
        `Recording the end of the ${row.job} run failed: ${messageOf(error)}`,
      );
    }
  }
}
