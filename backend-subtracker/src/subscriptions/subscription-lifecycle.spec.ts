import {
  CANCELLABLE_STATUSES,
  CANCELLED_STATUS,
  RESUMABLE_STATUSES,
  RESUMED_STATUS,
} from './subscription-lifecycle.js';
import { SubscriptionStatus } from './subscription.types.js';

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
