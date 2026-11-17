import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { type DuplicateThresholds, thresholdOf } from '../duplicate-warning.js';
import type { UpdateBudgetDto } from '../dtos/update-budget.dto.js';
import { CategorySetting } from '../entities/category-setting.entity.js';
import {
  defaultDuplicateThresholdOf,
  BudgetSettings,
} from '../entities/budget-settings.entity.js';
import type { BudgetResponse } from '../subscription.types.js';
import { CategoriesService } from './categories.service.js';

// Every query is scoped to the current user; userId never comes from the request body.
@Injectable()
export class BudgetService {
  constructor(
    @InjectRepository(CategorySetting)
    private readonly settings: Repository<CategorySetting>,
    private readonly categories: CategoriesService,
  ) {}

  // The user's current default threshold and the categories with a stored threshold. A category
  // without a row has the default, so it is missing from the map.
  async duplicateThresholds(userId: string): Promise<DuplicateThresholds> {
    const [defaultThreshold, rows] = await Promise.all([
      defaultDuplicateThresholdOf(this.settings.manager, userId),
      this.settings.find({
        select: { categoryId: true, duplicateThreshold: true },
        where: { userId },
      }),
    ]);
    return {
      defaultThreshold,
      byCategory: new Map(
        rows.map((row) => [row.categoryId, row.duplicateThreshold]),
      ),
    };
  }

  // Every category the user can use, in the order of GET /categories, with its settings.
  async get(userId: string): Promise<BudgetResponse> {
    const [categories, thresholds] = await Promise.all([
      this.categories.list(userId),
      this.duplicateThresholds(userId),
    ]);
    return {
      defaultDuplicateThreshold: thresholds.defaultThreshold,
      categories: categories.map((category) => ({
        category,
        duplicateThreshold: thresholdOf(thresholds, category.id),
      })),
    };
  }

  // All or nothing: every category is checked first, so one unknown or another account's category
  // refuses the whole request before anything is written; then the default and the listed
  // categories are written in one transaction, each with one INSERT … ON CONFLICT. A field the
  // request leaves out keeps what it has.
  async update(userId: string, dto: UpdateBudgetDto): Promise<BudgetResponse> {
    const categories = dto.categories ?? [];
    const categoryIds = categories.map((row) => row.categoryId);
    if (!(await this.categories.allUsable(userId, categoryIds))) {
      throw new BadRequestException(
        'categories must name only usable categories',
      );
    }

    await this.settings.manager.transaction(async (manager) => {
      if (dto.defaultDuplicateThreshold !== undefined) {
        await manager.upsert(
          BudgetSettings,
          {
            userId,
            defaultDuplicateThreshold: dto.defaultDuplicateThreshold,
          },
          ['userId'],
        );
      }
      if (categories.length > 0) {
        await manager.upsert(
          CategorySetting,
          categories.map((row) => ({
            userId,
            categoryId: row.categoryId,
            duplicateThreshold: row.duplicateThreshold,
          })),
          ['userId', 'categoryId'],
        );
      }
    });
    return this.get(userId);
  }
}
