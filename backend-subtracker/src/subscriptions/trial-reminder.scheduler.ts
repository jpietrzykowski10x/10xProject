import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { escapeHtml } from '../mail/escape-html.js';
import { MailService } from '../mail/services/mail.service.js';
import { APP_TIME_ZONE, calendarDayIn } from '../shared/date/calendar-day.js';
import { TrialReminderService } from './services/trial-reminder.service.js';

// Every day at 02:00 in Warsaw. On the spring DST change 02:00 does not exist and in autumn it
// comes twice: a doubled run changes nothing (the marker) and a skipped day is caught up by the
// 7-day window.
export const TRIAL_REMINDER_CRON = '0 2 * * *';

// Runs the trial reminder job once at startup (catching up the deploy window or a restart) and
// every day at 02:00 in Warsaw. The logic lives in the service; this only picks "today", logs and
// alerts the operator when a whole run fails.
@Injectable()
export class TrialReminderScheduler
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(TrialReminderScheduler.name);
  private running = false;
  private currentRun: Promise<void> = Promise.resolve();

  constructor(
    private readonly reminders: TrialReminderService,
    private readonly mail: MailService,
  ) {}

  // Not awaited: sending mail (many users, a hanging SMTP server) must not delay the startup and
  // the deploy health-check. run() never rejects.
  onApplicationBootstrap(): void {
    void this.run();
  }

  // Lets a run in progress finish before the database connection closes.
  async beforeApplicationShutdown(): Promise<void> {
    await this.idle();
  }

  @Cron(TRIAL_REMINDER_CRON, { timeZone: APP_TIME_ZONE })
  async daily(): Promise<void> {
    await this.run();
  }

  // Resolves when the run in progress (if any) has ended, e.g. the startup run in an e2e test.
  idle(): Promise<void> {
    return this.currentRun;
  }

  private run(): Promise<void> {
    if (this.running) {
      this.logger.warn(
        'Skipped: the previous trial reminder run is still going',
      );
      return this.currentRun;
    }
    this.running = true;
    this.currentRun = this.runOnce().finally(() => {
      this.running = false;
    });
    return this.currentRun;
  }

  private async runOnce(): Promise<void> {
    const today = calendarDayIn(APP_TIME_ZONE, new Date());
    try {
      const result = await this.reminders.sendDue(today);
      if (result.usersNotified + result.usersFailed > 0) {
        // Black on green, so the run stands out among Nest's lines like the startup lines of
        // main.ts (an explicit text colour: Nest prints a log message in green).
        this.logger.log(
          `\x1b[30;42m Trial reminder run for ${today}: ${result.usersNotified} users notified, ` +
            `${result.remindersSent} trials reminded about, ${result.usersFailed} users failed \x1b[0m`,
        );
      }
      if (result.usersFailed > 0) {
        this.logger.warn(
          `Trial reminder run for ${today}: ${result.usersFailed} users not reminded, retried on the next run`,
        );
      }
    } catch (error) {
      // The message only: the parameters of a failed query stay out of the log.
      this.logger.error(
        `Trial reminder run failed: ${error instanceof Error ? error.message : 'non-error value thrown'}`,
      );
      // The date only: no error text and no user data in the mail. notifyOperator never rejects.
      await this.mail.notifyOperator({
        subject: 'SubTracker: przebieg przypomnień o trialu nie powiódł się',
        text: `Przebieg przypomnień o kończących się okresach próbnych nie powiódł się.\ndzień: ${today}\nSzczegóły w logu API.`,
        html: `<p>Przebieg przypomnień o kończących się okresach próbnych nie powiódł się.</p><p>dzień: ${escapeHtml(today)}<br>Szczegóły w logu API.</p>`,
      });
    }
  }
}
