import { MagicLinkToken } from '../../src/auth/entities/magic-link-token.entity.js';
import { Session } from '../../src/auth/entities/session.entity.js';
import { Category } from '../../src/subscriptions/entities/category.entity.js';
import { Subscription } from '../../src/subscriptions/entities/subscription.entity.js';
import type {
  CategoryResponse,
  SubscriptionResponse,
} from '../../src/subscriptions/subscription.types.js';
import { UserRole } from '../../src/users/entities/user-role.entity.js';
import { User } from '../../src/users/entities/user.entity.js';
import { createE2eApp } from '../support/e2e-app.js';
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
  const { postSubscription, postCategory, getSubscriptions } =
    subscriptionRequests(e2e);

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
