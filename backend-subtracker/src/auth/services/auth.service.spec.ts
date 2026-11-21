import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { type DataSource, IsNull } from 'typeorm';
import { type EnvConfig, validateEnv } from '../../config/env.js';
import { type MailContent, MailType } from '../../mail/mail.types.js';
import type { MailService } from '../../mail/services/mail.service.js';
import { RoleCode } from '../../shared/types/role-code.js';
import { Role } from '../../users/entities/role.entity.js';
import { UserRole } from '../../users/entities/user-role.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { AccountBlockedException } from '../account-blocked.exception.js';
import { PRIVACY_POLICY_VERSION } from '../auth.constants.js';
import { MagicLinkToken } from '../entities/magic-link-token.entity.js';
import { AuthService } from './auth.service.js';
import { hashToken, type SessionService } from './session.service.js';

const FRONTEND_URL = 'https://app.example.com';
const SUPPORT_EMAIL = 'pomoc@example.com';
const ADDRESS = 'jan@example.com';
const USER_ROLE_ID = 'role-user';

function configStub() {
  const env = validateEnv({
    MODE: 'DEV',
    POSTGRES_HOST: 'localhost',
    POSTGRES_USER: 'subtracker-adm',
    POSTGRES_PASSWORD: 'secret',
    POSTGRES_DATABASE: 'subtracker-db',
    POSTGRES_DATABASE_DEV: 'subtracker-db-dev',
    CORS_ORIGINS: 'http://localhost:4200',
    FRONTEND_URL,
    SUPPORT_EMAIL,
  });
  return {
    get: (key: keyof EnvConfig) => env[key],
  } as unknown as ConfigService<EnvConfig, true>;
}

function userWith(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: ADDRESS,
    isActive: true,
    emailVerifiedAt: null,
    userRoles: [
      { role: { code: RoleCode.USER, isActive: true } as Role } as UserRole,
    ],
    ...overrides,
  } as User;
}

interface SetupOptions {
  // What the locking lookup finds.
  found?: User | null;
  // Rows returned by the query builder's insert of a user.
  returned?: Record<string, string>[];
  // The owner of the unused token verify looks up, or null when there is none.
  tokenOwner?: string | null;
  // Rows the query builder's update reports, i.e. whether verify used the token up.
  affected?: number;
}

function setup({
  found = null,
  returned = [],
  tokenOwner = null,
  affected = 1,
}: SetupOptions = {}) {
  const calls: string[] = [];
  const users = {
    findOne: vi.fn((_options: object) => Promise.resolve(found)),
    findOneOrFail: vi.fn(() => Promise.resolve(found)),
    update: vi.fn(() => Promise.resolve()),
  };
  const roles = {
    findOneBy: vi.fn(() => Promise.resolve({ id: USER_ROLE_ID })),
  };
  const userRoles = { insert: vi.fn(() => Promise.resolve()) };
  const tokens = {
    findOne: vi.fn((_options: object) =>
      Promise.resolve(tokenOwner === null ? null : { userId: tokenOwner }),
    ),
    delete: vi.fn(() => {
      calls.push('delete');
      return Promise.resolve();
    }),
    insert: vi.fn((_row: Partial<MagicLinkToken>) => {
      calls.push('insert');
      return Promise.resolve();
    }),
  };
  const repositories = new Map<unknown, unknown>([
    [User, users],
    [Role, roles],
    [UserRole, userRoles],
    [MagicLinkToken, tokens],
  ]);

  const query = {
    insert: () => query,
    into: () => query,
    values: vi.fn((_row: Partial<User>) => query),
    orIgnore: () => query,
    updateEntity: () => query,
    update: () => query,
    set: () => query,
    where: vi.fn((_condition: string, _params: object) => query),
    returning: () => query,
    execute: vi.fn(() => Promise.resolve({ raw: returned, affected })),
  };
  const manager = {
    getRepository: (entity: unknown) => repositories.get(entity),
    createQueryBuilder: () => query,
  };
  const dataSource = {
    transaction: <T>(work: (entityManager: typeof manager) => Promise<T>) =>
      work(manager),
  } as unknown as DataSource;

  const sendToUser = vi.fn<
    (type: MailType, to: string, content: MailContent) => Promise<void>
  >(() => Promise.resolve());
  const create = vi.fn(() => Promise.resolve('session-token'));
  const service = new AuthService(
    dataSource,
    { sendToUser } as unknown as MailService,
    { create } as unknown as SessionService,
    configStub(),
  );
  return {
    service,
    calls,
    users,
    userRoles,
    tokens,
    query,
    manager,
    sendToUser,
    create,
  };
}

describe('AuthService', () => {
  describe('requestLink', () => {
    it('sends nothing for an unknown address', async () => {
      const { service, tokens, sendToUser } = setup({ found: null });

      await expect(service.requestLink(ADDRESS)).resolves.toBeUndefined();

      expect(tokens.insert).not.toHaveBeenCalled();
      expect(sendToUser).not.toHaveBeenCalled();
    });

    it('refuses a blocked account with the contact address and mails it about the block', async () => {
      const { service, tokens, sendToUser } = setup({
        found: userWith({ isActive: false }),
      });

      const refusal = await service
        .requestLink(ADDRESS)
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(AccountBlockedException);
      expect((refusal as AccountBlockedException).getResponse()).toEqual({
        statusCode: 403,
        code: 'account_blocked',
        contact: SUPPORT_EMAIL,
        message: 'Account blocked',
      });
      expect(tokens.delete).not.toHaveBeenCalled();
      expect(tokens.insert).not.toHaveBeenCalled();
      expect(sendToUser).toHaveBeenCalledOnce();
      const [type, to, content] = sendToUser.mock.calls[0];
      expect(type).toBe(MailType.ACCOUNT_BLOCKED);
      expect(to).toBe(ADDRESS);
      expect(content.text).toContain(SUPPORT_EMAIL);
    });

    it('refuses a blocked account before the mail about the block has gone out', async () => {
      const { service, sendToUser } = setup({
        found: userWith({ isActive: false }),
      });
      sendToUser.mockReturnValueOnce(new Promise(() => undefined));

      await expect(service.requestLink(ADDRESS)).rejects.toBeInstanceOf(
        AccountBlockedException,
      );
    });

    it('normalizes the address before looking it up, under a row lock', async () => {
      const { service, users } = setup();

      await service.requestLink('  Jan@Example.COM ');

      expect(users.findOne).toHaveBeenCalledWith({
        where: { email: ADDRESS },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('deletes the unused tokens before inserting the new one', async () => {
      const { service, calls, tokens } = setup({ found: userWith() });

      await service.requestLink(ADDRESS);

      expect(tokens.delete).toHaveBeenCalledWith({
        userId: 'user-1',
        usedAt: IsNull(),
      });
      expect(calls).toEqual(['delete', 'insert']);
    });

    it('mails the token in the URL fragment and stores only its hash', async () => {
      const { service, tokens, sendToUser } = setup({ found: userWith() });

      await service.requestLink(ADDRESS);

      const [type, to, content] = sendToUser.mock.calls[0];
      expect(type).toBe(MailType.MAGIC_LINK);
      expect(to).toBe(ADDRESS);
      const token = /#token=([\w-]+)/.exec(content.text)?.[1] ?? '';
      expect(content.text).toContain(
        `${FRONTEND_URL}/auth/verify#token=${token}`,
      );
      expect(content.html).toContain(
        `${FRONTEND_URL}/auth/verify#token=${token}`,
      );
      expect(tokens.insert.mock.calls[0][0].tokenHash).toBe(hashToken(token));
    });

    it('tells an unconfirmed account that the link confirms the consents', async () => {
      const { service, sendToUser } = setup({ found: userWith() });

      await service.requestLink(ADDRESS);

      const content = sendToUser.mock.calls[0][2];
      expect(content.text).toContain('18 lat');
      expect(content.html).toContain('18 lat');
    });

    it('does not mention consents to a confirmed account', async () => {
      const { service, sendToUser } = setup({
        found: userWith({ emailVerifiedAt: new Date() }),
      });

      await service.requestLink(ADDRESS);

      const content = sendToUser.mock.calls[0][2];
      expect(content.text).not.toContain('18 lat');
      expect(content.html).not.toContain('18 lat');
    });

    it('answers before the mail has gone out', async () => {
      const { service, sendToUser } = setup({ found: userWith() });
      sendToUser.mockReturnValueOnce(new Promise(() => undefined));

      await expect(service.requestLink(ADDRESS)).resolves.toBeUndefined();
    });
  });

  describe('register', () => {
    it('creates a normalized user with the USER role', async () => {
      const { service, query, userRoles, sendToUser } = setup({
        found: userWith(),
        returned: [{ id: 'user-1' }],
      });

      await service.register(' Jan@Example.COM');

      expect(query.values).toHaveBeenCalledWith(
        expect.objectContaining({
          email: ADDRESS,
          privacyPolicyVersion: PRIVACY_POLICY_VERSION,
        }),
      );
      expect(userRoles.insert).toHaveBeenCalledWith({
        userId: 'user-1',
        roleId: USER_ROLE_ID,
      });
      expect(sendToUser).toHaveBeenCalledOnce();
    });

    it('adds no role when the address is taken, and refreshes unconfirmed consents', async () => {
      const { service, users, userRoles, sendToUser } = setup({
        found: userWith(),
        returned: [],
      });

      await service.register(ADDRESS);

      expect(userRoles.insert).not.toHaveBeenCalled();
      expect(users.update).toHaveBeenCalledWith(
        { id: 'user-1' },
        {
          consentsAcceptedAt: expect.any(Date) as Date,
          privacyPolicyVersion: PRIVACY_POLICY_VERSION,
        },
      );
      expect(sendToUser).toHaveBeenCalledOnce();
    });

    it('does not change a confirmed account', async () => {
      const { service, users, sendToUser } = setup({
        found: userWith({ emailVerifiedAt: new Date() }),
        returned: [],
      });

      await service.register(ADDRESS);

      expect(users.update).not.toHaveBeenCalled();
      expect(sendToUser).toHaveBeenCalledOnce();
    });

    it('refuses a blocked account without changing its consents or mailing it', async () => {
      const { service, users, tokens, sendToUser } = setup({
        found: userWith({ isActive: false }),
        returned: [],
      });

      await expect(service.register(ADDRESS)).rejects.toBeInstanceOf(
        AccountBlockedException,
      );

      expect(users.update).not.toHaveBeenCalled();
      expect(tokens.insert).not.toHaveBeenCalled();
      expect(sendToUser).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    it('answers 401 when no unused token has this hash', async () => {
      const { service, tokens, users, create } = setup({ tokenOwner: null });

      await expect(service.verify('token', null)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      expect(tokens.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tokenHash: hashToken('token'),
          }) as object,
        }),
      );
      expect(users.findOne).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it('locks the owner row before using the token up', async () => {
      const { service, users, query } = setup({
        found: userWith(),
        tokenOwner: 'user-1',
      });
      const order: string[] = [];
      users.findOne.mockImplementationOnce(() => {
        order.push('lock user');
        return Promise.resolve(userWith());
      });
      query.execute.mockImplementationOnce(() => {
        order.push('use token');
        return Promise.resolve({ raw: [], affected: 1 });
      });

      await service.verify('token', null);

      expect(users.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(order).toEqual(['lock user', 'use token']);
      expect(query.where).toHaveBeenCalledWith(expect.any(String), {
        tokenHash: hashToken('token'),
        userId: 'user-1',
      });
    });

    it('answers 403 for a blocked account and leaves its token unused', async () => {
      const { service, query, create } = setup({
        found: userWith({ isActive: false }),
        tokenOwner: 'user-1',
      });

      await expect(service.verify('token', null)).rejects.toBeInstanceOf(
        AccountBlockedException,
      );

      expect(query.execute).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it('answers 401 when a parallel request used the token up first', async () => {
      const { service, create } = setup({
        found: userWith(),
        tokenOwner: 'user-1',
        affected: 0,
      });

      await expect(service.verify('token', null)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      expect(create).not.toHaveBeenCalled();
    });

    it('confirms the address and creates the session in the same transaction', async () => {
      const { service, users, create, manager } = setup({
        found: userWith(),
        tokenOwner: 'user-1',
      });

      await expect(service.verify('token', 'agent')).resolves.toEqual({
        user: { id: 'user-1', email: ADDRESS, roles: [RoleCode.USER] },
        sessionToken: 'session-token',
      });

      expect(users.update).toHaveBeenCalledWith(
        { id: 'user-1', emailVerifiedAt: IsNull() },
        { emailVerifiedAt: expect.any(Date) as Date },
      );
      expect(create).toHaveBeenCalledWith('user-1', 'agent', manager);
    });
  });
});
