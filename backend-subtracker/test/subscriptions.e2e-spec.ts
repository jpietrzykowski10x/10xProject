import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { App } from 'supertest/types.js';
import { DataSource, In, Like, type ObjectLiteral } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { MagicLinkToken } from './../src/auth/entities/magic-link-token.entity.js';
import { Session } from './../src/auth/entities/session.entity.js';
import { type EnvConfig, envFromConfig } from './../src/config/env.js';
import { applyHttpSecurity } from './../src/config/http-security.js';
import { Mail } from './../src/mail/entities/mail.entity.js';
import { MAIL_TRANSPORT } from './../src/mail/mail.transport.js';
import type { MailMessage } from './../src/mail/mail.types.js';
import { DEFAULT_CATEGORIES } from './../src/subscriptions/default-categories.js';
import {
  Category,
  CATEGORY_OWNER_NAME_INDEX,
} from './../src/subscriptions/entities/category.entity.js';
import { Subscription } from './../src/subscriptions/entities/subscription.entity.js';
import type {
  CategoryResponse,
  SubscriptionResponse,
} from './../src/subscriptions/subscription.types.js';
import { UserRole } from './../src/users/entities/user-role.entity.js';
import { User } from './../src/users/entities/user.entity.js';

// Runs against the local dev database with a fake mail transport. Every row these tests create
// hangs off a recognisable address and is removed at the end.
const ADDRESS_PREFIX = 'e2e-subscriptions-';
const ADDRESS_DOMAIN = '@subtracker.test';
const ADDRESS_PATTERN = `${ADDRESS_PREFIX}%${ADDRESS_DOMAIN}`;
const OTHER_CATEGORY_ID = DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1].id;

interface SignedIn {
  address: string;
  cookie: string;
}

describe('Subscriptions (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  const sent: MailMessage[] = [];
  let addressCounter = 0;

  const http = () => request(app.getHttpServer());
  const newAddress = () =>
    `${ADDRESS_PREFIX}${Date.now()}-${++addressCounter}${ADDRESS_DOMAIN}`;
  const repository = <T extends ObjectLiteral>(entity: new () => T) =>
    dataSource.getRepository(entity);

  // Subscriptions and categories first: they hang off the users. Session, token and role rows
  // block deleting a user (ON DELETE NO ACTION).
  async function removeUserRows(userIds: string[]): Promise<void> {
    const ids = In(userIds);
    await repository(Subscription).delete({ userId: ids });
    await repository(Category).delete({ userId: ids });
    await repository(Session).delete({ userId: ids });
    await repository(MagicLinkToken).delete({ userId: ids });
    await repository(UserRole).delete({ userId: ids });
    await repository(User).delete({ id: ids });
  }

  async function removeTestData(): Promise<void> {
    const users = await repository(User).findBy({
      email: Like(ADDRESS_PATTERN),
    });
    await removeUserRows(users.map((user) => user.id));
    await repository(Mail).delete({ recipient: Like(ADDRESS_PATTERN) });
  }

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

  const userIdOf = async (address: string) =>
    (await repository(User).findOneByOrFail({ email: address })).id;

  const subscriptionBody = (overrides: Record<string, unknown> = {}) => ({
    name: 'Netflix',
    categoryId: OTHER_CATEGORY_ID,
    amount: 43,
    billingCycle: 'monthly',
    paymentMethod: 'credit_card',
    status: 'active',
    nextBillingDate: '2026-11-15',
    ...overrides,
  });

  const postSubscription = (cookie: string, body: Record<string, unknown>) =>
    http().post('/subscriptions').set('Cookie', cookie).send(body);

  const postCategory = (cookie: string, name: string) =>
    http().post('/categories').set('Cookie', cookie).send({ name });

  const getSubscriptions = async (cookie: string) =>
    (
      await http()
        .get('/subscriptions')
        .set('Cookie', cookie)
        .expect(200)
        .expect('Cache-Control', 'no-store')
    ).body as SubscriptionResponse[];

  const getCategories = async (cookie: string) =>
    (
      await http()
        .get('/categories')
        .set('Cookie', cookie)
        .expect(200)
        .expect('Cache-Control', 'no-store')
    ).body as CategoryResponse[];

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
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
    app = moduleFixture.createNestApplication();
    // The production policy (CORS, CSRF, headers), so these tests cover what main.ts serves.
    applyHttpSecurity(app, env.CORS_ORIGINS);
    await app.init();
    dataSource = app.get(DataSource);
    // Leftovers of a run that was killed before its cleanup.
    await removeTestData();
  });

  afterAll(async () => {
    try {
      // Audit rows are written after the transport finishes.
      await vi.waitFor(
        async () => {
          expect(
            await repository(Mail).countBy({
              recipient: Like(ADDRESS_PATTERN),
            }),
          ).toBe(sent.length);
        },
        { timeout: 5000 },
      );
    } finally {
      await removeTestData();
      await app.close();
    }
  });

  it('answers 401 on every route without a session', async () => {
    await http().get('/categories').expect(401);
    await http().post('/categories').send({ name: 'Praca' }).expect(401);
    await http().get('/subscriptions').expect(401);
    await http().post('/subscriptions').send(subscriptionBody()).expect(401);
  });

  it('adds a subscription and lists it with the amount as a string', async () => {
    const { cookie } = await signIn();

    const created = await postSubscription(
      cookie,
      subscriptionBody({ name: '  Netflix  ' }),
    ).expect(201);

    const expected = {
      id: expect.any(String) as string,
      name: 'Netflix',
      category: { id: OTHER_CATEGORY_ID, name: 'Inne', isDefault: true },
      amount: '43.00',
      billingCycle: 'monthly',
      paymentMethod: 'credit_card',
      status: 'active',
      trialEndDate: null,
      nextBillingDate: '2026-11-15',
      createdAt: expect.any(String) as string,
    };
    expect(created.body).toEqual(expected);
    expect(await getSubscriptions(cookie)).toEqual([created.body]);
  });

  it('stores a trial with its end date', async () => {
    const { cookie } = await signIn();

    const created = await postSubscription(
      cookie,
      subscriptionBody({
        status: 'trial',
        trialEndDate: '2026-11-20',
        nextBillingDate: '2026-11-20',
        amount: 29.99,
        billingCycle: 'yearly',
      }),
    ).expect(201);

    expect(created.body).toMatchObject({
      status: 'trial',
      trialEndDate: '2026-11-20',
      nextBillingDate: '2026-11-20',
      amount: '29.99',
      billingCycle: 'yearly',
    });
  });

  describe('account isolation', () => {
    it('keeps the subscriptions and own categories of one user from another', async () => {
      const owner = await signIn();
      const other = await signIn();
      const category = (await postCategory(owner.cookie, 'Praca').expect(201))
        .body as CategoryResponse;
      await postSubscription(
        owner.cookie,
        subscriptionBody({ categoryId: category.id }),
      ).expect(201);

      expect(await getSubscriptions(other.cookie)).toEqual([]);
      const categories = await getCategories(other.cookie);
      expect(categories.map((row) => row.id)).not.toContain(category.id);
      expect(categories).toHaveLength(DEFAULT_CATEGORIES.length);

      await postSubscription(
        other.cookie,
        subscriptionBody({ categoryId: category.id }),
      ).expect(400);
      // The same name is free for another account.
      await postCategory(other.cookie, 'Praca').expect(201);
    });

    it('refuses an unknown category and a userId in the body', async () => {
      const owner = await signIn();
      const other = await signIn();

      await postSubscription(
        owner.cookie,
        subscriptionBody({
          categoryId: '00000000-0000-4000-8000-000000000000',
        }),
      ).expect(400);
      await postSubscription(
        owner.cookie,
        subscriptionBody({ userId: await userIdOf(other.address) }),
      ).expect(400);
      expect(await getSubscriptions(other.cookie)).toEqual([]);
    });
  });

  describe('validation', () => {
    it.each([
      ['a trial without its end date', { status: 'trial' }],
      [
        'a trial end date on an active subscription',
        { status: 'active', trialEndDate: '2026-11-10' },
      ],
      [
        'a payment before the trial ends',
        {
          status: 'trial',
          trialEndDate: '2026-11-20',
          nextBillingDate: '2026-11-19',
        },
      ],
      ['a negative amount', { amount: -1 }],
      ['an amount above the limit', { amount: 100000 }],
      ['an amount with three decimals', { amount: 1.234 }],
      ['an empty name', { name: '   ' }],
      ['a date that does not exist', { nextBillingDate: '2026-02-31' }],
    ])('refuses %s', async (_case, overrides) => {
      const { cookie } = await signIn();

      await postSubscription(cookie, subscriptionBody(overrides)).expect(400);

      expect(await getSubscriptions(cookie)).toEqual([]);
    });

    it('accepts a zero amount', async () => {
      const { cookie } = await signIn();

      const created = await postSubscription(
        cookie,
        subscriptionBody({ amount: 0 }),
      ).expect(201);

      expect((created.body as SubscriptionResponse).amount).toBe('0.00');
    });
  });

  describe('categories', () => {
    it('lists the defaults in their order, then own categories alphabetically', async () => {
      const { cookie } = await signIn();
      await postCategory(cookie, 'Zwierzęta').expect(201);
      await postCategory(cookie, 'Auto').expect(201);

      const categories = await getCategories(cookie);

      expect(categories).toEqual([
        ...DEFAULT_CATEGORIES.map(({ id, name }) => ({
          id,
          name,
          isDefault: true,
        })),
        { id: expect.any(String) as string, name: 'Auto', isDefault: false },
        {
          id: expect.any(String) as string,
          name: 'Zwierzęta',
          isDefault: false,
        },
      ]);
    });

    it('adds a trimmed own category and refuses a name taken in any case', async () => {
      const { cookie } = await signIn();

      const created = await postCategory(cookie, '  Praca ').expect(201);

      expect(created.body).toEqual({
        id: expect.any(String) as string,
        name: 'Praca',
        isDefault: false,
      });
      await postCategory(cookie, 'PRACA').expect(409);
      await postCategory(cookie, 'inne').expect(409);
      await postCategory(cookie, 'INNE').expect(409);
      // Polish capitals fold in the application, whatever the database locale.
      await postCategory(cookie, 'Ślub').expect(201);
      await postCategory(cookie, 'ślub').expect(409);
      await postCategory(cookie, 'ŚLUB').expect(409);
      await postCategory(cookie, '').expect(400);
      await postCategory(cookie, 'a'.repeat(51)).expect(400);
    });

    it('creates one category when two identical requests race', async () => {
      const { address, cookie } = await signIn();

      const responses = await Promise.all([
        postCategory(cookie, 'Netto'),
        postCategory(cookie, 'netto'),
      ]);

      const statuses = responses.map((response) => response.status);
      expect(statuses.sort((a, b) => a - b)).toEqual([201, 409]);
      expect(
        await repository(Category).countBy({
          userId: await userIdOf(address),
        }),
      ).toBe(1);
    });

    it('lets the database refuse a duplicate the lookup did not see', async () => {
      const { address } = await signIn();
      const userId = await userIdOf(address);
      await repository(Category).insert({
        userId,
        name: 'Żółw',
        nameKey: 'żółw',
      });

      // The constraint name is what CategoriesService maps to 409.
      await expect(
        repository(Category).insert({ userId, name: 'ŻÓŁW', nameKey: 'żółw' }),
      ).rejects.toMatchObject({
        driverError: { code: '23505', constraint: CATEGORY_OWNER_NAME_INDEX },
      });
    });
  });

  it('lists running subscriptions first by the date that matters next, then ending, then ended', async () => {
    const { cookie } = await signIn();
    const add = async (overrides: Record<string, unknown>) =>
      (
        (
          await postSubscription(cookie, subscriptionBody(overrides)).expect(
            201,
          )
        ).body as SubscriptionResponse
      ).name;

    // Added in an order that matches none of the expected rules.
    await add({
      name: 'Delta',
      status: 'cancelled',
      nextBillingDate: '2026-01-01',
    });
    await add({
      name: 'Celka',
      status: 'cancelled_pending',
      nextBillingDate: '2026-11-15',
    });
    await add({
      name: 'Beta',
      status: 'active',
      nextBillingDate: '2026-12-01',
    });
    // Ends its trial the day Beta bills, but pays later: the trial end counts, and the tie goes
    // to the name without case ("alfa" before "Beta").
    await add({
      name: 'alfa',
      status: 'trial',
      trialEndDate: '2026-12-01',
      nextBillingDate: '2026-12-31',
    });

    const names = (await getSubscriptions(cookie)).map((row) => row.name);

    expect(names).toEqual(['alfa', 'Beta', 'Celka', 'Delta']);
  });

  it('breaks a tie on the date by the name in Polish order', async () => {
    const { cookie } = await signIn();
    // Code-point order (a C.UTF-8 database) would put "Ślub" after "Zoo".
    for (const name of ['Zoo', 'Ślub', 'słoń', 'Sad']) {
      await postSubscription(cookie, subscriptionBody({ name })).expect(201);
    }

    const names = (await getSubscriptions(cookie)).map((row) => row.name);

    expect(names).toEqual(['Sad', 'słoń', 'Ślub', 'Zoo']);
  });

  it('removes the subscriptions and own categories of a deleted user', async () => {
    const { address, cookie } = await signIn();
    const category = (await postCategory(cookie, 'Praca').expect(201))
      .body as CategoryResponse;
    await postSubscription(
      cookie,
      subscriptionBody({ categoryId: category.id }),
    ).expect(201);
    await postSubscription(cookie, subscriptionBody()).expect(201);
    const userId = await userIdOf(address);

    // Session, token and role rows still block the delete (ON DELETE NO ACTION).
    await repository(Session).delete({ userId });
    await repository(MagicLinkToken).delete({ userId });
    await repository(UserRole).delete({ userId });
    await repository(User).delete({ id: userId });

    expect(await repository(Subscription).countBy({ userId })).toBe(0);
    expect(await repository(Category).countBy({ userId })).toBe(0);
    expect(await repository(Category).countBy({ id: OTHER_CATEGORY_ID })).toBe(
      1,
    );
  });
});
