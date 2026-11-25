import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { FORM_FIELD_DEFAULTS } from '../../shared/form-field-defaults';
import { PublicLayout } from '../../layout/public-layout/public-layout';
import { accountBlockedContact } from '../../auth/account-blocked';
import { AuthService } from '../../auth/auth.service';
import { ErrorReporter } from '../../shared/error-reporter';
import { emailValidators } from '../../auth/email-validators';

type SignInState = 'idle' | 'sending' | 'sent' | 'invalid' | 'blocked' | 'unavailable';

@Component({
  selector: 'app-sign-in',
  providers: [FORM_FIELD_DEFAULTS],
  imports: [
    MatButton,
    MatError,
    MatFormField,
    MatInput,
    MatLabel,
    PublicLayout,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './sign-in.html',
})
export class SignIn {
  private readonly auth = inject(AuthService);
  private readonly reporter = inject(ErrorReporter);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', emailValidators],
  });
  // The contact address of a 403 account_blocked answer; '' when the API sent none.
  protected readonly blockedContact = signal('');
  protected readonly state = signal<SignInState>('idle');

  protected submit(): void {
    if (this.form.invalid) {
      return;
    }

    this.state.set('sending');
    this.auth.requestLink(this.form.getRawValue().email).subscribe({
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
        this.reporter.report('SignIn', error);
        this.state.set('unavailable');
      },
    });
  }
}
