import { DEFAULT_CATEGORIES } from '../../src/subscriptions/default-categories.js';
import type {
  CategoryResponse,
  SubscriptionResponse,
} from '../../src/subscriptions/subscription.types.js';
import { createE2eApp } from '../support/e2e-app.js';
import { subscriptionBody, subscriptionRequests } from './subscriptions-e2e.js';

const STREAMING: CategoryResponse = {
  id: DEFAULT_CATEGORIES[0].id,
  name: 'Streaming',
  isDefault: true,
};

describe('Subscriptions — cost totals (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job) with a fake mail transport. Every row these tests create hangs off a
  // recognisable address and is removed at the end.
  const e2e = createE2eApp({ addressPrefix: 'e2e-subscriptions-totals-' });
  const { signIn } = e2e;
  const { postSubscription, putSubscription, postCategory, getTotals } =
    subscriptionRequests(e2e);

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

  // The example from the mockup, one subscription in each status. Worked out by hand:
  // - active 43.00 a month (Streaming): 4300 gr a month, 51600 gr a year;
  // - trial 23.99 a month (Muzyka): 2399 gr a month, 28788 gr a year;
  // - cancelled_pending 429.99 a year (Praca): 42999 / 12 = 3583.25 → 3583 gr a month, 42999 gr a
  //   year;
  // - cancelled 50.00 a month (Streaming): not counted.
  // Monthly 4300 + 2399 + 3583 = 10282 gr, yearly 51600 + 28788 + 42999 = 123387 gr.
  it('sums the counted subscriptions of the account by category', async () => {
    const { cookie } = await signIn();
    const muzyka = (await postCategory(cookie, 'Muzyka').expect(201))
      .body as CategoryResponse;
    const praca = (await postCategory(cookie, 'Praca').expect(201))
      .body as CategoryResponse;
    await postSubscription(
      cookie,
      subscriptionBody({
        name: 'Netflix',
        categoryId: STREAMING.id,
        amount: 43,
      }),
    ).expect(201);
    await postSubscription(
      cookie,
      subscriptionBody({
        name: 'Spotify',
        categoryId: muzyka.id,
        amount: 23.99,
        status: 'trial',
        trialEndDate: '2026-11-20',
        nextBillingDate: '2026-11-20',
      }),
    ).expect(201);
    const pending = (
      await postSubscription(
        cookie,
        subscriptionBody({
          name: 'Slack',
          categoryId: praca.id,
          amount: 429.99,
          billingCycle: 'yearly',
          status: 'cancelled_pending',
        }),
      ).expect(201)
    ).body as SubscriptionResponse;
    await postSubscription(
      cookie,
      subscriptionBody({
        name: 'HBO Max',
        categoryId: STREAMING.id,
        amount: 50,
        status: 'cancelled',
      }),
    ).expect(201);

    expect(await getTotals(cookie)).toEqual({
      monthly: '102.82',
      yearly: '1233.87',
      categories: [
        {
          category: STREAMING,
          monthly: '43.00',
          yearly: '516.00',
          subscriptionCount: 1,
        },
        {
          category: praca,
          monthly: '35.83',
          yearly: '429.99',
          subscriptionCount: 1,
        },
        {
          category: muzyka,
          monthly: '23.99',
          yearly: '287.88',
          subscriptionCount: 1,
        },
      ],
    });

    // Cancelled now: Praca leaves the categories and its amount the sums.
    await putSubscription(
      cookie,
      pending.id,
      subscriptionBody({
        name: 'Slack',
        categoryId: praca.id,
        amount: 429.99,
        billingCycle: 'yearly',
        status: 'cancelled',
      }),
    ).expect(200);

    // Monthly 4300 + 2399 = 6699 gr, yearly 51600 + 28788 = 80388 gr.
    expect(await getTotals(cookie)).toEqual({
      monthly: '66.99',
      yearly: '803.88',
      categories: [
        {
          category: STREAMING,
          monthly: '43.00',
          yearly: '516.00',
          subscriptionCount: 1,
        },
        {
          category: muzyka,
          monthly: '23.99',
          yearly: '287.88',
          subscriptionCount: 1,
        },
      ],
    });
  });
});
