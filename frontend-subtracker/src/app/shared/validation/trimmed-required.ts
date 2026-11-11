import type { AbstractControl, ValidationErrors } from '@angular/forms';

// Validators.required lets "   " through, and the API trims names before it checks them.
export function trimmedRequired(control: AbstractControl<string>): ValidationErrors | null {
  return control.value.trim() === '' ? { required: true } : null;
}
