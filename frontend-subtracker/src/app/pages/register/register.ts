import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { FORM_FIELD_DEFAULTS } from '../../shared/form-field-defaults';
import { PublicLayout } from '../../layout/public-layout/public-layout';
import { AuthService } from '../../auth/auth.service';
import { emailValidators } from '../../auth/email-validators';

type RegisterState = 'idle' | 'sending' | 'sent' | 'invalid' | 'unavailable';

@Component({
  selector: 'app-register',
  providers: [FORM_FIELD_DEFAULTS],
  imports: [
    MatButton,
    MatCheckbox,
    MatError,
    MatFormField,
    MatInput,
    MatLabel,
    PublicLayout,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './register.html',
})
export class Register {
  private readonly auth = inject(AuthService);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', emailValidators],
    confirmedAdult: [false, Validators.requiredTrue],
    acceptedPrivacyPolicy: [false, Validators.requiredTrue],
  });
  protected readonly state = signal<RegisterState>('idle');
  protected readonly submitted = signal(false);

  protected submit(): void {
    this.submitted.set(true);
    if (this.form.invalid) {
      return;
    }

    this.state.set('sending');
    this.auth.register(this.form.getRawValue()).subscribe({
      next: () => this.state.set('sent'),
      error: (error: HttpErrorResponse) =>
        this.state.set(error.status === 400 ? 'invalid' : 'unavailable'),
    });
  }
}
