// @Type() reads design-time metadata; in the app Nest loads this polyfill.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateBudgetDto } from './update-budget.dto.js';

const FIRST_ID = '8312d1ba-9f14-4fe2-b611-ebd2538c2721';
const SECOND_ID = '2f6b7c1e-4d3a-4b8e-9c2f-0a1b2c3d4e5f';

// The same options as the global ValidationPipe (app.module.ts), without implicit conversion.
async function failedProperties(body: unknown): Promise<string[]> {
  const dto = plainToInstance(UpdateBudgetDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

const threshold = (duplicateThreshold: unknown, categoryId = FIRST_ID) => ({
  categories: [{ categoryId, duplicateThreshold }],
});

describe('UpdateBudgetDto', () => {
  it.each([0, 2, 99])('accepts a threshold of %j', async (value) => {
    expect(await failedProperties(threshold(value))).toEqual([]);
  });

  it.each([
    ['below 0', -1],
    ['above 99', 100],
    ['not a whole number', 1.5],
    ['a string', '2'],
    ['missing', undefined],
    ['null', null],
  ])('refuses a threshold %s', async (_case, value) => {
    expect(await failedProperties(threshold(value))).toEqual(['categories']);
  });

  it('accepts several distinct categories', async () => {
    expect(
      await failedProperties({
        categories: [
          { categoryId: FIRST_ID, duplicateThreshold: 0 },
          { categoryId: SECOND_ID, duplicateThreshold: 99 },
        ],
      }),
    ).toEqual([]);
  });

  it('refuses the same category twice', async () => {
    expect(
      await failedProperties({
        categories: [
          { categoryId: FIRST_ID, duplicateThreshold: 1 },
          { categoryId: FIRST_ID, duplicateThreshold: 3 },
        ],
      }),
    ).toEqual(['categories']);
  });

  it.each([
    // without a default either, so the body names nothing to change
    ['missing', undefined],
    ['null', null],
    ['not a list', { categoryId: FIRST_ID, duplicateThreshold: 2 }],
    [
      'longer than 200',
      Array.from({ length: 201 }, (_, index) => ({
        categoryId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        duplicateThreshold: 2,
      })),
    ],
  ])('refuses a categories list that is %s', async (_case, categories) => {
    expect(await failedProperties({ categories })).toEqual(['categories']);
  });

  // The oracle is the S-07 plan, phase 3 item 6: both fields are optional, at least one is required,
  // and the default has the same 0–99 range as a category threshold.
  it('refuses an empty body', async () => {
    expect(await failedProperties({})).toEqual(['categories']);
  });

  it.each([0, 3, 99])(
    'accepts only a default threshold of %j',
    async (value) => {
      expect(
        await failedProperties({ defaultDuplicateThreshold: value }),
      ).toEqual([]);
    },
  );

  it.each([
    ['below 0', -1],
    ['above 99', 100],
    ['not a whole number', 1.5],
    ['a string', '3'],
    ['null', null],
  ])('refuses a default threshold %s', async (_case, value) => {
    expect(
      await failedProperties({ defaultDuplicateThreshold: value }),
    ).toEqual(['defaultDuplicateThreshold']);
  });

  it('accepts a default threshold together with categories', async () => {
    expect(
      await failedProperties({ defaultDuplicateThreshold: 4, ...threshold(1) }),
    ).toEqual([]);
  });

  it('accepts an empty categories list, as the field is present', async () => {
    expect(await failedProperties({ categories: [] })).toEqual([]);
    expect(
      await failedProperties({ defaultDuplicateThreshold: 4, categories: [] }),
    ).toEqual([]);
  });

  it('refuses a categories list that is not a list next to a valid default', async () => {
    expect(
      await failedProperties({
        defaultDuplicateThreshold: 4,
        categories: null,
      }),
    ).toEqual(['categories']);
  });

  it('accepts 200 categories', async () => {
    const categories = Array.from({ length: 200 }, (_, index) => ({
      categoryId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      duplicateThreshold: 2,
    }));
    expect(await failedProperties({ categories })).toEqual([]);
  });

  it('refuses a categoryId that is not a UUID', async () => {
    expect(await failedProperties(threshold(2, 'inne'))).toEqual([
      'categories',
    ]);
  });

  it('refuses a userId in the body and in a category', async () => {
    expect(
      await failedProperties({ ...threshold(2), userId: FIRST_ID }),
    ).toEqual(['userId']);
    expect(
      await failedProperties({
        categories: [
          { categoryId: FIRST_ID, duplicateThreshold: 2, userId: SECOND_ID },
        ],
      }),
    ).toEqual(['categories']);
  });
});
