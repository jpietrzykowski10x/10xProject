import {
  addDays,
  APP_TIME_ZONE,
  calendarDayIn,
} from '../../src/shared/date/calendar-day.js';
import { BackfillOwnCategorySettings1794951132638 } from '../../src/database/migrations/1794951132638-BackfillOwnCategorySettings.js';
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
      monthlyLimit: null,
      categories: (await getCategories(cookie)).map((category) => ({
        category,
        duplicateThreshold: 3,
        monthlyLimit: null,
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

  // The data migration touches every account's own categories, but only adds what POST /categories
  // adds anyway, so running it again on the shared test database is harmless (idempotent).
  it('gives own categories from before S-07 the threshold 3 and keeps saved ones', async () => {
    const { cookie, address } = await signIn();
    const userId = await userIdOf(address);
    const old = (await postCategory(cookie, 'Stara').expect(201))
      .body as CategoryResponse;
    const saved = (await postCategory(cookie, 'Zapisana').expect(201))
      .body as CategoryResponse;
    // "Stara" as it is in production before S-07: no row at all.
    await repository(CategorySetting).delete({ userId, categoryId: old.id });
    await putBudget(cookie, {
      defaultDuplicateThreshold: 6,
      categories: [{ categoryId: saved.id, duplicateThreshold: 5 }],
    }).expect(200);

    const queryRunner = e2e.dataSource.createQueryRunner();
    try {
      await new BackfillOwnCategorySettings1794951132638().up(queryRunner);
    } finally {
      await queryRunner.release();
    }

    const budget = await getBudget(cookie);
    expect(thresholdIn(budget, old.id)).toBe(3);
    expect(thresholdIn(budget, saved.id)).toBe(5);
    expect(thresholdIn(budget, GRY_ID)).toBe(6);
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

  // S-08: the overall and category monthly limits, saved by the same PUT /budget and compared in
  // the totals with the monthly sums on every read.
  describe('monthly limits', () => {
    // The limit of one category on the budget page.
    const limitIn = (budget: BudgetResponse, categoryId: string) =>
      budget.categories.find((row) => row.category.id === categoryId)
        ?.monthlyLimit;

    // The limit and alert of each category in the totals, by category name.
    const alerts = (totals: CostTotalsResponse) =>
      totals.categories.map(({ category, monthlyLimit, budgetAlert }) => ({
        name: category.name,
        monthlyLimit,
        budgetAlert,
      }));

    it('gives a new account no limits and no alert', async () => {
      const { cookie } = await signIn();
      await create(cookie, { categoryId: STREAMING_ID, amount: 43 });

      const budget = await getBudget(cookie);
      expect(budget.monthlyLimit).toBeNull();
      expect(budget.categories.map((row) => row.monthlyLimit)).toEqual(
        budget.categories.map(() => null),
      );
      expect(await getTotals(cookie)).toMatchObject({
        monthly: '43.00',
        monthlyLimit: null,
        budgetAlert: 'none',
        categories: [{ monthlyLimit: null, budgetAlert: 'none' }],
      });
    });

    // The oracle is the S-08 plan: below 80% no alert, from 80% near, exactly the limit reached,
    // above it exceeded, all against the monthly total.
    it('alerts in the totals by the overall limit', async () => {
      const { cookie, address } = await signIn();
      const saved = (await putBudget(cookie, { monthlyLimit: 100 }).expect(200))
        .body as BudgetResponse;
      expect(saved.monthlyLimit).toBe('100.00');
      expect(saved).toEqual(await getBudget(cookie));
      // Only the limit was written; the default threshold keeps its value.
      expect(
        await repository(BudgetSettings).findOneByOrFail({
          userId: await userIdOf(address),
        }),
      ).toMatchObject({ defaultDuplicateThreshold: 3, monthlyLimit: '100.00' });

      const steps: [string, number, string, string][] = [
        // 79.99 of 100.00: below 80%
        ['Netflix', 79.99, '79.99', 'none'],
        // 80.00 of 100.00: exactly 80%
        ['HBO Max', 0.01, '80.00', 'near'],
        // 100.00 of 100.00: exactly the limit
        ['Disney+', 20, '100.00', 'reached'],
        // 100.01 of 100.00: one grosz over
        ['SkyShowtime', 0.01, '100.01', 'exceeded'],
      ];
      for (const [name, amount, monthly, budgetAlert] of steps) {
        await create(cookie, { name, amount });
        expect(await getTotals(cookie)).toMatchObject({
          monthly,
          monthlyLimit: '100.00',
          budgetAlert,
        });
      }
    });

    it('compares a category limit with the monthly sum of the category', async () => {
      const { cookie } = await signIn();
      // 959.40 a year: 95940 / 12 = 7995 gr a month; with 50.00 a month 12995 gr in Streaming.
      await create(cookie, {
        name: 'Netflix',
        categoryId: STREAMING_ID,
        amount: 959.4,
        billingCycle: 'yearly',
      });
      await create(cookie, {
        name: 'HBO Max',
        categoryId: STREAMING_ID,
        amount: 50,
      });
      await create(cookie, { name: 'Steam', categoryId: GRY_ID, amount: 10 });

      await putBudget(cookie, {
        categories: [
          // 129.95 of 129.95: reached
          { categoryId: STREAMING_ID, monthlyLimit: 129.95 },
          // 10.00 of 12.50: exactly 80%
          { categoryId: GRY_ID, monthlyLimit: 12.5 },
        ],
      }).expect(200);

      const totals = await getTotals(cookie);
      expect(totals.monthlyLimit).toBeNull();
      expect(totals.budgetAlert).toBe('none');
      expect(alerts(totals)).toEqual([
        { name: 'Streaming', monthlyLimit: '129.95', budgetAlert: 'reached' },
        { name: 'Gry', monthlyLimit: '12.50', budgetAlert: 'near' },
      ]);
    });

    it("saves a category limit without freezing the category's threshold", async () => {
      const { cookie, address } = await signIn();
      const userId = await userIdOf(address);
      for (const name of ['Steam', 'Xbox Game Pass']) {
        await create(cookie, { name, categoryId: GRY_ID, amount: 30 });
      }

      await putBudget(cookie, {
        categories: [{ categoryId: GRY_ID, monthlyLimit: 50 }],
      }).expect(200);

      // The row exists for the limit alone, its threshold stays null.
      expect(
        await repository(CategorySetting).findOneByOrFail({
          userId,
          categoryId: GRY_ID,
        }),
      ).toMatchObject({ duplicateThreshold: null, monthlyLimit: '50.00' });
      let budget = await getBudget(cookie);
      expect(thresholdIn(budget, GRY_ID)).toBe(3);
      expect(limitIn(budget, GRY_ID)).toBe('50.00');

      // A new default still reaches the category, and the limit stays.
      await putBudget(cookie, { defaultDuplicateThreshold: 2 }).expect(200);
      budget = await getBudget(cookie);
      expect(thresholdIn(budget, GRY_ID)).toBe(2);
      expect(limitIn(budget, GRY_ID)).toBe('50.00');
      // 2 × 30.00 = 60.00 of 50.00: exceeded; 2 subscriptions at the default threshold 2: reached.
      expect(await getTotals(cookie)).toMatchObject({
        categories: [
          {
            duplicateThreshold: 2,
            duplicateWarning: 'reached',
            monthlyLimit: '50.00',
            budgetAlert: 'exceeded',
          },
        ],
      });

      // Requests naming a threshold for one category and a limit for another change only what
      // each names.
      await putBudget(cookie, {
        categories: [
          { categoryId: GRY_ID, duplicateThreshold: 5 },
          { categoryId: STREAMING_ID, monthlyLimit: 20 },
        ],
      }).expect(200);
      await putBudget(cookie, {
        categories: [
          { categoryId: STREAMING_ID, duplicateThreshold: 1 },
          { categoryId: GRY_ID, monthlyLimit: 70 },
        ],
      }).expect(200);
      budget = await getBudget(cookie);
      expect(thresholdIn(budget, GRY_ID)).toBe(5);
      expect(limitIn(budget, GRY_ID)).toBe('70.00');
      expect(thresholdIn(budget, STREAMING_ID)).toBe(1);
      expect(limitIn(budget, STREAMING_ID)).toBe('20.00');
    });

    it('removes a limit given as null and keeps the rest', async () => {
      const { cookie } = await signIn();
      await create(cookie, { categoryId: STREAMING_ID, amount: 43 });
      await putBudget(cookie, {
        defaultDuplicateThreshold: 4,
        monthlyLimit: 40,
        categories: [
          { categoryId: STREAMING_ID, duplicateThreshold: 0, monthlyLimit: 40 },
        ],
      }).expect(200);
      expect(await getTotals(cookie)).toMatchObject({
        budgetAlert: 'exceeded',
        categories: [{ budgetAlert: 'exceeded' }],
      });

      const saved = (
        await putBudget(cookie, {
          monthlyLimit: null,
          categories: [{ categoryId: STREAMING_ID, monthlyLimit: null }],
        }).expect(200)
      ).body as BudgetResponse;

      expect(saved.monthlyLimit).toBeNull();
      expect(saved.defaultDuplicateThreshold).toBe(4);
      expect(limitIn(saved, STREAMING_ID)).toBeNull();
      expect(thresholdIn(saved, STREAMING_ID)).toBe(0);
      expect(await getTotals(cookie)).toMatchObject({
        monthlyLimit: null,
        budgetAlert: 'none',
        categories: [
          {
            duplicateThreshold: 0,
            duplicateWarning: 'exceeded',
            monthlyLimit: null,
            budgetAlert: 'none',
          },
        ],
      });
    });

    it("keeps each account's limits to itself", async () => {
      const { owner, other } = await twoAccounts();
      const ownersCategory = (
        await postCategory(owner.cookie, 'Praca').expect(201)
      ).body as CategoryResponse;
      await putBudget(owner.cookie, {
        monthlyLimit: 100,
        categories: [{ categoryId: ownersCategory.id, monthlyLimit: 20 }],
      }).expect(200);
      await create(other.cookie, { amount: 90 });

      const otherBudget = await getBudget(other.cookie);
      expect(otherBudget.monthlyLimit).toBeNull();
      expect(
        otherBudget.categories.map((row) => row.category.id),
      ).not.toContain(ownersCategory.id);
      expect(await getTotals(other.cookie)).toMatchObject({
        monthlyLimit: null,
        budgetAlert: 'none',
      });

      // Another account's category refuses the whole request, the own limit in it included.
      await putBudget(other.cookie, {
        monthlyLimit: 5,
        categories: [{ categoryId: ownersCategory.id, monthlyLimit: 0 }],
      }).expect(400);
      expect(
        await repository(BudgetSettings).countBy({
          userId: await userIdOf(other.address),
        }),
      ).toBe(0);

      await putBudget(other.cookie, { monthlyLimit: 5 }).expect(200);
      const ownerBudget = await getBudget(owner.cookie);
      expect(ownerBudget.monthlyLimit).toBe('100.00');
      expect(limitIn(ownerBudget, ownersCategory.id)).toBe('20.00');
      expect((await getTotals(other.cookie)).budgetAlert).toBe('exceeded');
    });

    it.each([
      ['an overall limit above 99 999.99', { monthlyLimit: 100000 }],
      ['an overall limit below 0', { monthlyLimit: -1 }],
      ['an overall limit with three decimals', { monthlyLimit: 1.001 }],
      ['an overall limit as a string', { monthlyLimit: '10' }],
      [
        'a category limit above 99 999.99',
        { categories: [{ categoryId: STREAMING_ID, monthlyLimit: 100000 }] },
      ],
      [
        'a category naming neither field',
        { categories: [{ categoryId: STREAMING_ID }] },
      ],
      [
        'a null threshold next to a limit',
        {
          categories: [
            {
              categoryId: STREAMING_ID,
              duplicateThreshold: null,
              monthlyLimit: 10,
            },
          ],
        },
      ],
    ])('answers 400 for %s', async (_case, body) => {
      const { cookie } = await signIn();

      await putBudget(cookie, body).expect(400);
    });
  });
});
