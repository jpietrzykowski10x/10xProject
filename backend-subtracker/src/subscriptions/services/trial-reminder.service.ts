import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type WhereExpressionBuilder } from 'typeorm';
import { type EnvConfig, envFromConfig } from '../../config/env.js';
import { MailType } from '../../mail/mail.types.js';
import { MailService } from '../../mail/services/mail.service.js';
import { Subscription } from '../entities/subscription.entity.js';
import { BillingCycle, SubscriptionStatus } from '../subscription.types.js';
import {
  type TrialReminderItem,
  trialReminderMail,
  trialReminderWindow,
} from '../trial-reminder.js';

// What one run did: users who got a mail, trials listed in those mails, and users whose mail
// failed (their trials stay due for the next run).
export interface TrialReminderRunResult {
  usersNotified: number;
  remindersSent: number;
  usersFailed: number;
}

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
    .andWhere(
      'EXISTS (SELECT 1 FROM "user" "owner" WHERE "owner"."id" = "subscription"."user_id" AND "owner"."is_active" = true)',
    );
  return query;
}

// The trial reminder job over every account. Per user: claim the due rows (marker set to the
// trial end date), send one mail listing them, and release the claim when the mail failed, so the
// next run tries again. A claim is a conditional UPDATE, so two overlapping runs never mail the
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
      usersFailed: 0,
    };
    for (const user of users) {
      try {
        const sent = await this.remind(user, today);
        if (sent === null) {
          continue;
        }
        if (sent > 0) {
          result.usersNotified += 1;
          result.remindersSent += sent;
        } else {
          result.usersFailed += 1;
        }
      } catch (error) {
        // The message only: no address and no query parameters in the log.
        this.logger.error(
          `Trial reminder for one user failed: ${error instanceof Error ? error.message : 'non-error value thrown'}`,
        );
        result.usersFailed += 1;
      }
    }
    return result;
  }

  // The number of trials in the mail that went out, 0 when the mail failed (claim released), or
  // null when another run or an edit got to the rows first.
  private async remind(user: DueUser, today: string): Promise<number | null> {
    const claim = await whereDue(
      this.subscriptions
        .createQueryBuilder()
        .update(Subscription)
        .set({ trialReminderSentFor: () => 'trial_end_date' })
        .where('"subscription"."user_id" = :userId', { userId: user.userId }),
      today,
    )
      .returning(
        'id, name, amount, billing_cycle, CAST(trial_end_date AS text) AS trial_end_date',
      )
      .execute();
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
    const sent = await this.mail.sendToUser(
      MailType.TRIAL_REMINDER,
      user.email,
      trialReminderMail({
        items,
        today,
        subscriptionsUrl: this.subscriptionsUrl,
      }),
    );
    if (sent) {
      return items.length;
    }

    // Released only while the marker still holds the claimed date: an edit made in between
    // (a new end date) is not overwritten.
    await this.subscriptions
      .createQueryBuilder()
      .update(Subscription)
      .set({ trialReminderSentFor: null })
      .where('id IN (:...ids)', { ids: rows.map((row) => row.id) })
      .andWhere('trial_reminder_sent_for = trial_end_date')
      .execute();
    return 0;
  }
}
