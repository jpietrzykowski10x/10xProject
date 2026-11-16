import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { APP_TIME_ZONE } from '../shared/date/calendar-day.js';
import { AuthCleanupService } from './services/auth-cleanup.service.js';

// Runs the cleanup once at startup (catching up the deploy window or a restart) and every day at
// 00:05 in Warsaw. The logic lives in the service; this only logs.
@Injectable()
export class AuthCleanupScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthCleanupScheduler.name);
  private running = false;

  constructor(private readonly cleanup: AuthCleanupService) {}

  // Awaited, so the run ends before the app takes requests; a failure is only logged, so it does
  // not stop the startup or the deploy health-check.
  async onApplicationBootstrap(): Promise<void> {
    await this.run();
  }

  @Cron('5 0 * * *', { timeZone: APP_TIME_ZONE })
  async daily(): Promise<void> {
    await this.run();
  }

  private async run(): Promise<void> {
    if (this.running) {
      this.logger.warn('Skipped: the previous cleanup run is still going');
      return;
    }
    this.running = true;
    try {
      const result = await this.cleanup.purge(new Date());
      if (result.tokens + result.sessions > 0) {
        this.logger.log(
          `Cleanup run: ${result.tokens} sign-in tokens and ${result.sessions} sessions deleted`,
        );
      }
    } catch (error) {
      // The message only: the parameters of a failed query stay out of the log.
      this.logger.error(
        `Cleanup run failed: ${error instanceof Error ? error.message : 'non-error value thrown'}`,
      );
    } finally {
      this.running = false;
    }
  }
}
