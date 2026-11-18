// S-08: the budget alerts of the cost totals. The API decides the alert of every limit (backend
// budget-alert.ts); the front maps it onto the shared warning icon, picks the most severe state of
// a category from both kinds of alert (duplicates and limit) and works out the share of a limit
// for display only.
import { toGrosze } from '../shared/grosze';
import type { BudgetAlert, CategoryCostTotal } from './subscription.types';

// The level of the shared warning icon (S-07): orange `reached`, red `exceeded`, or no icon.
export type AlertLevel = 'none' | 'reached' | 'exceeded';

// Close to a limit is orange; at the limit or above it is red.
const BUDGET_LEVEL: Record<BudgetAlert, AlertLevel> = {
  none: 'none',
  near: 'reached',
  reached: 'exceeded',
  exceeded: 'exceeded',
};

const SEVERITY: Record<AlertLevel, number> = { none: 0, reached: 1, exceeded: 2 };

function moreSevere(a: AlertLevel, b: AlertLevel): AlertLevel {
  return SEVERITY[b] > SEVERITY[a] ? b : a;
}

// The icon level of a budget alert: near → orange, reached and exceeded → red.
export function budgetAlertLevel(alert: BudgetAlert): AlertLevel {
  return BUDGET_LEVEL[alert];
}

// The most severe state of a category: its duplicate warning or its limit alert, whichever is worse.
export function categoryAlertLevel(item: CategoryCostTotal): AlertLevel {
  return moreSevere(item.duplicateWarning, budgetAlertLevel(item.budgetAlert));
}

// The most severe state of the categories, both kinds of alert together (none for no categories).
export function mostSevereAlertLevel(categories: readonly CategoryCostTotal[]): AlertLevel {
  return categories.reduce<AlertLevel>(
    (worst, item) => moreSevere(worst, categoryAlertLevel(item)),
    'none',
  );
}

// How many categories have the budget alert.
export function countBudgetAlerts(
  categories: readonly CategoryCostTotal[],
  alert: BudgetAlert,
): number {
  return categories.filter((item) => item.budgetAlert === alert).length;
}

// The share of the limit spent, in whole percent rounded down, so 99.9% never shows as 100%; null
// for a limit of 0 (no share of nothing) or an amount not in the API's format.
export function budgetUsagePercent(spent: string, limit: string): number | null {
  const spentGrosze = toGrosze(spent);
  const limitGrosze = toGrosze(limit);
  if (spentGrosze === null || limitGrosze === null || limitGrosze === 0) {
    return null;
  }
  return Math.floor((spentGrosze * 100) / limitGrosze);
}

// How full the budget bar is, 0–100: the share of the limit, capped at a full bar. With a limit of
// 0 the bar is full as soon as anything is spent (the API reports it as exceeded).
export function budgetBarFill(spent: string, limit: string): number {
  const percent = budgetUsagePercent(spent, limit);
  if (percent === null) {
    return (toGrosze(spent) ?? 0) > 0 && toGrosze(limit) === 0 ? 100 : 0;
  }
  return Math.min(percent, 100);
}
