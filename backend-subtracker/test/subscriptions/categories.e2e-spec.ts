import { DEFAULT_CATEGORIES } from '../../src/subscriptions/default-categories.js';
import {
  Category,
  CATEGORY_OWNER_NAME_INDEX,
} from '../../src/subscriptions/entities/category.entity.js';
import { createE2eApp } from '../support/e2e-app.js';
import { subscriptionRequests } from './subscriptions-e2e.js';

describe('Subscriptions — categories (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job) with a fake mail transport. Every row these tests create hangs off a
  // recognisable address and is removed at the end.
  const e2e = createE2eApp({ addressPrefix: 'e2e-subscriptions-categories-' });
  const { repository, signIn, userIdOf } = e2e;
  const { postCategory, getCategories } = subscriptionRequests(e2e);

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
});
