import type { TestContext } from 'vitest';
import { AdminAction } from '../../src/admin/admin-audit.types.js';
import type {
  AdminUserDetail,
  AdminUserSummary,
} from '../../src/admin/admin-user.types.js';
import { AdminAudit } from '../../src/admin/entities/admin-audit.entity.js';
import { CANNOT_MANAGE_MESSAGE } from '../../src/admin/services/admin-users.service.js';
import { MailType } from '../../src/mail/mail.types.js';
import { RoleCode, roleIdOf } from '../../src/shared/types/role-code.js';
import { UserRole } from '../../src/users/entities/user-role.entity.js';
import { User } from '../../src/users/entities/user.entity.js';
import { authRequests } from '../auth/auth-e2e.js';
import { subscriptionRequests } from '../subscriptions/subscriptions-e2e.js';
import { subscriptionBody } from '../subscriptions/subscriptions-e2e.js';
import {
  ADDRESS_DOMAIN,
  createE2eApp,
  UNKNOWN_ID,
} from '../support/e2e-app.js';
import { type Account, ADMIN_ACTIONS, adminRequests } from './admin-e2e.js';

const ADDRESS_PREFIX = 'e2e-admin-users-';

describe('Admin — accounts (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job) with a fake mail transport. Every account these tests create hangs off a
  // recognisable address and is removed at the end with its roles and audit rows.
  const e2e = createE2eApp({ addressPrefix: ADDRESS_PREFIX });
  const { repository, sent } = e2e;
  const {
    account,
    insertAccount,
    searchUsers,
    getUser,
    postAction,
    auditActions,
    mailTypesOf,
  } = adminRequests(e2e);
  const { getMe, postRequestLink, postVerify } = authRequests(e2e);
  const {
    postSubscription,
    putBudget,
    getSubscriptions,
    getTotals,
    getBudget,
  } = subscriptionRequests(e2e);

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

  // The superadmin of this file. There is at most one in the database: when an account outside
  // this file holds the role (locally, e.g. the developer's own), the tests that need one skip
  // rather than touch it. The CI database has none, so they always run there.
  let superAdmin: Account | undefined;
  async function fileSuperAdmin(skip: TestContext['skip']): Promise<Account> {
    if (superAdmin !== undefined) {
      return superAdmin;
    }
    const holder = await repository(UserRole).findOneBy({
      roleId: roleIdOf(RoleCode.SUPER_ADMIN),
    });
    if (holder !== null) {
      skip('Another account of this database holds SUPER_ADMIN');
    }
    superAdmin = await account([RoleCode.SUPER_ADMIN]);
    return superAdmin;
  }

  // What must not change on a target an actor may not manage: still active, its session works and
  // no change of it is recorded (a VIEW is not a change).
  async function expectUntouched(target: Account) {
    expect(
      (await repository(User).findOneByOrFail({ id: target.id })).isActive,
    ).toBe(true);
    await getMe(target.cookie).expect(200);
    const changes = await repository(AdminAudit).findBy({
      targetId: target.id,
    });
    expect(changes.filter((row) => row.action !== AdminAction.VIEW)).toEqual(
      [],
    );
  }

  // Every action on the target answers 403 with the same message, whatever its state allows.
  async function expectActionsRefused(actor: Account, target: Account) {
    for (const action of ADMIN_ACTIONS) {
      const response = await postAction(actor.cookie, target.id, action).expect(
        403,
      );
      expect((response.body as { message: string }).message).toBe(
        CANNOT_MANAGE_MESSAGE,
      );
    }
  }

  async function detailOf(actor: Account, target: Account) {
    return (await getUser(actor.cookie, target.id).expect(200))
      .body as AdminUserDetail;
  }

  const fragmentOf = (address: string) =>
    address.slice(ADDRESS_PREFIX.length, address.indexOf('@'));

  describe('rank rule', () => {
    it('refuses every admin action where the actor does not outrank the target, leaving the target unchanged', async () => {
      const user = await account();
      const otherUser = await account();
      const admin = await account([RoleCode.ADMIN]);
      const otherAdmin = await account([RoleCode.ADMIN]);

      // A user has no admin route at all.
      for (const target of [otherUser, admin, user]) {
        await searchUsers(user.cookie, {
          q: fragmentOf(target.address),
        }).expect(403);
        await getUser(user.cookie, target.id).expect(403);
        for (const action of ADMIN_ACTIONS) {
          await postAction(user.cookie, target.id, action).expect(403);
        }
      }

      // An admin sees every account but manages neither another admin nor itself; `unblock` of an
      // active account answers 403, not 409, so a refused actor learns nothing about the state.
      for (const target of [otherAdmin, admin]) {
        await expectActionsRefused(admin, target);
        expect((await detailOf(admin, target)).user).toMatchObject({
          role: 'admin',
          canManage: false,
        });
      }
      expect((await detailOf(admin, otherUser)).user).toMatchObject({
        role: 'user',
        canManage: true,
      });

      for (const target of [otherUser, admin, otherAdmin, user]) {
        await expectUntouched(target);
      }
    });

    it('lets the superadmin manage admins and users, and nobody manage the superadmin', async ({
      skip,
    }) => {
      const owner = await fileSuperAdmin(skip);
      const user = await account();
      const admin = await account([RoleCode.ADMIN]);
      const bodies: string[] = [];

      // Seen by an admin, by a user's attempt and by itself.
      await expectActionsRefused(admin, owner);
      await expectActionsRefused(owner, owner);
      for (const action of ADMIN_ACTIONS) {
        await postAction(user.cookie, owner.id, action).expect(403);
      }
      for (const viewer of [admin, owner]) {
        const response = await getUser(viewer.cookie, owner.id).expect(200);
        bodies.push(response.text);
        expect((response.body as AdminUserDetail).user).toMatchObject({
          role: 'admin',
          canManage: false,
        });
      }
      const found = await searchUsers(admin.cookie, {
        q: fragmentOf(owner.address),
      }).expect(200);
      bodies.push(found.text);
      expect(found.body as AdminUserSummary[]).toContainEqual(
        expect.objectContaining({
          id: owner.id,
          role: 'admin',
          canManage: false,
        }),
      );
      await expectUntouched(owner);

      // The superadmin manages an admin and a user.
      const blocked = await postAction(owner.cookie, admin.id, 'block').expect(
        200,
      );
      bodies.push(blocked.text);
      expect(blocked.body).toMatchObject({
        id: admin.id,
        role: 'admin',
        isActive: false,
        canManage: true,
      });
      bodies.push(
        (await postAction(owner.cookie, admin.id, 'unblock').expect(200)).text,
      );
      const reset = await postAction(
        owner.cookie,
        user.id,
        'reset-sessions',
      ).expect(200);
      bodies.push(reset.text);
      expect(reset.body).toMatchObject({ id: user.id, canManage: true });
      bodies.push(
        // The superadmin's own address, so its row is surely among the results.
        (
          await searchUsers(owner.cookie, {
            q: owner.address,
          }).expect(200)
        ).text,
      );

      // The role code itself never leaves the admin API.
      for (const body of bodies) {
        expect(body).not.toContain(RoleCode.SUPER_ADMIN);
      }
    });
  });

  describe('search', () => {
    // Each case of the literal-character test gets its own addresses.
    let literalRuns = 0;

    it('finds accounts by a fragment of the address', async () => {
      const admin = await account([RoleCode.ADMIN]);
      const found = await account();
      const other = await account();

      const response = await searchUsers(admin.cookie, {
        q: `  ${fragmentOf(found.address).toUpperCase()}  `,
      })
        .expect(200)
        .expect('Cache-Control', 'no-store');

      const results = response.body as AdminUserSummary[];
      expect(results).toContainEqual({
        id: found.id,
        email: found.address,
        role: 'user',
        isActive: true,
        createdAt: expect.any(String) as string,
        canManage: true,
      });
      expect(results.map((result) => result.id)).not.toContain(other.id);
    });

    it.each([
      ['a fragment shorter than 3 characters', { q: 'ab' }],
      ['a fragment of 2 characters after trimming', { q: '  ab  ' }],
      ['no fragment', {}],
      ['an empty fragment', { q: '' }],
      ['a fragment longer than an address', { q: 'a'.repeat(255) }],
      ['an unknown status', { q: 'abc', status: 'yes' }],
      ['no fragment with status=all', { status: 'all' }],
      ['no fragment with status=active', { status: 'active' }],
      ['the removed blocked filter', { q: 'abc', blocked: 'true' }],
      ['an unknown parameter', { q: 'abc', role: 'admin' }],
    ])('answers 400 to %s', async (_case, query: Record<string, string>) => {
      const admin = await account([RoleCode.ADMIN]);

      await searchUsers(admin.cookie, query).expect(400);
    });

    it('filters by status, lists blocked accounts with or without a fragment', async () => {
      const admin = await account([RoleCode.ADMIN]);
      const active = await account();
      const blocked = await account();
      await postAction(admin.cookie, blocked.id, 'block').expect(200);

      // Each search uses the full address of one account: the file's prefix matches more than the
      // 20 results by now, so an account of this test could fall outside them.
      const idsFor = async (query: Record<string, string>) =>
        (
          (await searchUsers(admin.cookie, query).expect(200))
            .body as AdminUserSummary[]
        ).map((result) => result.id);
      expect(await idsFor({ q: blocked.address, status: 'blocked' })).toEqual([
        blocked.id,
      ]);
      expect(await idsFor({ q: active.address, status: 'blocked' })).toEqual(
        [],
      );
      expect(await idsFor({ q: active.address, status: 'active' })).toEqual([
        active.id,
      ]);
      expect(await idsFor({ q: blocked.address, status: 'active' })).toEqual(
        [],
      );

      const blockedQueries: Record<string, string>[] = [
        { status: 'blocked' },
        { status: 'blocked', q: '' },
      ];
      for (const query of blockedQueries) {
        const all = (await searchUsers(admin.cookie, query).expect(200))
          .body as AdminUserSummary[];
        expect(all.every((result) => !result.isActive)).toBe(true);
      }

      // `status=all` (also the default) does not filter.
      const statusFilters: Record<string, string>[] = [{ status: 'all' }, {}];
      for (const status of statusFilters) {
        expect(await idsFor({ q: active.address, ...status })).toEqual([
          active.id,
        ]);
        expect(await idsFor({ q: blocked.address, ...status })).toEqual([
          blocked.id,
        ]);
      }
      await mailTypesOf(blocked.address, 2);
    });

    it('returns at most 20 accounts, in address order', async () => {
      const admin = await account([RoleCode.ADMIN]);
      const addresses = Array.from(
        { length: 21 },
        (_, index) =>
          `${ADDRESS_PREFIX}limit-${String(index).padStart(2, '0')}${ADDRESS_DOMAIN}`,
      );
      // Inserted in reverse, so the order of the answer comes from the query.
      for (const address of [...addresses].reverse()) {
        await insertAccount(address);
      }

      const results = (
        await searchUsers(admin.cookie, {
          q: `${ADDRESS_PREFIX}limit-`,
        }).expect(200)
      ).body as AdminUserSummary[];

      expect(results.map((result) => result.email)).toEqual(
        addresses.slice(0, 20),
      );
    });

    it.each([
      ['%', 'a%b'],
      ['_', 'a_b'],
      ['\\', String.raw`a\b`],
    ])('treats %s in the fragment as itself', async (_char, middle: string) => {
      const admin = await account([RoleCode.ADMIN]);
      // Matches of the fragment read as a pattern: `%` and `_` as wildcards, `\` as an escape.
      const lookalikes = ['ab', 'axb', 'azzb', 'a%b', 'a_b', String.raw`a\b`];
      const run = ++literalRuns;
      const ids = new Map<string, string>();
      for (const part of lookalikes) {
        const address = `${ADDRESS_PREFIX}lit-${run}-${lookalikes.indexOf(part)}-${part}${ADDRESS_DOMAIN}`;
        ids.set(part, await insertAccount(address));
      }

      const results = (
        await searchUsers(admin.cookie, {
          q: `-${middle}@`,
        }).expect(200)
      ).body as AdminUserSummary[];

      expect(
        results
          .filter((result) => result.email.includes(`lit-${run}-`))
          .map((result) => result.id),
      ).toEqual([ids.get(middle)]);
    });
  });

  describe('account detail', () => {
    it("shows the account's data exactly as the account sees it and records the view", async () => {
      const admin = await account([RoleCode.ADMIN]);
      const target = await account();
      await postSubscription(target.cookie, subscriptionBody()).expect(201);
      await postSubscription(
        target.cookie,
        subscriptionBody({
          name: 'Spotify',
          amount: 120,
          billingCycle: 'yearly',
        }),
      ).expect(201);
      await putBudget(target.cookie, { monthlyLimit: 50 }).expect(200);

      const response = await getUser(admin.cookie, target.id)
        .expect(200)
        .expect('Cache-Control', 'no-store');

      const detail = response.body as AdminUserDetail;
      expect(detail.user).toEqual({
        id: target.id,
        email: target.address,
        role: 'user',
        isActive: true,
        createdAt: expect.any(String) as string,
        emailVerifiedAt: expect.any(String) as string,
        canManage: true,
      });
      expect(detail.subscriptions).toHaveLength(2);
      expect(detail.subscriptions).toEqual(
        await getSubscriptions(target.cookie),
      );
      expect(detail.totals).toEqual(await getTotals(target.cookie));
      expect(detail.budget).toEqual(await getBudget(target.cookie));
      expect(await auditActions(admin.id, target.id)).toEqual([
        AdminAction.VIEW,
      ]);
    });

    it('answers 404 for an unknown id without recording a view, and 400 for an id that is not a UUID', async () => {
      const admin = await account([RoleCode.ADMIN]);

      await getUser(admin.cookie, UNKNOWN_ID).expect(404);
      await getUser(admin.cookie, 'not-a-uuid').expect(400);

      expect(await auditActions(admin.id, UNKNOWN_ID)).toEqual([]);
    });
  });

  describe('actions', () => {
    it('blocks, unblocks and signs out everywhere, mailing the owner and recording each action', async () => {
      const admin = await account([RoleCode.ADMIN]);
      const target = await account();
      await getMe(target.cookie).expect(200);

      const blocked = await postAction(admin.cookie, target.id, 'block').expect(
        200,
      );
      expect(blocked.body).toEqual({
        id: target.id,
        email: target.address,
        role: 'user',
        isActive: false,
        createdAt: expect.any(String) as string,
        canManage: true,
      });
      await getMe(target.cookie).expect(401);
      // A refused change records nothing: the 409 rolls the audit row back.
      await postAction(admin.cookie, target.id, 'block').expect(409);
      await postAction(admin.cookie, target.id, 'reset-sessions').expect(409);
      expect(await auditActions(admin.id, target.id)).toEqual([
        AdminAction.BLOCK,
      ]);
      expect(await mailTypesOf(target.address, 2)).toEqual(
        [MailType.MAGIC_LINK, MailType.ACCOUNT_BLOCKED].sort(),
      );

      const unblocked = await postAction(
        admin.cookie,
        target.id,
        'unblock',
      ).expect(200);
      expect(unblocked.body).toMatchObject({ id: target.id, isActive: true });
      await postAction(admin.cookie, target.id, 'unblock').expect(409);
      expect(await mailTypesOf(target.address, 3)).toContain(
        MailType.ACCOUNT_UNBLOCKED,
      );

      // Signed in again with a new link, then signed out everywhere.
      await postRequestLink(target.address).expect(202);
      const cookie = e2e.cookiePairOf(
        await postVerify(await e2e.latestToken(target.address)).expect(200),
      );
      await getMe(cookie).expect(200);
      const reset = await postAction(
        admin.cookie,
        target.id,
        'reset-sessions',
      ).expect(200);
      expect(reset.body).toMatchObject({ id: target.id, isActive: true });
      await getMe(cookie).expect(401);
      expect(await mailTypesOf(target.address, 5)).toContain(
        MailType.SESSIONS_RESET,
      );

      expect(await auditActions(admin.id, target.id)).toEqual(
        [
          AdminAction.BLOCK,
          AdminAction.UNBLOCK,
          AdminAction.RESET_SESSIONS,
        ].sort(),
      );
      expect(sent.filter((mail) => mail.to === target.address).length).toBe(5);
    });

    it('answers 404 for an unknown id and 400 for an id that is not a UUID', async () => {
      const admin = await account([RoleCode.ADMIN]);

      for (const action of ADMIN_ACTIONS) {
        await postAction(admin.cookie, UNKNOWN_ID, action).expect(404);
        await postAction(admin.cookie, 'not-a-uuid', action).expect(400);
      }
      expect(await auditActions(admin.id, UNKNOWN_ID)).toEqual([]);
    });
  });
});
