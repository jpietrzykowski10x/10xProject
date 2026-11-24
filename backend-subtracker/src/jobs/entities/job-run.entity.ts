import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { JobName, JobOutcome, JobTrigger } from '../job-run.types.js';

// One row per run of a scheduled job (JobRunService.track). The row is written when the run
// starts and completed when it ends, so a process killed in the middle leaves a row without
// finished_at and outcome. No foreign keys and no user data: only the job, the times, the outcome
// and the numbers its service returned.
@Entity('job_run')
// For the latest finished run of each job and for deleting a job's rows past the retention.
@Index('IDX_job_run_job_started_at', ['job', 'startedAt'])
export class JobRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40 })
  job: JobName;

  @Column({ type: 'varchar', length: 10 })
  trigger: JobTrigger;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  // Null while the run is going.
  @Column({ type: 'varchar', length: 10, nullable: true })
  outcome: JobOutcome | null;

  // E.g. { "trialsActivated": 2 }; null for a failed or skipped run.
  @Column({ type: 'jsonb', nullable: true })
  counters: Record<string, number> | null;

  // Why a failed run failed: `<step>: <code>` (e.g. "roll_billing_dates: 57014"), `unknown: <code>`
  // when the failure named no step. Never the error message, which can quote data. Null otherwise.
  @Column({ type: 'varchar', length: 200, nullable: true })
  failure: string | null;
}
