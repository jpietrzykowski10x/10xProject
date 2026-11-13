import { parseDecimal } from './decimal';

// The oracle is what a person types in a Polish number field, not the regular expression inside
// parseDecimal: a comma or a dot as the decimal separator, spaces between thousands.
describe('parseDecimal', () => {
  it.each([
    ['12,99', 2, 12.99],
    ['12.99', 2, 12.99],
    ['43,5', 2, 43.5],
    ['0', 2, 0],
    [' 12,99 ', 2, 12.99],
    ['1 299,00', 2, 1299],
    ['1\u00A0299,00', 2, 1299],
    ['1\u202F299,00', 2, 1299],
    ['42', 0, 42],
    ['1,234', 3, 1.234],
    ['1.5', 3, 1.5],
  ])('reads %j with at most %i decimals as %d', (value, maxFractionDigits, expected) => {
    expect(parseDecimal(value, maxFractionDigits)).toBe(expected);
  });

  it.each([
    ['', 2],
    ['abc', 2],
    ['-1', 2],
    ['1,234', 2],
    ['12,', 2],
    [',5', 2],
    ['1.299,00', 2],
    ['12,99 zł', 2],
    ['1e3', 2],
    ['12,5', 0],
    ['1,2345', 3],
  ])('rejects %j with at most %i decimals', (value, maxFractionDigits) => {
    expect(parseDecimal(value, maxFractionDigits)).toBeNull();
  });
});
