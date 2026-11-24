import { Logger } from '@nestjs/common';
import { In } from 'typeorm';
import { AdminAction } from '../../src/admin/admin-audit.types.js';
import { AdminAudit } from '../../src/admin/entities/admin-audit.entity.js';
import { MagicLinkToken } from '../../src/auth/entities/magic-link-token.entity.js';
import { Session } from '../../src/auth/entities/session.entity.js';
import { Mail } from '../../src/mail/entities/mail.entity.js';
import {
  ANONYMIZED_RECIPIENT,
  MailStatus,
  MailType,
} from '../../src/mail/mail.types.js';
import { DEFAULT_CATEGORIES } from '../../src/subscriptions/default-categories.js';
import { BudgetSettings } from '../../src/subscriptions/entities/budget-settings.entity.js';
import { CategorySetting } from '../../src/subscriptions/entities/category-setting.entity.js';
import { Category } from '../../src/subscriptions/entities/category.entity.js';
import { Subscription } from '../../src/subscriptions/entities/subscription.entity.js';
import type { CategoryResponse } from '../../src/subscriptions/subscription.types.js';
import { UserRole } from '../../src/users/entities/user-role.entity.js';
import { User } from '../../src/users/entities/user.entity.js';
import {
  createE2eApp,
  type SignedIn,
  setCookieOf,
} from '../support/e2e-app.js';
import {
  subscriptionBody,
  subscriptionRequests,
} from '../subscriptions/subscriptions-e2e.js';
import { authRequests } from './auth-e2e.js';

interface Account extends SignedIn {
  userId: string;
}

describe('Auth — account deletion (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job) with a fake mail transport. Every row these tests create hangs off a
  // recognisable address and is removed at the end.
  const e2e = createE2eApp({ addressPrefix: 'e2e-auth-account-deletion-' });
  const { http, repository, sent, signIn, userIdOf, cookiePairOf } = e2e;
  const { postRegister, postRequestLink, postVerify, getMe, tokenFromMail } =
    authRequests(e2e);
  const { postSubscription, postCategory, putBudget, getSubscriptions } =
    subscriptionRequests(e2e);

  // Rows anonymized by a deletion no longer carry the file's address, so neither close() nor the
  // cleanup by prefix finds them: the account's mails leave `sent` and its rows go by id at the end.
  const anonymizedMailIds: string[] = [];
  // Audit rows of a deleted account outlive it and no longer match the file's addresses either.
  const keptAuditIds: string[] = [];
  // Deleted accounts, for their ACCOUNT_DELETED rows.
  const deletedUserIds: string[] = [];

  beforeAll(() => e2e.start());

  afterAll(async () => {
    if (anonymizedMailIds.length > 0) {
      await repository(Mail).delete({ id: In(anonymizedMailIds) });
    }
    if (keptAuditIds.length > 0) {
      await repository(AdminAudit).delete({ id: In(keptAuditIds) });
    }
    if (deletedUserIds.length > 0) {
      await repository(AdminAudit).delete({ targetId: In(deletedUserIds) });
    }
    await e2e.close();
  });

  const postDeleteAccount = (cookie: string, email: string) =>
    http().post('/auth/delete-account').set('Cookie', cookie).send({ email });

  // The ids of the address's audit rows, once every mail sent to it has its row. A test can add
  // rows of its own, so there may be more rows than mails.
  function mailIdsOf(address: string): Promise<string[]> {
    const count = sent.filter((mail) => mail.to === address).length;
    return vi.waitFor(async () => {
      const rows = await repository(Mail).findBy({ recipient: address });
      expect(rows.length).toBeGreaterThanOrEqual(count);
      return rows.map((row) => row.id);
    });
  }

  // Call right after a successful deletion with the ids from mailIdsOf, see anonymizedMailIds.
  function forgetDeleted(address: string, mailIds: string[]): void {
    anonymizedMailIds.push(...mailIds);
    for (let i = sent.length - 1; i >= 0; i--) {
      if (sent[i].to === address) {
        sent.splice(i, 1);
      }
    }
  }

  async function deleteAccount({ address, cookie }: SignedIn, email = address) {
    deletedUserIds.push(await userIdOf(address));
    const mailIds = await mailIdsOf(address);
    const response = await postDeleteAccount(cookie, email).expect(204);
    forgetDeleted(address, mailIds);
    return { response, mailIds };
  }

  // The stored fields of audit rows in a fixed order, to compare before and after.
  const auditView = (rows: AdminAudit[]) =>
    rows
      .map(({ id, actorId, targetId, action, createdAt }) => ({
        id,
        actorId,
        targetId,
        action,
        createdAt,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

  async function rowsOfUser(userId: string): Promise<Record<string, number>> {
    return {
      session: await repository(Session).countBy({ userId }),
      magicLinkToken: await repository(MagicLinkToken).countBy({ userId }),
      userRole: await repository(UserRole).countBy({ userId }),
      subscription: await repository(Subscription).countBy({ userId }),
      category: await repository(Category).countBy({ userId }),
      categorySetting: await repository(CategorySetting).countBy({ userId }),
      budgetSettings: await repository(BudgetSettings).countBy({ userId }),
    };
  }

  // A signed-in account with a subscription in its own category and saved limits.
  async function fullAccount(): Promise<Account> {
    const account = await signIn();
    const { cookie } = account;
    const own = (await postCategory(cookie, 'Praca').expect(201))
      .body as CategoryResponse;
    await postSubscription(
      cookie,
      subscriptionBody({ categoryId: own.id }),
    ).expect(201);
    await putBudget(cookie, {
      monthlyLimit: 100,
      categories: [
        {
          categoryId: DEFAULT_CATEGORIES[0].id,
          duplicateThreshold: 2,
          monthlyLimit: 50,
        },
      ],
    }).expect(200);
    return { ...account, userId: await userIdOf(account.address) };
  }

  it('removes everything the account owns and anonymizes its mail', async () => {
    const owner = await fullAccount();
    const other = await fullAccount();
    const { address, userId } = owner;
    // A second session, then an unused sign-in token.
    await postRequestLink(address).expect(202);
    const secondSession = cookiePairOf(
      await postVerify(await tokenFromMail(address, 2)).expect(200),
    );
    await postRequestLink(address).expect(202);
    await tokenFromMail(address, 3);
    await mailIdsOf(address);
    // A failed mail whose SMTP message quotes the address.
    const failed = await repository(Mail).save(
      repository(Mail).create({
        type: MailType.MAGIC_LINK,
        recipient: address,
        status: MailStatus.FAILED,
        errorMessage: `550 refused ${address}`,
        sentAt: null,
      }),
    );

    // Audit rows with the account as target and as actor (admin actions arrive with S-09's routes).
    const audit = await repository(AdminAudit).save([
      repository(AdminAudit).create({
        actorId: other.userId,
        targetId: userId,
        action: AdminAction.VIEW,
      }),
      repository(AdminAudit).create({
        actorId: userId,
        targetId: other.userId,
        action: AdminAction.BLOCK,
      }),
    ]);
    keptAuditIds.push(...audit.map((row) => row.id));

    const before = await rowsOfUser(userId);
    for (const [table, count] of Object.entries(before)) {
      expect(count, table).toBeGreaterThan(0);
    }
    const otherBefore = await rowsOfUser(other.userId);
    const otherMailIds = await mailIdsOf(other.address);

    const { response, mailIds } = await deleteAccount(owner);

    expect(setCookieOf(response)).toMatch(/^subtracker_session=;/);
    expect(await repository(User).countBy({ id: userId })).toBe(0);
    expect(await rowsOfUser(userId)).toEqual({
      session: 0,
      magicLinkToken: 0,
      userRole: 0,
      subscription: 0,
      category: 0,
      categorySetting: 0,
      budgetSettings: 0,
    });

    // The archive keeps every row of the account, but none holds its address.
    expect(mailIds).toHaveLength(4);
    expect(mailIds).toContain(failed.id);
    expect(await repository(Mail).countBy({ recipient: address })).toBe(0);
    const archived = await repository(Mail).findBy({ id: In(mailIds) });
    expect(archived).toHaveLength(mailIds.length);
    for (const row of archived) {
      expect(row.recipient).toBe(ANONYMIZED_RECIPIENT);
      expect(row.errorMessage).toBeNull();
      expect(row.type).toBe(MailType.MAGIC_LINK);
    }
    expect(archived.find((row) => row.id === failed.id)?.status).toBe(
      MailStatus.FAILED,
    );

    // The admin audit keeps the account's rows as they were: ids only, no address.
    const keptAudit = await repository(AdminAudit).findBy({
      id: In(keptAuditIds),
    });
    expect(auditView(keptAudit)).toEqual(auditView(audit));
    expect(JSON.stringify(keptAudit)).not.toContain(address);

    // The default categories and the other account stay as they were.
    expect(
      await repository(Category).countBy({
        id: In(DEFAULT_CATEGORIES.map((category) => category.id)),
      }),
    ).toBe(DEFAULT_CATEGORIES.length);
    expect(await rowsOfUser(other.userId)).toEqual(otherBefore);
    const otherMails = await repository(Mail).findBy({ id: In(otherMailIds) });
    expect(otherMails.map((row) => row.recipient)).toEqual(
      otherMailIds.map(() => other.address),
    );
    expect(await getSubscriptions(other.cookie)).toHaveLength(1);

    // Neither session of the deleted account works any more.
    for (const cookie of [owner.cookie, secondSession]) {
      await getMe(cookie).expect(401);
      await http().get('/subscriptions').set('Cookie', cookie).expect(401);
    }
  });

  it('leaves an ACCOUNT_DELETED row and a log line, both without the address', async () => {
    const logged = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    try {
      const owner = await signIn();
      const userId = await userIdOf(owner.address);

      await deleteAccount(owner);

      const rows = await repository(AdminAudit).findBy({ targetId: userId });
      expect(
        rows.map(({ actorId, targetId, action, details }) => ({
          actorId,
          targetId,
          action,
          details,
        })),
      ).toEqual([
        {
          actorId: userId,
          targetId: userId,
          action: AdminAction.ACCOUNT_DELETED,
          details: null,
        },
      ]);
      expect(JSON.stringify(rows)).not.toContain(owner.address);

      const lines = logged.mock.calls.map((call: unknown[]) => String(call[0]));
      expect(lines).toContain(`Account ${userId} deleted`);
      expect(JSON.stringify(logged.mock.calls)).not.toContain(owner.address);
    } finally {
      logged.mockRestore();
    }
  });

  it('refuses another address and changes nothing', async () => {
    const owner = await fullAccount();
    const other = await signIn();
    const before = await rowsOfUser(owner.userId);
    const mailIds = await mailIdsOf(owner.address);

    for (const email of [other.address, 'nie-moj-adres', '']) {
      const response = await postDeleteAccount(owner.cookie, email).expect(400);
      expect(response.headers['set-cookie']).toBeUndefined();
    }

    expect(await repository(User).countBy({ id: owner.userId })).toBe(1);
    expect(await rowsOfUser(owner.userId)).toEqual(before);
    expect(await repository(Mail).countBy({ recipient: owner.address })).toBe(
      mailIds.length,
    );
    await getMe(owner.cookie).expect(200);
  });

  it('accepts its address in capitals and with spaces around it', async () => {
    const owner = await signIn();

    await deleteAccount(owner, `  ${owner.address.toUpperCase()}  `);

    expect(await repository(User).countBy({ email: owner.address })).toBe(0);
  });

  it('refuses a request without a session', async () => {
    const owner = await signIn();

    await http()
      .post('/auth/delete-account')
      .send({ email: owner.address })
      .expect(401);

    expect(await repository(User).countBy({ email: owner.address })).toBe(1);
  });

  it('refuses a request from a foreign site and lets the frontend through', async () => {
    const owner = await signIn();

    await postDeleteAccount(owner.cookie, owner.address)
      .set('Origin', 'https://example.com')
      .set('Sec-Fetch-Site', 'cross-site')
      .expect(403);
    expect(await repository(User).countBy({ email: owner.address })).toBe(1);

    const mailIds = await mailIdsOf(owner.address);
    deletedUserIds.push(await userIdOf(owner.address));
    await postDeleteAccount(owner.cookie, owner.address)
      .set('Origin', e2e.env.CORS_ORIGINS[0])
      .set('Sec-Fetch-Site', 'same-site')
      .expect(204);
    forgetDeleted(owner.address, mailIds);
    expect(await repository(User).countBy({ email: owner.address })).toBe(0);
  });

  it('mails no link to a deleted address and lets it register a new, empty account', async () => {
    const owner = await fullAccount();
    await deleteAccount(owner);

    await postRequestLink(owner.address).expect(202);
    expect(sent.filter((mail) => mail.to === owner.address)).toEqual([]);

    await postRegister(owner.address).expect(202);
    const cookie = cookiePairOf(
      await postVerify(await tokenFromMail(owner.address)).expect(200),
    );

    expect(await userIdOf(owner.address)).not.toBe(owner.userId);
    expect(await getSubscriptions(cookie)).toEqual([]);
  });
});
