// The API contract of backend-subtracker/src/subscriptions (subscription.types.ts, dtos/).
// Codes stay in English; Polish names live in subscription-labels.ts.

export type SubscriptionStatus = 'trial' | 'active' | 'cancelled_pending' | 'cancelled';

export type BillingCycle = 'monthly' | 'yearly';

// FR-004: credit card, debit card, BLIK, bank transfer / standing order, e-wallet, other.
export type PaymentMethod =
  'credit_card' | 'debit_card' | 'blik' | 'bank_transfer' | 'e_wallet' | 'other';

// The duplicate warning of a category in the cost totals (S-07), from the least to the most severe.
export type DuplicateWarning = 'none' | 'reached' | 'exceeded';

// S-08 (backend budget-alert.ts): how a monthly sum compares with its monthly limit. `none` without
// a limit, with nothing spent or below 80% of it; `near` from 80% up to just below the limit;
// `reached` at exactly the limit; `exceeded` above it (with a limit of 0, from the first grosz).
export type BudgetAlert = 'none' | 'near' | 'reached' | 'exceeded';

// The orders of GET /subscriptions (backend SubscriptionSort, FR-016). The default groups by status
// and then takes the nearest date; every other one starts with its own key and falls back to the
// default order.
export const SUBSCRIPTION_SORTS = [
  'status_then_date',
  'name_asc',
  'name_desc',
  'amount_desc',
  'amount_asc',
  'date_asc',
  'date_desc',
] as const;

export type SubscriptionSort = (typeof SUBSCRIPTION_SORTS)[number];

export const DEFAULT_SUBSCRIPTION_SORT: SubscriptionSort = 'status_then_date';

// Rows per page of GET /subscriptions: the API's default, so the page never sends it.
export const SUBSCRIPTION_PAGE_SIZE = 25;

export const SUBSCRIPTION_NAME_MAX_LENGTH = 100;
export const CATEGORY_NAME_MAX_LENGTH = 50;
export const AMOUNT_MAX = 99999.99;

export interface Category {
  id: string;
  name: string;
  isDefault: boolean;
}

// `amount` is the price per billing cycle with two decimals ("43.00"); dates are calendar days
// (YYYY-MM-DD) without a time zone; `trialEndDate` is set only for a trial.
export interface Subscription {
  id: string;
  name: string;
  category: Category;
  amount: string;
  billingCycle: BillingCycle;
  paymentMethod: PaymentMethod;
  status: SubscriptionStatus;
  trialEndDate: string | null;
  nextBillingDate: string;
  createdAt: string;
}

// What the list on /subscriptions shows: the order, the filters (null: all) and the page, from 1.
// The address and the request carry only the values that differ from the default.
export interface SubscriptionListQuery {
  sort: SubscriptionSort;
  category: string | null;
  status: SubscriptionStatus | null;
  page: number;
}

// GET /subscriptions: one page of the account's list, already in the requested order. `total`
// counts every row that matches the filters, so a page past the end has no items but the real
// total.
export interface SubscriptionPage {
  items: Subscription[];
  total: number;
  page: number;
  pageSize: number;
}

// POST /subscriptions. `trialEndDate` is required for a trial and must be absent or null otherwise;
// `nextBillingDate` must not be earlier than `trialEndDate`.
export interface CreateSubscriptionRequest {
  name: string;
  categoryId: string;
  amount: number;
  billingCycle: BillingCycle;
  paymentMethod: PaymentMethod;
  status: SubscriptionStatus;
  trialEndDate?: string | null;
  nextBillingDate: string;
}

// POST /categories; 409 when the user or a default category already has the name (any case).
export interface CreateCategoryRequest {
  name: string;
}

// GET /subscriptions/totals (backend cost-totals.ts). Amounts are in the API's format ("102.82").
// Only trial, active and cancelled_pending subscriptions count. `monthly` is the sum of the
// per-subscription monthly amounts (a yearly one divided by 12 and rounded each); `yearly` is the
// real yearly spend (monthly × 12 plus yearly unchanged).
// S-07 (backend duplicate-warning.ts): `duplicateWarning` compares `subscriptionCount` with the
// user's `duplicateThreshold` for the category: `exceeded` above it, `reached` at it (from one
// subscription up), `none` otherwise.
export interface CategoryCostTotal {
  category: Category;
  monthly: string;
  yearly: string;
  subscriptionCount: number;
  duplicateThreshold: number;
  duplicateWarning: DuplicateWarning;
  // S-08: the category's monthly limit (null: none) and how its `monthly` compares with it.
  monthlyLimit: string | null;
  budgetAlert: BudgetAlert;
}

// `categories` holds only categories with a counted subscription, in display order: monthly
// descending, then the Polish name order.
export interface CostTotals {
  monthly: string;
  yearly: string;
  // S-08: the overall monthly limit (null: none) and how `monthly` compares with it.
  monthlyLimit: string | null;
  budgetAlert: BudgetAlert;
  categories: CategoryCostTotal[];
}
