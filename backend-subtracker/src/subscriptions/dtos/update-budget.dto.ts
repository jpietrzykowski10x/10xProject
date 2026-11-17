import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateIf,
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

// PUT /budget: only what the request names changes; the default and the categories left out keep
// what they have. At least one of the two fields is required.
export class UpdateBudgetDto {
  // Validated whenever it is present, so null is refused rather than taken as "left out".
  @ValidateIf(
    (dto: UpdateBudgetDto) => dto.defaultDuplicateThreshold !== undefined,
  )
  @IsInt()
  @Min(DUPLICATE_THRESHOLD_MIN)
  @Max(DUPLICATE_THRESHOLD_MAX)
  defaultDuplicateThreshold?: number;

  // Validated when present, and also when the default is missing too: an empty body then fails
  // here as "categories must be an array".
  @ValidateIf(
    (dto: UpdateBudgetDto) =>
      dto.categories !== undefined ||
      dto.defaultDuplicateThreshold === undefined,
  )
  @IsArray()
  @ArrayMaxSize(BUDGET_CATEGORIES_MAX)
  @ArrayUnique((category: CategoryBudgetDto) => category.categoryId)
  @ValidateNested({ each: true })
  @Type(() => CategoryBudgetDto)
  categories?: CategoryBudgetDto[];
}
