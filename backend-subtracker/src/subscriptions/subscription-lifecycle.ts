import { addMonthsClamped } from '../shared/date/calendar-day.js';
import { BillingCycle, SubscriptionStatus } from './subscription.types.js';

// Transitions the user starts with an action (POST /subscriptions/:id/cancel and /resume). An edit
// (PUT) stays a free manual correction of the status and dates and does not go through these lists.

// Cancelling keeps the subscription counted until its billing date; a cancelled trial ends with the
// trial (the service moves trial_end_date into next_billing_date).
export const CANCELLABLE_STATUSES: readonly SubscriptionStatus[] = [
  SubscriptionStatus.TRIAL,
  SubscriptionStatus.ACTIVE,
];
export const CANCELLED_STATUS = SubscriptionStatus.CANCELLED_PENDING;

// Only a cancellation that has not completed yet can be taken back; a cancelled subscription comes
// back through an edit.
export const RESUMABLE_STATUSES: readonly SubscriptionStatus[] = [
  SubscriptionStatus.CANCELLED_PENDING,
];
export const RESUMED_STATUS = SubscriptionStatus.ACTIVE;

// Transitions of the daily lifecycle job. "Today" is the calendar day in APP_TIME_ZONE and a
// transition happens on the day after the date (date < today), in this order within one run:
// 1. a trial whose trial_end_date has passed becomes active (trial_end_date := null);
// 2. a pending cancellation whose next_billing_date has passed becomes cancelled;
// 3. an active subscription whose next_billing_date has passed gets it moved by whole cycles
//    (rolledBillingDate), so a trial activated in step 1 gets its date moved in the same run.

const CYCLE_MONTHS: Record<BillingCycle, number> = {
  [BillingCycle.MONTHLY]: 1,
  [BillingCycle.YEARLY]: 12,
};

// The billing date moved by the fewest whole cycles (at least one) that bring it to today or
// later; a date that is today or later stays. Always counted from the stored date, not cycle by
// cycle, so one move does not drift the day (2026-01-31 + 10 months = 2026-11-30, not 11-28).
// Days as YYYY-MM-DD compare correctly as text.
export function rolledBillingDate(
  nextBillingDate: string,
  cycle: BillingCycle,
  today: string,
): string {
  if (nextBillingDate >= today) {
    return nextBillingDate;
  }
  const step = CYCLE_MONTHS[cycle];
  const monthsBehind = monthIndex(today) - monthIndex(nextBillingDate);
  // Fewer cycles than this end in an earlier month than today's, so they are all too early.
  let cycles = Math.max(1, Math.floor(monthsBehind / step));
  let rolled = addMonthsClamped(nextBillingDate, cycles * step);
  while (rolled < today) {
    cycles += 1;
    rolled = addMonthsClamped(nextBillingDate, cycles * step);
  }
  return rolled;
}

function monthIndex(day: string): number {
  const [year, month] = day.split('-').map(Number);
  return year * 12 + month - 1;
}
