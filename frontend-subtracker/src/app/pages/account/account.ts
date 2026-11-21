import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { AppShell } from '../../layout/app-shell/app-shell';
import { CostTotalsStore } from '../../subscriptions/cost-totals.store';
import { openDeleteAccountDialog } from './delete-account-dialog/delete-account-dialog';

// S-10: the signed-in user's account: the address and the deletion of the account. The dialog
// deletes it; the page then drops the cost totals of the gone account and goes to the start page,
// whose notice comes from the navigation state (a reload loses it on purpose).
@Component({
  selector: 'app-account',
  imports: [AppShell, MatButton],
  templateUrl: './account.html',
  styleUrl: './account.scss',
})
export class Account {
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly totals = inject(CostTotalsStore);
  private readonly destroyRef = inject(DestroyRef);

  // Set by authGuard before the page is created.
  protected readonly user = inject(AuthService).currentUser;

  protected confirmDelete(): void {
    const user = this.user();
    if (user === null) {
      return;
    }
    openDeleteAccountDialog(this.dialog, user.email)
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((deleted) => {
        if (deleted !== true) {
          return;
        }
        this.totals.clear();
        void this.router.navigate(['/'], { state: { accountDeleted: true } });
      });
  }
}
