import { DEFAULT_CATEGORIES } from '../../src/subscriptions/default-categories.js';
import type { CategoryResponse } from '../../src/subscriptions/subscription.types.js';
import { createE2eApp, UNKNOWN_ID } from '../support/e2e-app.js';
import { subscriptionBody, subscriptionRequests } from './subscriptions-e2e.js';

// The two-account pattern (test plan §6.4): the owner creates a resource, the other account must
// not reach it. A new route by id adds its test here and names it in routes.e2e-spec.ts.
describe('Subscriptions — account isolation (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job) with a fake mail transport. Every row these tests create hangs off a
  // recognisable address and is removed at the end.
  const e2e = createE2eApp({ addressPrefix: 'e2e-subscriptions-isolation-' });
  const { twoAccounts, userIdOf } = e2e;
  const { postSubscription, postCategory, getSubscriptions, getCategories } =
    subscriptionRequests(e2e);

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

  describe('account isolation', () => {
    it('keeps the subscriptions and own categories of one user from another', async () => {
      const { owner, other } = await twoAccounts();
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
      const { owner, other } = await twoAccounts();

      await postSubscription(
        owner.cookie,
        subscriptionBody({
          categoryId: UNKNOWN_ID,
        }),
      ).expect(400);
      await postSubscription(
        owner.cookie,
        subscriptionBody({ userId: await userIdOf(other.address) }),
      ).expect(400);
      expect(await getSubscriptions(other.cookie)).toEqual([]);
    });
  });
});
