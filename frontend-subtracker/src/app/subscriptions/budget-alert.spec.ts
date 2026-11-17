import {
  budgetAlertLevel,
  budgetBarFill,
  budgetUsagePercent,
  categoryAlertLevel,
  mostSevereAlertLevel,
} from './budget-alert';
import {
  budgetAlertNote,
  budgetAlertsSummary,
  budgetUsageText,
  categoryAlertsSummary,
  categoryLimitNote,
} from './subscription-labels';
import type { BudgetAlert, CategoryCostTotal, DuplicateWarning } from './subscription.types';

function category(
  duplicateWarning: DuplicateWarning,
  budgetAlert: BudgetAlert,
  monthly = '10.00',
  monthlyLimit: string | null = null,
): CategoryCostTotal {
  return {
    category: {
      id: `category-${duplicateWarning}-${budgetAlert}`,
      name: 'Streaming',
      isDefault: true,
    },
    monthly,
    yearly: '120.00',
    subscriptionCount: 1,
    duplicateThreshold: 2,
    duplicateWarning,
    monthlyLimit,
    budgetAlert,
  };
}

// The oracle is the plan of S-08 (phase 2): close to a limit is orange like a reached duplicate
// threshold, at or above it red like an exceeded one.
describe('budgetAlertLevel', () => {
  it.each([
    ['none', 'none'],
    ['near', 'reached'],
    ['reached', 'exceeded'],
    ['exceeded', 'exceeded'],
  ] as const)('shows %j at the icon level %j', (alert, expected) => {
    expect(budgetAlertLevel(alert)).toBe(expected);
  });
});

// The oracle is the plan of S-08 (phase 2): a category takes the worse of its two states, ordered
// red > orange > none.
describe('categoryAlertLevel', () => {
  it.each([
    ['none', 'none', 'none'],
    ['reached', 'none', 'reached'],
    ['none', 'near', 'reached'],
    ['reached', 'near', 'reached'],
    ['reached', 'reached', 'exceeded'],
    ['exceeded', 'near', 'exceeded'],
    ['none', 'exceeded', 'exceeded'],
  ] as const)('takes duplicates %j and limit %j as %j', (duplicate, budget, expected) => {
    expect(categoryAlertLevel(category(duplicate, budget))).toBe(expected);
  });
});

// The oracle is the plan of S-07 (exceeded > reached > none) extended by S-08 to both kinds.
describe('mostSevereAlertLevel', () => {
  it.each([
    [[], 'none'],
    [[['none', 'none']], 'none'],
    [
      [
        ['none', 'none'],
        ['reached', 'none'],
      ],
      'reached',
    ],
    [
      [
        ['reached', 'none'],
        ['exceeded', 'none'],
        ['none', 'none'],
      ],
      'exceeded',
    ],
    [
      [
        ['none', 'near'],
        ['none', 'none'],
      ],
      'reached',
    ],
    [
      [
        ['reached', 'none'],
        ['none', 'reached'],
      ],
      'exceeded',
    ],
    [
      [
        ['none', 'exceeded'],
        ['reached', 'near'],
      ],
      'exceeded',
    ],
  ] as const)('picks %j as %j', (states, expected) => {
    expect(
      mostSevereAlertLevel(states.map(([duplicate, budget]) => category(duplicate, budget))),
    ).toBe(expected);
  });
});

// The oracle is the plan of S-08: the share in whole percent rounded down, worked out by hand.
describe('budgetUsagePercent', () => {
  it.each([
    // 17000 × 100 / 20000 = 85
    ['170.00', '200.00', 85],
    // 7999 × 100 / 10000 = 79.99 → 79
    ['79.99', '100.00', 79],
    // 19999 × 100 / 20000 = 99.995 → 99, never 100 below the limit
    ['199.99', '200.00', 99],
    ['100.00', '100.00', 100],
    // 10001 × 100 / 10000 = 100.01 → 100
    ['100.01', '100.00', 100],
    ['250.00', '200.00', 125],
    ['0.00', '100.00', 0],
    // no share of a limit of 0
    ['5.00', '0.00', null],
    ['0.00', '0.00', null],
  ])('gives %j of %j as %j%', (spent, limit, expected) => {
    expect(budgetUsagePercent(spent, limit)).toBe(expected);
  });
});

describe('budgetBarFill', () => {
  it.each([
    ['170.00', '200.00', 85],
    ['199.99', '200.00', 99],
    ['100.00', '100.00', 100],
    // over the limit the bar stays full
    ['250.00', '200.00', 100],
    ['0.00', '100.00', 0],
    // a limit of 0: full from the first grosz (exceeded), empty with nothing spent
    ['0.01', '0.00', 100],
    ['0.00', '0.00', 0],
  ])('fills the bar of %j against %j to %j%', (spent, limit, expected) => {
    expect(budgetBarFill(spent, limit)).toBe(expected);
  });
});

// The oracle is the plan of S-08 and the Polish number format (no-break space between thousands
// and before "zł").
describe('budgetUsageText', () => {
  it.each([
    ['170.00', '200.00', '170,00 z 200,00 zł (85%)'],
    ['199.99', '200.00', '199,99 z 200,00 zł (99%)'],
    ['1233.87', '2000.00', '1 233,87 z 2 000,00 zł (61%)'],
    ['250.00', '200.00', '250,00 z 200,00 zł (125%)'],
    ['5.00', '0.00', '5,00 z 0,00 zł'],
  ])('says %j of %j as %j', (spent, limit, expected) => {
    expect(budgetUsageText(spent, limit, 'pl-PL')).toBe(expected);
  });
});

describe('categoryLimitNote', () => {
  it('says the monthly sum against the limit', () => {
    expect(categoryLimitNote(category('none', 'exceeded', '90.00', '80.00'), 'pl-PL')).toBe(
      'Limit: 90,00 z 80,00 zł',
    );
  });

  it('says nothing without a limit', () => {
    expect(categoryLimitNote(category('none', 'none'), 'pl-PL')).toBeNull();
  });
});

describe('budgetAlertNote', () => {
  it.each([
    ['none', null],
    ['near', 'Zbliżasz się do limitu'],
    ['reached', 'Wykorzystano limit'],
    ['exceeded', 'Przekroczono limit'],
  ] as const)('describes %j as %j', (alert, expected) => {
    expect(budgetAlertNote(alert)).toBe(expected);
  });
});

// The oracle is the plan of S-08 and the Polish plural forms of "kategoria".
describe('budgetAlertsSummary', () => {
  it.each([
    [[], null],
    [['none'], null],
    [['exceeded'], '1 kategoria przekroczyła limit'],
    [['reached', 'reached'], '2 kategorie wykorzystały limit'],
    [Array(5).fill('near'), '5 kategorii zbliża się do limitu'],
    [
      ['near', 'exceeded', 'none', 'near', 'reached'],
      '1 kategoria przekroczyła limit, 1 kategoria wykorzystała limit, 2 kategorie zbliżają się do limitu',
    ],
  ] as const)('says %j as %j', (alerts, expected) => {
    expect(budgetAlertsSummary(alerts.map((alert: BudgetAlert) => category('none', alert)))).toBe(
      expected,
    );
  });
});

describe('categoryAlertsSummary', () => {
  it.each([
    [[['none', 'none']], null],
    [[['exceeded', 'none']], '1 kategoria przekroczyła próg'],
    [[['none', 'near']], '1 kategoria zbliża się do limitu'],
    // Two categories, one of each kind: duplicates first, then limits.
    [
      [
        ['none', 'near'],
        ['exceeded', 'none'],
      ],
      '1 kategoria przekroczyła próg, 1 kategoria zbliża się do limitu',
    ],
    // One category with both alerts counts once for each kind.
    [[['reached', 'exceeded']], '1 kategoria osiągnęła próg, 1 kategoria przekroczyła limit'],
  ] as const)('says %j as %j', (states, expected) => {
    expect(
      categoryAlertsSummary(states.map(([duplicate, budget]) => category(duplicate, budget))),
    ).toBe(expected);
  });
});
