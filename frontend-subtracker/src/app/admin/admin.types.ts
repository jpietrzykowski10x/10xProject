// The API contract of /admin/users (backend-subtracker/src/admin: admin-user.types.ts,
// admin-rank.ts, dtos/search-users.dto.ts). Dates come as ISO strings.
import type { BudgetResponse } from '../budget/budget.types';
import type { CostTotals, Subscription } from '../subscriptions/subscription.types';

// The shortest fragment of an address a search accepts (unless it lists the blocked accounts);
// the API answers 400 below it.
export const ADMIN_SEARCH_MIN_LENGTH = 3;

// The most accounts one search returns; there is no paging, a longer fragment narrows the list.
export const ADMIN_SEARCH_LIMIT = 20;

// Which accounts a search lists (GET /admin/users?status=); the API's default is `all`.
export type AdminStatusFilter = 'all' | 'active' | 'blocked';

// The role an administrator sees: a superadministrator shows as `admin`.
export type AdminVisibleRole = 'user' | 'admin';

// One account in the search results and the answer of every action. `canManage`: the asking
// administrator outranks the account, so it may block, unblock and sign it out.
export interface AdminUserSummary {
  id: string;
  email: string;
  role: AdminVisibleRole;
  isActive: boolean;
  createdAt: string;
  canManage: boolean;
}

// GET /admin/users/:id: what the account itself sees, read-only.
export interface AdminUserDetail {
  user: AdminUserSummary & { emailVerifiedAt: string | null };
  subscriptions: Subscription[];
  totals: CostTotals;
  budget: BudgetResponse;
}
