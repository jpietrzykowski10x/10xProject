import type { AbstractControl, ValidationErrors } from '@angular/forms';
import { parseDecimal } from '../shared/decimal';
import { AMOUNT_MAX } from './subscription.types';

// The amount as the API takes it: 0 to 99 999,99 with at most two decimals, typed with a comma or
// a dot. Null for anything the API would refuse ("abc", "-1", "100 000", "1,234").
export function parseAmount(value: string): number | null {
  const amount = parseDecimal(value, 2);
  return amount !== null && amount <= AMOUNT_MAX ? amount : null;
}

export function amountValidator(control: AbstractControl<string>): ValidationErrors | null {
  return parseAmount(control.value) === null ? { amount: true } : null;
}
