import { EntityManager } from 'typeorm';
import { DEFAULT_CATEGORIES } from '../../src/subscriptions/default-categories.js';
import {
  CATEGORY_SETTING_CATEGORY_FK,
  CategorySetting,
} from '../../src/subscriptions/entities/category-setting.entity.js';
import {
  Category,
  CATEGORY_OWNER_NAME_INDEX,
} from '../../src/subscriptions/entities/category.entity.js';
import {
  Subscription,
  SUBSCRIPTION_CATEGORY_FK,
} from '../../src/subscriptions/entities/subscription.entity.js';
import { CategoriesService } from '../../src/subscriptions/services/categories.service.js';
import {
  BillingCycle,
  type CategoryResponse,
  PaymentMethod,
  type SubscriptionResponse,
  SubscriptionStatus,
} from '../../src/subscriptions/subscription.types.js';
import { createE2eApp, UNKNOWN_ID } from '../support/e2e-app.js';
import {
  OTHER_CATEGORY_ID,
  subscriptionBody,
  subscriptionRequests,
} from './subscriptions-e2e.js';

describe('Subscriptions — categories (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job) with a fake mail transport. Every row these tests create hangs off a
  // recognisable address and is removed at the end.
  const e2e = createE2eApp({ addressPrefix: 'e2e-subscriptions-categories-' });
  const { repository, signIn, userIdOf } = e2e;
  const {
    postCategory,
    patchCategory,
    deleteCategory,
    getCategories,
    postSubscription,
    putSubscription,
    getSubscriptions,
    getBudget,
    putBudget,
  } = subscriptionRequests(e2e);

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

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

  describe('rename', () => {
    it('renames an own category and keeps the own ones in Polish alphabetical order', async () => {
      const { cookie } = await signIn();
      const auto = (await postCategory(cookie, 'Auto').expect(201))
        .body as CategoryResponse;
      await postCategory(cookie, 'Dom').expect(201);

      const renamed = await patchCategory(
        cookie,
        auto.id,
        '  Ćwiczenia ',
      ).expect(200);

      expect(renamed.body).toEqual({
        id: auto.id,
        name: 'Ćwiczenia',
        isDefault: false,
      });
      const own = (await getCategories(cookie)).filter(
        (category) => !category.isDefault,
      );
      expect(own).toEqual([
        { id: auto.id, name: 'Ćwiczenia', isDefault: false },
        { id: expect.any(String) as string, name: 'Dom', isDefault: false },
      ]);
    });

    it('lets a category change only the case of its name', async () => {
      const { cookie } = await signIn();
      const praca = (await postCategory(cookie, 'praca').expect(201))
        .body as CategoryResponse;

      await patchCategory(cookie, praca.id, 'Praca').expect(200);

      expect(
        (await getCategories(cookie)).find(({ id }) => id === praca.id),
      ).toEqual({ id: praca.id, name: 'Praca', isDefault: false });
    });

    it('refuses the name of another own category or a default, whatever the case', async () => {
      const { cookie } = await signIn();
      const praca = (await postCategory(cookie, 'Praca').expect(201))
        .body as CategoryResponse;
      await postCategory(cookie, 'Ślub').expect(201);

      await patchCategory(cookie, praca.id, 'ŚLUB').expect(409);
      await patchCategory(cookie, praca.id, 'ślub').expect(409);
      await patchCategory(cookie, praca.id, 'Inne').expect(409);
      await patchCategory(cookie, praca.id, 'INNE').expect(409);

      expect(
        (await getCategories(cookie)).find(({ id }) => id === praca.id)?.name,
      ).toBe('Praca');
    });

    it('answers 404 for a default and an unknown category, 400 for a bad id or name', async () => {
      const { cookie } = await signIn();
      const praca = (await postCategory(cookie, 'Praca').expect(201))
        .body as CategoryResponse;

      const missing = await patchCategory(
        cookie,
        OTHER_CATEGORY_ID,
        'Nowa nazwa',
      ).expect(404);
      expect(missing.body).toMatchObject({ message: 'Category not found' });
      await patchCategory(cookie, UNKNOWN_ID, 'Nowa nazwa').expect(404);
      await patchCategory(cookie, 'not-a-uuid', 'Nowa nazwa').expect(400);
      await patchCategory(cookie, praca.id, '').expect(400);
      await patchCategory(cookie, praca.id, '   ').expect(400);
      await patchCategory(cookie, praca.id, 'a'.repeat(51)).expect(400);
      await patchCategory(cookie, praca.id, 'a'.repeat(50)).expect(200);

      const defaults = (await getCategories(cookie)).filter(
        ({ isDefault }) => isDefault,
      );
      expect(defaults.map(({ id, name }) => ({ id, name }))).toEqual(
        DEFAULT_CATEGORIES.map(({ id, name }) => ({ id, name })),
      );
    });

    it('keeps the threshold and the limit of the renamed category', async () => {
      const { cookie } = await signIn();
      const praca = (await postCategory(cookie, 'Praca').expect(201))
        .body as CategoryResponse;
      await putBudget(cookie, {
        categories: [
          { categoryId: praca.id, duplicateThreshold: 5, monthlyLimit: 100 },
        ],
      }).expect(200);

      await patchCategory(cookie, praca.id, 'Biuro').expect(200);

      expect(
        (await getBudget(cookie)).categories.find(
          ({ category }) => category.id === praca.id,
        ),
      ).toEqual({
        category: { id: praca.id, name: 'Biuro', isDefault: false },
        duplicateThreshold: 5,
        monthlyLimit: '100.00',
      });
    });
  });

  describe('delete', () => {
    it('deletes an empty own category together with its settings row', async () => {
      const { cookie } = await signIn();
      const praca = (await postCategory(cookie, 'Praca').expect(201))
        .body as CategoryResponse;
      await putBudget(cookie, {
        categories: [{ categoryId: praca.id, monthlyLimit: 100 }],
      }).expect(200);

      await deleteCategory(cookie, praca.id).expect(204);

      expect((await getCategories(cookie)).map(({ id }) => id)).not.toContain(
        praca.id,
      );
      expect(
        (await getBudget(cookie)).categories.map(({ category }) => category.id),
      ).not.toContain(praca.id);
      expect(
        await repository(CategorySetting).countBy({ categoryId: praca.id }),
      ).toBe(0);
      await deleteCategory(cookie, praca.id).expect(404);
    });

    it('refuses to delete a category with a subscription and leaves both alone', async () => {
      const { cookie } = await signIn();
      const praca = (await postCategory(cookie, 'Praca').expect(201))
        .body as CategoryResponse;
      const created = (
        await postSubscription(
          cookie,
          subscriptionBody({ categoryId: praca.id }),
        ).expect(201)
      ).body as SubscriptionResponse;
      const stored = await repository(Subscription).findOneByOrFail({
        id: created.id,
      });

      const refused = await deleteCategory(cookie, praca.id).expect(409);

      expect(refused.body).toMatchObject({
        message: 'The category has subscriptions',
      });
      expect(
        await repository(Subscription).findOneByOrFail({ id: created.id }),
      ).toEqual(stored);
      expect((await getCategories(cookie)).map(({ id }) => id)).toContain(
        praca.id,
      );
      expect(
        await repository(CategorySetting).countBy({ categoryId: praca.id }),
      ).toBe(1);
    });

    it('answers 404 for a default and an unknown category, 400 for a bad id', async () => {
      const { cookie } = await signIn();

      const missing = await deleteCategory(cookie, OTHER_CATEGORY_ID).expect(
        404,
      );
      expect(missing.body).toMatchObject({ message: 'Category not found' });
      await deleteCategory(cookie, UNKNOWN_ID).expect(404);
      await deleteCategory(cookie, 'not-a-uuid').expect(400);

      expect(await getCategories(cookie)).toHaveLength(
        DEFAULT_CATEGORIES.length,
      );
    });
  });

  // A category deleted between the check and the write: the foreign keys decide, and their names
  // (pinned here against the real database) are what the services map.
  describe('a category deleted during a write', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    // The category as the check saw it, then gone from the database.
    async function deletedCategory(cookie: string): Promise<Category> {
      const created = (await postCategory(cookie, 'Znika').expect(201))
        .body as CategoryResponse;
      const category = await repository(Category).findOneByOrFail({
        id: created.id,
      });
      await repository(CategorySetting).delete({ categoryId: category.id });
      await repository(Category).delete({ id: category.id });
      return category;
    }

    it('refuses a new subscription in it with the usual 400', async () => {
      const { cookie } = await signIn();
      const category = await deletedCategory(cookie);
      vi.spyOn(CategoriesService.prototype, 'findUsable').mockResolvedValueOnce(
        category,
      );

      const refused = await postSubscription(
        cookie,
        subscriptionBody({ categoryId: category.id }),
      ).expect(400);

      expect(refused.body).toMatchObject({
        message: 'categoryId does not name a usable category',
      });
      expect(await getSubscriptions(cookie)).toEqual([]);
    });

    it('refuses an edit that moves a subscription into it with the usual 400', async () => {
      const { cookie } = await signIn();
      const created = (
        await postSubscription(cookie, subscriptionBody()).expect(201)
      ).body as SubscriptionResponse;
      const category = await deletedCategory(cookie);
      vi.spyOn(CategoriesService.prototype, 'findUsable').mockResolvedValueOnce(
        category,
      );

      const refused = await putSubscription(
        cookie,
        created.id,
        subscriptionBody({ categoryId: category.id }),
      ).expect(400);

      expect(refused.body).toMatchObject({
        message: 'categoryId does not name a usable category',
      });
      expect(await getSubscriptions(cookie)).toEqual([created]);
    });

    it('refuses budget settings for it with the usual 400 and writes nothing', async () => {
      const { cookie } = await signIn();
      const before = await getBudget(cookie);
      vi.spyOn(CategoriesService.prototype, 'allUsable').mockResolvedValueOnce(
        true,
      );

      const refused = await putBudget(cookie, {
        defaultDuplicateThreshold: 7,
        categories: [{ categoryId: UNKNOWN_ID, duplicateThreshold: 2 }],
      }).expect(400);

      expect(refused.body).toMatchObject({
        message: 'categories must name only usable categories',
      });
      expect(await getBudget(cookie)).toEqual(before);
    });

    it('refuses to delete a category whose subscription the check missed', async () => {
      const { cookie } = await signIn();
      const praca = (await postCategory(cookie, 'Praca').expect(201))
        .body as CategoryResponse;
      await postSubscription(
        cookie,
        subscriptionBody({ categoryId: praca.id }),
      ).expect(201);
      vi.spyOn(EntityManager.prototype, 'exists').mockResolvedValueOnce(false);

      const refused = await deleteCategory(cookie, praca.id).expect(409);

      expect(refused.body).toMatchObject({
        message: 'The category has subscriptions',
      });
      // The transaction rolled back, so the settings row deleted before the category is back.
      expect(
        await repository(CategorySetting).countBy({ categoryId: praca.id }),
      ).toBe(1);
      expect((await getCategories(cookie)).map(({ id }) => id)).toContain(
        praca.id,
      );
    });

    it('fails on the foreign key names the services map', async () => {
      const { address } = await signIn();
      const userId = await userIdOf(address);

      await expect(
        repository(Subscription).insert({
          userId,
          categoryId: UNKNOWN_ID,
          name: 'Netflix',
          amount: '43.00',
          billingCycle: BillingCycle.MONTHLY,
          paymentMethod: PaymentMethod.CREDIT_CARD,
          status: SubscriptionStatus.ACTIVE,
          nextBillingDate: '2026-11-15',
        }),
      ).rejects.toMatchObject({
        driverError: { code: '23503', constraint: SUBSCRIPTION_CATEGORY_FK },
      });
      await expect(
        repository(CategorySetting).insert({
          userId,
          categoryId: UNKNOWN_ID,
          duplicateThreshold: 3,
        }),
      ).rejects.toMatchObject({
        driverError: {
          code: '23503',
          constraint: CATEGORY_SETTING_CATEGORY_FK,
        },
      });
    });
  });
});
