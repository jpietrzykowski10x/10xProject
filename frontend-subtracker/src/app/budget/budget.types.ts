// The API contract of GET and PUT /budget (backend-subtracker/src/subscriptions: subscription.types.ts,
// dtos/update-budget.dto.ts, duplicate-warning.ts). S-08 extends the same types with the limits.
import type { Category } from '../subscriptions/subscription.types';

// The threshold of active subscriptions per category (S-07): a whole number from 0 to 99. The
// user's default threshold has the same range.
export const DUPLICATE_THRESHOLD_MIN = 0;
export const DUPLICATE_THRESHOLD_MAX = 99;

export interface CategoryBudget {
  category: Category;
  duplicateThreshold: number;
}

// GET and PUT /budget: the user's default threshold (3 until they save one) and every category of
// the user, defaults first, in the order of GET /categories. A category without a threshold of its
// own shows the current default; a new own category gets a copy of the default when it is created.
export interface BudgetResponse {
  defaultDuplicateThreshold: number;
  categories: CategoryBudget[];
}

export interface CategoryBudgetRequest {
  categoryId: string;
  duplicateThreshold: number;
}

// PUT /budget: only what the request names changes; at least one of the two fields is required.
// 400 for the whole request when any category is unknown or another account's; nothing is saved then.
export interface UpdateBudgetRequest {
  defaultDuplicateThreshold?: number;
  categories?: CategoryBudgetRequest[];
}
