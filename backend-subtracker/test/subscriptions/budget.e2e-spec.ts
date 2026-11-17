import {
  addDays,
  APP_TIME_ZONE,
  calendarDayIn,
} from '../../src/shared/date/calendar-day.js';
import { DEFAULT_CATEGORIES } from '../../src/subscriptions/default-categories.js';
import { CategorySetting } from '../../src/subscriptions/entities/category-setting.entity.js';
import { Subscription } from '../../src/subscriptions/entities/subscription.entity.js';
import { BudgetSettings } from '../../src/subscriptions/entities/budget-settings.entity.js';
import { SubscriptionLifecycleService } from '../../src/subscriptions/services/subscription-lifecycle.service.js';
import type {
  BudgetResponse,
  CategoryResponse,
  CostTotalsResponse,
  SubscriptionResponse,
} from '../../src/subscriptions/subscription.types.js';
import { createE2eApp, UNKNOWN_ID } from '../support/e2e-app.js';
import { subscriptionBody, subscriptionRequests } from './subscriptions-e2e.js';

const STREAMING_ID = DEFAULT_CATEGORIES[0].id;
const GRY_ID = DEFAULT_CATEGORIES[1].id;

// The threshold and warning of each category in the totals, by category name.
const warnings = (totals: CostTotalsResponse) =>
  totals.categories.map(
    ({
      category,
      subscriptionCount,
      duplicateThreshold,
      duplicateWarning,
    }) => ({
      name: category.name,
      subscriptionCount,
      duplicateThreshold,
      duplicateWarning,
    }),
  );

// The threshold of one category on the budget page.
const thresholdIn = (budget: BudgetResponse, categoryId: string) =>
  budget.categories.find((row) => row.category.id === categoryId)
    ?.duplicateThreshold;

describe('Budget — duplicate thresholds (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job) with a fake mail transport. Every row these tests create hangs off a
  // recognisable address and is removed at the end.
  const e2e = createE2eApp({ addressPrefix: 'e2e-subscriptions-budget-' });
  const { repository, signIn, twoAccounts, userIdOf } = e2e;
  const {
    postSubscription,
    postCategory,
    getCategories,
    getTotals,
    getBudget,
    putBudget,
  } = subscriptionRequests(e2e);

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

  const create = async (
    cookie: string,
    overrides: Record<string, unknown>,
  ): Promise<SubscriptionResponse> =>
    (await postSubscription(cookie, subscriptionBody(overrides)).expect(201))
      .body as SubscriptionResponse;

  it('gives a new account the default threshold of 3 for every category', async () => {
    const { cookie, address } = await signIn();
    const own = (await postCategory(cookie, 'Praca').expect(201))
      .body as CategoryResponse;

    const budget = await getBudget(cookie);

    // The order of GET /categories: the defaults, then the account's own.
    expect(budget).toEqual({
      defaultDuplicateThreshold: 3,
      categories: (await getCategories(cookie)).map((category) => ({
        category,
        duplicateThreshold: 3,
      })),
    });
    expect(budget.categories).toHaveLength(DEFAULT_CATEGORIES.length + 1);
    expect(budget.categories.at(-1)?.category).toEqual(own);
    // No settings row until the account saves a default.
    expect(
      await repository(BudgetSettings).countBy({
        userId: await userIdOf(address),
      }),
    ).toBe(0);
  });

  it('saves the listed thresholds and keeps the others', async () => {
    const { cookie, address } = await signIn();
    const own = (await postCategory(cookie, 'Praca').expect(201))
      .body as CategoryResponse;

    const saved = (
      await putBudget(cookie, {
        categories: [
          { categoryId: STREAMING_ID, duplicateThreshold: 0 },
          { categoryId: own.id, duplicateThreshold: 99 },
        ],
      })
        .expect(200)
        .expect('Cache-Control', 'no-store')
    ).body as unknown;

    const budget = await getBudget(cookie);
    expect(saved).toEqual(budget);
    expect(budget.defaultDuplicateThreshold).toBe(3);
    expect(thresholdIn(budget, STREAMING_ID)).toBe(0);
    expect(thresholdIn(budget, own.id)).toBe(99);
    expect(thresholdIn(budget, GRY_ID)).toBe(3);
    expect(JSON.stringify(saved)).not.toContain('userId');

    // A second save changes a stored value and leaves the other stored one alone.
    await putBudget(cookie, {
      categories: [{ categoryId: STREAMING_ID, duplicateThreshold: 5 }],
    }).expect(200);
    const rows = await repository(CategorySetting).find({
      where: { userId: await userIdOf(address) },
      order: { duplicateThreshold: 'ASC' },
    });
    expect(
      rows.map(({ categoryId, duplicateThreshold }) => ({
        categoryId,
        duplicateThreshold,
      })),
    ).toEqual([
      { categoryId: STREAMING_ID, duplicateThreshold: 5 },
      { categoryId: own.id, duplicateThreshold: 99 },
    ]);
  });

  it('warns in the totals by the stored thresholds', async () => {
    const { cookie } = await signIn();
    const own = (await postCategory(cookie, 'Praca').expect(201))
      .body as CategoryResponse;
    // 3 × 30.00 in Streaming, 4 × 10.00 in Praca: Streaming first by its monthly cost.
    for (const name of ['Netflix', 'HBO Max', 'Disney+']) {
      await create(cookie, { name, categoryId: STREAMING_ID, amount: 30 });
    }
    for (const name of ['Slack', 'Notion', 'Jira', 'Figma']) {
      await create(cookie, { name, categoryId: own.id, amount: 10 });
    }

    // The default threshold of 3.
    expect(warnings(await getTotals(cookie))).toEqual([
      {
        name: 'Streaming',
        subscriptionCount: 3,
        duplicateThreshold: 3,
        duplicateWarning: 'reached',
      },
      {
        name: 'Praca',
        subscriptionCount: 4,
        duplicateThreshold: 3,
        duplicateWarning: 'exceeded',
      },
    ]);

    await putBudget(cookie, {
      categories: [
        { categoryId: STREAMING_ID, duplicateThreshold: 2 },
        { categoryId: own.id, duplicateThreshold: 4 },
      ],
    }).expect(200);

    expect(warnings(await getTotals(cookie))).toEqual([
      {
        name: 'Streaming',
        subscriptionCount: 3,
        duplicateThreshold: 2,
        duplicateWarning: 'exceeded',
      },
      {
        name: 'Praca',
        subscriptionCount: 4,
        duplicateThreshold: 4,
        duplicateWarning: 'reached',
      },
    ]);
  });

  it('changes the threshold of a never saved category with the default, not of a saved one', async () => {
    const { cookie, address } = await signIn();
    await putBudget(cookie, {
      categories: [{ categoryId: STREAMING_ID, duplicateThreshold: 5 }],
    }).expect(200);
    // 2 × Gry, never saved: below the default 3.
    for (const name of ['Steam', 'Xbox Game Pass']) {
      await create(cookie, { name, categoryId: GRY_ID, amount: 20 });
    }
    expect(warnings(await getTotals(cookie))).toEqual([
      {
        name: 'Gry',
        subscriptionCount: 2,
        duplicateThreshold: 3,
        duplicateWarning: 'none',
      },
    ]);

    const saved = (
      await putBudget(cookie, { defaultDuplicateThreshold: 2 }).expect(200)
    ).body as BudgetResponse;

    expect(saved).toEqual(await getBudget(cookie));
    expect(saved.defaultDuplicateThreshold).toBe(2);
    expect(thresholdIn(saved, GRY_ID)).toBe(2);
    expect(thresholdIn(saved, STREAMING_ID)).toBe(5);
    expect(warnings(await getTotals(cookie))).toEqual([
      {
        name: 'Gry',
        subscriptionCount: 2,
        duplicateThreshold: 2,
        duplicateWarning: 'reached',
      },
    ]);
    // Only the default was written; the stored category rows stay as they were.
    const userId = await userIdOf(address);
    expect(
      (await repository(BudgetSettings).findOneByOrFail({ userId }))
        .defaultDuplicateThreshold,
    ).toBe(2);
    expect(
      (await repository(CategorySetting).findBy({ userId })).map(
        ({ categoryId, duplicateThreshold }) => ({
          categoryId,
          duplicateThreshold,
        }),
      ),
    ).toEqual([{ categoryId: STREAMING_ID, duplicateThreshold: 5 }]);
  });

  it('gives a new own category a copy of the current default that a later default leaves alone', async () => {
    const { cookie, address } = await signIn();
    await putBudget(cookie, { defaultDuplicateThreshold: 4 }).expect(200);

    const own = (await postCategory(cookie, 'Praca').expect(201))
      .body as CategoryResponse;
    expect(thresholdIn(await getBudget(cookie), own.id)).toBe(4);
    expect(
      (
        await repository(CategorySetting).findOneByOrFail({
          userId: await userIdOf(address),
          categoryId: own.id,
        })
      ).duplicateThreshold,
    ).toBe(4);

    // The default and a category threshold in one request.
    await putBudget(cookie, {
      defaultDuplicateThreshold: 7,
      categories: [{ categoryId: STREAMING_ID, duplicateThreshold: 1 }],
    }).expect(200);

    const budget = await getBudget(cookie);
    expect(budget.defaultDuplicateThreshold).toBe(7);
    expect(thresholdIn(budget, own.id)).toBe(4);
    expect(thresholdIn(budget, GRY_ID)).toBe(7);
    expect(thresholdIn(budget, STREAMING_ID)).toBe(1);
  });

  // The job sees every account, so "today" is the real day in Warsaw (test plan §6.4).
  it('drops the warning when the job closes a pending cancellation', async () => {
    const { cookie } = await signIn();
    const today = calendarDayIn(APP_TIME_ZONE, new Date());
    await create(cookie, { name: 'Netflix', categoryId: STREAMING_ID });
    await create(cookie, { name: 'Disney+', categoryId: STREAMING_ID });
    const pending = await create(cookie, {
      name: 'HBO Max',
      categoryId: STREAMING_ID,
      status: 'cancelled_pending',
      nextBillingDate: addDays(today, -1),
    });
    expect(warnings(await getTotals(cookie))).toEqual([
      {
        name: 'Streaming',
        subscriptionCount: 3,
        duplicateThreshold: 3,
        duplicateWarning: 'reached',
      },
    ]);

    await e2e.app.get(SubscriptionLifecycleService).advance(today);

    expect(
      (await repository(Subscription).findOneByOrFail({ id: pending.id }))
        .status,
    ).toBe('cancelled');
    expect(warnings(await getTotals(cookie))).toEqual([
      {
        name: 'Streaming',
        subscriptionCount: 2,
        duplicateThreshold: 3,
        duplicateWarning: 'none',
      },
    ]);
  });

  it("refuses to save another account's category and keeps its threshold", async () => {
    const { owner, other } = await twoAccounts();
    const ownersCategory = (
      await postCategory(owner.cookie, 'Praca').expect(201)
    ).body as CategoryResponse;
    await putBudget(owner.cookie, {
      categories: [{ categoryId: ownersCategory.id, duplicateThreshold: 5 }],
    }).expect(200);

    await putBudget(other.cookie, {
      categories: [{ categoryId: ownersCategory.id, duplicateThreshold: 0 }],
    }).expect(400);

    expect(thresholdIn(await getBudget(owner.cookie), ownersCategory.id)).toBe(
      5,
    );
    expect(
      (await getBudget(other.cookie)).categories.map((row) => row.category.id),
    ).not.toContain(ownersCategory.id);
    expect(
      await repository(CategorySetting).countBy({
        userId: await userIdOf(other.address),
      }),
    ).toBe(0);
  });

  it("keeps each account's default to itself", async () => {
    const { owner, other } = await twoAccounts();

    await putBudget(owner.cookie, { defaultDuplicateThreshold: 7 }).expect(200);

    const otherBudget = await getBudget(other.cookie);
    expect(otherBudget.defaultDuplicateThreshold).toBe(3);
    expect(thresholdIn(otherBudget, GRY_ID)).toBe(3);
    expect(
      await repository(BudgetSettings).countBy({
        userId: await userIdOf(other.address),
      }),
    ).toBe(0);

    await putBudget(other.cookie, { defaultDuplicateThreshold: 1 }).expect(200);

    const ownerBudget = await getBudget(owner.cookie);
    expect(ownerBudget.defaultDuplicateThreshold).toBe(7);
    expect(thresholdIn(ownerBudget, GRY_ID)).toBe(7);
    expect((await getBudget(other.cookie)).defaultDuplicateThreshold).toBe(1);
  });

  it('refuses the whole request when one category is unknown', async () => {
    const { cookie, address } = await signIn();

    await putBudget(cookie, {
      defaultDuplicateThreshold: 5,
      categories: [
        { categoryId: STREAMING_ID, duplicateThreshold: 0 },
        { categoryId: UNKNOWN_ID, duplicateThreshold: 0 },
      ],
    }).expect(400);

    const userId = await userIdOf(address);
    expect(await repository(CategorySetting).countBy({ userId })).toBe(0);
    expect(await repository(BudgetSettings).countBy({ userId })).toBe(0);
    const budget = await getBudget(cookie);
    expect(budget.defaultDuplicateThreshold).toBe(3);
    expect(thresholdIn(budget, STREAMING_ID)).toBe(3);
  });

  it.each([
    [
      'a threshold above 99',
      { categories: [{ categoryId: STREAMING_ID, duplicateThreshold: 100 }] },
    ],
    [
      'a threshold below 0',
      { categories: [{ categoryId: STREAMING_ID, duplicateThreshold: -1 }] },
    ],
    ['a default above 99', { defaultDuplicateThreshold: 100 }],
    ['a default below 0', { defaultDuplicateThreshold: -1 }],
    ['an empty body', {}],
    [
      'the same category twice',
      {
        categories: [
          { categoryId: STREAMING_ID, duplicateThreshold: 1 },
          { categoryId: STREAMING_ID, duplicateThreshold: 3 },
        ],
      },
    ],
  ])('answers 400 for %s', async (_case, body) => {
    const { cookie } = await signIn();

    await putBudget(cookie, body).expect(400);
  });
});
