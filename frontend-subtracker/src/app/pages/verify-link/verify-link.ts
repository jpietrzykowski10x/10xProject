import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PublicLayout } from '../../layout/public-layout/public-layout';
import { accountBlockedContact } from '../../auth/account-blocked';
import { AuthService } from '../../auth/auth.service';

type VerifyState = 'ready' | 'sending' | 'invalid' | 'blocked' | 'unavailable';

@Component({
  selector: 'app-verify-link',
  imports: [MatButton, PublicLayout, RouterLink],
  templateUrl: './verify-link.html',
})
export class VerifyLink {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly token = new URLSearchParams(inject(ActivatedRoute).snapshot.fragment ?? '').get(
    'token',
  );

  // The contact address of a 403 account_blocked answer; '' when the API sent none.
  protected readonly blockedContact = signal('');
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
      error: (error: HttpErrorResponse) => {
        const contact = accountBlockedContact(error);
        if (contact !== null) {
          this.blockedContact.set(contact);
          this.state.set('blocked');
          return;
        }
        this.state.set(error.status === 400 || error.status === 401 ? 'invalid' : 'unavailable');
      },
    });
  }
}
