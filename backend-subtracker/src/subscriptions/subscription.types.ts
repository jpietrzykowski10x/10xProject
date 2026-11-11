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
