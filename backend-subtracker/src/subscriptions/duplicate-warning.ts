// The threshold of active subscriptions per category (S-07): a category without a stored setting
// has the user's default threshold, and a user without stored settings has this one. Active means
// COUNTED_STATUSES (cost-totals.ts).
export const DEFAULT_DUPLICATE_THRESHOLD = 3;
export const DUPLICATE_THRESHOLD_MIN = 0;
export const DUPLICATE_THRESHOLD_MAX = 99;

// A user's thresholds: their default, and the categories with a settings row. A row's threshold is
// null when the row was saved only for a limit (S-08), so the category follows the default.
export interface DuplicateThresholds {
  defaultThreshold: number;
  byCategory: ReadonlyMap<string, number | null>;
}

// The category's stored threshold, else the user's current default (no row, or a null threshold).
export function thresholdOf(
  thresholds: DuplicateThresholds,
  categoryId: string,
): number {
  return thresholds.byCategory.get(categoryId) ?? thresholds.defaultThreshold;
}

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
