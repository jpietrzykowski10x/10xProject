import { Component, inject, signal } from '@angular/core';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../auth/auth.service';

@Component({
  selector: 'app-shell',
  imports: [MatMenu, MatMenuItem, MatMenuTrigger, RouterLink, RouterLinkActive],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class AppShell {
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
