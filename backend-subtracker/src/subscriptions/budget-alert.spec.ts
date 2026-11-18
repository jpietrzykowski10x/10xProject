import {
  BUDGET_ALERT_NEAR_PERCENT,
  BudgetAlert,
  budgetAlert,
} from './budget-alert.js';

// The oracle is the S-08 plan ("Critical Implementation Details"): below 80% of the limit no alert,
// from 80% near, exactly the limit reached, above it exceeded; nothing spent or no limit never
// alerts. Amounts are in grosze.
describe('budgetAlert', () => {
  it.each([
    // no limit
    [0, null, BudgetAlert.NONE],
    [5000, null, BudgetAlert.NONE],
    // a limit of 0: nothing spent stays quiet, the first grosz is over it
    [0, 0, BudgetAlert.NONE],
    [1, 0, BudgetAlert.EXCEEDED],
    // a limit of 100.00 zł: 79.99 zł is below 80%
    [7999, 10000, BudgetAlert.NONE],
    // exactly 80%
    [8000, 10000, BudgetAlert.NEAR],
    // one grosz below the limit
    [9999, 10000, BudgetAlert.NEAR],
    // exactly the limit
    [10000, 10000, BudgetAlert.REACHED],
    // one grosz over the limit
    [10001, 10000, BudgetAlert.EXCEEDED],
    // nothing spent under a limit
    [0, 10000, BudgetAlert.NONE],
  ])(
    'gives %i gr spent against a limit of %j gr %j',
    (spent, limit, expected) => {
      expect(budgetAlert(spent, limit)).toBe(expected);
    },
  );

  it('warns from 80%', () => {
    expect(BUDGET_ALERT_NEAR_PERCENT).toBe(80);
  });
});
