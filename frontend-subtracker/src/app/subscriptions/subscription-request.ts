import { toDateOnly } from '../shared/date-only';
import { parseAmount } from './subscription-validators';
import type {
  BillingCycle,
  CreateSubscriptionRequest,
  PaymentMethod,
  SubscriptionStatus,
} from './subscription.types';

// The add form's value as getRawValue() gives it: the amount as typed, the dates as picked.
export interface SubscriptionFormValue {
  name: string;
  categoryId: string;
  amount: string;
  billingCycle: BillingCycle;
  paymentMethod: PaymentMethod | '';
  status: SubscriptionStatus;
  trialEndDate: Date | null;
  nextBillingDate: Date | null;
}

// The POST /subscriptions body for a form value, or null when a field cannot be sent. The end of
// the trial goes only with a trial: the API refuses it for every other status.
export function toCreateSubscriptionRequest(
  value: SubscriptionFormValue,
): CreateSubscriptionRequest | null {
  const amount = parseAmount(value.amount);
  const trial = value.status === 'trial';
  if (
    amount === null ||
    value.paymentMethod === '' ||
    value.nextBillingDate === null ||
    (trial && value.trialEndDate === null)
  ) {
    return null;
  }
  return {
    name: value.name.trim(),
    categoryId: value.categoryId,
    amount,
    billingCycle: value.billingCycle,
    paymentMethod: value.paymentMethod,
    status: value.status,
    nextBillingDate: toDateOnly(value.nextBillingDate),
    ...(trial && value.trialEndDate !== null
      ? { trialEndDate: toDateOnly(value.trialEndDate) }
      : {}),
  };
}
