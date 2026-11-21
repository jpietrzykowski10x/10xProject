import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryBoolean } from './query-boolean.js';

class Sample {
  @QueryBoolean()
  flag?: boolean;
}

const parse = (query: Record<string, unknown>) =>
  plainToInstance(Sample, query);

const failedProperties = async (query: Record<string, unknown>) =>
  (await validate(parse(query))).map((error) => error.property);

describe('QueryBoolean', () => {
  it.each([
    ['true', true],
    ['false', false],
  ])('reads %s as a boolean', async (value, expected) => {
    expect(parse({ flag: value }).flag).toBe(expected);
    expect(await failedProperties({ flag: value })).toEqual([]);
  });

  it('allows the parameter to be missing', async () => {
    expect(parse({}).flag).toBeUndefined();
    expect(await failedProperties({})).toEqual([]);
  });

  it.each([
    ['another word', 'yes'],
    ['a number', '1'],
    ['an empty value', ''],
    ['a repeated parameter', ['true', 'true']],
  ])('refuses %s', async (_case, value) => {
    expect(await failedProperties({ flag: value })).toEqual(['flag']);
  });
});
