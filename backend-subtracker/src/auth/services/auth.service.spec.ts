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
import { PRIVACY_POLICY_VERSION } from '../auth.constants.js';
import { MagicLinkToken } from '../entities/magic-link-token.entity.js';
import { AuthService } from './auth.service.js';
import { hashToken, type SessionService } from './session.service.js';

const FRONTEND_URL = 'https://app.example.com';
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
  // Rows returned by the query builder: the insert of a user, or the consumption of a token.
  returned?: Record<string, string>[];
}

function setup({ found = null, returned = [] }: SetupOptions = {}) {
  const calls: string[] = [];
  const users = {
    findOne: vi.fn(() => Promise.resolve(found)),
    update: vi.fn(() => Promise.resolve()),
  };
  const roles = {
    findOneBy: vi.fn(() => Promise.resolve({ id: USER_ROLE_ID })),
  };
  const userRoles = { insert: vi.fn(() => Promise.resolve()) };
  const tokens = {
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
    execute: () => Promise.resolve({ raw: returned }),
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

    it('sends nothing for an inactive user', async () => {
      const { service, tokens, sendToUser } = setup({
        found: userWith({ isActive: false }),
      });

      await expect(service.requestLink(ADDRESS)).resolves.toBeUndefined();

      expect(tokens.insert).not.toHaveBeenCalled();
      expect(sendToUser).not.toHaveBeenCalled();
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
        `${FRONTEND_URL}/auth/potwierdz#token=${token}`,
      );
      expect(content.html).toContain(
        `${FRONTEND_URL}/auth/potwierdz#token=${token}`,
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

    it('neither changes an inactive account nor mails it', async () => {
      const { service, users, tokens, sendToUser } = setup({
        found: userWith({ isActive: false }),
        returned: [],
      });

      await expect(service.register(ADDRESS)).resolves.toBeUndefined();

      expect(users.update).not.toHaveBeenCalled();
      expect(tokens.insert).not.toHaveBeenCalled();
      expect(sendToUser).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    it('answers 401 when no token row was consumed', async () => {
      const { service, query, create } = setup({ returned: [] });

      await expect(service.verify('token', null)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      expect(query.where).toHaveBeenCalledWith(expect.any(String), {
        tokenHash: hashToken('token'),
      });
      expect(create).not.toHaveBeenCalled();
    });

    it('answers 401 for an inactive user', async () => {
      const { service, create } = setup({
        found: userWith({ isActive: false }),
        returned: [{ user_id: 'user-1' }],
      });

      await expect(service.verify('token', null)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      expect(create).not.toHaveBeenCalled();
    });

    it('confirms the address and creates the session in the same transaction', async () => {
      const { service, users, create, manager } = setup({
        found: userWith(),
        returned: [{ user_id: 'user-1' }],
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
