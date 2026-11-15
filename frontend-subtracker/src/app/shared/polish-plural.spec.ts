import { polishPlural } from './polish-plural';

const SUBSCRIPTION = { one: 'subskrypcja', few: 'subskrypcje', many: 'subskrypcji' };

// The oracle is Polish grammar: 1 takes the singular, a number ending in 2–4 takes "few" except
// 12–14, every other whole number (0 and 5–21 included) takes "many".
describe('polishPlural', () => {
  it.each([
    [1, 'subskrypcja'],
    [2, 'subskrypcje'],
    [4, 'subskrypcje'],
    [5, 'subskrypcji'],
    // 12–14 end in 2–4 but take "many".
    [12, 'subskrypcji'],
    [14, 'subskrypcji'],
    [22, 'subskrypcje'],
    [25, 'subskrypcji'],
    [0, 'subskrypcji'],
  ])('uses for %j the form %j', (count, expected) => {
    expect(polishPlural(count, SUBSCRIPTION)).toBe(expected);
  });
});
