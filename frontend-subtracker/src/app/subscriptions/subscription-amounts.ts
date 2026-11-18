import { toGrosze } from '../shared/grosze';
import type { BillingCycle } from './subscription.types';

// The price per month of a subscription, in the API's format ("102.82"). A yearly amount is
// divided in whole grosze ("1233.87" → 123387 → 10282 → "102.82"), never as a float decimal.
// A monthly amount, or one not in the API's format, is returned unchanged.
export function monthlyAmount(amount: string, cycle: BillingCycle): string {
  const grosze = toGrosze(amount);
  if (cycle === 'monthly' || grosze === null) {
    return amount;
  }
  const perMonth = Math.round(grosze / 12);
  return `${Math.floor(perMonth / 100)}.${String(perMonth % 100).padStart(2, '0')}`;
}
