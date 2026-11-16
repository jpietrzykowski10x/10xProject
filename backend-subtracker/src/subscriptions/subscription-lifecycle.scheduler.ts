import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { APP_TIME_ZONE, calendarDayIn } from '../shared/date/calendar-day.js';
import { SubscriptionLifecycleService } from './services/subscription-lifecycle.service.js';

// Runs the lifecycle job once at startup (catching up the deploy window or a restart) and every
// day at 00:05 in Warsaw. The logic lives in the service; this only picks "today" and logs.
@Injectable()
export class SubscriptionLifecycleScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubscriptionLifecycleScheduler.name);
  private running = false;

  constructor(private readonly lifecycle: SubscriptionLifecycleService) {}

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
      this.logger.warn('Skipped: the previous lifecycle run is still going');
      return;
    }
    this.running = true;
    try {
      const today = calendarDayIn(APP_TIME_ZONE, new Date());
      const result = await this.lifecycle.advance(today);
      if (
        result.trialsActivated +
          result.cancellationsCompleted +
          result.billingDatesRolled >
        0
      ) {
        this.logger.log(
          `Lifecycle run for ${today}: ${result.trialsActivated} trials activated, ` +
            `${result.cancellationsCompleted} cancellations completed, ` +
            `${result.billingDatesRolled} billing dates rolled`,
        );
      }
    } catch (error) {
      // The message only: the parameters of a failed query stay out of the log.
      this.logger.error(
        `Lifecycle run failed: ${error instanceof Error ? error.message : 'non-error value thrown'}`,
      );
    } finally {
      this.running = false;
    }
  }
}
