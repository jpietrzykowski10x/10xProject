import type {
  BudgetResponse,
  CostTotalsResponse,
  SubscriptionResponse,
} from '../subscriptions/subscription.types.js';
import type { VisibleRole } from './admin-rank.js';

// The most accounts one search returns; there is no paging, a longer fragment narrows the list.
export const ADMIN_SEARCH_LIMIT = 20;

// The shortest fragment of an address a search accepts (unless it lists the blocked accounts).
export const ADMIN_SEARCH_MIN_LENGTH = 3;

// An account as an administrator sees it. `canManage` is worked out for the administrator asking.
export interface AdminUserSummary {
  id: string;
  email: string;
  role: VisibleRole;
  isActive: boolean;
  createdAt: Date;
  canManage: boolean;
}

// Everything the account itself sees, read-only: the same responses as its own /subscriptions,
// /subscriptions/totals and /budget.
export interface AdminUserDetail {
  user: AdminUserSummary & { emailVerifiedAt: Date | null };
  subscriptions: SubscriptionResponse[];
  totals: CostTotalsResponse;
  budget: BudgetResponse;
}
