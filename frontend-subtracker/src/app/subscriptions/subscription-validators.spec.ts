import { FormControl } from '@angular/forms';
import { amountValidator, parseAmount } from './subscription-validators';

// The oracle is the API contract (backend create-subscription DTO): the amount is a number with at
// most two decimals, from 0 to 99 999,99. Typed the Polish way: a comma or a dot as the decimal
// separator, a plain, no-break or narrow no-break space between thousands.
const ACCEPTED: [string, number][] = [
  ['12,99', 12.99],
  ['12.99', 12.99],
  ['43,5', 43.5],
  ['0', 0],
  [' 12,99 ', 12.99],
  ['1 299,00', 1299],
  ['1\u00A0299,00', 1299],
  ['1\u202F299,00', 1299],
  ['99 999,99', 99999.99],
];

const REJECTED: string[] = [
  '',
  'abc',
  '-1',
  '1,234',
  '12,',
  ',5',
  '100 000',
  '99 999,991',
  // A dot is not a Polish thousands separator.
  '1.299,00',
  '12,99 zł',
  '1e3',
];

describe('parseAmount', () => {
  it.each(ACCEPTED)('reads %j as %d', (value, expected) => {
    expect(parseAmount(value)).toBe(expected);
  });

  it.each(REJECTED)('rejects %j', (value) => {
    expect(parseAmount(value)).toBeNull();
  });
});

describe('amountValidator', () => {
  it.each(ACCEPTED)('accepts %j', (value) => {
    expect(amountValidator(new FormControl(value, { nonNullable: true }))).toBeNull();
  });

  it.each(REJECTED)('flags %j', (value) => {
    expect(amountValidator(new FormControl(value, { nonNullable: true }))).toEqual({
      amount: true,
    });
  });
});
