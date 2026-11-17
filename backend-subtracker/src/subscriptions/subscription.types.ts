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

// One value for now; user-chosen sorting (FR-016) adds more.
export enum SubscriptionSort {
  STATUS_THEN_DATE = 'status_then_date',
}

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

// The cost of the counted subscriptions of one category (amounts as in SubscriptionResponse).
export interface CategoryCostTotal {
  category: CategoryResponse;
  monthly: string; // "35.83"
  yearly: string; // "429.99"
  subscriptionCount: number;
  // The category's threshold of active subscriptions and how the count compares with it (S-07).
  duplicateThreshold: number;
  duplicateWarning: DuplicateWarning;
}

// GET /subscriptions/totals: the sums are the sums of the category values.
export interface CostTotalsResponse {
  monthly: string;
  yearly: string;
  categories: CategoryCostTotal[]; // monthly desc, then Polish name order
}

// One category on the budget page with its settings (S-07: the duplicate threshold).
export interface CategoryBudget {
  category: CategoryResponse;
  duplicateThreshold: number;
}

// GET and PUT /budget: every category of the user, defaults first, in the order of GET /categories.
export interface BudgetResponse {
  categories: CategoryBudget[];
}
