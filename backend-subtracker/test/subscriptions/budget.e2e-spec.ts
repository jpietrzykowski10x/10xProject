import {
  addDays,
  APP_TIME_ZONE,
  calendarDayIn,
} from '../../src/shared/date/calendar-day.js';
import { DEFAULT_CATEGORIES } from '../../src/subscriptions/default-categories.js';
import { CategorySetting } from '../../src/subscriptions/entities/category-setting.entity.js';
import { Subscription } from '../../src/subscriptions/entities/subscription.entity.js';
import { SubscriptionLifecycleService } from '../../src/subscriptions/services/subscription-lifecycle.service.js';
import type {
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

  it('gives every category of the account the default threshold of 2', async () => {
    const { cookie } = await signIn();
    const own = (await postCategory(cookie, 'Praca').expect(201))
      .body as CategoryResponse;

    const budget = await getBudget(cookie);

    // The order of GET /categories: the defaults, then the account's own.
    expect(budget).toEqual({
      categories: (await getCategories(cookie)).map((category) => ({
        category,
        duplicateThreshold: 2,
      })),
    });
    expect(budget.categories).toHaveLength(DEFAULT_CATEGORIES.length + 1);
    expect(budget.categories.at(-1)?.category).toEqual(own);
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
    const thresholds = new Map(
      budget.categories.map((row) => [row.category.id, row.duplicateThreshold]),
    );
    expect(thresholds.get(STREAMING_ID)).toBe(0);
    expect(thresholds.get(own.id)).toBe(99);
    expect(thresholds.get(GRY_ID)).toBe(2);
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
    // 2 × 30.00 in Streaming, 3 × 10.00 in Praca: Streaming first by its monthly cost.
    for (const name of ['Netflix', 'HBO Max']) {
      await create(cookie, { name, categoryId: STREAMING_ID, amount: 30 });
    }
    for (const name of ['Slack', 'Notion', 'Jira']) {
      await create(cookie, { name, categoryId: own.id, amount: 10 });
    }

    // The default threshold of 2.
    expect(warnings(await getTotals(cookie))).toEqual([
      {
        name: 'Streaming',
        subscriptionCount: 2,
        duplicateThreshold: 2,
        duplicateWarning: 'reached',
      },
      {
        name: 'Praca',
        subscriptionCount: 3,
        duplicateThreshold: 2,
        duplicateWarning: 'exceeded',
      },
    ]);

    await putBudget(cookie, {
      categories: [
        { categoryId: STREAMING_ID, duplicateThreshold: 1 },
        { categoryId: own.id, duplicateThreshold: 3 },
      ],
    }).expect(200);

    expect(warnings(await getTotals(cookie))).toEqual([
      {
        name: 'Streaming',
        subscriptionCount: 2,
        duplicateThreshold: 1,
        duplicateWarning: 'exceeded',
      },
      {
        name: 'Praca',
        subscriptionCount: 3,
        duplicateThreshold: 3,
        duplicateWarning: 'reached',
      },
    ]);
  });

  // The job sees every account, so "today" is the real day in Warsaw (test plan §6.4).
  it('drops the warning when the job closes a pending cancellation', async () => {
    const { cookie } = await signIn();
    const today = calendarDayIn(APP_TIME_ZONE, new Date());
    await create(cookie, { name: 'Netflix', categoryId: STREAMING_ID });
    const pending = await create(cookie, {
      name: 'HBO Max',
      categoryId: STREAMING_ID,
      status: 'cancelled_pending',
      nextBillingDate: addDays(today, -1),
    });
    expect(warnings(await getTotals(cookie))).toEqual([
      {
        name: 'Streaming',
        subscriptionCount: 2,
        duplicateThreshold: 2,
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
        subscriptionCount: 1,
        duplicateThreshold: 2,
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

    const ownerBudget = await getBudget(owner.cookie);
    expect(
      ownerBudget.categories.find(
        (row) => row.category.id === ownersCategory.id,
      )?.duplicateThreshold,
    ).toBe(5);
    expect(
      (await getBudget(other.cookie)).categories.map((row) => row.category.id),
    ).not.toContain(ownersCategory.id);
    expect(
      await repository(CategorySetting).countBy({
        userId: await userIdOf(other.address),
      }),
    ).toBe(0);
  });

  it('refuses the whole request when one category is unknown', async () => {
    const { cookie, address } = await signIn();

    await putBudget(cookie, {
      categories: [
        { categoryId: STREAMING_ID, duplicateThreshold: 0 },
        { categoryId: UNKNOWN_ID, duplicateThreshold: 0 },
      ],
    }).expect(400);

    expect(
      await repository(CategorySetting).countBy({
        userId: await userIdOf(address),
      }),
    ).toBe(0);
    expect(
      (await getBudget(cookie)).categories.find(
        (row) => row.category.id === STREAMING_ID,
      )?.duplicateThreshold,
    ).toBe(2);
  });

  it.each([
    [
      'a threshold above 99',
      [{ categoryId: STREAMING_ID, duplicateThreshold: 100 }],
    ],
    [
      'a threshold below 0',
      [{ categoryId: STREAMING_ID, duplicateThreshold: -1 }],
    ],
    ['no categories', []],
    [
      'the same category twice',
      [
        { categoryId: STREAMING_ID, duplicateThreshold: 1 },
        { categoryId: STREAMING_ID, duplicateThreshold: 3 },
      ],
    ],
  ])('answers 400 for %s', async (_case, categories) => {
    const { cookie } = await signIn();

    await putBudget(cookie, { categories }).expect(400);
  });
});
