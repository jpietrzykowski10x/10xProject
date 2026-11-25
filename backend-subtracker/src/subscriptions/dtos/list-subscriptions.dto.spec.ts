// @Type() reads design-time metadata; in the app Nest loads this polyfill.
import 'reflect-metadata';
import { instanceToPlain, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListSubscriptionsDto } from './list-subscriptions.dto.js';

const CATEGORY_ID = '8312d1ba-9f14-4fe2-b611-ebd2538c2721';

// Query values as the request carries them (strings), with the options of the global
// ValidationPipe (app.module.ts).
async function parse(query: Record<string, string>) {
  const dto = plainToInstance(ListSubscriptionsDto, query);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, failed: errors.map((error) => error.property) };
}

describe('ListSubscriptionsDto', () => {
  it('defaults to the status order, the first page and 25 rows without filters', async () => {
    const { dto, failed } = await parse({});

    expect(failed).toEqual([]);
    expect(instanceToPlain(dto)).toEqual({
      sort: 'status_then_date',
      page: 1,
      pageSize: 25,
    });
  });

  it('reads every parameter and turns the numbers into numbers', async () => {
    const { dto, failed } = await parse({
      sort: 'amount_desc',
      category: CATEGORY_ID,
      status: 'trial',
      page: '3',
      pageSize: '100',
    });

    expect(failed).toEqual([]);
    expect(instanceToPlain(dto)).toEqual({
      sort: 'amount_desc',
      category: CATEGORY_ID,
      status: 'trial',
      page: 3,
      pageSize: 100,
    });
  });

  it.each([
    ['an unknown sort', { sort: 'x' }, 'sort'],
    ['a category that is not a UUID', { category: 'nie-uuid' }, 'category'],
    ['an unknown status', { status: 'x' }, 'status'],
    ['page 0', { page: '0' }, 'page'],
    ['a page that is not a whole number', { page: '1.5' }, 'page'],
    ['a page that is not a number', { page: 'abc' }, 'page'],
    ['a page size of 0', { pageSize: '0' }, 'pageSize'],
    ['a page size above 100', { pageSize: '101' }, 'pageSize'],
    ['an unknown parameter', { q: 'netflix' }, 'q'],
  ])('refuses %s', async (_case, query, property) => {
    expect((await parse(query)).failed).toEqual([property]);
  });
});
