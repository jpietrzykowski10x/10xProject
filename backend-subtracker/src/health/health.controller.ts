import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Logger,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { type JobHealth, jobHealth } from '../jobs/job-health.js';
import { JobRunService } from '../jobs/job-run.service.js';
import type { JobName } from '../jobs/job-run.types.js';
import { failureCodeOf } from '../shared/database/failure-code.js';
import { Public } from '../shared/decorators/public.decorator.js';
import { DEPLOYED_VERSION } from '../shared/deploy/deploy-info.js';
import { safeStack } from '../shared/logging/log-format.js';

export interface HealthStatus {
  status: 'ok' | 'error';
  db: 'ok' | 'error';
  // The deployed commit SHA from .deploy-info, or `dev`; also in the 503 answer. Never the backup
  // path that file also holds.
  version: string;
  // Per job only ok/stale/failed, no dates or counters: the endpoint is public. Absent when the
  // database is down or the job register cannot be read.
  jobs?: Record<JobName, JobHealth>;
}

// Used by the deploy health-check and the watchdog. Must stay @Public(): both call it without a
// cookie, and the deploy rolls back when it fails. The status code depends on the database only:
// a stale or failed job never turns it into 503 (restoring the dump would undo job markers).
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly jobRuns: JobRunService,
    @Inject(DEPLOYED_VERSION) private readonly version: string,
  ) {}

  @Public()
  @Get()
  async check(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthStatus> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch (error) {
      // The code and a stack without the text of a failed query, which can quote its data.
      this.logger.error(
        `Database health check failed (code: ${failureCodeOf(error)})`,
        error instanceof Error && error.stack !== undefined
          ? safeStack(error.stack)
          : undefined,
      );
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'error', db: 'error', version: this.version };
    }

    try {
      const jobs = jobHealth(await this.jobRuns.latestFinished(), new Date());
      return { status: 'ok', db: 'ok', version: this.version, jobs };
    } catch (error) {
      // The code only, like the job register. The database answers, so still 200.
      this.logger.error(
        `Reading the job runs for the health check failed (code: ${failureCodeOf(error)})`,
      );
      return { status: 'ok', db: 'ok', version: this.version };
    }
  }
}
