// The API contract of backend-subtracker/src/subscriptions (subscription.types.ts, dtos/).
// Codes stay in English; Polish names live in subscription-labels.ts.

export type SubscriptionStatus = 'trial' | 'active' | 'cancelled_pending' | 'cancelled';

export type BillingCycle = 'monthly' | 'yearly';

// FR-004: credit card, debit card, BLIK, bank transfer / standing order, e-wallet, other.
export type PaymentMethod =
  'credit_card' | 'debit_card' | 'blik' | 'bank_transfer' | 'e_wallet' | 'other';

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
