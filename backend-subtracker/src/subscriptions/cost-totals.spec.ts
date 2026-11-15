import {
  COUNTED_STATUSES,
  costTotals,
  type CostTotalsRow,
} from './cost-totals.js';
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
    expect(costTotals([row(amount, BillingCycle.YEARLY)])).toEqual({
      monthly,
      yearly: amount,
      categories: [
        { category: PRACA, monthly, yearly: amount, subscriptionCount: 1 },
      ],
    });
  });

  it('counts a monthly amount unchanged a month and times 12 a year', () => {
    // 1299 gr × 12 = 15588 gr
    expect(costTotals([row('12.99', BillingCycle.MONTHLY)])).toMatchObject({
      monthly: '12.99',
      yearly: '155.88',
    });
  });

  it('adds up the example from the mockup', () => {
    // The cancelled 50.00 a month (Streaming) is filtered out before; these are the counted rows.
    const totals = costTotals([
      // active: 4300 gr a month, 4300 × 12 = 51600 gr a year
      row('43.00', BillingCycle.MONTHLY, STREAMING),
      // trial: 2399 gr a month, 2399 × 12 = 28788 gr a year
      row('23.99', BillingCycle.MONTHLY, MUZYKA),
      // cancelled_pending: 42999 / 12 = 3583.25 → 3583 gr a month, 42999 gr a year
      row('429.99', BillingCycle.YEARLY, PRACA),
    ]);

    expect(totals).toEqual({
      // 4300 + 2399 + 3583 = 10282 gr
      monthly: '102.82',
      // 51600 + 28788 + 42999 = 123387 gr
      yearly: '1233.87',
      categories: [
        {
          category: STREAMING,
          monthly: '43.00',
          yearly: '516.00',
          subscriptionCount: 1,
        },
        {
          category: PRACA,
          monthly: '35.83',
          yearly: '429.99',
          subscriptionCount: 1,
        },
        {
          category: MUZYKA,
          monthly: '23.99',
          yearly: '287.88',
          subscriptionCount: 1,
        },
      ],
    });
  });

  it('rounds each subscription before adding them up', () => {
    // 1206 / 12 = 100.5 → 101 gr each; 101 + 101 = 202 gr (not 2412 / 12 = 201 gr)
    expect(
      costTotals([
        row('12.06', BillingCycle.YEARLY),
        row('12.06', BillingCycle.YEARLY),
      ]),
    ).toEqual({
      monthly: '2.02',
      // 1206 + 1206 = 2412 gr
      yearly: '24.12',
      categories: [
        {
          category: PRACA,
          monthly: '2.02',
          yearly: '24.12',
          subscriptionCount: 2,
        },
      ],
    });
  });

  it('breaks a tie on the monthly cost by the name in Polish order', () => {
    const zdrowie = category('c4', 'Zdrowie');
    const lacznosc = category('c5', 'Łączność');

    const totals = costTotals([
      row('10.00', BillingCycle.MONTHLY, zdrowie),
      row('10.00', BillingCycle.MONTHLY, lacznosc),
      // 12000 / 12 = 1000 gr a month: the same tie, from a yearly amount
      row('120.00', BillingCycle.YEARLY, PRACA),
      row('10.01', BillingCycle.MONTHLY, STREAMING),
    ]);

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

    const totals = costTotals([
      row('5.00', BillingCycle.MONTHLY, second),
      row('5.00', BillingCycle.MONTHLY, first),
    ]);

    expect(totals.categories.map((total) => total.category.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('gives zero sums and no categories for no subscriptions', () => {
    expect(costTotals([])).toEqual({
      monthly: '0.00',
      yearly: '0.00',
      categories: [],
    });
  });
});
