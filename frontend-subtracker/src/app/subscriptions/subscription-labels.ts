// The single source of the Polish names of subscription codes, for the list and the form.
import { daysFromToday } from '../shared/date-only';
import { polishPlural } from '../shared/polish-plural';
import { countDuplicateWarnings } from './duplicate-warning';
import type {
  BillingCycle,
  CategoryCostTotal,
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

// "dziś", "jutro", "za N dni"; null for a past day, since "za -3 dni" makes no sense. The lifecycle
// job (S-05) moves past dates on daily at 00:05 and on every API start, so a past day here means at
// most a day's delay (or a list opened before midnight).
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

// The status message after a new subscription is saved.
export function addedSubscriptionMessage(name: string): string {
  return `Dodano subskrypcję „${name}”.`;
}

// The status message after an edited subscription is saved.
export function updatedSubscriptionMessage(name: string): string {
  return `Zapisano zmiany w subskrypcji „${name}”.`;
}

// The status message after a subscription is deleted.
export function deletedSubscriptionMessage(name: string): string {
  return `Usunięto subskrypcję „${name}”.`;
}

// The status message after a subscription is cancelled (it is now cancelled_pending).
export function cancelledSubscriptionMessage(name: string): string {
  return `Anulowano subskrypcję „${name}”.`;
}

// The status message after a cancelled_pending subscription is resumed (it is active again).
export function resumedSubscriptionMessage(name: string): string {
  return `Przywrócono subskrypcję „${name}”.`;
}

// The error when "Przywróć" did not reach the API or the API failed; the list stays as it was.
export function resumeFailedMessage(name: string): string {
  return `Nie udało się przywrócić subskrypcji „${name}”. Spróbuj ponownie.`;
}

// The status message when a cancel or resume finds the subscription in another status (409),
// e.g. changed in another tab; the list is read again.
export const conflictSubscriptionMessage = 'Stan subskrypcji zmienił się w międzyczasie.';

// The status message when the edited subscription is gone (e.g. deleted in another tab).
export const missingSubscriptionMessage = 'Tej subskrypcji już nie ma na liście.';

const SUBSCRIPTION_FORMS = { one: 'subskrypcja', few: 'subskrypcje', many: 'subskrypcji' };

// "1 subskrypcja", "3 subskrypcje", "12 subskrypcji": the count in a category of the cost totals.
export function subscriptionCountLabel(count: number): string {
  return `${count} ${polishPlural(count, SUBSCRIPTION_FORMS)}`;
}

// The description of a category's duplicate warning (S-07): "Osiągnięto próg: 2 z 2",
// "Przekroczono próg: 3 z 2"; null without a warning.
export function duplicateWarningNote(item: CategoryCostTotal): string | null {
  switch (item.duplicateWarning) {
    case 'reached':
      return `Osiągnięto próg: ${item.subscriptionCount} z ${item.duplicateThreshold}`;
    case 'exceeded':
      return `Przekroczono próg: ${item.subscriptionCount} z ${item.duplicateThreshold}`;
    default:
      return null;
  }
}

const EXCEEDED_FORMS = {
  one: 'kategoria przekroczyła',
  few: 'kategorie przekroczyły',
  many: 'kategorii przekroczyło',
};
const REACHED_FORMS = {
  one: 'kategoria osiągnęła',
  few: 'kategorie osiągnęły',
  many: 'kategorii osiągnęło',
};

// The spoken state of the collapsed category list: "1 kategoria przekroczyła próg, 2 kategorie
// osiągnęły próg"; null when no category warns.
export function duplicateWarningsSummary(categories: readonly CategoryCostTotal[]): string | null {
  const parts: string[] = [];
  const exceeded = countDuplicateWarnings(categories, 'exceeded');
  if (exceeded > 0) {
    parts.push(`${exceeded} ${polishPlural(exceeded, EXCEEDED_FORMS)} próg`);
  }
  const reached = countDuplicateWarnings(categories, 'reached');
  if (reached > 0) {
    parts.push(`${reached} ${polishPlural(reached, REACHED_FORMS)} próg`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}
