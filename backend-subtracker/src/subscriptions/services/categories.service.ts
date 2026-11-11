import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { isUniqueViolation } from '../../shared/database/unique-violation.js';
import { toNameKey } from '../../shared/text/name-key.js';
import { DEFAULT_CATEGORIES } from '../default-categories.js';
import {
  Category,
  CATEGORY_OWNER_NAME_INDEX,
} from '../entities/category.entity.js';
import type { CategoryResponse } from '../subscription.types.js';

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
    const taken = await this.categories
      .createQueryBuilder('category')
      .where('(category.userId IS NULL OR category.userId = :userId)', {
        userId,
      })
      .andWhere('category.nameKey = :nameKey', { nameKey })
      .getExists();
    if (taken) {
      throw new ConflictException();
    }

    try {
      const category = await this.categories.save(
        this.categories.create({ userId, name, nameKey }),
      );
      return toCategoryResponse(category);
    } catch (error) {
      if (isUniqueViolation(error, CATEGORY_OWNER_NAME_INDEX)) {
        throw new ConflictException();
      }
      throw error;
    }
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
