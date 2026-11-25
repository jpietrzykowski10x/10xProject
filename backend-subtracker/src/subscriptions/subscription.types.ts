import type { BudgetAlert } from './budget-alert.js';
import type { DuplicateWarning } from './duplicate-warning.js';

// Codes of the closed lists, stored as varchar. Display names live in the frontend.
export enum SubscriptionStatus {
  TRIAL = 'trial',
  ACTIVE = 'active',
  CANCELLED_PENDING = 'cancelled_pending',
  CANCELLED = 'cancelled',
}

export enum BillingCycle {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

// FR-004: credit card, debit card, BLIK, bank transfer / standing order, e-wallet, other.
export enum PaymentMethod {
  CREDIT_CARD = 'credit_card',
  DEBIT_CARD = 'debit_card',
  BLIK = 'blik',
  BANK_TRANSFER = 'bank_transfer',
  E_WALLET = 'e_wallet',
  OTHER = 'other',
}

// The orders of GET /subscriptions (FR-016). The default groups by status; every other one starts
// with its own key and then falls back to the default order (subscription-order.ts).
export enum SubscriptionSort {
  STATUS_THEN_DATE = 'status_then_date',
  NAME_ASC = 'name_asc',
  NAME_DESC = 'name_desc',
  AMOUNT_DESC = 'amount_desc',
  AMOUNT_ASC = 'amount_asc',
  DATE_ASC = 'date_asc',
  DATE_DESC = 'date_desc',
}

// Rows per page of GET /subscriptions: the default and the most one request may ask for.
export const SUBSCRIPTION_PAGE_SIZE = 25;
export const SUBSCRIPTION_PAGE_SIZE_MAX = 100;

export const SUBSCRIPTION_NAME_MAX_LENGTH = 100;
export const CATEGORY_NAME_MAX_LENGTH = 50;
// numeric(10,2) holds more; this is the product limit.
export const AMOUNT_MAX = 99999.99;

export interface CategoryResponse {
  id: string;
  name: string;
  isDefault: boolean;
}

// The amount is the price per billing cycle as a string with two decimals ("43.00"), dates are
// calendar days (YYYY-MM-DD) without a time zone.
export interface SubscriptionResponse {
  id: string;
  name: string;
  category: CategoryResponse;
  amount: string;
  billingCycle: BillingCycle;
  paymentMethod: PaymentMethod;
  status: SubscriptionStatus;
  trialEndDate: string | null;
  nextBillingDate: string;
  createdAt: Date;
}

// GET /subscriptions: one page of the account's list in the requested order. `total` counts every
// row that matches the filters, so a page past the end has no items but the real total.
export interface SubscriptionPageResponse {
  items: SubscriptionResponse[];
  total: number;
  page: number;
  pageSize: number;
}

// The cost of the counted subscriptions of one category (amounts as in SubscriptionResponse).
export interface CategoryCostTotal {
  category: CategoryResponse;
  monthly: string; // "35.83"
  yearly: string; // "429.99"
  subscriptionCount: number;
  // The category's threshold of active subscriptions and how the count compares with it (S-07).
  duplicateThreshold: number;
  duplicateWarning: DuplicateWarning;
  // The category's monthly limit (null: none) and how its monthly sum compares with it (S-08).
  monthlyLimit: string | null;
  budgetAlert: BudgetAlert;
}

// GET /subscriptions/totals: the sums are the sums of the category values.
export interface CostTotalsResponse {
  monthly: string;
  yearly: string;
  // The overall monthly limit (null: none) and how the monthly total compares with it (S-08).
  monthlyLimit: string | null;
  budgetAlert: BudgetAlert;
  categories: CategoryCostTotal[]; // monthly desc, then Polish name order
}

// One category on the budget page with its settings (S-07: the duplicate threshold; S-08: the
// monthly limit, null when none).
export interface CategoryBudget {
  category: CategoryResponse;
  duplicateThreshold: number;
  monthlyLimit: string | null;
}

// GET and PUT /budget: the user's default threshold (DEFAULT_DUPLICATE_THRESHOLD until they save
// one) and every category of the user, defaults first, in the order of GET /categories. A category
// without a stored threshold shows the user's current default. The overall limit is null until
// the user saves one.
export interface BudgetResponse {
  defaultDuplicateThreshold: number;
  monthlyLimit: string | null;
  categories: CategoryBudget[];
}
