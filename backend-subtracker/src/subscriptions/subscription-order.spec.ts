import { STATUS_GROUPS, subscriptionOrder } from './subscription-order.js';
import { SubscriptionSort, SubscriptionStatus } from './subscription.types.js';

const STATUS_GROUP =
  "CASE s.status WHEN 'active' THEN 0 WHEN 'trial' THEN 0 WHEN 'cancelled_pending' THEN 1 WHEN 'cancelled' THEN 2 END";
const REFERENCE_DATE =
  "CASE WHEN s.status = 'trial' THEN s.trialEndDate ELSE s.nextBillingDate END";
const NAME = 'lower(s.name) COLLATE "pl-PL-x-icu"';
const MONTHLY_AMOUNT =
  "CASE s.billingCycle WHEN 'yearly' THEN s.amount / 12 ELSE s.amount END";

// The default order and the id, which close every variant.
const DEFAULT_TERMS = [
  { expression: STATUS_GROUP, direction: 'ASC' },
  { expression: REFERENCE_DATE, direction: 'ASC' },
  { expression: NAME, direction: 'ASC' },
  { expression: 's.createdAt', direction: 'ASC' },
  { expression: 's.id', direction: 'ASC' },
];

describe('subscriptionOrder', () => {
  describe('status_then_date (the default)', () => {
    const terms = subscriptionOrder(SubscriptionSort.STATUS_THEN_DATE, 's');

    it('groups active and trial first, then ending, then ended', () => {
      expect(STATUS_GROUPS).toEqual({
        [SubscriptionStatus.ACTIVE]: 0,
        [SubscriptionStatus.TRIAL]: 0,
        [SubscriptionStatus.CANCELLED_PENDING]: 1,
        [SubscriptionStatus.CANCELLED]: 2,
      });
      expect(terms[0]).toEqual({ expression: STATUS_GROUP, direction: 'ASC' });
    });

    it('orders a group by the trial end for a trial, otherwise by the next payment', () => {
      expect(terms[1]).toEqual({
        expression: REFERENCE_DATE,
        direction: 'ASC',
      });
    });

    it('breaks ties by the name without case in Polish order, then by the creation time and the id', () => {
      expect(terms.slice(2)).toEqual([
        { expression: NAME, direction: 'ASC' },
        { expression: 's.createdAt', direction: 'ASC' },
        { expression: 's.id', direction: 'ASC' },
      ]);
    });

    it('applies the terms in this order and no others', () => {
      expect(terms).toEqual(DEFAULT_TERMS);
    });
  });

  it.each([
    [SubscriptionSort.NAME_ASC, { expression: NAME, direction: 'ASC' }],
    [SubscriptionSort.NAME_DESC, { expression: NAME, direction: 'DESC' }],
    [
      SubscriptionSort.AMOUNT_DESC,
      { expression: MONTHLY_AMOUNT, direction: 'DESC' },
    ],
    [
      SubscriptionSort.AMOUNT_ASC,
      { expression: MONTHLY_AMOUNT, direction: 'ASC' },
    ],
    [
      SubscriptionSort.DATE_ASC,
      { expression: REFERENCE_DATE, direction: 'ASC' },
    ],
    [
      SubscriptionSort.DATE_DESC,
      { expression: REFERENCE_DATE, direction: 'DESC' },
    ],
  ])(
    '%s starts with its own key, then the rest of the default order',
    (sort, key) => {
      // The default term on the same expression is left out: TypeORM would let it overwrite the
      // key's direction.
      expect(subscriptionOrder(sort, 's')).toEqual([
        key,
        ...DEFAULT_TERMS.filter((term) => term.expression !== key.expression),
      ]);
    },
  );

  it('keeps every default term after the amount, which is not one of them', () => {
    expect(
      subscriptionOrder(SubscriptionSort.AMOUNT_DESC, 's').slice(1),
    ).toEqual(DEFAULT_TERMS);
  });

  it.each(Object.values(SubscriptionSort))(
    '%s names each expression once',
    (sort) => {
      const expressions = subscriptionOrder(sort, 's').map(
        (term) => term.expression,
      );
      expect(new Set(expressions).size).toBe(expressions.length);
    },
  );

  it.each(Object.values(SubscriptionSort))(
    '%s ends with the id, so no two rows tie',
    (sort) => {
      expect(subscriptionOrder(sort, 's').at(-1)).toEqual({
        expression: 's.id',
        direction: 'ASC',
      });
    },
  );
});
