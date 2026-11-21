import type { Test } from 'supertest';
import type { AdminAction } from '../../src/admin/admin-audit.types.js';
import { AdminAudit } from '../../src/admin/entities/admin-audit.entity.js';
import { Mail } from '../../src/mail/entities/mail.entity.js';
import type { MailType } from '../../src/mail/mail.types.js';
import type { RoleCode } from '../../src/shared/types/role-code.js';
import { User } from '../../src/users/entities/user.entity.js';
import { grantRole } from '../../src/users/role-grants.js';
import type { E2eApp } from '../support/e2e-app.js';

// The action routes, /admin/users/:id/<action>.
export const ADMIN_ACTIONS = ['block', 'unblock', 'reset-sessions'] as const;
export type AdminActionRoute = (typeof ADMIN_ACTIONS)[number];

export interface Account {
  id: string;
  address: string;
  cookie: string;
}

// Requests and lookups shared by the admin e2e files.
export interface AdminRequests {
  // A new signed-in account holding the roles (granted the way the CLI scripts grant them).
  account: (roles?: RoleCode[]) => Promise<Account>;
  // An account written straight to the table, without a session, e.g. many for the search limit
  // or an address the API would refuse. The address must be one of the file's.
  insertAccount: (address: string) => Promise<string>;
  searchUsers: (cookie: string, query: Record<string, string>) => Test;
  getUser: (cookie: string, id: string) => Test;
  postAction: (cookie: string, id: string, action: AdminActionRoute) => Test;
  // The actions recorded for the pair, sorted.
  auditActions: (actorId: string, targetId: string) => Promise<AdminAction[]>;
  // The types of the mail audit rows of the address, sorted, once there are `count` of them.
  mailTypesOf: (address: string, count: number) => Promise<MailType[]>;
}

export function adminRequests(e2e: E2eApp): AdminRequests {
  const { http, repository, signIn, userIdOf } = e2e;

  async function account(roles: RoleCode[] = []): Promise<Account> {
    const { address, cookie } = await signIn();
    for (const role of roles) {
      await grantRole(e2e.dataSource, address, role);
    }
    return { id: await userIdOf(address), address, cookie };
  }

  async function insertAccount(address: string): Promise<string> {
    const user = await repository(User).save(
      repository(User).create({
        email: address,
        consentsAcceptedAt: new Date(),
        privacyPolicyVersion: 'e2e',
      }),
    );
    return user.id;
  }

  const searchUsers = (cookie: string, query: Record<string, string>) =>
    http().get('/admin/users').query(query).set('Cookie', cookie);

  const getUser = (cookie: string, id: string) =>
    http().get(`/admin/users/${id}`).set('Cookie', cookie);

  const postAction = (cookie: string, id: string, action: AdminActionRoute) =>
    http().post(`/admin/users/${id}/${action}`).set('Cookie', cookie);

  async function auditActions(
    actorId: string,
    targetId: string,
  ): Promise<AdminAction[]> {
    const rows = await repository(AdminAudit).findBy({ actorId, targetId });
    return rows.map((row) => row.action).sort();
  }

  // Audit rows of mail are written after sending, so their order is not the order of the mails.
  async function mailTypesOf(
    address: string,
    count: number,
  ): Promise<MailType[]> {
    let types: MailType[] = [];
    await vi.waitFor(async () => {
      const rows = await repository(Mail).findBy({ recipient: address });
      expect(rows).toHaveLength(count);
      types = rows.map((row) => row.type).sort();
    });
    return types;
  }

  return {
    account,
    insertAccount,
    searchUsers,
    getUser,
    postAction,
    auditActions,
    mailTypesOf,
  };
}
