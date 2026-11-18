// The state of a monthly limit (S-08, FR-011), worked out on every read of the totals, so no alert
// state is stored. The share is never computed: the comparison stays on whole grosze.
export enum BudgetAlert {
  NONE = 'none',
  NEAR = 'near',
  REACHED = 'reached',
  EXCEEDED = 'exceeded',
}

// From this share of the limit on, spending is close to it.
export const BUDGET_ALERT_NEAR_PERCENT = 80;

// No limit, or nothing spent: no alert, even with a limit of 0. Over the limit: exceeded (with a
// limit of 0 the first grosz already is). Exactly the limit: reached. From 80% of it up: near.
export function budgetAlert(
  spentGrosze: number,
  limitGrosze: number | null,
): BudgetAlert {
  if (limitGrosze === null || spentGrosze === 0) {
    return BudgetAlert.NONE;
  }
  if (spentGrosze > limitGrosze) {
    return BudgetAlert.EXCEEDED;
  }
  if (spentGrosze === limitGrosze) {
    return BudgetAlert.REACHED;
  }
  if (spentGrosze * 100 >= limitGrosze * BUDGET_ALERT_NEAR_PERCENT) {
    return BudgetAlert.NEAR;
  }
  return BudgetAlert.NONE;
}
