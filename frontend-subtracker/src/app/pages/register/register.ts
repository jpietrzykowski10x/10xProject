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
import { accountBlockedContact } from '../../auth/account-blocked';
import { AuthService } from '../../auth/auth.service';
import { ErrorReporter } from '../../shared/error-reporter';
import { emailValidators } from '../../auth/email-validators';

type RegisterState = 'idle' | 'sending' | 'sent' | 'invalid' | 'blocked' | 'unavailable';

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
  private readonly reporter = inject(ErrorReporter);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', emailValidators],
    confirmedAdult: [false, Validators.requiredTrue],
    acceptedPrivacyPolicy: [false, Validators.requiredTrue],
  });
  // The contact address of a 403 account_blocked answer; '' when the API sent none.
  protected readonly blockedContact = signal('');
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
      error: (error: HttpErrorResponse) => {
        const contact = accountBlockedContact(error);
        if (contact !== null) {
          this.blockedContact.set(contact);
          this.state.set('blocked');
          return;
        }
        if (error.status === 400) {
          this.state.set('invalid');
          return;
        }
        this.reporter.report('Register', error);
        this.state.set('unavailable');
      },
    });
  }
}
