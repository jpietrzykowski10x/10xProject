import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from '../entities/subscription.entity.js';
import { rolledBillingDate } from '../subscription-lifecycle.js';
import { SubscriptionStatus } from '../subscription.types.js';

// The number of rows each transition of one run changed.
export interface LifecycleRunResult {
  trialsActivated: number;
  cancellationsCompleted: number;
  billingDatesRolled: number;
}

// The lifecycle job over every account (rules in subscription-lifecycle.ts). Each transition is a
// conditional UPDATE on the status and the date, so a second run on the same day changes nothing,
// a missed day is caught up by the next run, and a user's action between the read and the write
// is never overwritten.
@Injectable()
export class SubscriptionLifecycleService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
  ) {}

  // today: the calendar day (YYYY-MM-DD) the run counts as today, compared as a date.
  async advance(today: string): Promise<LifecycleRunResult> {
    const trials = await this.subscriptions
      .createQueryBuilder()
      .update(Subscription)
      .set({ status: SubscriptionStatus.ACTIVE, trialEndDate: null })
      .where('status = :trial', { trial: SubscriptionStatus.TRIAL })
      .andWhere('trial_end_date < CAST(:today AS date)', { today })
      .execute();

    const cancellations = await this.subscriptions
      .createQueryBuilder()
      .update(Subscription)
      .set({ status: SubscriptionStatus.CANCELLED })
      .where('status = :pending', {
        pending: SubscriptionStatus.CANCELLED_PENDING,
      })
      .andWhere('next_billing_date < CAST(:today AS date)', { today })
      .execute();

    return {
      trialsActivated: trials.affected ?? 0,
      cancellationsCompleted: cancellations.affected ?? 0,
      billingDatesRolled: await this.rollBillingDates(today),
    };
  }

  // Each row moves from its own date, so it is read first and written back only while it is still
  // active with the date that was read.
  private async rollBillingDates(today: string): Promise<number> {
    const overdue = await this.subscriptions
      .createQueryBuilder('subscription')
      .select([
        'subscription.id',
        'subscription.billingCycle',
        'subscription.nextBillingDate',
      ])
      .where('subscription.status = :active', {
        active: SubscriptionStatus.ACTIVE,
      })
      .andWhere('subscription.next_billing_date < CAST(:today AS date)', {
        today,
      })
      .getMany();

    let rolled = 0;
    for (const row of overdue) {
      const result = await this.subscriptions
        .createQueryBuilder()
        .update(Subscription)
        .set({
          nextBillingDate: rolledBillingDate(
            row.nextBillingDate,
            row.billingCycle,
            today,
          ),
        })
        .where('id = :id', { id: row.id })
        .andWhere('status = :active', { active: SubscriptionStatus.ACTIVE })
        .andWhere('next_billing_date = CAST(:previous AS date)', {
          previous: row.nextBillingDate,
        })
        .execute();
      rolled += result.affected ?? 0;
    }
    return rolled;
  }
}
