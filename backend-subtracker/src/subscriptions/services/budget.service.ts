import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DEFAULT_DUPLICATE_THRESHOLD } from '../duplicate-warning.js';
import type { UpdateBudgetDto } from '../dtos/update-budget.dto.js';
import { CategorySetting } from '../entities/category-setting.entity.js';
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

  // Category id → the user's stored duplicate threshold. A category without a row has the
  // default, so it is missing from the map.
  async duplicateThresholds(userId: string): Promise<Map<string, number>> {
    const rows = await this.settings.find({
      select: { categoryId: true, duplicateThreshold: true },
      where: { userId },
    });
    return new Map(rows.map((row) => [row.categoryId, row.duplicateThreshold]));
  }

  // Every category the user can use, in the order of GET /categories, with its settings.
  async get(userId: string): Promise<BudgetResponse> {
    const [categories, thresholds] = await Promise.all([
      this.categories.list(userId),
      this.duplicateThresholds(userId),
    ]);
    return {
      categories: categories.map((category) => ({
        category,
        duplicateThreshold:
          thresholds.get(category.id) ?? DEFAULT_DUPLICATE_THRESHOLD,
      })),
    };
  }

  // All or nothing: every category is checked first, so one unknown or another account's category
  // refuses the whole request before anything is written; then one INSERT … ON CONFLICT writes
  // them all.
  async update(userId: string, dto: UpdateBudgetDto): Promise<BudgetResponse> {
    const categoryIds = dto.categories.map((row) => row.categoryId);
    if (!(await this.categories.allUsable(userId, categoryIds))) {
      throw new BadRequestException(
        'categories must name only usable categories',
      );
    }

    await this.settings.upsert(
      dto.categories.map((row) => ({
        userId,
        categoryId: row.categoryId,
        duplicateThreshold: row.duplicateThreshold,
      })),
      ['userId', 'categoryId'],
    );
    return this.get(userId);
  }
}
