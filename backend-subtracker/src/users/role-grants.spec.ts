import { type DataSource, QueryFailedError } from 'typeorm';
import { AdminAction } from '../admin/admin-audit.types.js';
import { AdminAudit } from '../admin/entities/admin-audit.entity.js';
import { RoleCode } from '../shared/types/role-code.js';
import { Role } from './entities/role.entity.js';
import {
  SINGLE_SUPER_ADMIN_INDEX,
  UserRole,
} from './entities/user-role.entity.js';
import { User } from './entities/user.entity.js';
import {
  grantRole,
  revokeRole,
  SUPER_ADMIN_EXISTS_MESSAGE,
} from './role-grants.js';

const ADDRESS = 'jan@example.com';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROLE_ID = '22222222-2222-4222-8222-222222222222';

interface Options {
  roleActive?: boolean;
  // Rows the INSERT … RETURNING gives back, or the error it fails with.
  inserted?: { user_id: string }[] | Error;
  deleted?: number;
  heldByOther?: boolean;
}

function setup({
  roleActive = true,
  inserted = [{ user_id: USER_ID }],
  deleted = 1,
  heldByOther = false,
}: Options = {}) {
  // Every step in order, including the end of the transaction.
  const steps: string[] = [];
  const audit = {
    insert: vi.fn((_row: Partial<AdminAudit>) => {
      steps.push('audit row');
      return Promise.resolve({ identifiers: [{ id: 'audit-1' }] });
    }),
  };
  const repositories = new Map<unknown, unknown>([
    [
      User,
      {
        findOneBy: () =>
          Promise.resolve({ id: USER_ID, email: ADDRESS } as User),
      },
    ],
    [
      Role,
      {
        findOneBy: ({ code }: { code: RoleCode }) =>
          Promise.resolve({ id: ROLE_ID, code, isActive: roleActive } as Role),
      },
    ],
    [
      UserRole,
      {
        existsBy: () => Promise.resolve(heldByOther),
        delete: vi.fn((_where: object) => {
          steps.push('delete role row');
          return Promise.resolve({ affected: deleted, raw: [] });
        }),
      },
    ],
    [AdminAudit, audit],
  ]);
  const manager = {
    getRepository: (entity: unknown) => repositories.get(entity),
    query: vi.fn((_sql: string, _params: unknown[]) => {
      steps.push('insert role row');
      return inserted instanceof Error
        ? Promise.reject(inserted)
        : Promise.resolve(inserted);
    }),
  };
  const dataSource = {
    transaction: async <T>(work: (m: typeof manager) => Promise<T>) => {
      try {
        const result = await work(manager);
        steps.push('commit');
        return result;
      } catch (error) {
        steps.push('rollback');
        throw error;
      }
    },
  } as unknown as DataSource;
  return { dataSource, steps, audit, manager };
}

describe('role grants', () => {
  describe('grantRole', () => {
    it('grants the role and leaves a ROLE_GRANTED row without an actor in the same transaction', async () => {
      const { dataSource, steps, audit } = setup();

      await expect(
        grantRole(dataSource, ADDRESS, RoleCode.ADMIN),
      ).resolves.toBe('granted');

      expect(steps).toEqual(['insert role row', 'audit row', 'commit']);
      expect(audit.insert).toHaveBeenCalledWith({
        actorId: null,
        targetId: USER_ID,
        action: AdminAction.ROLE_GRANTED,
        details: { role: RoleCode.ADMIN },
      });
    });

    it('answers already_granted and writes no audit row when the account holds the role', async () => {
      const { dataSource, audit } = setup({ inserted: [] });

      await expect(
        grantRole(dataSource, ADDRESS, RoleCode.ADMIN),
      ).resolves.toBe('already_granted');

      expect(audit.insert).not.toHaveBeenCalled();
    });

    it('refuses an inactive role and changes nothing', async () => {
      const { dataSource, steps, manager, audit } = setup({
        roleActive: false,
      });

      await expect(
        grantRole(dataSource, ADDRESS, RoleCode.ADMIN),
      ).rejects.toThrow('Role ADMIN is inactive');

      expect(manager.query).not.toHaveBeenCalled();
      expect(audit.insert).not.toHaveBeenCalled();
      expect(steps).toEqual(['rollback']);
    });

    it('refuses a second superadmin before inserting', async () => {
      const { dataSource, manager } = setup({ heldByOther: true });

      await expect(
        grantRole(dataSource, ADDRESS, RoleCode.SUPER_ADMIN),
      ).rejects.toThrow(SUPER_ADMIN_EXISTS_MESSAGE);

      expect(manager.query).not.toHaveBeenCalled();
    });

    it('turns a race stopped by the superadmin index into the same message, with the cause', async () => {
      const violation = new QueryFailedError('INSERT', [], {
        code: '23505',
        constraint: SINGLE_SUPER_ADMIN_INDEX,
      } as unknown as Error);
      const { dataSource, audit } = setup({ inserted: violation });

      const refused = await grantRole(
        dataSource,
        ADDRESS,
        RoleCode.SUPER_ADMIN,
      ).then(
        () => null,
        (error: unknown) => error,
      );

      expect(refused).toBeInstanceOf(Error);
      expect((refused as Error).message).toBe(SUPER_ADMIN_EXISTS_MESSAGE);
      expect((refused as Error).cause).toBe(violation);
      expect(audit.insert).not.toHaveBeenCalled();
    });
  });

  describe('revokeRole', () => {
    it('revokes the role and leaves a ROLE_REVOKED row in the same transaction', async () => {
      const { dataSource, steps, audit } = setup();

      await expect(
        revokeRole(dataSource, ADDRESS, RoleCode.ADMIN),
      ).resolves.toBe('revoked');

      expect(steps).toEqual(['delete role row', 'audit row', 'commit']);
      expect(audit.insert).toHaveBeenCalledWith({
        actorId: null,
        targetId: USER_ID,
        action: AdminAction.ROLE_REVOKED,
        details: { role: RoleCode.ADMIN },
      });
    });

    it('answers not_granted and writes no audit row when the account does not hold the role', async () => {
      const { dataSource, audit } = setup({ deleted: 0 });

      await expect(
        revokeRole(dataSource, ADDRESS, RoleCode.ADMIN),
      ).resolves.toBe('not_granted');

      expect(audit.insert).not.toHaveBeenCalled();
    });
  });
});
