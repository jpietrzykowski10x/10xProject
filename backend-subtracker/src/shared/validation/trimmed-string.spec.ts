import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TrimmedString } from './trimmed-string.js';

const MAX_LENGTH = 5;

class Sample {
  @TrimmedString(MAX_LENGTH)
  value: string;
}

const parse = (value: unknown) => plainToInstance(Sample, { value });

const failedProperties = async (value: unknown) =>
  (await validate(parse(value))).map((error) => error.property);

describe('TrimmedString', () => {
  it('trims the value before validating it', async () => {
    expect(parse('  abc  ').value).toBe('abc');
    expect(await failedProperties('  abc  ')).toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
  ])('refuses a value that is %s', async (_case, value) => {
    expect(await failedProperties(value)).toEqual(['value']);
  });

  it('accepts exactly maxLength characters after trimming', async () => {
    expect(await failedProperties(` ${'a'.repeat(MAX_LENGTH)} `)).toEqual([]);
  });

  it('refuses maxLength + 1 characters', async () => {
    expect(await failedProperties('a'.repeat(MAX_LENGTH + 1))).toEqual([
      'value',
    ]);
  });

  it.each([42, true, null, ['abc']])(
    'refuses the non-string %s',
    async (value) => {
      expect(await failedProperties(value)).toEqual(['value']);
    },
  );
});
