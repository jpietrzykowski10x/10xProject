import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { type DataSource, IsNull } from 'typeorm';
import { type EnvConfig, validateEnv } from '../../config/env.js';
import { type MailContent, MailType } from '../../mail/mail.types.js';
import type { MailService } from '../../mail/services/mail.service.js';
import { User } from '../../users/entities/user.entity.js';
import { MagicLinkToken } from '../entities/magic-link-token.entity.js';
import { AccountAccessService } from './account-access.service.js';

const FRONTEND_URL = 'https://app.example.com';
const SUPPORT_EMAIL = 'pomoc@example.com';
const ADDRESS = 'jan@example.com';

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

function setup(found: Partial<User> | null) {
  // Every step in order, including the commit of the transaction and the mail.
  const steps: string[] = [];
  const users = {
    findOne: vi.fn((_options: object) => {
      steps.push('lock user');
      return Promise.resolve(
        found === null
          ? null
          : ({ id: 'user-1', email: ADDRESS, ...found } as User),
      );
    }),
    update: vi.fn((_where: object, values: Partial<User>) => {
      steps.push(`set isActive ${String(values.isActive)}`);
      return Promise.resolve();
    }),
  };
  const tokens = {
    delete: vi.fn((_where: object) => {
      steps.push('delete unused links');
      return Promise.resolve();
    }),
  };
  const query = {
    update: () => query,
    set: () => query,
    where: vi.fn((_condition: string, _params: object) => query),
    execute: vi.fn(() => {
      steps.push('revoke sessions');
      return Promise.resolve({ affected: 2 });
    }),
  };
  const repositories = new Map<unknown, unknown>([
    [User, users],
    [MagicLinkToken, tokens],
  ]);
  const manager = {
    getRepository: (entity: unknown) => repositories.get(entity),
    createQueryBuilder: () => query,
  };
  const dataSource = {
    transaction: async <T>(
      work: (entityManager: typeof manager) => Promise<T>,
    ) => {
      const result = await work(manager);
      steps.push('commit');
      return result;
    },
  } as unknown as DataSource;

  const sendToUser = vi.fn(
    (type: MailType, _to: string, _content: MailContent) => {
      steps.push(`mail ${type}`);
      return Promise.resolve(true);
    },
  );
  const service = new AccountAccessService(
    dataSource,
    { sendToUser } as unknown as MailService,
    configStub(),
  );
  return { service, steps, users, tokens, query, manager, sendToUser };
}

describe('AccountAccessService', () => {
  describe('block', () => {
    it('blocks the account, ends its links and sessions, and mails it after the commit', async () => {
      const { service, steps, users, tokens, query, sendToUser } = setup({
        isActive: true,
      });

      const user = await service.block('user-1');

      expect(user).toMatchObject({ id: 'user-1', isActive: false });
      expect(users.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(tokens.delete).toHaveBeenCalledWith({
        userId: 'user-1',
        usedAt: IsNull(),
      });
      expect(query.where).toHaveBeenCalledWith(
        'user_id = :userId AND revoked_at IS NULL',
        { userId: 'user-1' },
      );
      expect(steps).toEqual([
        'lock user',
        'set isActive false',
        'delete unused links',
        'revoke sessions',
        'commit',
        `mail ${MailType.ACCOUNT_BLOCKED}`,
      ]);
      const [, to, content] = sendToUser.mock.calls[0];
      expect(to).toBe(ADDRESS);
      expect(content.text).toContain(SUPPORT_EMAIL);
    });

    it('answers 409 for a blocked account and mails nothing', async () => {
      const { service, steps, sendToUser } = setup({ isActive: false });

      await expect(service.block('user-1')).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(steps).toEqual(['lock user']);
      expect(sendToUser).not.toHaveBeenCalled();
    });
  });

  describe('unblock', () => {
    it('unblocks the account, keeps the rest, and mails a link to the sign-in page', async () => {
      const { service, steps, sendToUser } = setup({ isActive: false });

      const user = await service.unblock('user-1');

      expect(user).toMatchObject({ id: 'user-1', isActive: true });
      expect(steps).toEqual([
        'lock user',
        'set isActive true',
        'commit',
        `mail ${MailType.ACCOUNT_UNBLOCKED}`,
      ]);
      expect(sendToUser.mock.calls[0][2].text).toContain(
        `${FRONTEND_URL}/sign-in`,
      );
    });

    it('answers 409 for an active account', async () => {
      const { service, sendToUser } = setup({ isActive: true });

      await expect(service.unblock('user-1')).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(sendToUser).not.toHaveBeenCalled();
    });
  });

  describe('resetSessions', () => {
    it('ends the links and sessions of an active account without blocking it', async () => {
      const { service, steps, users } = setup({ isActive: true });

      const user = await service.resetSessions('user-1');

      expect(user).toMatchObject({ id: 'user-1', isActive: true });
      expect(users.update).not.toHaveBeenCalled();
      expect(steps).toEqual([
        'lock user',
        'delete unused links',
        'revoke sessions',
        'commit',
        `mail ${MailType.SESSIONS_RESET}`,
      ]);
    });

    it('answers 409 for a blocked account', async () => {
      const { service, sendToUser } = setup({ isActive: false });

      await expect(service.resetSessions('user-1')).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(sendToUser).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['block', (service: AccountAccessService) => service.block('user-1')],
    ['unblock', (service: AccountAccessService) => service.unblock('user-1')],
    [
      'resetSessions',
      (service: AccountAccessService) => service.resetSessions('user-1'),
    ],
  ])('%s answers 404 without an account', async (_name, action) => {
    const { service, sendToUser } = setup(null);

    await expect(action(service)).rejects.toBeInstanceOf(NotFoundException);

    expect(sendToUser).not.toHaveBeenCalled();
  });

  describe('the hook within the transaction', () => {
    it('runs after the lock and before the change, with the same manager', async () => {
      const { service, steps, manager } = setup({ isActive: true });
      const hook = vi.fn((_manager: unknown, user: User) => {
        steps.push(`hook sees isActive ${String(user.isActive)}`);
        return Promise.resolve();
      });

      await service.block('user-1', hook);

      expect(hook).toHaveBeenCalledWith(manager, expect.any(Object));
      expect(steps.slice(0, 3)).toEqual([
        'lock user',
        'hook sees isActive true',
        'set isActive false',
      ]);
    });

    it('stops the change and the mail when it throws', async () => {
      const { service, steps, sendToUser } = setup({ isActive: true });
      const refusal = new Error('refused');

      await expect(
        service.block('user-1', () => Promise.reject(refusal)),
      ).rejects.toBe(refusal);

      expect(steps).toEqual(['lock user']);
      expect(sendToUser).not.toHaveBeenCalled();
    });
  });
});
