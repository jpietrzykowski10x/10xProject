import type { QueryRunner } from 'typeorm';
import { SINGLE_SUPER_ADMIN_INDEX_SQL } from '../../users/entities/user-role.entity.js';
import { AdminRolesAndAudit1795264062710 } from './1795264062710-AdminRolesAndAudit.js';

// The migration spells the unique index out literally, RolesSeeder runs the constant on the dev
// database; this keeps the two rules from drifting apart.
describe('AdminRolesAndAudit migration', () => {
  it('creates the unique index with exactly SINGLE_SUPER_ADMIN_INDEX_SQL', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: vi.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve();
      }),
    };

    await new AdminRolesAndAudit1795264062710().up(
      queryRunner as unknown as QueryRunner,
    );

    expect(
      queries.filter((sql) => sql.startsWith('CREATE UNIQUE INDEX')),
    ).toEqual([SINGLE_SUPER_ADMIN_INDEX_SQL]);
  });
});
