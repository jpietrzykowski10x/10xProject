import { BudgetAlert } from './budget-alert.js';
import {
  COUNTED_STATUSES,
  costTotals,
  type CostTotalsRow,
  type UserBudgetSettings,
} from './cost-totals.js';
import { DuplicateWarning } from './duplicate-warning.js';
import {
  BillingCycle,
  type CategoryResponse,
  SubscriptionStatus,
} from './subscription.types.js';

const category = (id: string, name: string): CategoryResponse => ({
  id,
  name,
  isDefault: false,
});

// No stored settings: every category has the default of 3 (DEFAULT_DUPLICATE_THRESHOLD) and no
// limit applies.
const NO_SETTINGS: UserBudgetSettings = {
  defaultThreshold: 3,
  byCategory: new Map(),
  monthlyLimit: null,
  limitByCategory: new Map(),
};

const STREAMING = category('c1', 'Streaming');
const MUZYKA = category('c2', 'Muzyka');
const PRACA = category('c3', 'Praca');

const row = (
  amount: string,
  billingCycle: BillingCycle,
  rowCategory: CategoryResponse = PRACA,
): CostTotalsRow => ({ amount, billingCycle, category: rowCategory });

// The oracle is the rounding rule from test-plan.md §2 (risk #4): a yearly amount in grosze is
// divided by 12 and rounded to the grosz per subscription, a half grosz up; the yearly total is the
// real spend (monthly × 12, yearly unchanged). Every expected value below was worked out by hand;
// the arithmetic is in the comment next to it.
describe('costTotals', () => {
  it('counts trial, active and cancelled_pending, not cancelled', () => {
    expect(COUNTED_STATUSES).toEqual([
      SubscriptionStatus.TRIAL,
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.CANCELLED_PENDING,
    ]);
  });

  // The same cases as monthlyAmount in frontend-subtracker/src/app/subscriptions/subscription-amounts.spec.ts.
  it.each([
    // 12000 gr / 12 = 1000 gr
    ['120.00', '10.00'],
    // 123387 gr / 12 = 10282.25 → 10282 gr
    ['1233.87', '102.82'],
    // 1206 gr / 12 = 100.5 → 101 gr (a half grosz goes up)
    ['12.06', '1.01'],
    // 1205 gr / 12 = 100.4166… → 100 gr
    ['12.05', '1.00'],
    // 1207 gr / 12 = 100.5833… → 101 gr
    ['12.07', '1.01'],
    // 6 gr / 12 = 0.5 → 1 gr (a half grosz goes up)
    ['0.06', '0.01'],
    // 5 gr / 12 = 0.4166… → 0 gr
    ['0.05', '0.00'],
    // 0 gr / 12 = 0 gr
    ['0.00', '0.00'],
    // 9999999 gr / 12 = 833333.25 → 833333 gr
    ['99999.99', '8333.33'],
    // 59988 gr / 12 = 4999 gr
    ['599.88', '49.99'],
    // 18 gr / 12 = 1.5 → 2 gr (a half grosz goes up)
    ['0.18', '0.02'],
  ])('counts a yearly %j as %j a month', (amount, monthly) => {
    expect(costTotals([row(amount, BillingCycle.YEARLY)], NO_SETTINGS)).toEqual(
      {
        monthly,
        yearly: amount,
        monthlyLimit: null,
        budgetAlert: BudgetAlert.NONE,
        categories: [
          {
            category: PRACA,
            monthly,
            yearly: amount,
            subscriptionCount: 1,
            duplicateThreshold: 3,
            duplicateWarning: DuplicateWarning.NONE,
            monthlyLimit: null,
            budgetAlert: BudgetAlert.NONE,
          },
        ],
      },
    );
  });

  it('counts a monthly amount unchanged a month and times 12 a year', () => {
    // 1299 gr × 12 = 15588 gr
    expect(
      costTotals([row('12.99', BillingCycle.MONTHLY)], NO_SETTINGS),
    ).toMatchObject({
      monthly: '12.99',
      yearly: '155.88',
    });
  });

  it('adds up the example from the mockup', () => {
    // The cancelled 50.00 a month (Streaming) is filtered out before; these are the counted rows.
    const totals = costTotals(
      [
        // active: 4300 gr a month, 4300 × 12 = 51600 gr a year
        row('43.00', BillingCycle.MONTHLY, STREAMING),
        // trial: 2399 gr a month, 2399 × 12 = 28788 gr a year
        row('23.99', BillingCycle.MONTHLY, MUZYKA),
        // cancelled_pending: 42999 / 12 = 3583.25 → 3583 gr a month, 42999 gr a year
        row('429.99', BillingCycle.YEARLY, PRACA),
      ],
      NO_SETTINGS,
    );

    expect(totals).toEqual({
      // 4300 + 2399 + 3583 = 10282 gr
      monthly: '102.82',
      // 51600 + 28788 + 42999 = 123387 gr
      yearly: '1233.87',
      monthlyLimit: null,
      budgetAlert: BudgetAlert.NONE,
      categories: [
        {
          category: STREAMING,
          monthly: '43.00',
          yearly: '516.00',
          subscriptionCount: 1,
          duplicateThreshold: 3,
          duplicateWarning: DuplicateWarning.NONE,
          monthlyLimit: null,
          budgetAlert: BudgetAlert.NONE,
        },
        {
          category: PRACA,
          monthly: '35.83',
          yearly: '429.99',
          subscriptionCount: 1,
          duplicateThreshold: 3,
          duplicateWarning: DuplicateWarning.NONE,
          monthlyLimit: null,
          budgetAlert: BudgetAlert.NONE,
        },
        {
          category: MUZYKA,
          monthly: '23.99',
          yearly: '287.88',
          subscriptionCount: 1,
          duplicateThreshold: 3,
          duplicateWarning: DuplicateWarning.NONE,
          monthlyLimit: null,
          budgetAlert: BudgetAlert.NONE,
        },
      ],
    });
  });

  it('rounds each subscription before adding them up', () => {
    // 1206 / 12 = 100.5 → 101 gr each; 101 + 101 = 202 gr (not 2412 / 12 = 201 gr)
    expect(
      costTotals(
        [row('12.06', BillingCycle.YEARLY), row('12.06', BillingCycle.YEARLY)],
        NO_SETTINGS,
      ),
    ).toEqual({
      monthly: '2.02',
      // 1206 + 1206 = 2412 gr
      yearly: '24.12',
      monthlyLimit: null,
      budgetAlert: BudgetAlert.NONE,
      categories: [
        {
          category: PRACA,
          monthly: '2.02',
          yearly: '24.12',
          subscriptionCount: 2,
          duplicateThreshold: 3,
          duplicateWarning: DuplicateWarning.NONE,
          monthlyLimit: null,
          budgetAlert: BudgetAlert.NONE,
        },
      ],
    });
  });

  it('breaks a tie on the monthly cost by the name in Polish order', () => {
    const zdrowie = category('c4', 'Zdrowie');
    const lacznosc = category('c5', 'Łączność');

    const totals = costTotals(
      [
        row('10.00', BillingCycle.MONTHLY, zdrowie),
        row('10.00', BillingCycle.MONTHLY, lacznosc),
        // 12000 / 12 = 1000 gr a month: the same tie, from a yearly amount
        row('120.00', BillingCycle.YEARLY, PRACA),
        row('10.01', BillingCycle.MONTHLY, STREAMING),
      ],
      NO_SETTINGS,
    );

    // In Unicode code point order "Ł" (U+0141) would come after "Z".
    expect(totals.categories.map((total) => total.category.name)).toEqual([
      'Streaming',
      'Łączność',
      'Praca',
      'Zdrowie',
    ]);
  });

  it('breaks a tie on the cost and the name by the id', () => {
    const first = category('a', 'Inne');
    const second = category('b', 'Inne');

    const totals = costTotals(
      [
        row('5.00', BillingCycle.MONTHLY, second),
        row('5.00', BillingCycle.MONTHLY, first),
      ],
      NO_SETTINGS,
    );

    expect(totals.categories.map((total) => total.category.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it("takes the threshold from the settings and the user's default without one", () => {
    // The user's default is 2 here, not DEFAULT_DUPLICATE_THRESHOLD.
    // Praca: 3 subscriptions with a stored threshold of 3 → reached.
    // Streaming: 1 subscription with a stored threshold of 0 → exceeded.
    // Muzyka: 3 subscriptions without a setting, so the user's default 2 → exceeded.
    const totals = costTotals(
      [
        row('30.00', BillingCycle.MONTHLY, PRACA),
        row('30.00', BillingCycle.MONTHLY, PRACA),
        row('30.00', BillingCycle.MONTHLY, PRACA),
        row('50.00', BillingCycle.MONTHLY, STREAMING),
        row('10.00', BillingCycle.MONTHLY, MUZYKA),
        row('10.00', BillingCycle.MONTHLY, MUZYKA),
        row('10.00', BillingCycle.MONTHLY, MUZYKA),
      ],
      {
        ...NO_SETTINGS,
        defaultThreshold: 2,
        byCategory: new Map([
          [PRACA.id, 3],
          [STREAMING.id, 0],
        ]),
      },
    );

    expect(
      totals.categories.map(
        ({ category: { name }, duplicateThreshold, duplicateWarning }) => ({
          name,
          duplicateThreshold,
          duplicateWarning,
        }),
      ),
    ).toEqual([
      // 3 × 3000 = 9000 gr
      {
        name: 'Praca',
        duplicateThreshold: 3,
        duplicateWarning: DuplicateWarning.REACHED,
      },
      // 5000 gr
      {
        name: 'Streaming',
        duplicateThreshold: 0,
        duplicateWarning: DuplicateWarning.EXCEEDED,
      },
      // 3 × 1000 = 3000 gr
      {
        name: 'Muzyka',
        duplicateThreshold: 2,
        duplicateWarning: DuplicateWarning.EXCEEDED,
      },
    ]);
  });

  it.each([
    // no stored settings: the default 3, three subscriptions reach it
    [3, DuplicateWarning.REACHED],
    // a user's default of 4: three subscriptions stay below it
    [4, DuplicateWarning.NONE],
  ])(
    'gives a category without a setting the default of %i',
    (defaultThreshold, expected) => {
      const totals = costTotals(
        [
          row('10.00', BillingCycle.MONTHLY, MUZYKA),
          row('10.00', BillingCycle.MONTHLY, MUZYKA),
          row('10.00', BillingCycle.MONTHLY, MUZYKA),
        ],
        {
          ...NO_SETTINGS,
          defaultThreshold,
          byCategory: new Map([[PRACA.id, 1]]),
        },
      );

      expect(totals.categories).toMatchObject([
        {
          category: MUZYKA,
          duplicateThreshold: defaultThreshold,
          duplicateWarning: expected,
        },
      ]);
    },
  );

  it('gives zero sums and no categories for no subscriptions', () => {
    expect(costTotals([], NO_SETTINGS)).toEqual({
      monthly: '0.00',
      yearly: '0.00',
      monthlyLimit: null,
      budgetAlert: BudgetAlert.NONE,
      categories: [],
    });
  });

  // The oracle is the S-08 plan: a limit is compared with the same monthly sum the response shows,
  // in which a yearly subscription counts as its amount / 12 rounded per subscription (risk #4).
  it.each([
    // 9594 gr / 12 = 799.5 → 800 gr: exactly 80% of 10.00 zł → near
    ['95.94', '8.00', BudgetAlert.NEAR],
    // 9593 gr / 12 = 799.41… → 799 gr: below 80% (800 gr) → none
    ['95.93', '7.99', BudgetAlert.NONE],
  ])(
    'compares a yearly %j (%j a month) with a limit of 10.00 as %j',
    (amount, monthly, expected) => {
      const totals = costTotals([row(amount, BillingCycle.YEARLY)], {
        ...NO_SETTINGS,
        monthlyLimit: '10.00',
        limitByCategory: new Map([[PRACA.id, '10.00']]),
      });

      expect(totals).toMatchObject({
        monthly,
        monthlyLimit: '10.00',
        budgetAlert: expected,
        categories: [{ monthly, monthlyLimit: '10.00', budgetAlert: expected }],
      });
    },
  );

  it('compares a limit with the sum of the rounded monthly amounts', () => {
    // 1206 / 12 = 100.5 → 101 gr each; 101 + 101 = 202 gr: exactly the limit of 2.02 → reached.
    // The yearly sum divided by 12 (2412 / 12 = 201 gr) would only be near.
    const totals = costTotals(
      [row('12.06', BillingCycle.YEARLY), row('12.06', BillingCycle.YEARLY)],
      {
        ...NO_SETTINGS,
        monthlyLimit: '2.02',
        limitByCategory: new Map([[PRACA.id, '2.02']]),
      },
    );

    expect(totals).toMatchObject({
      monthly: '2.02',
      budgetAlert: BudgetAlert.REACHED,
      categories: [{ monthly: '2.02', budgetAlert: BudgetAlert.REACHED }],
    });
  });

  it('gives each category its own limit and the total the overall one', () => {
    // Streaming 50.00 against 40.00 → exceeded; Praca 30.00 against 30.00 → reached; Muzyka
    // 10.00 with a settings row but no limit → none. The total 90.00 against 100.00 → near.
    const totals = costTotals(
      [
        row('50.00', BillingCycle.MONTHLY, STREAMING),
        row('30.00', BillingCycle.MONTHLY, PRACA),
        row('10.00', BillingCycle.MONTHLY, MUZYKA),
      ],
      {
        ...NO_SETTINGS,
        monthlyLimit: '100.00',
        limitByCategory: new Map([
          [STREAMING.id, '40.00'],
          [PRACA.id, '30.00'],
          [MUZYKA.id, null],
        ]),
      },
    );

    expect(totals.monthlyLimit).toBe('100.00');
    expect(totals.budgetAlert).toBe(BudgetAlert.NEAR);
    expect(
      totals.categories.map(
        ({ category: { name }, monthlyLimit, budgetAlert }) => ({
          name,
          monthlyLimit,
          budgetAlert,
        }),
      ),
    ).toEqual([
      {
        name: 'Streaming',
        monthlyLimit: '40.00',
        budgetAlert: BudgetAlert.EXCEEDED,
      },
      {
        name: 'Praca',
        monthlyLimit: '30.00',
        budgetAlert: BudgetAlert.REACHED,
      },
      { name: 'Muzyka', monthlyLimit: null, budgetAlert: BudgetAlert.NONE },
    ]);
  });

  it('leaves out a category with a limit but no counted subscriptions', () => {
    const totals = costTotals([], {
      ...NO_SETTINGS,
      monthlyLimit: '0.00',
      limitByCategory: new Map([[PRACA.id, '0.00']]),
    });

    // Nothing spent under a limit of 0 is no alert.
    expect(totals).toEqual({
      monthly: '0.00',
      yearly: '0.00',
      monthlyLimit: '0.00',
      budgetAlert: BudgetAlert.NONE,
      categories: [],
    });
  });
});
