import { type DataSource, Not } from 'typeorm';
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

interface Grant {
  user: User;
  role: Role;
}

// Throws on an unknown address and on a role missing from this database.
async function findGrant(
  dataSource: DataSource,
  email: string,
  code: RoleCode,
): Promise<Grant> {
  const address = normalizeEmail(email);
  const user = await dataSource
    .getRepository(User)
    .findOneBy({ email: address });
  if (user === null) {
    throw new Error(`No user with e-mail address ${address}`);
  }

  const role = await dataSource.getRepository(Role).findOneBy({ code });
  if (role === null) {
    throw new Error(`Role ${code} does not exist in this database`);
  }
  return { user, role };
}

// Idempotent: granting the role twice leaves a single row. SUPER_ADMIN goes to at most one
// account: while another one holds it, this throws SUPER_ADMIN_EXISTS_MESSAGE. A grant racing past
// that check is stopped by the unique index SINGLE_SUPER_ADMIN_INDEX, with the same message.
export async function grantRole(
  dataSource: DataSource,
  email: string,
  code: RoleCode,
): Promise<void> {
  const { user, role } = await findGrant(dataSource, email, code);

  if (code === RoleCode.SUPER_ADMIN) {
    const heldByOther = await dataSource
      .getRepository(UserRole)
      .existsBy({ roleId: role.id, userId: Not(user.id) });
    if (heldByOther) {
      throw new Error(SUPER_ADMIN_EXISTS_MESSAGE);
    }
  }

  try {
    // The conflict target is the primary key only, so a repeated grant does nothing while a second
    // superadmin still fails on SINGLE_SUPER_ADMIN_INDEX (a bare ON CONFLICT DO NOTHING would
    // swallow that too).
    await dataSource.query(
      `INSERT INTO "user_role" ("user_id", "role_id") VALUES ($1, $2)
       ON CONFLICT ("user_id", "role_id") DO NOTHING`,
      [user.id, role.id],
    );
  } catch (error) {
    if (isUniqueViolation(error, SINGLE_SUPER_ADMIN_INDEX)) {
      throw new Error(SUPER_ADMIN_EXISTS_MESSAGE);
    }
    throw error;
  }
}

// Idempotent: revoking a role the account does not hold changes nothing. Takes effect from the
// account's next request, as roles are read with every session check.
export async function revokeRole(
  dataSource: DataSource,
  email: string,
  code: RoleCode,
): Promise<void> {
  const { user, role } = await findGrant(dataSource, email, code);
  await dataSource
    .getRepository(UserRole)
    .delete({ userId: user.id, roleId: role.id });
}

// Kept for the tests that need an admin.
export function grantAdmin(
  dataSource: DataSource,
  email: string,
): Promise<void> {
  return grantRole(dataSource, email, RoleCode.ADMIN);
}
