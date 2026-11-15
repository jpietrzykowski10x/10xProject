import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CreateSubscriptionDto } from '../dtos/create-subscription.dto.js';
import type { Category } from '../entities/category.entity.js';
import { Subscription } from '../entities/subscription.entity.js';
import { subscriptionOrder } from '../subscription-order.js';
import {
  SubscriptionSort,
  type SubscriptionResponse,
  SubscriptionStatus,
} from '../subscription.types.js';
import { CategoriesService, toCategoryResponse } from './categories.service.js';

const LIST_ALIAS = 'subscription';

// The same for another account's id and for an id no row has.
const NOT_FOUND_MESSAGE = 'Subscription not found';

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

    const saved = await this.subscriptions.save(
      this.subscriptions.merge(subscription, subscriptionFields(dto, category)),
    );
    return toSubscriptionResponse(saved, category);
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.subscriptions.delete({ id, userId });
    if (!result.affected) {
      throw new NotFoundException(NOT_FOUND_MESSAGE);
    }
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
