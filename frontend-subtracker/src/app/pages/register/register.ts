import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { emailValidators } from '../../auth/email-validators';

type RegisterState = 'idle' | 'sending' | 'sent' | 'invalid' | 'unavailable';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink],
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
