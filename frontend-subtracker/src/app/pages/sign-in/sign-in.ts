import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { FORM_FIELD_DEFAULTS } from '../../shared/form-field-defaults';
import { PublicLayout } from '../../layout/public-layout/public-layout';
import { AuthService } from '../../auth/auth.service';
import { emailValidators } from '../../auth/email-validators';

type SignInState = 'idle' | 'sending' | 'sent' | 'invalid' | 'unavailable';

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

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', emailValidators],
  });
  protected readonly state = signal<SignInState>('idle');

  protected submit(): void {
    if (this.form.invalid) {
      return;
    }

    this.state.set('sending');
    this.auth.requestLink(this.form.getRawValue().email).subscribe({
      next: () => this.state.set('sent'),
      error: (error: HttpErrorResponse) =>
        this.state.set(error.status === 400 ? 'invalid' : 'unavailable'),
    });
  }
}
