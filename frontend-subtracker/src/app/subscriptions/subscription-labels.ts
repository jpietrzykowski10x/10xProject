// The single source of the Polish names of subscription codes, for the list and the form.
import { daysFromToday } from '../shared/date-only';
import type {
  BillingCycle,
  PaymentMethod,
  Subscription,
  SubscriptionStatus,
} from './subscription.types';

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trial: 'Trial',
  active: 'Aktywna',
  cancelled_pending: 'W trakcie anulowania',
  cancelled: 'Anulowana',
};

// The billing-cycle switch in the form.
export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: 'Miesiąc',
  yearly: 'Rok',
};

// Under the amount in the desktop table.
export const BILLING_CYCLE_NOTES: Record<BillingCycle, string> = {
  monthly: 'miesięcznie',
  yearly: 'rocznie',
};

// After the amount in the phone list.
export const BILLING_CYCLE_SHORT: Record<BillingCycle, string> = {
  monthly: '/ mies.',
  yearly: '/ rok',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  credit_card: 'Karta kredytowa',
  debit_card: 'Karta debetowa',
  blik: 'BLIK',
  bank_transfer: 'Przelew lub zlecenie stałe',
  e_wallet: 'Portfel elektroniczny',
  other: 'Inne',
};

// What the date in the "Kolejna data" column means for each status.
export const DATE_NOTES: Record<SubscriptionStatus, string> = {
  trial: 'koniec triala',
  active: 'rozliczenie',
  cancelled_pending: 'do',
  cancelled: 'zakończona',
};

// The date the list shows and the API sorts by: the end of the trial for a trial, otherwise the
// next billing date.
export function referenceDate(subscription: Subscription): string {
  return subscription.status === 'trial' && subscription.trialEndDate !== null
    ? subscription.trialEndDate
    : subscription.nextBillingDate;
}

// "dziś", "jutro", "za N dni"; null for a past day: the status job (S-05) may not have moved the
// subscription on yet, and "za -3 dni" makes no sense.
export function relativeDays(days: number | null): string | null {
  if (days === null || days < 0) {
    return null;
  }
  if (days === 0) {
    return 'dziś';
  }
  return days === 1 ? 'jutro' : `za ${days} dni`;
}

// How far away the end of a trial is; only a trial shows it.
function trialCountdown(subscription: Subscription, today: Date): string | null {
  return subscription.status === 'trial'
    ? relativeDays(daysFromToday(referenceDate(subscription), today))
    : null;
}

// The note under the date in the desktop table: "koniec triala, za 4 dni", "rozliczenie", …
export function dateNote(subscription: Subscription, today: Date): string {
  const countdown = trialCountdown(subscription, today);
  const note = DATE_NOTES[subscription.status];
  return countdown === null ? note : `${note}, ${countdown}`;
}

// The text before the date on the phone: "za 4 dni, " for a trial, "do " while the cancellation
// runs out, nothing otherwise.
export function phoneDatePrefix(subscription: Subscription, today: Date): string {
  if (subscription.status === 'cancelled_pending') {
    return 'do ';
  }
  const countdown = trialCountdown(subscription, today);
  return countdown === null ? '' : `${countdown}, `;
}
