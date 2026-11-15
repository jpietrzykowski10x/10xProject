import { fromGrosze, toGrosze } from './grosze.js';

describe('grosze', () => {
  it.each([
    ['0.00', 0],
    ['0.05', 5],
    ['43.00', 4300],
    ['102.82', 10282],
    // AMOUNT_MAX
    ['99999.99', 9999999],
    // a sum above AMOUNT_MAX
    ['1234567.89', 123456789],
  ])('converts %j to %i grosze and back', (amount, grosze) => {
    expect(toGrosze(amount)).toBe(grosze);
    expect(fromGrosze(grosze)).toBe(amount);
  });

  it.each(['12.9', '12', 'abc', '', '-1.00', '1.234', '1,00'])(
    'refuses %j, which is not an amount with two decimals',
    (amount) => {
      expect(() => toGrosze(amount)).toThrow();
    },
  );

  it.each([-1, 1.5, Number.NaN])('refuses %d grosze', (grosze) => {
    expect(() => fromGrosze(grosze)).toThrow();
  });
});
