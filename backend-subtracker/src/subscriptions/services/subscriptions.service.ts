import { BadRequestException, Injectable } from '@nestjs/common';
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
    const category = await this.categories.findUsable(userId, dto.categoryId);
    if (category === null) {
      throw new BadRequestException(
        'categoryId does not name a usable category',
      );
    }

    const saved = await this.subscriptions.save(
      this.subscriptions.create({
        userId,
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
      }),
    );
    // Read back so the answer shows the stored values, as the list will.
    const stored = await this.subscriptions.findOneByOrFail({ id: saved.id });
    return toSubscriptionResponse(stored, category);
  }
}
