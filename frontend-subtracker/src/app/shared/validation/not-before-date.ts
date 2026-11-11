import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { toDateOnly } from '../date-only';

// The control's day must not come before the day `earliest()` returns (null: no limit). Compared
// as calendar days, so the time of day never matters. The other control is read at validation
// time; re-run this validator when it changes.
export function notBeforeDate(earliest: () => Date | null): ValidatorFn {
  return (control: AbstractControl<Date | null>): ValidationErrors | null => {
    const limit = earliest();
    const value = control.value;
    return value !== null && limit !== null && toDateOnly(value) < toDateOnly(limit)
      ? { notBeforeDate: true }
      : null;
  };
}
