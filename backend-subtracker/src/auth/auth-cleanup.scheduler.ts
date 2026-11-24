import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JobRunService } from '../jobs/job-run.service.js';
import type { JobTrigger } from '../jobs/job-run.types.js';
import { APP_TIME_ZONE } from '../shared/date/calendar-day.js';
import { AuthCleanupService } from './services/auth-cleanup.service.js';

// Runs the cleanup once at startup (catching up the deploy window or a restart) and every day at
// 00:05 in Warsaw. The logic lives in the service; this only hands the run to JobRunService, which
// records it, logs the summary and alerts the operator on a failure.
@Injectable()
export class AuthCleanupScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthCleanupScheduler.name);
  private running = false;

  constructor(
    private readonly cleanup: AuthCleanupService,
    private readonly jobRuns: JobRunService,
  ) {}

  // Awaited, so the run ends before the app takes requests; a failure is only recorded, logged and
  // mailed, so it does not stop the startup or the deploy health-check.
  async onApplicationBootstrap(): Promise<void> {
    await this.run('startup');
  }

  @Cron('5 0 * * *', { timeZone: APP_TIME_ZONE })
  async daily(): Promise<void> {
    await this.run('cron');
  }

  // Never rejects: track() and recordSkipped() catch everything.
  private async run(trigger: JobTrigger): Promise<void> {
    if (this.running) {
      // error, so the line goes to err.log (J13).
      this.logger.error('Skipped: the previous cleanup run is still going');
      await this.jobRuns.recordSkipped('auth-cleanup', trigger);
      return;
    }
    this.running = true;
    try {
      await this.jobRuns.track('auth-cleanup', trigger, async () => {
        const result = await this.cleanup.purge(new Date());
        return { counters: { ...result } };
      });
    } finally {
      this.running = false;
    }
  }
}
