import { Subscription } from '../../src/subscriptions/entities/subscription.entity.js';
import type { SubscriptionResponse } from '../../src/subscriptions/subscription.types.js';
import { createE2eApp, UNKNOWN_ID } from '../support/e2e-app.js';
import { subscriptionBody, subscriptionRequests } from './subscriptions-e2e.js';

// Dates far ahead, so the lifecycle job (which moves only past dates) never touches these rows.
const TRIAL_END = '2099-02-10';
const BILLING = '2099-02-20';

describe('Subscriptions — cancel and resume (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job) with a fake mail transport. Every row these tests create hangs off a
  // recognisable address and is removed at the end.
  const e2e = createE2eApp({ addressPrefix: 'e2e-subscriptions-actions-' });
  const { repository, signIn, twoAccounts } = e2e;
  const {
    postSubscription,
    cancelSubscription,
    resumeSubscription,
    getSubscriptions,
    getTotals,
  } = subscriptionRequests(e2e);

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

  const create = async (
    cookie: string,
    overrides: Record<string, unknown> = {},
  ): Promise<SubscriptionResponse> =>
    (
      await postSubscription(
        cookie,
        subscriptionBody({ nextBillingDate: BILLING, ...overrides }),
      ).expect(201)
    ).body as SubscriptionResponse;

  it('cancels an active subscription and keeps its dates', async () => {
    const { cookie } = await signIn();
    const created = await create(cookie);

    const cancelled = (await cancelSubscription(cookie, created.id).expect(200))
      .body as SubscriptionResponse;

    const expected = { ...created, status: 'cancelled_pending' };
    expect(cancelled).toEqual(expected);
    expect(await getSubscriptions(cookie)).toEqual([expected]);
  });

  it('cancels a trial so that it ends with the trial, without a payment', async () => {
    const { cookie } = await signIn();
    const created = await create(cookie, {
      status: 'trial',
      trialEndDate: TRIAL_END,
    });

    const cancelled = (await cancelSubscription(cookie, created.id).expect(200))
      .body as SubscriptionResponse;

    const expected = {
      ...created,
      status: 'cancelled_pending',
      trialEndDate: null,
      nextBillingDate: TRIAL_END,
    };
    expect(cancelled).toEqual(expected);
    expect(await getSubscriptions(cookie)).toEqual([expected]);
  });

  it('resumes a pending cancellation and keeps its dates', async () => {
    const { cookie } = await signIn();
    const created = await create(cookie, { status: 'cancelled_pending' });

    const resumed = (await resumeSubscription(cookie, created.id).expect(200))
      .body as SubscriptionResponse;

    const expected = { ...created, status: 'active' };
    expect(resumed).toEqual(expected);
    expect(await getSubscriptions(cookie)).toEqual([expected]);
  });

  it.each([
    ['cancel', 'cancelled'],
    ['cancel', 'cancelled_pending'],
    ['resume', 'active'],
    ['resume', 'trial'],
    ['resume', 'cancelled'],
  ])(
    'answers 409 to %s on a %s subscription and changes nothing',
    async (action, status) => {
      const { cookie } = await signIn();
      const created = await create(cookie, {
        status,
        ...(status === 'trial' ? { trialEndDate: TRIAL_END } : {}),
      });
      const stored = await repository(Subscription).findOneByOrFail({
        id: created.id,
      });
      const request =
        action === 'cancel' ? cancelSubscription : resumeSubscription;

      await request(cookie, created.id).expect(409);

      expect(
        await repository(Subscription).findOneByOrFail({ id: created.id }),
      ).toEqual(stored);
    },
  );

  it('answers 404 to an unknown id and 400 to an id that is not a UUID', async () => {
    const { cookie } = await signIn();

    await cancelSubscription(cookie, UNKNOWN_ID).expect(404);
    await resumeSubscription(cookie, UNKNOWN_ID).expect(404);
    await cancelSubscription(cookie, 'not-a-uuid').expect(400);
    await resumeSubscription(cookie, 'not-a-uuid').expect(400);
  });

  it('keeps a cancelled subscription in the totals until it is closed', async () => {
    const { cookie } = await signIn();
    const created = await create(cookie, { amount: 43 });
    const before = await getTotals(cookie);

    await cancelSubscription(cookie, created.id).expect(200);

    expect(before.monthly).toBe('43.00');
    expect(await getTotals(cookie)).toEqual(before);
  });

  // The two-account pattern (test plan §6.4), named in routes.e2e-spec.ts.
  it("lets no account cancel or resume another account's subscription", async () => {
    const { owner, other } = await twoAccounts();
    const active = await create(owner.cookie);
    const pending = await create(owner.cookie, {
      name: 'Spotify',
      status: 'cancelled_pending',
    });
    const storedActive = await repository(Subscription).findOneByOrFail({
      id: active.id,
    });
    const storedPending = await repository(Subscription).findOneByOrFail({
      id: pending.id,
    });

    await cancelSubscription(other.cookie, active.id).expect(404);
    await resumeSubscription(other.cookie, pending.id).expect(404);

    expect(
      await repository(Subscription).findOneByOrFail({ id: active.id }),
    ).toEqual(storedActive);
    expect(
      await repository(Subscription).findOneByOrFail({ id: pending.id }),
    ).toEqual(storedPending);
  });
});
