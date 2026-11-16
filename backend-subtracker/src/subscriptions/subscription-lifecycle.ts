import { SubscriptionStatus } from './subscription.types.js';

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
