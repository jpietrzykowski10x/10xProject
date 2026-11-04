import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../auth/auth.service';

type SignInState = 'idle' | 'sending' | 'sent' | 'invalid' | 'unavailable';

@Component({
  selector: 'app-sign-in',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './sign-in.html',
})
export class SignIn {
  private readonly auth = inject(AuthService);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
  });
  protected readonly state = signal<SignInState>('idle');
  protected readonly submitted = signal(false);

  protected submit(): void {
    this.submitted.set(true);
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
