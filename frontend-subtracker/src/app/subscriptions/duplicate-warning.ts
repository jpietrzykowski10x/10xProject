// S-07: the duplicate warnings of the cost totals. The API decides the warning of each category
// (backend duplicate-warning.ts); the front only counts them. The most severe state of the
// categories, duplicates and limits together (S-08), is mostSevereAlertLevel in budget-alert.ts.
import type { CategoryCostTotal, DuplicateWarning } from './subscription.types';

// How many categories have the warning.
export function countDuplicateWarnings(
  categories: readonly CategoryCostTotal[],
  warning: DuplicateWarning,
): number {
  return categories.filter((item) => item.duplicateWarning === warning).length;
}
