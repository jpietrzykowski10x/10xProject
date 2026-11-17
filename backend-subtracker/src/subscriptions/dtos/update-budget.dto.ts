import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsAmount } from '../../shared/validation/amount.js';
import {
  DUPLICATE_THRESHOLD_MAX,
  DUPLICATE_THRESHOLD_MIN,
} from '../duplicate-warning.js';
import { AMOUNT_MAX } from '../subscription.types.js';

// More than the defaults and the own categories of any real account.
export const BUDGET_CATEGORIES_MAX = 200;

// One category of PUT /budget: only the fields it names change. At least one of the two is
// required; a limit of null removes the limit, a threshold of null is refused.
export class CategoryBudgetDto {
  @IsUUID()
  categoryId: string;

  // Validated when present (so null is refused), and also when the limit is missing too: a
  // category naming neither field then fails here.
  @ValidateIf(
    (dto: CategoryBudgetDto) =>
      dto.duplicateThreshold !== undefined || dto.monthlyLimit === undefined,
  )
  @IsInt()
  @Min(DUPLICATE_THRESHOLD_MIN)
  @Max(DUPLICATE_THRESHOLD_MAX)
  duplicateThreshold?: number;

  // Null removes the category's limit (S-08).
  @IsOptional()
  @IsAmount(AMOUNT_MAX)
  monthlyLimit?: number | null;
}

// PUT /budget: only what the request names changes; the settings and the categories left out keep
// what they have. At least one of the three fields is required.
export class UpdateBudgetDto {
  // Validated whenever it is present, so null is refused rather than taken as "left out".
  @ValidateIf(
    (dto: UpdateBudgetDto) => dto.defaultDuplicateThreshold !== undefined,
  )
  @IsInt()
  @Min(DUPLICATE_THRESHOLD_MIN)
  @Max(DUPLICATE_THRESHOLD_MAX)
  defaultDuplicateThreshold?: number;

  // The overall monthly limit (S-08); null removes it, so null counts as present.
  @IsOptional()
  @IsAmount(AMOUNT_MAX)
  monthlyLimit?: number | null;

  // Validated when present, and also when the other two are missing too: an empty body then fails
  // here as "categories must be an array".
  @ValidateIf(
    (dto: UpdateBudgetDto) =>
      dto.categories !== undefined ||
      (dto.defaultDuplicateThreshold === undefined &&
        dto.monthlyLimit === undefined),
  )
  @IsArray()
  @ArrayMaxSize(BUDGET_CATEGORIES_MAX)
  @ArrayUnique((category: CategoryBudgetDto) => category.categoryId)
  @ValidateNested({ each: true })
  @Type(() => CategoryBudgetDto)
  categories?: CategoryBudgetDto[];
}
