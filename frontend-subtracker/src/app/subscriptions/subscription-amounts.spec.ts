import { monthlyAmount } from './subscription-amounts';

// The oracle is the rounding rule from test-plan.md §2 (risk #4): a yearly amount in grosze is
// divided by 12 and rounded to the grosz per subscription, a half grosz up. Every expected value
// below was worked out by hand; the arithmetic is in the comment next to it.
describe('monthlyAmount', () => {
  it.each([
    // 12000 gr / 12 = 1000 gr
    ['120.00', '10.00'],
    // 123387 gr / 12 = 10282.25 → 10282 gr
    ['1233.87', '102.82'],
    // 1206 gr / 12 = 100.5 → 101 gr (a half grosz goes up)
    ['12.06', '1.01'],
    // 1205 gr / 12 = 100.4166… → 100 gr
    ['12.05', '1.00'],
    // 1207 gr / 12 = 100.5833… → 101 gr
    ['12.07', '1.01'],
    // 6 gr / 12 = 0.5 → 1 gr (a half grosz goes up)
    ['0.06', '0.01'],
    // 5 gr / 12 = 0.4166… → 0 gr
    ['0.05', '0.00'],
    // 0 gr / 12 = 0 gr
    ['0.00', '0.00'],
    // 9999999 gr / 12 = 833333.25 → 833333 gr
    ['99999.99', '8333.33'],
    // 59988 gr / 12 = 4999 gr
    ['599.88', '49.99'],
    // 18 gr / 12 = 1.5 → 2 gr (a half grosz goes up)
    ['0.18', '0.02'],
  ])('divides a yearly %j into %j a month', (amount, expected) => {
    expect(monthlyAmount(amount, 'yearly')).toBe(expected);
  });

  it.each(['12.99', '0.00', '99999.99'])('keeps a monthly %j unchanged', (amount) => {
    expect(monthlyAmount(amount, 'monthly')).toBe(amount);
  });

  // The API always sends two decimals; anything else is shown as it came.
  it.each(['12.9', '12', 'abc', ''])('returns %j outside the API format unchanged', (amount) => {
    expect(monthlyAmount(amount, 'yearly')).toBe(amount);
  });
});
