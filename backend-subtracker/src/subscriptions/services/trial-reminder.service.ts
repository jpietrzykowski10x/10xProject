import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type WhereExpressionBuilder } from 'typeorm';
import { type EnvConfig, envFromConfig } from '../../config/env.js';
import { inStep, JobStepError } from '../../jobs/job-run.types.js';
import { MailType } from '../../mail/mail.types.js';
import { MailService } from '../../mail/services/mail.service.js';
import { failureCodeOf } from '../../shared/database/failure-code.js';
import { OWNER_IS_ACTIVE } from '../active-owner.js';
import { Subscription } from '../entities/subscription.entity.js';
import { BillingCycle, SubscriptionStatus } from '../subscription.types.js';
import {
  type TrialReminderItem,
  trialReminderMail,
  trialReminderWindow,
} from '../trial-reminder.js';

// What one run did: users who got a mail and the trials listed in those mails; users skipped (the
// account was deleted or blocked in the meantime, or the server refused the address as
// nonexistent); users whose mail failed (their trials stay due for the next run); and users whose
// claim could not be released after a failed or skipped mail (their reminder is lost).
export interface TrialReminderRunResult {
  usersNotified: number;
  remindersSent: number;
  usersSkipped: number;
  usersFailed: number;
  remindersLost: number;
}

// How the reminder of one user ended (remind returns null when another run or an edit got to the
// rows first).
type UserReminder =
  { kind: 'sent'; trials: number } | { kind: 'skipped' | 'failed' | 'lost' };

interface DueUser {
  userId: string;
  email: string;
}

// A row of the claim's RETURNING; the date comes back as text, so no time-zone shift.
interface ClaimedRow {
  id: string;
  name: string;
  amount: string;
  billing_cycle: BillingCycle;
  trial_end_date: string;
}

// The rule of a due reminder (trial-reminder.ts), shared by the read of due users and the claim,
// so both see the same rows: a trial of an active account ending inside the window, not yet
// reminded about for this end date. Columns are qualified by the table name, which works both in
// the aliased SELECT and in the UPDATE.
function whereDue<T extends WhereExpressionBuilder>(
  query: T,
  today: string,
): T {
  const { from, to } = trialReminderWindow(today);
  query
    .andWhere('"subscription"."status" = :trial', {
      trial: SubscriptionStatus.TRIAL,
    })
    .andWhere(
      '"subscription"."trial_end_date" BETWEEN CAST(:from AS date) AND CAST(:to AS date)',
      { from, to },
    )
    .andWhere(
      '"subscription"."trial_reminder_sent_for" IS DISTINCT FROM "subscription"."trial_end_date"',
    )
    .andWhere(OWNER_IS_ACTIVE);
  return query;
}

// The trial reminder job over every account. Per user: claim the due rows (marker set to the
// trial end date), send one mail listing them, and release the claim when the mail did not go out,
// so the next run tries again; an address the server refused as nonexistent keeps the claim, so a
// typo is not mailed every day. A claim is a conditional UPDATE, so two overlapping runs never mail the
// same row twice; a crash between the claim and the send loses only that user's reminders.
@Injectable()
export class TrialReminderService {
  private readonly logger = new Logger(TrialReminderService.name);
  private readonly subscriptionsUrl: string;

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    private readonly mail: MailService,
    config: ConfigService<EnvConfig, true>,
  ) {
    this.subscriptionsUrl = `${envFromConfig(config).FRONTEND_URL}/subscriptions`;
  }

  // today: the calendar day (YYYY-MM-DD) the run counts as today, compared as a date.
  async sendDue(today: string): Promise<TrialReminderRunResult> {
    const users = await whereDue(
      this.subscriptions
        .createQueryBuilder('subscription')
        .innerJoin('subscription.user', 'account')
        .select('account.id', 'userId')
        .addSelect('account.email', 'email')
        .distinct(true),
      today,
    ).getRawMany<DueUser>();

    const result: TrialReminderRunResult = {
      usersNotified: 0,
      remindersSent: 0,
      usersSkipped: 0,
      usersFailed: 0,
      remindersLost: 0,
    };
    for (const user of users) {
      try {
        const reminder = await this.remind(user, today);
        if (reminder === null) {
          continue;
        }
        switch (reminder.kind) {
          case 'sent':
            result.usersNotified += 1;
            result.remindersSent += reminder.trials;
            break;
          case 'skipped':
            result.usersSkipped += 1;
            break;
          case 'failed':
            result.usersFailed += 1;
            break;
          case 'lost':
            result.remindersLost += 1;
            break;
        }
      } catch (error) {
        // The user's id, the step and the code only: no address and no query parameters.
        const step = error instanceof JobStepError ? error.step : 'unknown';
        const cause = error instanceof JobStepError ? error.cause : error;
        this.logger.error(
          `Trial reminder for user ${user.userId} failed in step ${step} (code: ${failureCodeOf(cause)})`,
        );
        result.usersFailed += 1;
      }
    }
    return result;
  }

  private async remind(
    user: DueUser,
    today: string,
  ): Promise<UserReminder | null> {
    const claim = await inStep('reserve', () =>
      whereDue(
        this.subscriptions
          .createQueryBuilder()
          .update(Subscription)
          .set({ trialReminderSentFor: () => 'trial_end_date' })
          .where('"subscription"."user_id" = :userId', {
            userId: user.userId,
          }),
        today,
      )
        .returning(
          'id, name, amount, billing_cycle, CAST(trial_end_date AS text) AS trial_end_date',
        )
        .execute(),
    );
    const rows = claim.raw as ClaimedRow[];
    if (rows.length === 0) {
      return null;
    }

    const items: TrialReminderItem[] = rows.map((row) => ({
      name: row.name,
      trialEndDate: row.trial_end_date,
      amount: row.amount,
      billingCycle: row.billing_cycle,
    }));
    const outcome = await inStep('send', () =>
      this.mail.sendToUser(
        MailType.TRIAL_REMINDER,
        user.email,
        trialReminderMail({
          items,
          today,
          subscriptionsUrl: this.subscriptionsUrl,
        }),
      ),
    );
    switch (outcome) {
      case 'sent':
        return { kind: 'sent', trials: items.length };
      case 'recipient_typo':
        // The claim stays: the address does not exist, so the next run would only fail again.
        this.logger.warn(
          `Trial reminder for user ${user.userId} skipped: the server refused the address as nonexistent; the reminder stays marked as sent`,
        );
        return { kind: 'skipped' };
      case 'no_account':
      case 'blocked':
        // Deleted or blocked after the claim: released, so an unblocked account gets it later.
        return (await this.release(user, rows))
          ? { kind: 'skipped' }
          : { kind: 'lost' };
      case 'send_failed':
      case 'lookup_failed':
        return (await this.release(user, rows))
          ? { kind: 'failed' }
          : { kind: 'lost' };
    }
  }

  // Releases the claim so the next run tries again; false (and an error line) when it could not
  // be released, so the reminder for these end dates is lost. Released only while the marker
  // still holds the claimed date: an edit made in between (a new end date) is not overwritten.
  private async release(user: DueUser, rows: ClaimedRow[]): Promise<boolean> {
    try {
      await this.subscriptions
        .createQueryBuilder()
        .update(Subscription)
        .set({ trialReminderSentFor: null })
        .where('id IN (:...ids)', { ids: rows.map((row) => row.id) })
        .andWhere('trial_reminder_sent_for = trial_end_date')
        .execute();
      return true;
    } catch (error) {
      const dates = [...new Set(rows.map((row) => row.trial_end_date))]
        .sort()
        .join(', ');
      this.logger.error(
        `Releasing the trial reminder of user ${user.userId} failed (code: ${failureCodeOf(error)}); the reminder for ${dates} is lost`,
      );
      return false;
    }
  }
}
