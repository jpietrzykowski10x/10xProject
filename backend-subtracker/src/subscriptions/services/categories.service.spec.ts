import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import {
  CATEGORY_SETTING_CATEGORY_FK,
  CategorySetting,
} from '../entities/category-setting.entity.js';
import {
  Category,
  CATEGORY_OWNER_NAME_INDEX,
} from '../entities/category.entity.js';
import type { BudgetSettings } from '../entities/budget-settings.entity.js';
import {
  Subscription,
  SUBSCRIPTION_CATEGORY_FK,
} from '../entities/subscription.entity.js';
import { CategoriesService } from './categories.service.js';

const USER_ID = '7f0c2a8e-2b1d-4c3a-9e5f-1a2b3c4d5e6f';

const uniqueViolation = (constraint: string) =>
  new QueryFailedError(
    'INSERT',
    [],
    Object.assign(new Error('duplicate key value'), {
      code: '23505',
      constraint,
    }),
  );

// `settings` is the user's stored settings row, or null for an account that never saved one.
function setup(
  taken = false,
  settings: Pick<BudgetSettings, 'defaultDuplicateThreshold'> | null = null,
) {
  const lookup = {
    where: vi.fn(() => lookup),
    andWhere: vi.fn(() => lookup),
    getExists: vi.fn(() => Promise.resolve(taken)),
  };
  // The transaction runs its callback on the same fake manager.
  const manager = {
    findOne: vi.fn(() => Promise.resolve(settings)),
    create: vi.fn((_entity: unknown, row: Partial<Category>) => row),
    save: vi.fn((row: Partial<Category>) =>
      Promise.resolve({ ...row, id: 'new-id' } as Category),
    ),
    insert: vi.fn(() => Promise.resolve()),
    transaction: vi.fn(
      (work: (transactional: unknown) => Promise<unknown>): Promise<unknown> =>
        work(manager),
    ),
  };
  const categories = {
    createQueryBuilder: vi.fn(() => lookup),
    manager,
  };
  const service = new CategoriesService(
    categories as unknown as Repository<Category>,
  );
  return { service, manager, lookup };
}

describe('CategoriesService.create', () => {
  it('stores the name with its case-insensitive key and looks the key up', async () => {
    const { service, manager, lookup } = setup();

    await expect(service.create(USER_ID, 'Ślub')).resolves.toEqual({
      id: 'new-id',
      name: 'Ślub',
      isDefault: false,
    });

    expect(lookup.andWhere).toHaveBeenCalledWith(
      'category.nameKey = :nameKey',
      { nameKey: 'ślub' },
    );
    expect(manager.create).toHaveBeenCalledWith(Category, {
      userId: USER_ID,
      name: 'Ślub',
      nameKey: 'ślub',
    });
  });

  // The oracle is the S-07 plan: a new own category gets a copy of the user's current default,
  // 3 for an account without stored settings.
  it.each([
    ['without stored settings', null, 3],
    ['with a stored default', { defaultDuplicateThreshold: 5 }, 5],
  ])(
    'gives the new category the current default threshold %s',
    async (_case, settings, expected) => {
      const { service, manager } = setup(false, settings);

      await service.create(USER_ID, 'Praca');

      expect(manager.transaction).toHaveBeenCalledTimes(1);
      expect(manager.insert).toHaveBeenCalledWith(CategorySetting, {
        userId: USER_ID,
        categoryId: 'new-id',
        duplicateThreshold: expected,
      });
    },
  );

  it('answers 409 when the lookup finds the name', async () => {
    const { service, manager } = setup(true);

    await expect(service.create(USER_ID, 'Praca')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.insert).not.toHaveBeenCalled();
  });

  it('answers 409 when the unique index refuses a name the lookup did not see', async () => {
    const { service, manager } = setup();
    manager.save.mockRejectedValueOnce(
      uniqueViolation(CATEGORY_OWNER_NAME_INDEX),
    );

    await expect(service.create(USER_ID, 'Praca')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(manager.insert).not.toHaveBeenCalled();
  });

  it('rethrows a unique violation on another constraint', async () => {
    const { service, manager } = setup();
    const failure = uniqueViolation('PK_9c4e4a89e3674fc9f382d733f03');
    manager.save.mockRejectedValueOnce(failure);

    await expect(service.create(USER_ID, 'Praca')).rejects.toBe(failure);
  });
});

const CATEGORY_ID = '3b8f1c2d-4e5a-4b6c-8d7e-9f0a1b2c3d4e';

const foreignKeyViolation = (constraint: string) =>
  new QueryFailedError(
    'DELETE',
    [],
    Object.assign(new Error('violates foreign key constraint'), {
      code: '23503',
      constraint,
    }),
  );

function setupRename(taken = false, affected = 1) {
  const lookup = {
    where: vi.fn(() => lookup),
    andWhere: vi.fn(() => lookup),
    getExists: vi.fn(() => Promise.resolve(taken)),
  };
  const categories = {
    createQueryBuilder: vi.fn(() => lookup),
    update: vi.fn(() => Promise.resolve({ affected })),
  };
  const service = new CategoriesService(
    categories as unknown as Repository<Category>,
  );
  return { service, categories, lookup };
}

describe('CategoriesService.rename', () => {
  it('writes the name with its key and leaves the category itself out of the lookup', async () => {
    const { service, categories, lookup } = setupRename();

    await expect(service.rename(USER_ID, CATEGORY_ID, 'Ślub')).resolves.toEqual(
      { id: CATEGORY_ID, name: 'Ślub', isDefault: false },
    );

    expect(lookup.andWhere).toHaveBeenCalledWith(
      'category.nameKey = :nameKey',
      { nameKey: 'ślub' },
    );
    expect(lookup.andWhere).toHaveBeenCalledWith('category.id <> :exceptId', {
      exceptId: CATEGORY_ID,
    });
    expect(categories.update).toHaveBeenCalledWith(
      { id: CATEGORY_ID, userId: USER_ID },
      { name: 'Ślub', nameKey: 'ślub' },
    );
  });

  it('answers 409 when the lookup finds the name', async () => {
    const { service, categories } = setupRename(true);

    await expect(
      service.rename(USER_ID, CATEGORY_ID, 'Praca'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(categories.update).not.toHaveBeenCalled();
  });

  it('answers 404 when no own category has the id', async () => {
    const { service } = setupRename(false, 0);

    await expect(
      service.rename(USER_ID, CATEGORY_ID, 'Praca'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 409 when the unique index refuses a name the lookup did not see', async () => {
    const { service, categories } = setupRename();
    categories.update.mockRejectedValueOnce(
      uniqueViolation(CATEGORY_OWNER_NAME_INDEX),
    );

    await expect(
      service.rename(USER_ID, CATEGORY_ID, 'Praca'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

function setupRemove(
  category: Partial<Category> | null = { id: CATEGORY_ID, userId: USER_ID },
  hasSubscriptions = false,
) {
  const manager = {
    findOne: vi.fn(() => Promise.resolve(category)),
    exists: vi.fn(() => Promise.resolve(hasSubscriptions)),
    delete: vi.fn(() => Promise.resolve({ affected: 1 })),
    transaction: vi.fn(
      (work: (transactional: unknown) => Promise<unknown>): Promise<unknown> =>
        work(manager),
    ),
  };
  const service = new CategoriesService({
    manager,
  } as unknown as Repository<Category>);
  return { service, manager };
}

describe('CategoriesService.remove', () => {
  it('locks the own category, then deletes its settings row before the category', async () => {
    const { service, manager } = setupRemove();

    await service.remove(USER_ID, CATEGORY_ID);

    expect(manager.findOne).toHaveBeenCalledWith(Category, {
      where: { id: CATEGORY_ID, userId: USER_ID },
      lock: { mode: 'pessimistic_write' },
    });
    expect(manager.exists).toHaveBeenCalledWith(Subscription, {
      where: { categoryId: CATEGORY_ID },
    });
    expect(manager.delete.mock.calls).toEqual([
      [CategorySetting, { userId: USER_ID, categoryId: CATEGORY_ID }],
      [Category, { id: CATEGORY_ID, userId: USER_ID }],
    ]);
  });

  it('answers 404 when no own category has the id', async () => {
    const { service, manager } = setupRemove(null);

    await expect(service.remove(USER_ID, CATEGORY_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('answers 409 while the category has subscriptions', async () => {
    const { service, manager } = setupRemove(undefined, true);

    await expect(service.remove(USER_ID, CATEGORY_ID)).rejects.toThrow(
      new ConflictException('The category has subscriptions'),
    );
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it.each([SUBSCRIPTION_CATEGORY_FK, CATEGORY_SETTING_CATEGORY_FK])(
    'answers the same 409 when the delete fails on %s',
    async (constraint) => {
      const { service, manager } = setupRemove();
      manager.delete.mockRejectedValueOnce(foreignKeyViolation(constraint));

      await expect(service.remove(USER_ID, CATEGORY_ID)).rejects.toThrow(
        new ConflictException('The category has subscriptions'),
      );
    },
  );

  it('rethrows a foreign key violation on another constraint', async () => {
    const { service, manager } = setupRemove();
    const failure = foreignKeyViolation('FK_6562e564389d0600e6e243d9604');
    manager.delete.mockRejectedValueOnce(failure);

    await expect(service.remove(USER_ID, CATEGORY_ID)).rejects.toBe(failure);
  });
});
