import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../auth/auth.service';

type VerifyState = 'ready' | 'sending' | 'invalid' | 'unavailable';

@Component({
  selector: 'app-verify-link',
  imports: [RouterLink],
  templateUrl: './verify-link.html',
})
export class VerifyLink {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly token = new URLSearchParams(inject(ActivatedRoute).snapshot.fragment ?? '').get(
    'token',
  );

  protected readonly state = signal<VerifyState>(this.token ? 'ready' : 'invalid');

  // Runs only on the click: mail scanners open the link, and that must not consume the token.
  protected signIn(): void {
    if (!this.token) {
      return;
    }

    this.state.set('sending');
    this.auth.verify(this.token).subscribe({
      // replaceUrl takes the used token out of the address bar and the history.
      next: () => void this.router.navigate(['/subscriptions'], { replaceUrl: true }),
      // 400 comes from validation of a malformed token, so to the user it is a bad link as well.
      error: (error: HttpErrorResponse) =>
        this.state.set(error.status === 400 || error.status === 401 ? 'invalid' : 'unavailable'),
    });
  }
}
