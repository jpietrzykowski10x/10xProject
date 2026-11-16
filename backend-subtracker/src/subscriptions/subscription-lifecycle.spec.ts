import {
  CANCELLABLE_STATUSES,
  CANCELLED_STATUS,
  RESUMABLE_STATUSES,
  RESUMED_STATUS,
  rolledBillingDate,
} from './subscription-lifecycle.js';
import { BillingCycle, SubscriptionStatus } from './subscription.types.js';

describe('subscription lifecycle — user actions', () => {
  it('cancels a trial or an active subscription into cancelled_pending', () => {
    expect(CANCELLABLE_STATUSES).toEqual([
      SubscriptionStatus.TRIAL,
      SubscriptionStatus.ACTIVE,
    ]);
    expect(CANCELLED_STATUS).toBe(SubscriptionStatus.CANCELLED_PENDING);
  });

  it('resumes only a pending cancellation, back to active', () => {
    expect(RESUMABLE_STATUSES).toEqual([SubscriptionStatus.CANCELLED_PENDING]);
    expect(RESUMED_STATUS).toBe(SubscriptionStatus.ACTIVE);
  });
});

describe('rolledBillingDate', () => {
  // Oracle: the plan's examples (today = 2026-11-20) and the calendar; the result is the first
  // date of the series stored date + k cycles (k ≥ 1) that is today or later.
  it.each([
    // a date already passed by a day: one cycle
    ['2026-11-19', BillingCycle.MONTHLY, '2026-11-20', '2026-12-19'],
    // today or later: no change
    ['2026-11-20', BillingCycle.MONTHLY, '2026-11-20', '2026-11-20'],
    ['2026-12-01', BillingCycle.YEARLY, '2026-11-20', '2026-12-01'],
    // many missed cycles, counted from the stored day: 31.01 + 10 months, clamped once
    ['2026-01-31', BillingCycle.MONTHLY, '2026-11-20', '2026-11-30'],
    // the last missed cycle lands exactly on today
    ['2026-01-20', BillingCycle.MONTHLY, '2026-11-20', '2026-11-20'],
    // same month as today, but earlier day: the next month
    ['2026-10-25', BillingCycle.MONTHLY, '2026-11-20', '2026-11-25'],
    ['2026-11-05', BillingCycle.MONTHLY, '2026-11-20', '2026-12-05'],
    // yearly, three cycles: 2025-03-10 and 2026-03-10 are still in the past
    ['2024-03-10', BillingCycle.YEARLY, '2026-11-20', '2027-03-10'],
    // one yearly cycle ends a day before today: two cycles
    ['2025-11-19', BillingCycle.YEARLY, '2026-11-20', '2027-11-19'],
    // a leap day a year later
    ['2028-02-29', BillingCycle.YEARLY, '2028-03-01', '2029-02-28'],
    // across the year end
    ['2026-12-31', BillingCycle.MONTHLY, '2027-01-02', '2027-01-31'],
    ['2026-12-31', BillingCycle.MONTHLY, '2027-02-01', '2027-02-28'],
  ])(
    'moves %s (%s) with today %s to %s',
    (nextBillingDate, cycle, today, expected) => {
      expect(rolledBillingDate(nextBillingDate, cycle, today)).toBe(expected);
    },
  );
});
