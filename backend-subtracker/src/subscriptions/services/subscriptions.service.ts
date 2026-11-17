import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type QueryDeepPartialEntity } from 'typeorm';
import type { CreateSubscriptionDto } from '../dtos/create-subscription.dto.js';
import { COUNTED_STATUSES, costTotals } from '../cost-totals.js';
import type { Category } from '../entities/category.entity.js';
import { Subscription } from '../entities/subscription.entity.js';
import {
  CANCELLABLE_STATUSES,
  CANCELLED_STATUS,
  RESUMABLE_STATUSES,
  RESUMED_STATUS,
} from '../subscription-lifecycle.js';
import { subscriptionOrder } from '../subscription-order.js';
import {
  type CostTotalsResponse,
  SubscriptionSort,
  type SubscriptionResponse,
  SubscriptionStatus,
} from '../subscription.types.js';
import { BudgetService } from './budget.service.js';
import { CategoriesService, toCategoryResponse } from './categories.service.js';

const LIST_ALIAS = 'subscription';

// The same for another account's id and for an id no row has.
const NOT_FOUND_MESSAGE = 'Subscription not found';

// An action (cancel, resume) on a subscription whose status does not allow it.
const WRONG_STATUS_MESSAGE =
  'The subscription status does not allow this action';

type SubscriptionFields = Pick<
  Subscription,
  | 'categoryId'
  | 'name'
  | 'amount'
  | 'billingCycle'
  | 'paymentMethod'
  | 'status'
  | 'trialEndDate'
  | 'nextBillingDate'
>;

// The columns a create or an edit writes from the request, the amount already in the
// numeric(10,2) form the list reads back ("43.00").
function subscriptionFields(
  dto: CreateSubscriptionDto,
  category: Category,
): SubscriptionFields {
  return {
    categoryId: category.id,
    name: dto.name,
    amount: dto.amount.toFixed(2),
    billingCycle: dto.billingCycle,
    paymentMethod: dto.paymentMethod,
    status: dto.status,
    trialEndDate:
      dto.status === SubscriptionStatus.TRIAL
        ? (dto.trialEndDate ?? null)
        : null,
    nextBillingDate: dto.nextBillingDate,
  };
}

function toSubscriptionResponse(
  subscription: Subscription,
  category: Category,
): SubscriptionResponse {
  return {
    id: subscription.id,
    name: subscription.name,
    category: toCategoryResponse(category),
    amount: subscription.amount,
    billingCycle: subscription.billingCycle,
    paymentMethod: subscription.paymentMethod,
    status: subscription.status,
    trialEndDate: subscription.trialEndDate,
    nextBillingDate: subscription.nextBillingDate,
    createdAt: subscription.createdAt,
  };
}

// Every query is scoped to the current user; userId never comes from the request body.
@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    private readonly categories: CategoriesService,
    private readonly budget: BudgetService,
  ) {}

  async list(
    userId: string,
    sort: SubscriptionSort = SubscriptionSort.STATUS_THEN_DATE,
  ): Promise<SubscriptionResponse[]> {
    const query = this.subscriptions
      .createQueryBuilder(LIST_ALIAS)
      .innerJoinAndSelect(`${LIST_ALIAS}.category`, 'category')
      .where(`${LIST_ALIAS}.userId = :userId`, { userId });
    for (const term of subscriptionOrder(sort, LIST_ALIAS)) {
      query.addOrderBy(term.expression, term.direction);
    }
    const rows = await query.getMany();
    return rows.map((row) => toSubscriptionResponse(row, row.category));
  }

  // Summed in JS on whole grosze (cost-totals.ts); SQL only picks the counted rows of the account,
  // so there is no SUM and no ORDER BY here. The duplicate warnings and limit alerts are worked out
  // on every read from the user's budget settings, so no warning or alert state is stored.
  async totals(userId: string): Promise<CostTotalsResponse> {
    const [rows, settings] = await Promise.all([
      this.subscriptions
        .createQueryBuilder(LIST_ALIAS)
        .innerJoinAndSelect(`${LIST_ALIAS}.category`, 'category')
        .where(`${LIST_ALIAS}.userId = :userId`, { userId })
        .andWhere(`${LIST_ALIAS}.status IN (:...statuses)`, {
          statuses: COUNTED_STATUSES,
        })
        .getMany(),
      this.budget.budgetSettings(userId),
    ]);
    return costTotals(
      rows.map((row) => ({
        amount: row.amount,
        billingCycle: row.billingCycle,
        category: toCategoryResponse(row.category),
      })),
      settings,
    );
  }

  async create(
    userId: string,
    dto: CreateSubscriptionDto,
  ): Promise<SubscriptionResponse> {
    const category = await this.usableCategory(userId, dto.categoryId);

    // save() fills id and createdAt from RETURNING; the rest is what was written.
    const saved = await this.subscriptions.save(
      this.subscriptions.create({
        userId,
        ...subscriptionFields(dto, category),
      }),
    );
    return toSubscriptionResponse(saved, category);
  }

  // Replaces every field the request sets; userId and createdAt never change.
  async update(
    userId: string,
    id: string,
    dto: CreateSubscriptionDto,
  ): Promise<SubscriptionResponse> {
    const subscription = await this.subscriptions.findOneBy({ id, userId });
    if (subscription === null) {
      throw new NotFoundException(NOT_FOUND_MESSAGE);
    }
    const category = await this.usableCategory(userId, dto.categoryId);

    // update(), not save(): save() would INSERT the row again if a DELETE (e.g. from another
    // tab) removed it after the read above.
    const fields = subscriptionFields(dto, category);
    const result = await this.subscriptions.update({ id, userId }, fields);
    if (!result.affected) {
      throw new NotFoundException(NOT_FOUND_MESSAGE);
    }
    return toSubscriptionResponse(
      this.subscriptions.merge(subscription, fields),
      category,
    );
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.subscriptions.delete({ id, userId });
    if (!result.affected) {
      throw new NotFoundException(NOT_FOUND_MESSAGE);
    }
  }

  // Dates stay as they are, except that a cancelled trial ends with the trial: Postgres evaluates
  // every SET expression on the old row, so COALESCE reads trial_end_date before it is cleared.
  cancel(userId: string, id: string): Promise<SubscriptionResponse> {
    return this.transition(userId, id, CANCELLABLE_STATUSES, {
      status: CANCELLED_STATUS,
      nextBillingDate: () => 'COALESCE(trial_end_date, next_billing_date)',
      trialEndDate: null,
    });
  }

  resume(userId: string, id: string): Promise<SubscriptionResponse> {
    return this.transition(userId, id, RESUMABLE_STATUSES, {
      status: RESUMED_STATUS,
    });
  }

  // One conditional UPDATE, so an action and the lifecycle job never overwrite each other: the row
  // changes only while it belongs to the account and is still in one of the allowed statuses.
  private async transition(
    userId: string,
    id: string,
    from: readonly SubscriptionStatus[],
    changes: QueryDeepPartialEntity<Subscription>,
  ): Promise<SubscriptionResponse> {
    const result = await this.subscriptions
      .createQueryBuilder()
      .update(Subscription)
      .set(changes)
      .where('id = :id', { id })
      .andWhere('user_id = :userId', { userId })
      .andWhere('status IN (:...from)', { from })
      .execute();
    if (!result.affected) {
      const exists = await this.subscriptions.existsBy({ id, userId });
      throw exists
        ? new ConflictException(WRONG_STATUS_MESSAGE)
        : new NotFoundException(NOT_FOUND_MESSAGE);
    }

    const subscription = await this.subscriptions.findOne({
      where: { id, userId },
      relations: { category: true },
    });
    // Deleted (e.g. from another tab) right after the update.
    if (subscription === null) {
      throw new NotFoundException(NOT_FOUND_MESSAGE);
    }
    return toSubscriptionResponse(subscription, subscription.category);
  }

  private async usableCategory(
    userId: string,
    categoryId: string,
  ): Promise<Category> {
    const category = await this.categories.findUsable(userId, categoryId);
    if (category === null) {
      throw new BadRequestException(
        'categoryId does not name a usable category',
      );
    }
    return category;
  }
}
