import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource, In, Like, type ObjectLiteral } from 'typeorm';
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

const ADDRESS_DOMAIN = '@subtracker.test';

export interface E2eAppOptions {
  // Every row a file creates hangs off addresses with this prefix (e.g. `e2e-subscriptions-`), so
  // the cleanup removes only that file's data.
  addressPrefix: string;
  // Extra modules for this file, e.g. DiscoveryModule to list the routes.
  imports?: ModuleMetadata['imports'];
}

export interface SignedIn {
  address: string;
  cookie: string;
}

interface Started {
  app: INestApplication<App>;
  dataSource: DataSource;
  env: EnvConfig;
}

// Boots AppModule like main.ts against the local dev database, with a fake mail transport: no
// real mail goes out. Call start() in beforeAll and close() in afterAll; the other members work
// in between.
export function createE2eApp({ addressPrefix, imports = [] }: E2eAppOptions) {
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
  async function latestToken(address: string): Promise<string> {
    let token: string | undefined;
    await vi.waitFor(() => {
      const mail = sent.findLast((message) => message.to === address);
      token =
        mail === undefined ? undefined : /#token=([\w-]+)/.exec(mail.text)?.[1];
      expect(token).toBeDefined();
    });
    return token as string;
  }

  function cookiePairOf(response: Response): string {
    const header = response.headers['set-cookie'] as unknown as
      string[] | undefined;
    if (header === undefined || header.length !== 1) {
      throw new Error('Expected exactly one Set-Cookie header');
    }
    return header[0].split(';')[0];
  }

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
  async function twoAccounts(): Promise<{
    owner: SignedIn;
    other: SignedIn;
  }> {
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

    const env = envFromConfig(
      moduleFixture.get<ConfigService<EnvConfig, true>>(ConfigService),
    );
    const app = moduleFixture.createNestApplication<INestApplication<App>>();
    // The production policy (CORS, CSRF, headers), so these tests cover what main.ts serves.
    applyHttpSecurity(app, env.CORS_ORIGINS);
    await app.init();
    started = { app, dataSource: app.get(DataSource), env };
    // Leftovers of a run that was killed before its cleanup.
    await removeTestData();
  }

  async function close(): Promise<void> {
    const { app } = current();
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
    signIn,
    twoAccounts,
    removeTestData,
  };
}

export type E2eApp = ReturnType<typeof createE2eApp>;
