import { type DataSource, type EntityManager, Not } from 'typeorm';
import { insertAdminAudit } from '../admin/admin-audit-insert.js';
import { AdminAction } from '../admin/admin-audit.types.js';
import { isUniqueViolation } from '../shared/database/unique-violation.js';
import { RoleCode } from '../shared/types/role-code.js';
import { Role } from './entities/role.entity.js';
import {
  SINGLE_SUPER_ADMIN_INDEX,
  UserRole,
} from './entities/user-role.entity.js';
import { User } from './entities/user.entity.js';
import { normalizeEmail } from './normalize-email.js';

// No address of the other account: the message reaches the console of whoever runs the script.
export const SUPER_ADMIN_EXISTS_MESSAGE =
  'Superadmin już istnieje: najpierw `superadmin:revoke`';

// What a role script did; `already_granted` and `not_granted` changed nothing.
export type GrantResult = 'granted' | 'already_granted';
export type RevokeResult = 'revoked' | 'not_granted';

interface Grant {
  user: User;
  role: Role;
}

// Throws on an unknown address and on a role missing from this database.
async function findGrant(
  manager: EntityManager,
  email: string,
  code: RoleCode,
): Promise<Grant> {
  const address = normalizeEmail(email);
  const user = await manager.getRepository(User).findOneBy({ email: address });
  if (user === null) {
    throw new Error(`No user with e-mail address ${address}`);
  }

  const role = await manager.getRepository(Role).findOneBy({ code });
  if (role === null) {
    throw new Error(`Role ${code} does not exist in this database`);
  }
  return { user, role };
}

// Idempotent: granting the role twice leaves a single row and answers `already_granted`. An
// inactive role is never granted. SUPER_ADMIN goes to at most one account: while another one
// holds it, this throws SUPER_ADMIN_EXISTS_MESSAGE. A grant racing past that check is stopped by
// the unique index SINGLE_SUPER_ADMIN_INDEX, with the same message. An actual grant leaves a
// ROLE_GRANTED row in admin_audit (no actor: the CLI) in the same transaction.
export async function grantRole(
  dataSource: DataSource,
  email: string,
  code: RoleCode,
): Promise<GrantResult> {
  try {
    return await dataSource.transaction(async (manager) => {
      const { user, role } = await findGrant(manager, email, code);
      if (!role.isActive) {
        throw new Error(`Role ${code} is inactive`);
      }

      if (code === RoleCode.SUPER_ADMIN) {
        const heldByOther = await manager
          .getRepository(UserRole)
          .existsBy({ roleId: role.id, userId: Not(user.id) });
        if (heldByOther) {
          throw new Error(SUPER_ADMIN_EXISTS_MESSAGE);
        }
      }

      // The conflict target is the primary key only, so a repeated grant does nothing while a
      // second superadmin still fails on SINGLE_SUPER_ADMIN_INDEX (a bare ON CONFLICT DO NOTHING
      // would swallow that too). A row comes back only when one was inserted.
      const inserted = await manager.query<{ user_id: string }[]>(
        `INSERT INTO "user_role" ("user_id", "role_id") VALUES ($1, $2)
         ON CONFLICT ("user_id", "role_id") DO NOTHING
         RETURNING "user_id"`,
        [user.id, role.id],
      );
      if (inserted.length === 0) {
        return 'already_granted';
      }
      await insertAdminAudit(manager, {
        action: AdminAction.ROLE_GRANTED,
        actorId: null,
        targetId: user.id,
        details: { role: code },
      });
      return 'granted';
    });
  } catch (error) {
    if (isUniqueViolation(error, SINGLE_SUPER_ADMIN_INDEX)) {
      throw new Error(SUPER_ADMIN_EXISTS_MESSAGE, { cause: error });
    }
    throw error;
  }
}

// Idempotent: revoking a role the account does not hold changes nothing and answers
// `not_granted`. Takes effect from the account's next request, as roles are read with every
// session check. An actual revocation leaves a ROLE_REVOKED row in the same transaction.
export function revokeRole(
  dataSource: DataSource,
  email: string,
  code: RoleCode,
): Promise<RevokeResult> {
  return dataSource.transaction(async (manager) => {
    const { user, role } = await findGrant(manager, email, code);
    const { affected } = await manager
      .getRepository(UserRole)
      .delete({ userId: user.id, roleId: role.id });
    if ((affected ?? 0) === 0) {
      return 'not_granted';
    }
    await insertAdminAudit(manager, {
      action: AdminAction.ROLE_REVOKED,
      actorId: null,
      targetId: user.id,
      details: { role: code },
    });
    return 'revoked';
  });
}

// Kept for the tests that need an admin.
export function grantAdmin(
  dataSource: DataSource,
  email: string,
): Promise<GrantResult> {
  return grantRole(dataSource, email, RoleCode.ADMIN);
}
