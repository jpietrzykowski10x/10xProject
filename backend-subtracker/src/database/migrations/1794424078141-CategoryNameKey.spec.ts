import type { QueryRunner } from 'typeorm';
import { CATEGORY_OWNER_NAME_INDEX_SQL } from '../../subscriptions/entities/category.entity.js';
import { CategoryNameKey1794424078141 } from './1794424078141-CategoryNameKey.js';

// The migration spells the unique index out literally, CategoriesSeeder runs the constant on the
// dev database; this keeps the two rules from drifting apart.
describe('CategoryNameKey migration', () => {
  it('creates the unique index with exactly CATEGORY_OWNER_NAME_INDEX_SQL', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: vi.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve();
      }),
    };

    await new CategoryNameKey1794424078141().up(
      queryRunner as unknown as QueryRunner,
    );

    expect(
      queries.filter((sql) => sql.startsWith('CREATE UNIQUE INDEX')),
    ).toEqual([CATEGORY_OWNER_NAME_INDEX_SQL]);
  });
});
