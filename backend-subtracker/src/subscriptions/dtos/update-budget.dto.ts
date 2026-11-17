import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  DUPLICATE_THRESHOLD_MAX,
  DUPLICATE_THRESHOLD_MIN,
} from '../duplicate-warning.js';

// More than the defaults and the own categories of any real account.
export const BUDGET_CATEGORIES_MAX = 200;

export class CategoryBudgetDto {
  @IsUUID()
  categoryId: string;

  @IsInt()
  @Min(DUPLICATE_THRESHOLD_MIN)
  @Max(DUPLICATE_THRESHOLD_MAX)
  duplicateThreshold: number;
}

// PUT /budget: the categories listed change, the others keep what they have.
export class UpdateBudgetDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BUDGET_CATEGORIES_MAX)
  @ArrayUnique((category: CategoryBudgetDto) => category.categoryId)
  @ValidateNested({ each: true })
  @Type(() => CategoryBudgetDto)
  categories: CategoryBudgetDto[];
}
