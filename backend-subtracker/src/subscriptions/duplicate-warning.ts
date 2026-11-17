// The threshold of active subscriptions per category (S-07): a category without a stored setting
// has the default. Active means COUNTED_STATUSES (cost-totals.ts).
export const DEFAULT_DUPLICATE_THRESHOLD = 2;
export const DUPLICATE_THRESHOLD_MIN = 0;
export const DUPLICATE_THRESHOLD_MAX = 99;

export enum DuplicateWarning {
  NONE = 'none',
  REACHED = 'reached',
  EXCEEDED = 'exceeded',
}

// More active subscriptions than the threshold: exceeded. Exactly the threshold: reached, but only
// from one subscription up, so a threshold of 0 warns nothing for an empty category and the first
// subscription in it is already exceeded.
export function duplicateWarning(
  count: number,
  threshold: number,
): DuplicateWarning {
  if (count > threshold) {
    return DuplicateWarning.EXCEEDED;
  }
  if (count === threshold && count >= 1) {
    return DuplicateWarning.REACHED;
  }
  return DuplicateWarning.NONE;
}
