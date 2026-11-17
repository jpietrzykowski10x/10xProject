// S-07: the duplicate warnings of the cost totals. The API decides the warning of each category
// (backend duplicate-warning.ts); the front only picks the most severe one and counts them.
import type { CategoryCostTotal, DuplicateWarning } from './subscription.types';

const SEVERITY: Record<DuplicateWarning, number> = { none: 0, reached: 1, exceeded: 2 };

// The most severe warning of the categories: exceeded > reached > none (none for no categories).
export function mostSevereDuplicateWarning(
  categories: readonly CategoryCostTotal[],
): DuplicateWarning {
  let worst: DuplicateWarning = 'none';
  for (const { duplicateWarning } of categories) {
    if (SEVERITY[duplicateWarning] > SEVERITY[worst]) {
      worst = duplicateWarning;
    }
  }
  return worst;
}

// How many categories have the warning.
export function countDuplicateWarnings(
  categories: readonly CategoryCostTotal[],
  warning: DuplicateWarning,
): number {
  return categories.filter((item) => item.duplicateWarning === warning).length;
}
