import type { DataSource } from 'typeorm';
import { RoleCode } from '../shared/types/role-code.js';
import { Role } from './entities/role.entity.js';
import { UserRole } from './entities/user-role.entity.js';
import { User } from './entities/user.entity.js';
import { normalizeEmail } from './services/users.service.js';

// Idempotent: granting the role twice leaves a single row. Throws on an unknown address.
export async function grantAdmin(
  dataSource: DataSource,
  email: string,
): Promise<void> {
  const address = normalizeEmail(email);
  const user = await dataSource
    .getRepository(User)
    .findOneBy({ email: address });
  if (user === null) {
    throw new Error(`No user with e-mail address ${address}`);
  }

  const role = await dataSource
    .getRepository(Role)
    .findOneBy({ code: RoleCode.ADMIN });
  if (role === null) {
    throw new Error(`Role ${RoleCode.ADMIN} does not exist in this database`);
  }

  await dataSource
    .createQueryBuilder()
    .insert()
    .into(UserRole)
    .values({ userId: user.id, roleId: role.id })
    .orIgnore()
    .execute();
}
