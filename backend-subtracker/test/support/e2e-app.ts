import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request, { type Agent, type Response } from 'supertest';
import type { App } from 'supertest/types.js';
import {
  DataSource,
  In,
  Like,
  type ObjectLiteral,
  type Repository,
} from 'typeorm';
import { AppModule } from '../../src/app.module.js';
import { MagicLinkToken } from '../../src/auth/entities/magic-link-token.entity.js';
import { Session } from '../../src/auth/entities/session.entity.js';
import { type EnvConfig, envFromConfig } from '../../src/config/env.js';
import { applyHttpSecurity } from '../../src/config/http-security.js';
import { Mail } from '../../src/mail/entities/mail.entity.js';
import { MAIL_TRANSPORT } from '../../src/mail/mail.transport.js';
import type { MailMessage } from '../../src/mail/mail.types.js';
import { Category } from '../../src/subscriptions/entities/category.entity.js';
import { Subscription } from '../../src/subscriptions/entities/subscription.entity.js';
import { UserRole } from '../../src/users/entities/user-role.entity.js';
import { User } from '../../src/users/entities/user.entity.js';

export const ADDRESS_DOMAIN = '@subtracker.test';

// A moment long gone, e.g. to expire a session or a token.
export const PAST = new Date('2020-01-01T00:00:00.000Z');

// A well-formed id that no row has.
export const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

// The sign-in token from the link in a mail.
export function tokenIn(mail: MailMessage): string {
  const token = /#token=([\w-]+)/.exec(mail.text)?.[1];
  if (token === undefined) {
    throw new Error('The mail holds no token');
  }
  return token;
}

// The single Set-Cookie header of the response, with its attributes.
export function setCookieOf(response: Response): string {
  const header = response.headers['set-cookie'] as unknown as
    string[] | undefined;
  if (header === undefined || header.length !== 1) {
    throw new Error('Expected exactly one Set-Cookie header');
  }
  return header[0];
}

export interface E2eAppOptions {
  // Every row a file creates hangs off addresses with this prefix (e.g. `e2e-subscriptions-list-`), so
  // the cleanup removes only that file's data.
  addressPrefix: string;
  // Extra modules for this file, e.g. DiscoveryModule to list the routes.
  imports?: ModuleMetadata['imports'];
}

export interface SignedIn {
  address: string;
  cookie: string;
}

export interface TwoAccounts {
  owner: SignedIn;
  other: SignedIn;
}

// What an e2e file gets from createE2eApp. Members are function properties, so a spec can
// destructure them at describe level.
export interface E2eApp {
  // Boots the app and removes leftovers of this prefix; call in beforeAll. Refuses to run unless
  // MODE=DEV, and closes the app again when booting or the cleanup fails.
  start: () => Promise<void>;
  // Waits for the mail audit rows, removes this prefix's data and closes the app; call in afterAll.
  // Does nothing when the app is not started.
  close: () => Promise<void>;
  // The three below throw before start().
  readonly app: INestApplication<App>;
  readonly dataSource: DataSource;
  readonly env: EnvConfig;
  // Every mail the app tried to send, in order.
  readonly sent: MailMessage[];
  http: () => Agent;
  repository: <T extends ObjectLiteral>(entity: new () => T) => Repository<T>;
  newAddress: () => string;
  // The token from the latest mail sent to the address; waits for at least one mail.
  latestToken: (address: string) => Promise<string>;
  // `name=value` of the single Set-Cookie header.
  cookiePairOf: (response: Response) => string;
  // The id of the account with this address.
  userIdOf: (address: string) => Promise<string>;
  // A new account signed in through register → verify.
  signIn: () => Promise<SignedIn>;
  // Two signed-in accounts: the owner creates a resource, the other must not reach it.
  twoAccounts: () => Promise<TwoAccounts>;
  removeTestData: () => Promise<void>;
}

interface Started {
  app: INestApplication<App>;
  dataSource: DataSource;
  env: EnvConfig;
}

// Boots AppModule like main.ts against the database from .env (locally the dev database, in CI the
// C.UTF-8 database of the backend-e2e job), with a fake mail transport: no real mail goes out.
// Call start() in beforeAll and close() in afterAll; the other members work in between.
export function createE2eApp({
  addressPrefix,
  imports = [],
}: E2eAppOptions): E2eApp {
  const addressPattern = `${addressPrefix}%${ADDRESS_DOMAIN}`;
  const sent: MailMessage[] = [];
  let addressCounter = 0;
  let started: Started | undefined;

  function current(): Started {
    if (started === undefined) {
      throw new Error('The e2e app is not started; call start() in beforeAll');
    }
    return started;
  }

  const http = () => request(current().app.getHttpServer());
  const repository = <T extends ObjectLiteral>(entity: new () => T) =>
    current().dataSource.getRepository(entity);
  const newAddress = () =>
    `${addressPrefix}${Date.now()}-${++addressCounter}${ADDRESS_DOMAIN}`;

  // Subscriptions and categories first: they hang off the users. Session, token and role rows
  // block deleting a user (ON DELETE NO ACTION).
  async function removeTestData(): Promise<void> {
    const users = await repository(User).findBy({
      email: Like(addressPattern),
    });
    const userIds = In(users.map((user) => user.id));
    await repository(Subscription).delete({ userId: userIds });
    await repository(Category).delete({ userId: userIds });
    await repository(Session).delete({ userId: userIds });
    await repository(MagicLinkToken).delete({ userId: userIds });
    await repository(UserRole).delete({ userId: userIds });
    await repository(User).delete({ id: userIds });
    await repository(Mail).delete({ recipient: Like(addressPattern) });
  }

  // The token from the latest mail sent to the address. Mail goes out after the response.
  function latestToken(address: string): Promise<string> {
    return vi.waitFor(() => {
      const mail = sent.findLast((message) => message.to === address);
      if (mail === undefined) {
        throw new Error(`No mail sent to ${address} yet`);
      }
      return tokenIn(mail);
    });
  }

  const cookiePairOf = (response: Response) =>
    setCookieOf(response).split(';')[0];

  const userIdOf = async (address: string) =>
    (await repository(User).findOneByOrFail({ email: address })).id;

  // A new account signed in through the real register → verify flow.
  async function signIn(): Promise<SignedIn> {
    const address = newAddress();
    await http()
      .post('/auth/register')
      .send({
        email: address,
        confirmedAdult: true,
        acceptedPrivacyPolicy: true,
      })
      .expect(202);
    const verified = await http()
      .post('/auth/verify')
      .send({ token: await latestToken(address) })
      .expect(200);
    return { address, cookie: cookiePairOf(verified) };
  }

  // The owner creates a resource, the other account must not reach it.
  async function twoAccounts(): Promise<TwoAccounts> {
    return { owner: await signIn(), other: await signIn() };
  }

  async function start(): Promise<void> {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule, ...imports],
    })
      .overrideProvider(MAIL_TRANSPORT)
      .useValue({
        send: (message: MailMessage) => {
          sent.push(message);
          return Promise.resolve();
        },
      })
      .compile();

    let app: INestApplication<App> | undefined;
    try {
      const env = envFromConfig(
        moduleFixture.get<ConfigService<EnvConfig, true>>(ConfigService),
      );
      // The tests create accounts and delete rows by prefix, so never outside the DEV setup.
      if (env.MODE !== 'DEV') {
        throw new Error(
          `e2e tests run only against the DEV database from .env: MODE is ${env.MODE}, expected DEV`,
        );
      }
      app = moduleFixture.createNestApplication<INestApplication<App>>();
      // The production policy (CORS, CSRF, headers), so these tests cover what main.ts serves.
      applyHttpSecurity(app, env.CORS_ORIGINS);
      await app.init();
      started = { app, dataSource: app.get(DataSource), env };
      // Leftovers of a run that was killed before its cleanup.
      await removeTestData();
    } catch (error) {
      started = undefined;
      // A failure while closing must not hide the first error.
      await (app ?? moduleFixture).close().catch(() => undefined);
      throw error;
    }
  }

  async function close(): Promise<void> {
    if (started === undefined) {
      return;
    }
    const { app } = started;
    try {
      // Audit rows are written after the transport finishes.
      await vi.waitFor(
        async () => {
          expect(
            await repository(Mail).countBy({ recipient: Like(addressPattern) }),
          ).toBe(sent.length);
        },
        { timeout: 5000 },
      );
    } finally {
      try {
        await removeTestData();
      } finally {
        await app.close();
        started = undefined;
      }
    }
  }

  return {
    start,
    close,
    get app() {
      return current().app;
    },
    get dataSource() {
      return current().dataSource;
    },
    get env() {
      return current().env;
    },
    sent,
    http,
    repository,
    newAddress,
    latestToken,
    cookiePairOf,
    userIdOf,
    signIn,
    twoAccounts,
    removeTestData,
  };
}
