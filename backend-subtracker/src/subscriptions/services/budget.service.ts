import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, Repository } from 'typeorm';
import type { UserBudgetSettings } from '../cost-totals.js';
import {
  DEFAULT_DUPLICATE_THRESHOLD,
  thresholdOf,
} from '../duplicate-warning.js';
import type {
  CategoryBudgetDto,
  UpdateBudgetDto,
} from '../dtos/update-budget.dto.js';
import { CategorySetting } from '../entities/category-setting.entity.js';
import { BudgetSettings } from '../entities/budget-settings.entity.js';
import type { BudgetResponse } from '../subscription.types.js';
import { CategoriesService } from './categories.service.js';

// A limit from the request as the numeric(10,2) column stores it; null removes the limit.
const toLimit = (limit: number | null): string | null =>
  limit === null ? null : limit.toFixed(2);

// The columns one category row of the request writes: only the fields it names.
type CategoryRowFields = Partial<
  Pick<CategorySetting, 'duplicateThreshold' | 'monthlyLimit'>
>;

function categoryRowFields(row: CategoryBudgetDto): CategoryRowFields {
  return {
    ...(row.duplicateThreshold !== undefined && {
      duplicateThreshold: row.duplicateThreshold,
    }),
    ...(row.monthlyLimit !== undefined && {
      monthlyLimit: toLimit(row.monthlyLimit),
    }),
  };
}

// Every query is scoped to the current user; userId never comes from the request body.
@Injectable()
export class BudgetService {
  constructor(
    @InjectRepository(CategorySetting)
    private readonly settings: Repository<CategorySetting>,
    private readonly categories: CategoriesService,
  ) {}

  // The user's current default threshold, overall limit and every category settings row, read
  // from both tables at once. A category without a row has the default threshold and no limit,
  // so it is missing from the maps; a row with a null threshold follows the default too.
  async budgetSettings(userId: string): Promise<UserBudgetSettings> {
    const [settings, rows] = await Promise.all([
      this.settings.manager.findOne(BudgetSettings, {
        select: {
          userId: true,
          defaultDuplicateThreshold: true,
          monthlyLimit: true,
        },
        where: { userId },
      }),
      this.settings.find({
        select: {
          categoryId: true,
          duplicateThreshold: true,
          monthlyLimit: true,
        },
        where: { userId },
      }),
    ]);
    return {
      defaultThreshold:
        settings?.defaultDuplicateThreshold ?? DEFAULT_DUPLICATE_THRESHOLD,
      byCategory: new Map(
        rows.map((row) => [row.categoryId, row.duplicateThreshold]),
      ),
      monthlyLimit: settings?.monthlyLimit ?? null,
      limitByCategory: new Map(
        rows.map((row) => [row.categoryId, row.monthlyLimit]),
      ),
    };
  }

  // Every category the user can use, in the order of GET /categories, with its settings.
  async get(userId: string): Promise<BudgetResponse> {
    const [categories, settings] = await Promise.all([
      this.categories.list(userId),
      this.budgetSettings(userId),
    ]);
    return {
      defaultDuplicateThreshold: settings.defaultThreshold,
      monthlyLimit: settings.monthlyLimit,
      categories: categories.map((category) => ({
        category,
        duplicateThreshold: thresholdOf(settings, category.id),
        monthlyLimit: settings.limitByCategory.get(category.id) ?? null,
      })),
    };
  }

  // All or nothing: every category is checked first, so one unknown or another account's category
  // refuses the whole request before anything is written; then the user's settings and the listed
  // categories are written in one transaction with INSERT … ON CONFLICT. A field the request
  // leaves out keeps what it has, and a new category row written for a limit alone keeps a null
  // threshold, so the category still follows the default.
  async update(userId: string, dto: UpdateBudgetDto): Promise<BudgetResponse> {
    const categories = dto.categories ?? [];
    const categoryIds = categories.map((row) => row.categoryId);
    if (!(await this.categories.allUsable(userId, categoryIds))) {
      throw new BadRequestException(
        'categories must name only usable categories',
      );
    }

    await this.settings.manager.transaction(async (manager) => {
      const userFields = {
        ...(dto.defaultDuplicateThreshold !== undefined && {
          defaultDuplicateThreshold: dto.defaultDuplicateThreshold,
        }),
        ...(dto.monthlyLimit !== undefined && {
          monthlyLimit: toLimit(dto.monthlyLimit),
        }),
      };
      if (Object.keys(userFields).length > 0) {
        await manager.upsert(BudgetSettings, { userId, ...userFields }, [
          'userId',
        ]);
      }
      await upsertCategoryRows(
        manager,
        categories.map((row) => ({
          userId,
          categoryId: row.categoryId,
          ...categoryRowFields(row),
        })),
      );
    });
    return this.get(userId);
  }
}

// upsert() overwrites every column that any of its rows names, so rows naming different fields
// go in separate statements: one statement per set of named fields, each overwriting only those.
async function upsertCategoryRows(
  manager: EntityManager,
  rows: readonly (CategoryRowFields &
    Pick<CategorySetting, 'userId' | 'categoryId'>)[],
): Promise<void> {
  const groups = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) {
    const key = [
      'duplicateThreshold' in row ? 'threshold' : '',
      'monthlyLimit' in row ? 'limit' : '',
    ].join('|');
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const group of groups.values()) {
    await manager.upsert(CategorySetting, group, ['userId', 'categoryId']);
  }
}
