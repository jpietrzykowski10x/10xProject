import { toGrosze } from './grosze';

// The oracle is the API's amount format (backend numeric(10,2) as a string, "43.00").
describe('toGrosze', () => {
  it.each([
    ['0.00', 0],
    ['0.01', 1],
    ['43.00', 4300],
    ['102.82', 10282],
    ['99999.99', 9999999],
  ])('reads %j as %j grosze', (amount, expected) => {
    expect(toGrosze(amount)).toBe(expected);
  });

  it.each(['', '43', '43.5', '43,00', '-1.00', '1.234', ' 1.00'])('rejects %j', (amount) => {
    expect(toGrosze(amount)).toBeNull();
  });
});
