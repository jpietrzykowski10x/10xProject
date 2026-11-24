import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { inStep, JobStepError } from '../../jobs/job-run.types.js';
import { isConnectionFailure } from '../../shared/database/connection-failure.js';
import { failureCodeOf } from '../../shared/database/failure-code.js';
import { OWNER_IS_ACTIVE } from '../active-owner.js';
import { Subscription } from '../entities/subscription.entity.js';
import { rolledBillingDate } from '../subscription-lifecycle.js';
import { SubscriptionStatus } from '../subscription.types.js';

// The number of rows each transition of one run changed, and the rows whose billing date could
// not be rolled (the run is partial when there are any; they are tried again by the next run).
export interface LifecycleRunResult {
  trialsActivated: number;
  cancellationsCompleted: number;
  billingDatesRolled: number;
  billingRollFailed: number;
}

interface BillingRollResult {
  rolled: number;
  failed: number;
}

// The lifecycle job over every account (rules in subscription-lifecycle.ts). Each transition is a
// conditional UPDATE on the status and the date, so a second run on the same day changes nothing,
// a missed day is caught up by the next run, and a user's action between the read and the write
// is never overwritten. Subscriptions of blocked accounts wait (OWNER_IS_ACTIVE) and are caught up
// by the first run after the unblock. Each transition is a named step (inStep), so a failed run
// records which one failed.
@Injectable()
export class SubscriptionLifecycleService {
  private readonly logger = new Logger(SubscriptionLifecycleService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
  ) {}

  // today: the calendar day (YYYY-MM-DD) the run counts as today, compared as a date.
  async advance(today: string): Promise<LifecycleRunResult> {
    const trials = await inStep('trial_to_active', () =>
      this.subscriptions
        .createQueryBuilder()
        .update(Subscription)
        .set({ status: SubscriptionStatus.ACTIVE, trialEndDate: null })
        .where('status = :trial', { trial: SubscriptionStatus.TRIAL })
        .andWhere('trial_end_date < CAST(:today AS date)', { today })
        .andWhere(OWNER_IS_ACTIVE)
        .execute(),
    );

    const cancellations = await inStep('cancelled_pending_to_cancelled', () =>
      this.subscriptions
        .createQueryBuilder()
        .update(Subscription)
        .set({ status: SubscriptionStatus.CANCELLED })
        .where('status = :pending', {
          pending: SubscriptionStatus.CANCELLED_PENDING,
        })
        .andWhere('next_billing_date < CAST(:today AS date)', { today })
        .andWhere(OWNER_IS_ACTIVE)
        .execute(),
    );

    const billing = await this.rollBillingDates(today);
    return {
      trialsActivated: trials.affected ?? 0,
      cancellationsCompleted: cancellations.affected ?? 0,
      billingDatesRolled: billing.rolled,
      billingRollFailed: billing.failed,
    };
  }

  // Each row moves from its own date, so it is read first and written back only while it is still
  // active with the date that was read. A row that fails is logged by id and counted, and the
  // others go on; a failed read of the rows fails the step.
  private async rollBillingDates(today: string): Promise<BillingRollResult> {
    const overdue = await inStep('roll_billing_dates', () =>
      this.subscriptions
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
        .andWhere(OWNER_IS_ACTIVE)
        .getMany(),
    );

    const result: BillingRollResult = { rolled: 0, failed: 0 };
    for (const row of overdue) {
      try {
        const update = await this.subscriptions
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
        result.rolled += update.affected ?? 0;
      } catch (error) {
        // A lost database fails every remaining row the same way: the step fails once instead.
        if (isConnectionFailure(error)) {
          throw new JobStepError('roll_billing_dates', error);
        }
        // The id and the code only: the message can quote the values of the query.
        this.logger.error(
          `Rolling the billing date of subscription ${row.id} failed (code: ${failureCodeOf(error)})`,
        );
        result.failed += 1;
      }
    }
    return result;
  }
}
