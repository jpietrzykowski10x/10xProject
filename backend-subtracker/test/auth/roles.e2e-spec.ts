import { AdminAction } from '../../src/admin/admin-audit.types.js';
import { AdminAudit } from '../../src/admin/entities/admin-audit.entity.js';
import { isUniqueViolation } from '../../src/shared/database/unique-violation.js';
import type { AuthUser } from '../../src/shared/types/auth-user.js';
import { RoleCode, roleIdOf } from '../../src/shared/types/role-code.js';
import {
  SINGLE_SUPER_ADMIN_INDEX,
  UserRole,
} from '../../src/users/entities/user-role.entity.js';
import {
  grantRole,
  revokeRole,
  SUPER_ADMIN_EXISTS_MESSAGE,
} from '../../src/users/role-grants.js';
import { createE2eApp, type SignedIn } from '../support/e2e-app.js';
import { authRequests } from './auth-e2e.js';

const SUPER_ADMIN_ROLE_ID = roleIdOf(RoleCode.SUPER_ADMIN);

describe('Auth — role scripts (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job) with a fake mail transport. Every row these tests create hangs off a
  // recognisable address and is removed at the end, role rows with their accounts.
  const e2e = createE2eApp({ addressPrefix: 'e2e-auth-roles-' });
  const { repository, signIn, userIdOf, isFileAddress } = e2e;
  const { getMe } = authRequests(e2e);

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

  const grant = (email: string, code: RoleCode) =>
    grantRole(e2e.dataSource, email, code);
  const revoke = (email: string, code: RoleCode) =>
    revokeRole(e2e.dataSource, email, code);

  // The roles the session sees on this request; roles are read with every request.
  async function rolesOf(cookie: string): Promise<RoleCode[]> {
    const me = await getMe(cookie).expect(200);
    return [...(me.body as AuthUser).roles].sort();
  }

  const rowsOf = async (address: string, code: RoleCode) =>
    repository(UserRole).countBy({
      userId: await userIdOf(address),
      roleId: roleIdOf(code),
    });

  // The address of the account holding SUPER_ADMIN, or null when nobody holds it.
  async function superAdminAddress(): Promise<string | null> {
    const row = await repository(UserRole).findOne({
      where: { roleId: SUPER_ADMIN_ROLE_ID },
      relations: { user: true },
    });
    return row?.user.email ?? null;
  }

  it('grants and revokes ADMIN idempotently, effective from the next request of the same session', async () => {
    const { address, cookie } = await signIn();
    expect(await rolesOf(cookie)).toEqual([RoleCode.USER]);

    expect(await grant(address, RoleCode.ADMIN)).toBe('granted');
    expect(await grant(address, RoleCode.ADMIN)).toBe('already_granted');

    expect(await rowsOf(address, RoleCode.ADMIN)).toBe(1);
    expect(await rolesOf(cookie)).toEqual([RoleCode.ADMIN, RoleCode.USER]);

    expect(await revoke(address, RoleCode.ADMIN)).toBe('revoked');
    expect(await revoke(address, RoleCode.ADMIN)).toBe('not_granted');

    expect(await rowsOf(address, RoleCode.ADMIN)).toBe(0);
    expect(await rolesOf(cookie)).toEqual([RoleCode.USER]);

    // One audit row per actual change, without an actor (the CLI) and without the address.
    const audit = await repository(AdminAudit).find({
      where: { targetId: await userIdOf(address) },
      order: { createdAt: 'ASC' },
    });
    expect(
      audit.map(({ actorId, action, details }) => ({
        actorId,
        action,
        details,
      })),
    ).toEqual([
      {
        actorId: null,
        action: AdminAction.ROLE_GRANTED,
        details: { role: RoleCode.ADMIN },
      },
      {
        actorId: null,
        action: AdminAction.ROLE_REVOKED,
        details: { role: RoleCode.ADMIN },
      },
    ]);
    expect(JSON.stringify(audit)).not.toContain(address);
  });

  it('refuses an unknown address and changes nothing', async () => {
    const address = e2e.newAddress();

    await expect(grant(address, RoleCode.ADMIN)).rejects.toThrow(
      'No user with e-mail address',
    );
    await expect(revoke(address, RoleCode.SUPER_ADMIN)).rejects.toThrow(
      'No user with e-mail address',
    );
  });

  it('allows one superadmin: the script refuses a second one and the index rejects a direct INSERT', async () => {
    // A superadmin of the local database's manual tests serves as well as one of this file.
    let holder = await superAdminAddress();
    if (holder === null) {
      holder = (await signIn()).address;
      await grant(holder, RoleCode.SUPER_ADMIN);
    }
    const second: SignedIn = await signIn();

    // The message never names the account that holds the role.
    const refused = grant(second.address, RoleCode.SUPER_ADMIN);
    await expect(refused).rejects.toThrow(SUPER_ADMIN_EXISTS_MESSAGE);
    await expect(refused).rejects.not.toThrow(holder);

    const direct = await repository(UserRole)
      .insert({
        userId: await userIdOf(second.address),
        roleId: SUPER_ADMIN_ROLE_ID,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(isUniqueViolation(direct, SINGLE_SUPER_ADMIN_INDEX)).toBe(true);

    expect(await rowsOf(second.address, RoleCode.SUPER_ADMIN)).toBe(0);
    expect(await rolesOf(second.cookie)).toEqual([RoleCode.USER]);
    expect(await superAdminAddress()).toBe(holder);
  });

  it('hands SUPER_ADMIN to another account after superadmin:revoke, one winner in a race', async ({
    skip,
  }) => {
    // Leftover of the test above; a superadmin of another file or of manual tests is not ours to
    // revoke (the CI database has none).
    const leftover = await superAdminAddress();
    if (leftover !== null && !isFileAddress(leftover)) {
      skip('Another account of this database holds SUPER_ADMIN');
    }
    if (leftover !== null) {
      await revoke(leftover, RoleCode.SUPER_ADMIN);
    }
    const first = await signIn();
    const second = await signIn();

    await grant(first.address, RoleCode.SUPER_ADMIN);
    await grant(first.address, RoleCode.SUPER_ADMIN);
    expect(await rowsOf(first.address, RoleCode.SUPER_ADMIN)).toBe(1);
    expect(await rolesOf(first.cookie)).toEqual([
      RoleCode.SUPER_ADMIN,
      RoleCode.USER,
    ]);
    await expect(grant(second.address, RoleCode.SUPER_ADMIN)).rejects.toThrow(
      SUPER_ADMIN_EXISTS_MESSAGE,
    );

    await revoke(first.address, RoleCode.SUPER_ADMIN);
    await revoke(first.address, RoleCode.SUPER_ADMIN);
    expect(await rolesOf(first.cookie)).toEqual([RoleCode.USER]);

    await grant(second.address, RoleCode.SUPER_ADMIN);
    expect(await rolesOf(second.cookie)).toEqual([
      RoleCode.SUPER_ADMIN,
      RoleCode.USER,
    ]);

    // Both grants may pass the check before either inserts; the index lets exactly one through.
    await revoke(second.address, RoleCode.SUPER_ADMIN);
    const results = await Promise.allSettled([
      grant(first.address, RoleCode.SUPER_ADMIN),
      grant(second.address, RoleCode.SUPER_ADMIN),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as Error).message).toBe(
      SUPER_ADMIN_EXISTS_MESSAGE,
    );
    expect(
      [first.address, second.address].includes(
        (await superAdminAddress()) ?? '',
      ),
    ).toBe(true);
  });
});
