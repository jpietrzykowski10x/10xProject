// The decorators read design-time metadata; in the app Nest loads this polyfill.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IsAmount } from './amount.js';

class Priced {
  @IsAmount(99999.99)
  amount: number;
}

async function isValid(amount: unknown): Promise<boolean> {
  return (await validate(plainToInstance(Priced, { amount }))).length === 0;
}

describe('IsAmount', () => {
  it.each([0, 0.01, 43, 12.5, 99999.99])('accepts %j', async (amount) => {
    expect(await isValid(amount)).toBe(true);
  });

  it.each([
    ['below 0', -0.01],
    ['above the maximum', 100000],
    ['with three decimals', 1.001],
    ['a string', '10'],
    ['not a number', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['null', null],
    ['missing', undefined],
  ])('refuses a value %s', async (_case, amount) => {
    expect(await isValid(amount)).toBe(false);
  });
});
