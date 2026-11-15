import { Component, inject, OnInit, signal } from '@angular/core';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { CostTotals } from '../../subscriptions/cost-totals/cost-totals';
import { CostTotalsStore } from '../../subscriptions/cost-totals.store';

@Component({
  selector: 'app-shell',
  imports: [CostTotals, MatMenu, MatMenuItem, MatMenuTrigger, RouterLink, RouterLinkActive],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class AppShell implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly totals = inject(CostTotalsStore);

  protected readonly user = this.auth.currentUser;
  protected readonly loggingOut = signal(false);
  protected readonly logoutFailed = signal(false);

  // The store outlives the shell; load() first drops the totals it may still hold.
  ngOnInit(): void {
    this.totals.load();
  }

  protected logout(): void {
    this.loggingOut.set(true);
    this.logoutFailed.set(false);
    this.auth.logout().subscribe({
      next: () => {
        this.totals.clear();
        void this.router.navigate(['/sign-in']);
      },
      error: () => {
        this.loggingOut.set(false);
        this.logoutFailed.set(true);
      },
    });
  }
}
