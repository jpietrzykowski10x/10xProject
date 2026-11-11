import type { BillingCycle } from './subscription.types';

const API_AMOUNT = /^(\d+)\.(\d{2})$/;

// The price per month of a subscription, in the API's format ("102.82"). A yearly amount is
// divided in whole grosze ("1233.87" → 123387 → 10282 → "102.82"), never as a float decimal.
// A monthly amount, or one not in the API's format, is returned unchanged.
export function monthlyAmount(amount: string, cycle: BillingCycle): string {
  const match = API_AMOUNT.exec(amount);
  if (cycle === 'monthly' || match === null) {
    return amount;
  }
  const grosze = Number(match[1]) * 100 + Number(match[2]);
  const perMonth = Math.round(grosze / 12);
  return `${Math.floor(perMonth / 100)}.${String(perMonth % 100).padStart(2, '0')}`;
}
