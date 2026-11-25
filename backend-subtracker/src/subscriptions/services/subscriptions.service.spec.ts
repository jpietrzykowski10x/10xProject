import type { Repository } from 'typeorm';
import type { ListSubscriptionsDto } from '../dtos/list-subscriptions.dto.js';
import type { Category } from '../entities/category.entity.js';
import type { Subscription } from '../entities/subscription.entity.js';
import {
  BillingCycle,
  PaymentMethod,
  SubscriptionSort,
  SubscriptionStatus,
} from '../subscription.types.js';
import type { BudgetService } from './budget.service.js';
import type { CategoriesService } from './categories.service.js';
import { SubscriptionsService } from './subscriptions.service.js';

const USER_ID = '7f0c2a8e-2b1d-4c3a-9e5f-1a2b3c4d5e6f';
const CATEGORY_ID = '8312d1ba-9f14-4fe2-b611-ebd2538c2721';

const CATEGORY = {
  id: CATEGORY_ID,
  name: 'Praca',
  userId: USER_ID,
} as Category;

const ROW = {
  id: 'f1e2d3c4-b5a6-4978-8a6b-5c4d3e2f1a0b',
  name: 'Netflix',
  category: CATEGORY,
  amount: '43.00',
  billingCycle: BillingCycle.MONTHLY,
  paymentMethod: PaymentMethod.CREDIT_CARD,
  status: SubscriptionStatus.ACTIVE,
  trialEndDate: null,
  nextBillingDate: '2026-11-15',
  createdAt: new Date('2026-11-01T10:00:00Z'),
} as Subscription;

function setup(rows: Subscription[] = [ROW], total = rows.length) {
  const builder = {
    innerJoinAndSelect: vi.fn(() => builder),
    where: vi.fn(() => builder),
    andWhere: vi.fn(() => builder),
    addOrderBy: vi.fn(() => builder),
    offset: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    getManyAndCount: vi.fn(() => Promise.resolve([rows, total])),
  };
  const subscriptions = { createQueryBuilder: vi.fn(() => builder) };
  const service = new SubscriptionsService(
    subscriptions as unknown as Repository<Subscription>,
    {} as CategoriesService,
    {} as BudgetService,
  );
  return { service, builder };
}

// A query as the ValidationPipe hands it over: the defaults plus what the request set.
const query = (
  overrides: Partial<ListSubscriptionsDto> = {},
): ListSubscriptionsDto => ({
  sort: SubscriptionSort.STATUS_THEN_DATE,
  page: 1,
  pageSize: 25,
  ...overrides,
});

describe('SubscriptionsService.page', () => {
  it('scopes the query to the account and adds no filter without one', async () => {
    const { service, builder } = setup();

    await service.page(USER_ID, query());

    expect(builder.where).toHaveBeenCalledWith(
      'subscription.userId = :userId',
      { userId: USER_ID },
    );
    expect(builder.andWhere).not.toHaveBeenCalled();
  });

  it('filters by the category and the status when given', async () => {
    const { service, builder } = setup();

    await service.page(
      USER_ID,
      query({ category: CATEGORY_ID, status: SubscriptionStatus.TRIAL }),
    );

    expect(builder.andWhere).toHaveBeenCalledWith('category.id = :category', {
      category: CATEGORY_ID,
    });
    expect(builder.andWhere).toHaveBeenCalledWith(
      'subscription.status = :status',
      { status: SubscriptionStatus.TRIAL },
    );
  });

  it('orders by the chosen key first and the id last', async () => {
    const { service, builder } = setup();

    await service.page(USER_ID, query({ sort: SubscriptionSort.NAME_DESC }));

    const terms = builder.addOrderBy.mock.calls as unknown as [
      string,
      string,
    ][];
    expect(terms[0]).toEqual([
      'lower(subscription.name) COLLATE "pl-PL-x-icu"',
      'DESC',
    ]);
    expect(terms.at(-1)).toEqual(['subscription.id', 'ASC']);
  });

  it('takes the requested page with offset and limit', async () => {
    const { service, builder } = setup();

    await service.page(USER_ID, query({ page: 3, pageSize: 10 }));

    expect(builder.offset).toHaveBeenCalledWith(20);
    expect(builder.limit).toHaveBeenCalledWith(10);
  });

  it('answers the rows of the page with the total and the page asked for', async () => {
    const { service } = setup([ROW], 30);

    await expect(
      service.page(USER_ID, query({ page: 2, pageSize: 25 })),
    ).resolves.toEqual({
      items: [
        {
          id: ROW.id,
          name: 'Netflix',
          category: { id: CATEGORY_ID, name: 'Praca', isDefault: false },
          amount: '43.00',
          billingCycle: 'monthly',
          paymentMethod: 'credit_card',
          status: 'active',
          trialEndDate: null,
          nextBillingDate: '2026-11-15',
          createdAt: ROW.createdAt,
        },
      ],
      total: 30,
      page: 2,
      pageSize: 25,
    });
  });
});
