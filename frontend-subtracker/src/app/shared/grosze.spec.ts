import { numberToGrosze, toAmountText, toGrosze } from './grosze';

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

// The oracle is arithmetic: a typed amount in whole grosze, float errors rounded away.
describe('numberToGrosze', () => {
  it.each([
    [0, 0],
    [0.29, 29],
    [42.5, 4250],
    [80, 8000],
    [99999.99, 9999999],
  ])('reads %j as %j grosze', (amount, expected) => {
    expect(numberToGrosze(amount)).toBe(expected);
  });
});

// The oracle is the API's amount format and the Polish decimal comma of the form fields.
describe('toAmountText', () => {
  it.each([
    ['80.00', '80,00'],
    ['0.01', '0,01'],
    ['102.82', '102,82'],
  ])('shows %j as %j', (amount, expected) => {
    expect(toAmountText(amount)).toBe(expected);
  });

  it('shows no amount as an empty field', () => {
    expect(toAmountText(null)).toBe('');
  });
});
