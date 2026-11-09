import { Validators } from '@angular/forms';

// Validators.email accepts addresses the API refuses, such as a@b: the domain needs a real top
// level. Catching that here gives the same message without a failed request.
export const emailValidators = [
  Validators.required,
  Validators.email,
  Validators.pattern(/\.([a-z]{2,}|xn--[a-z0-9-]+)$/i),
];
