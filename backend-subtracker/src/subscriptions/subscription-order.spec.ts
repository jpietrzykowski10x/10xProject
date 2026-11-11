import { STATUS_GROUPS, subscriptionOrder } from './subscription-order.js';
import { SubscriptionSort, SubscriptionStatus } from './subscription.types.js';

describe('subscriptionOrder', () => {
  const terms = subscriptionOrder(SubscriptionSort.STATUS_THEN_DATE, 's');

  it('groups active and trial first, then ending, then ended', () => {
    expect(STATUS_GROUPS).toEqual({
      [SubscriptionStatus.ACTIVE]: 0,
      [SubscriptionStatus.TRIAL]: 0,
      [SubscriptionStatus.CANCELLED_PENDING]: 1,
      [SubscriptionStatus.CANCELLED]: 2,
    });
    expect(terms[0]).toEqual({
      expression:
        "CASE s.status WHEN 'active' THEN 0 WHEN 'trial' THEN 0 WHEN 'cancelled_pending' THEN 1 WHEN 'cancelled' THEN 2 END",
      direction: 'ASC',
    });
  });

  it('orders a group by the trial end for a trial, otherwise by the next payment', () => {
    expect(terms[1]).toEqual({
      expression:
        "CASE WHEN s.status = 'trial' THEN s.trialEndDate ELSE s.nextBillingDate END",
      direction: 'ASC',
    });
  });

  it('breaks ties by the name without case in Polish order, then by the creation time', () => {
    expect(terms.slice(2)).toEqual([
      { expression: 'lower(s.name) COLLATE "pl-PL-x-icu"', direction: 'ASC' },
      { expression: 's.createdAt', direction: 'ASC' },
    ]);
  });

  it('applies the terms in this order and no others', () => {
    expect(terms).toHaveLength(4);
  });
});
