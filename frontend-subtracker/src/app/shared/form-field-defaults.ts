import { Provider } from '@angular/core';
import {
  MAT_FORM_FIELD_DEFAULT_OPTIONS,
  MatFormFieldDefaultOptions,
} from '@angular/material/form-field';

// Outline fields for every form. Provided on each form component, not in app.config.ts: a root
// import of @angular/material/form-field puts form-field and @angular/forms (~120 kB) into the
// initial bundle, while only the lazy form pages need them.
export const FORM_FIELD_DEFAULTS: Provider = {
  provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
  useValue: { appearance: 'outline' } satisfies MatFormFieldDefaultOptions,
};
