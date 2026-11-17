import { mostSevereDuplicateWarning } from './duplicate-warning';
import { duplicateWarningNote, duplicateWarningsSummary } from './subscription-labels';
import type { CategoryCostTotal, DuplicateWarning } from './subscription.types';

function category(
  duplicateWarning: DuplicateWarning,
  subscriptionCount = 1,
  duplicateThreshold = 2,
): CategoryCostTotal {
  return {
    category: { id: `category-${duplicateWarning}`, name: 'Streaming', isDefault: true },
    monthly: '10.00',
    yearly: '120.00',
    subscriptionCount,
    duplicateThreshold,
    duplicateWarning,
  };
}

// The oracle is the plan of S-07 (phase 2): exceeded > reached > none.
describe('mostSevereDuplicateWarning', () => {
  it.each([
    [[], 'none'],
    [['none', 'none'], 'none'],
    [['none', 'reached'], 'reached'],
    [['reached', 'exceeded', 'none'], 'exceeded'],
    [['exceeded', 'reached'], 'exceeded'],
  ] as const)('picks %j as %j', (warnings, expected) => {
    expect(mostSevereDuplicateWarning(warnings.map((warning) => category(warning)))).toBe(expected);
  });
});

// The oracle is the plan of S-07 (phase 2) and the Polish plural forms of "kategoria".
describe('duplicateWarningNote', () => {
  it.each([
    [category('none', 1, 2), null],
    [category('reached', 2, 2), 'Osiągnięto próg: 2 z 2'],
    [category('exceeded', 3, 2), 'Przekroczono próg: 3 z 2'],
    [category('exceeded', 1, 0), 'Przekroczono próg: 1 z 0'],
  ])('describes %j as %j', (item, expected) => {
    expect(duplicateWarningNote(item)).toBe(expected);
  });
});

describe('duplicateWarningsSummary', () => {
  it.each([
    [[], null],
    [['none'], null],
    [['exceeded'], '1 kategoria przekroczyła próg'],
    [['reached', 'reached'], '2 kategorie osiągnęły próg'],
    [['exceeded', 'reached', 'none'], '1 kategoria przekroczyła próg, 1 kategoria osiągnęła próg'],
    [Array(5).fill('exceeded'), '5 kategorii przekroczyło próg'],
  ] as const)('says %j as %j', (warnings, expected) => {
    expect(
      duplicateWarningsSummary(warnings.map((warning: DuplicateWarning) => category(warning))),
    ).toBe(expected);
  });
});
