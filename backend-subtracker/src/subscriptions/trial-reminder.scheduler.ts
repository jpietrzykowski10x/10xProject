import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JobRunService } from '../jobs/job-run.service.js';
import type { JobTrigger } from '../jobs/job-run.types.js';
import { APP_TIME_ZONE, calendarDayIn } from '../shared/date/calendar-day.js';
import { TrialReminderService } from './services/trial-reminder.service.js';

// Every day at 02:00 in Warsaw. On the spring DST change 02:00 does not exist and in autumn it
// comes twice: a doubled run changes nothing (the marker) and a skipped day is caught up by the
// 7-day window.
export const TRIAL_REMINDER_CRON = '0 2 * * *';

// Runs the trial reminder job once at startup (catching up the deploy window or a restart) and
// every day at 02:00 in Warsaw. The logic lives in the service; this only picks "today" and hands
// the run to JobRunService, which records it, logs the summary and alerts the operator when the
// run fails or some users were not reminded (partial).
@Injectable()
export class TrialReminderScheduler
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(TrialReminderScheduler.name);
  private running = false;
  private currentRun: Promise<void> = Promise.resolve();

  constructor(
    private readonly reminders: TrialReminderService,
    private readonly jobRuns: JobRunService,
  ) {}

  // Not awaited: sending mail (many users, a hanging SMTP server) must not delay the startup and
  // the deploy health-check. run() never rejects.
  onApplicationBootstrap(): void {
    void this.run('startup');
  }

  // Lets a run in progress finish before app.close() closes the database connection (e2e tests).
  // In production main.ts does not enable shutdown hooks, so a stopped process ends the run as is.
  async beforeApplicationShutdown(): Promise<void> {
    await this.idle();
  }

  @Cron(TRIAL_REMINDER_CRON, { timeZone: APP_TIME_ZONE })
  async daily(): Promise<void> {
    await this.run('cron');
  }

  // Resolves when the run in progress (if any) has ended, e.g. the startup run in an e2e test.
  idle(): Promise<void> {
    return this.currentRun;
  }

  // Never rejects: track() and recordSkipped() catch everything.
  private run(trigger: JobTrigger): Promise<void> {
    if (this.running) {
      // error, so the line goes to err.log (J13).
      this.logger.error(
        'Skipped: the previous trial reminder run is still going',
      );
      const running = this.currentRun;
      return this.jobRuns
        .recordSkipped('trial-reminder', trigger)
        .then(() => running);
    }
    this.running = true;
    this.currentRun = this.jobRuns
      .track('trial-reminder', trigger, async () => {
        const today = calendarDayIn(APP_TIME_ZONE, new Date());
        const result = await this.reminders.sendDue(today);
        // Users whose mail failed stay due for the next run, lost reminders are not retried; the
        // operator hears about both. Skipped users are no failure.
        return {
          counters: { ...result },
          partial: result.usersFailed > 0 || result.remindersLost > 0,
          lost: result.remindersLost > 0,
        };
      })
      .finally(() => {
        this.running = false;
      });
    return this.currentRun;
  }
}
