import { parseDateOnly, toDateOnly } from '../shared/date-only';
import { toAmountText } from '../shared/grosze';
import { parseAmount } from './subscription-validators';
import type {
  BillingCycle,
  CreateSubscriptionRequest,
  PaymentMethod,
  Subscription,
  SubscriptionStatus,
} from './subscription.types';

// The form's value as getRawValue() gives it: the amount as typed, the dates as picked.
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

// The form's value for an existing subscription, the reverse of toCreateSubscriptionRequest: the
// amount the Polish way ("43.00" → "43,00"), the calendar days as local Dates, and the end of the
// trial only for a trial.
export function toSubscriptionFormValue(subscription: Subscription): SubscriptionFormValue {
  const trialEndDate =
    subscription.status === 'trial' && subscription.trialEndDate !== null
      ? parseDateOnly(subscription.trialEndDate)
      : null;
  return {
    name: subscription.name,
    categoryId: subscription.category.id,
    amount: toAmountText(subscription.amount),
    billingCycle: subscription.billingCycle,
    paymentMethod: subscription.paymentMethod,
    status: subscription.status,
    trialEndDate,
    nextBillingDate: parseDateOnly(subscription.nextBillingDate),
  };
}
