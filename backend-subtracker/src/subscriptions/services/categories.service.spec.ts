import { ConflictException } from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import {
  type Category,
  CATEGORY_OWNER_NAME_INDEX,
} from '../entities/category.entity.js';
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

function setup(taken = false) {
  const lookup = {
    where: vi.fn(() => lookup),
    andWhere: vi.fn(() => lookup),
    getExists: vi.fn(() => Promise.resolve(taken)),
  };
  const categories = {
    createQueryBuilder: vi.fn(() => lookup),
    create: vi.fn((row: Partial<Category>) => row),
    save: vi.fn((row: Partial<Category>) =>
      Promise.resolve({ ...row, id: 'new-id' } as Category),
    ),
  };
  const service = new CategoriesService(
    categories as unknown as Repository<Category>,
  );
  return { service, categories, lookup };
}

describe('CategoriesService.create', () => {
  it('stores the name with its case-insensitive key and looks the key up', async () => {
    const { service, categories, lookup } = setup();

    await expect(service.create(USER_ID, 'Ślub')).resolves.toEqual({
      id: 'new-id',
      name: 'Ślub',
      isDefault: false,
    });

    expect(lookup.andWhere).toHaveBeenCalledWith(
      'category.nameKey = :nameKey',
      { nameKey: 'ślub' },
    );
    expect(categories.create).toHaveBeenCalledWith({
      userId: USER_ID,
      name: 'Ślub',
      nameKey: 'ślub',
    });
  });

  it('answers 409 when the lookup finds the name', async () => {
    const { service, categories } = setup(true);

    await expect(service.create(USER_ID, 'Praca')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(categories.save).not.toHaveBeenCalled();
  });

  it('answers 409 when the unique index refuses a name the lookup did not see', async () => {
    const { service, categories } = setup();
    categories.save.mockRejectedValueOnce(
      uniqueViolation(CATEGORY_OWNER_NAME_INDEX),
    );

    await expect(service.create(USER_ID, 'Praca')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rethrows a unique violation on another constraint', async () => {
    const { service, categories } = setup();
    const failure = uniqueViolation('PK_9c4e4a89e3674fc9f382d733f03');
    categories.save.mockRejectedValueOnce(failure);

    await expect(service.create(USER_ID, 'Praca')).rejects.toBe(failure);
  });
});
