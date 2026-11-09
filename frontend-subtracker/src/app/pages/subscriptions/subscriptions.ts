import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';

@Component({
  selector: 'app-subscriptions',
  templateUrl: './subscriptions.html',
})
export class Subscriptions {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly user = this.auth.currentUser;
  protected readonly loggingOut = signal(false);
  protected readonly logoutFailed = signal(false);

  protected logout(): void {
    this.loggingOut.set(true);
    this.logoutFailed.set(false);
    this.auth.logout().subscribe({
      next: () => void this.router.navigate(['/sign-in']),
      error: () => {
        this.loggingOut.set(false);
        this.logoutFailed.set(true);
      },
    });
  }
}
