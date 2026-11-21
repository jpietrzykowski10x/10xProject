import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { isAdmin } from '../../auth/roles';
import { CostTotals } from '../../subscriptions/cost-totals/cost-totals';
import { CostTotalsStore } from '../../subscriptions/cost-totals.store';

interface NavLink {
  path: string;
  label: string;
}

const NAV_LINKS: readonly NavLink[] = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/subscriptions', label: 'Subskrypcje' },
  { path: '/budget', label: 'Budżet' },
];

// S-09: only for administrators and the superadministrator.
const ADMIN_LINK: NavLink = { path: '/admin/users', label: 'Administracja' };

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

  // S-09: false on the admin pages, which show another account's totals themselves; the shell then
  // neither loads nor shows the signed-in account's totals.
  readonly showTotals = input(true);

  protected readonly user = this.auth.currentUser;
  // The pages of the signed-in app, in the order of both navigations (desktop column, phone menu).
  protected readonly links = computed(() =>
    isAdmin(this.user()) ? [...NAV_LINKS, ADMIN_LINK] : NAV_LINKS,
  );
  protected readonly loggingOut = signal(false);
  protected readonly logoutFailed = signal(false);

  // The store outlives the shell; load() first drops the totals it may still hold.
  ngOnInit(): void {
    if (!this.showTotals()) {
      return;
    }
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
