import { DEFAULT_CATEGORIES } from '../../src/subscriptions/default-categories.js';
import { CategorySetting } from '../../src/subscriptions/entities/category-setting.entity.js';
import { Category } from '../../src/subscriptions/entities/category.entity.js';
import { Subscription } from '../../src/subscriptions/entities/subscription.entity.js';
import type {
  CategoryResponse,
  SubscriptionResponse,
} from '../../src/subscriptions/subscription.types.js';
import { createE2eApp, UNKNOWN_ID } from '../support/e2e-app.js';
import {
  OTHER_CATEGORY_ID,
  subscriptionBody,
  subscriptionRequests,
} from './subscriptions-e2e.js';

// The two-account pattern (test plan §6.4): the owner creates a resource, the other account must
// not reach it. A new route by id adds its test here and names it in routes.e2e-spec.ts.
describe('Subscriptions — account isolation (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job) with a fake mail transport. Every row these tests create hangs off a
  // recognisable address and is removed at the end.
  const e2e = createE2eApp({ addressPrefix: 'e2e-subscriptions-isolation-' });
  const { repository, signIn, twoAccounts, userIdOf } = e2e;
  const {
    postSubscription,
    putSubscription,
    deleteSubscription,
    postCategory,
    patchCategory,
    deleteCategory,
    getSubscriptions,
    getCategories,
    getTotals,
  } = subscriptionRequests(e2e);

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

    it('sums the costs of each account from its own subscriptions only', async () => {
      const { owner, other } = await twoAccounts();
      const empty = await signIn();
      await postSubscription(
        owner.cookie,
        subscriptionBody({ amount: 43 }),
      ).expect(201);
      await postSubscription(
        other.cookie,
        subscriptionBody({ name: 'Spotify', amount: 19.99 }),
      ).expect(201);

      const otherTotals = await getTotals(other.cookie);
      // 1999 gr a month, 1999 × 12 = 23988 gr a year
      expect(otherTotals).toEqual({
        monthly: '19.99',
        yearly: '239.88',
        monthlyLimit: null,
        budgetAlert: 'none',
        categories: [
          {
            category: { id: OTHER_CATEGORY_ID, name: 'Inne', isDefault: true },
            monthly: '19.99',
            yearly: '239.88',
            subscriptionCount: 1,
            duplicateThreshold: 3,
            duplicateWarning: 'none',
            monthlyLimit: null,
            budgetAlert: 'none',
          },
        ],
      });
      expect(await getTotals(empty.cookie)).toEqual({
        monthly: '0.00',
        yearly: '0.00',
        monthlyLimit: null,
        budgetAlert: 'none',
        categories: [],
      });
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

    it("lets no account change or delete another account's subscription", async () => {
      const { owner, other } = await twoAccounts();
      const created = (
        await postSubscription(owner.cookie, subscriptionBody()).expect(201)
      ).body as SubscriptionResponse;
      const stored = await repository(Subscription).findOneByOrFail({
        id: created.id,
      });
      // A body that would pass for the other account's own subscription.
      const otherCategory = (
        await postCategory(other.cookie, 'Praca').expect(201)
      ).body as CategoryResponse;

      await putSubscription(
        other.cookie,
        created.id,
        subscriptionBody({
          name: 'Spotify',
          categoryId: otherCategory.id,
          amount: 19.99,
        }),
      ).expect(404);
      await deleteSubscription(other.cookie, created.id).expect(404);

      expect(await getSubscriptions(owner.cookie)).toEqual([created]);
      expect(
        await repository(Subscription).findOneByOrFail({ id: created.id }),
      ).toEqual(stored);
    });

    it("lets no account rename or delete another account's category", async () => {
      const { owner, other } = await twoAccounts();
      const category = (await postCategory(owner.cookie, 'Praca').expect(201))
        .body as CategoryResponse;
      const stored = await repository(Category).findOneByOrFail({
        id: category.id,
      });

      const renamed = await patchCategory(
        other.cookie,
        category.id,
        'Biuro',
      ).expect(404);
      const deleted = await deleteCategory(other.cookie, category.id).expect(
        404,
      );

      // The same answer as for an id no row has.
      expect(renamed.body).toMatchObject({ message: 'Category not found' });
      expect(deleted.body).toMatchObject({ message: 'Category not found' });
      expect(
        await repository(Category).findOneByOrFail({ id: category.id }),
      ).toEqual(stored);
      expect(
        await repository(CategorySetting).countBy({ categoryId: category.id }),
      ).toBe(1);
      expect(await getCategories(owner.cookie)).toContainEqual(category);
    });

    it("refuses an edit that moves a subscription into another account's category", async () => {
      const { owner, other } = await twoAccounts();
      const created = (
        await postSubscription(owner.cookie, subscriptionBody()).expect(201)
      ).body as SubscriptionResponse;
      const stored = await repository(Subscription).findOneByOrFail({
        id: created.id,
      });
      const otherCategory = (
        await postCategory(other.cookie, 'Praca').expect(201)
      ).body as CategoryResponse;

      await putSubscription(
        owner.cookie,
        created.id,
        subscriptionBody({ name: 'Spotify', categoryId: otherCategory.id }),
      ).expect(400);

      expect(await getSubscriptions(owner.cookie)).toEqual([created]);
      expect(
        await repository(Subscription).findOneByOrFail({ id: created.id }),
      ).toEqual(stored);
    });
  });
});
