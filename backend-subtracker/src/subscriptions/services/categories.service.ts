import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { isForeignKeyViolation } from '../../shared/database/foreign-key-violation.js';
import { isUniqueViolation } from '../../shared/database/unique-violation.js';
import { toNameKey } from '../../shared/text/name-key.js';
import { DEFAULT_CATEGORIES } from '../default-categories.js';
import { CategorySetting } from '../entities/category-setting.entity.js';
import {
  Category,
  CATEGORY_OWNER_NAME_INDEX,
} from '../entities/category.entity.js';
import { defaultDuplicateThresholdOf } from '../entities/budget-settings.entity.js';
import {
  Subscription,
  SUBSCRIPTION_CATEGORY_FK,
} from '../entities/subscription.entity.js';
import type { CategoryResponse } from '../subscription.types.js';

// The same for a default category, another account's and an id no row has.
const NOT_FOUND_MESSAGE = 'Category not found';

const HAS_SUBSCRIPTIONS_MESSAGE = 'The category has subscriptions';

const DEFAULT_ORDER = new Map<string, number>(
  DEFAULT_CATEGORIES.map((category, index) => [category.id, index]),
);

export function toCategoryResponse(category: Category): CategoryResponse {
  return {
    id: category.id,
    name: category.name,
    isDefault: category.userId === null,
  };
}

// Every query is scoped to the current user: their own categories plus the defaults.
@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
  ) {}

  // Defaults in their fixed order, then the user's own alphabetically.
  async list(userId: string): Promise<CategoryResponse[]> {
    const rows = await this.categories.find({
      where: [{ userId: IsNull() }, { userId }],
    });
    const defaults = rows
      .filter((row) => row.userId === null)
      .sort(
        (a, b) =>
          (DEFAULT_ORDER.get(a.id) ?? DEFAULT_ORDER.size) -
          (DEFAULT_ORDER.get(b.id) ?? DEFAULT_ORDER.size),
      );
    const own = rows
      .filter((row) => row.userId !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    return [...defaults, ...own].map(toCategoryResponse);
  }

  // The lookup gives the usual answer; the unique index catches two requests that both passed it.
  // The index only covers names within one owner, so the lookup alone guards against a default.
  async create(userId: string, name: string): Promise<CategoryResponse> {
    const nameKey = toNameKey(name);
    if (await this.nameTaken(userId, nameKey)) {
      throw new ConflictException();
    }

    // The new category gets a copy of the user's current default threshold in the same
    // transaction, so a later change of the default leaves it alone.
    try {
      const category = await this.categories.manager.transaction(
        async (manager) => {
          const duplicateThreshold = await defaultDuplicateThresholdOf(
            manager,
            userId,
          );
          const saved = await manager.save(
            manager.create(Category, { userId, name, nameKey }),
          );
          await manager.insert(CategorySetting, {
            userId,
            categoryId: saved.id,
            duplicateThreshold,
          });
          return saved;
        },
      );
      return toCategoryResponse(category);
    } catch (error) {
      if (isUniqueViolation(error, CATEGORY_OWNER_NAME_INDEX)) {
        throw new ConflictException();
      }
      throw error;
    }
  }

  // Only the name and its key change; the category keeps its id, so its threshold and limit stay.
  // Ownership is checked before the name: a default category (user_id NULL), another account's and
  // an unknown id answer 404 whatever the name. The name lookup covers only the defaults and the
  // user's own categories, skipping the category itself, so changing only the case of its name
  // passes and a name another account uses is free. A delete between the check and the update
  // leaves no row, which gives the same 404.
  async rename(
    userId: string,
    id: string,
    name: string,
  ): Promise<CategoryResponse> {
    if (!(await this.categories.exists({ where: { id, userId } }))) {
      throw new NotFoundException(NOT_FOUND_MESSAGE);
    }
    const nameKey = toNameKey(name);
    if (await this.nameTaken(userId, nameKey, id)) {
      throw new ConflictException();
    }
    let affected: number | undefined;
    try {
      ({ affected } = await this.categories.update(
        { id, userId },
        { name, nameKey },
      ));
    } catch (error) {
      if (isUniqueViolation(error, CATEGORY_OWNER_NAME_INDEX)) {
        throw new ConflictException();
      }
      throw error;
    }
    if (!affected) {
      throw new NotFoundException(NOT_FOUND_MESSAGE);
    }
    return { id, name, isDefault: false };
  }

  // Only an own category without subscriptions, together with its settings row, in one
  // transaction. The category row is locked first, so a parallel rename or delete waits. A
  // subscription written past the check fails this delete on its foreign key, which gives the
  // same 409.
  async remove(userId: string, id: string): Promise<void> {
    try {
      await this.categories.manager.transaction(async (manager) => {
        const category = await manager.findOne(Category, {
          where: { id, userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (category === null) {
          throw new NotFoundException(NOT_FOUND_MESSAGE);
        }
        if (await manager.exists(Subscription, { where: { categoryId: id } })) {
          throw new ConflictException(HAS_SUBSCRIPTIONS_MESSAGE);
        }
        // By the category alone: it is already the user's own under the lock, so no settings row
        // of any account can keep it.
        await manager.delete(CategorySetting, { categoryId: id });
        await manager.delete(Category, { id, userId });
      });
    } catch (error) {
      if (isForeignKeyViolation(error, SUBSCRIPTION_CATEGORY_FK)) {
        throw new ConflictException(HAS_SUBSCRIPTIONS_MESSAGE);
      }
      throw error;
    }
  }

  // Whether a default category or one of the user's own, other than `exceptId`, has the key.
  private nameTaken(
    userId: string,
    nameKey: string,
    exceptId?: string,
  ): Promise<boolean> {
    const query = this.categories
      .createQueryBuilder('category')
      .where('(category.userId IS NULL OR category.userId = :userId)', {
        userId,
      })
      .andWhere('category.nameKey = :nameKey', { nameKey });
    if (exceptId !== undefined) {
      query.andWhere('category.id <> :exceptId', { exceptId });
    }
    return query.getExists();
  }

  // Whether every id names a default category or one of the user's own, in one query. The ids must
  // be distinct (the DTOs check it), so a count short of their number means one is unknown.
  async allUsable(
    userId: string,
    categoryIds: readonly string[],
  ): Promise<boolean> {
    if (categoryIds.length === 0) {
      return true;
    }
    const usable = await this.categories
      .createQueryBuilder('category')
      .where('category.id IN (:...categoryIds)', { categoryIds })
      .andWhere('(category.userId IS NULL OR category.userId = :userId)', {
        userId,
      })
      .getCount();
    return usable === categoryIds.length;
  }

  // A default category or one of the user's own; anything else is unknown to this user.
  findUsable(userId: string, categoryId: string): Promise<Category | null> {
    return this.categories.findOne({
      where: [
        { id: categoryId, userId: IsNull() },
        { id: categoryId, userId },
      ],
    });
  }
}
