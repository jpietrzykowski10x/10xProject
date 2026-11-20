import { MagicLinkToken } from '../../src/auth/entities/magic-link-token.entity.js';
import { Session } from '../../src/auth/entities/session.entity.js';
import { DEFAULT_CATEGORIES } from '../../src/subscriptions/default-categories.js';
import { Category } from '../../src/subscriptions/entities/category.entity.js';
import { Subscription } from '../../src/subscriptions/entities/subscription.entity.js';
import type {
  CategoryResponse,
  SubscriptionResponse,
} from '../../src/subscriptions/subscription.types.js';
import { UserRole } from '../../src/users/entities/user-role.entity.js';
import { User } from '../../src/users/entities/user.entity.js';
import { createE2eApp, UNKNOWN_ID } from '../support/e2e-app.js';
import {
  OTHER_CATEGORY_ID,
  subscriptionBody,
  subscriptionRequests,
} from './subscriptions-e2e.js';

describe('Subscriptions — list (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job) with a fake mail transport. Every row these tests create hangs off a
  // recognisable address and is removed at the end.
  const e2e = createE2eApp({ addressPrefix: 'e2e-subscriptions-list-' });
  const { repository, signIn, userIdOf } = e2e;
  const {
    postSubscription,
    putSubscription,
    deleteSubscription,
    postCategory,
    getSubscriptions,
  } = subscriptionRequests(e2e);

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

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

    // Since S-10 session, token and role rows cascade with the user too; removing them first
    // keeps this test about the subscription and category cascade alone.
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

  describe('edit and delete', () => {
    const add = async (cookie: string, overrides = {}) =>
      (await postSubscription(cookie, subscriptionBody(overrides)).expect(201))
        .body as SubscriptionResponse;

    it('replaces every field and keeps the creation time', async () => {
      const { cookie } = await signIn();
      const created = await add(cookie);

      const updated = await putSubscription(cookie, created.id, {
        name: '  Spotify  ',
        categoryId: DEFAULT_CATEGORIES[0].id,
        amount: 19.9,
        billingCycle: 'yearly',
        paymentMethod: 'blik',
        status: 'cancelled_pending',
        nextBillingDate: '2027-01-31',
      }).expect(200);

      const expected = {
        id: created.id,
        name: 'Spotify',
        category: { ...DEFAULT_CATEGORIES[0], isDefault: true },
        amount: '19.90',
        billingCycle: 'yearly',
        paymentMethod: 'blik',
        status: 'cancelled_pending',
        trialEndDate: null,
        nextBillingDate: '2027-01-31',
        createdAt: created.createdAt,
      };
      expect(updated.body).toEqual(expected);
      expect(await getSubscriptions(cookie)).toEqual([expected]);
    });

    it('clears the trial end date when a trial becomes active', async () => {
      const { cookie } = await signIn();
      const created = await add(cookie, {
        status: 'trial',
        trialEndDate: '2026-11-20',
        nextBillingDate: '2026-11-20',
      });

      await putSubscription(
        cookie,
        created.id,
        subscriptionBody({ status: 'active' }),
      ).expect(200);

      const [listed] = await getSubscriptions(cookie);
      expect(listed).toMatchObject({ status: 'active', trialEndDate: null });
    });

    it('needs the trial end date when an active subscription becomes a trial', async () => {
      const { cookie } = await signIn();
      const created = await add(cookie);

      await putSubscription(
        cookie,
        created.id,
        subscriptionBody({ status: 'trial' }),
      ).expect(400);
      const updated = await putSubscription(
        cookie,
        created.id,
        subscriptionBody({
          status: 'trial',
          trialEndDate: '2026-11-10',
          nextBillingDate: '2026-11-15',
        }),
      ).expect(200);

      expect(updated.body).toMatchObject({
        status: 'trial',
        trialEndDate: '2026-11-10',
      });
    });

    it('moves a subscription to an own category of the user', async () => {
      const { cookie } = await signIn();
      const created = await add(cookie);
      const category = (await postCategory(cookie, 'Praca').expect(201))
        .body as CategoryResponse;

      const updated = await putSubscription(
        cookie,
        created.id,
        subscriptionBody({ categoryId: category.id }),
      ).expect(200);

      expect((updated.body as SubscriptionResponse).category).toEqual(category);
    });

    it('refuses an invalid body and keeps the subscription', async () => {
      const { cookie } = await signIn();
      const created = await add(cookie);

      await putSubscription(
        cookie,
        created.id,
        subscriptionBody({ amount: -1 }),
      ).expect(400);

      expect(await getSubscriptions(cookie)).toEqual([created]);
    });

    it('answers 400 for an id that is not a UUID and 404 for an unknown one', async () => {
      const { cookie } = await signIn();

      await putSubscription(cookie, 'not-a-uuid', subscriptionBody()).expect(
        400,
      );
      await deleteSubscription(cookie, 'not-a-uuid').expect(400);
      await putSubscription(cookie, UNKNOWN_ID, subscriptionBody()).expect(404);
      await deleteSubscription(cookie, UNKNOWN_ID).expect(404);
    });

    it('deletes a subscription once and leaves the rest alone', async () => {
      const { cookie } = await signIn();
      const category = (await postCategory(cookie, 'Praca').expect(201))
        .body as CategoryResponse;
      const removed = await add(cookie, { categoryId: category.id });
      const kept = await add(cookie, { name: 'Spotify' });

      const response = await deleteSubscription(cookie, removed.id).expect(204);

      expect(response.text).toBe('');
      expect(await getSubscriptions(cookie)).toEqual([kept]);
      expect(await repository(Subscription).countBy({ id: removed.id })).toBe(
        0,
      );
      expect(await repository(Category).countBy({ id: category.id })).toBe(1);
      await deleteSubscription(cookie, removed.id).expect(404);
    });
  });
});
