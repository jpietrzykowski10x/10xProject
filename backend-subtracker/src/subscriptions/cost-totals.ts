import { fromGrosze, toGrosze } from '../shared/money/grosze.js';
import {
  type DuplicateThresholds,
  duplicateWarning,
  thresholdOf,
} from './duplicate-warning.js';
import {
  BillingCycle,
  type CategoryCostTotal,
  type CategoryResponse,
  type CostTotalsResponse,
  SubscriptionStatus,
} from './subscription.types.js';

// The statuses that count towards the cost totals: everything still paid for. This list is also
// what "active subscriptions" means for duplicate warnings (S-07) and budget limits (S-08). It
// names the statuses it includes rather than excluding `cancelled`, so a new status stays out of
// the sums until someone adds it here on purpose.
export const COUNTED_STATUSES: readonly SubscriptionStatus[] = [
  SubscriptionStatus.TRIAL,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.CANCELLED_PENDING,
];

// The price per month: a yearly amount divided by 12 and rounded to the grosz per subscription,
// a half grosz up (test-plan.md §2, the same rule as the frontend's monthlyAmount).
export function monthlyGrosze(grosze: number, cycle: BillingCycle): number {
  return cycle === BillingCycle.YEARLY ? Math.round(grosze / 12) : grosze;
}

// The real spend per year: a monthly amount times 12, a yearly amount unchanged.
export function yearlyGrosze(grosze: number, cycle: BillingCycle): number {
  return cycle === BillingCycle.MONTHLY ? grosze * 12 : grosze;
}

export interface CostTotalsRow {
  amount: string;
  billingCycle: BillingCycle;
  category: CategoryResponse;
}

interface CategorySum {
  category: CategoryResponse;
  monthly: number;
  yearly: number;
  subscriptionCount: number;
}

// The cost totals of rows already filtered to COUNTED_STATUSES. Everything is summed in whole
// grosze; the monthly total is the sum of the per-subscription rounded amounts, never the yearly
// sum divided by 12. Categories go from the highest monthly cost down, a tie by the name in
// Polish order, then by id, so the order never depends on the input order. `thresholds` are the
// user's duplicate thresholds; a category without a stored one has the user's default.
export function costTotals(
  rows: readonly CostTotalsRow[],
  thresholds: DuplicateThresholds,
): CostTotalsResponse {
  const sums = new Map<string, CategorySum>();
  for (const row of rows) {
    const grosze = toGrosze(row.amount);
    const sum = sums.get(row.category.id) ?? {
      category: row.category,
      monthly: 0,
      yearly: 0,
      subscriptionCount: 0,
    };
    sum.monthly += monthlyGrosze(grosze, row.billingCycle);
    sum.yearly += yearlyGrosze(grosze, row.billingCycle);
    sum.subscriptionCount += 1;
    sums.set(row.category.id, sum);
  }

  const ordered = [...sums.values()].sort(
    (a, b) =>
      b.monthly - a.monthly ||
      a.category.name.localeCompare(b.category.name, 'pl') ||
      a.category.id.localeCompare(b.category.id),
  );
  const categories: CategoryCostTotal[] = ordered.map((sum) => {
    const duplicateThreshold = thresholdOf(thresholds, sum.category.id);
    return {
      category: sum.category,
      monthly: fromGrosze(sum.monthly),
      yearly: fromGrosze(sum.yearly),
      subscriptionCount: sum.subscriptionCount,
      duplicateThreshold,
      duplicateWarning: duplicateWarning(
        sum.subscriptionCount,
        duplicateThreshold,
      ),
    };
  });
  return {
    monthly: fromGrosze(ordered.reduce((total, sum) => total + sum.monthly, 0)),
    yearly: fromGrosze(ordered.reduce((total, sum) => total + sum.yearly, 0)),
    categories,
  };
}
