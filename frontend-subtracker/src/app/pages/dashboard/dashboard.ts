import { CurrencyPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { AppShell } from '../../layout/app-shell/app-shell';
import { CostTotalsStore } from '../../subscriptions/cost-totals.store';
import { DuplicateWarningIcon } from '../../subscriptions/duplicate-warning-icon/duplicate-warning-icon';
import {
  duplicateWarningNote,
  subscriptionCountLabel,
} from '../../subscriptions/subscription-labels';
import type { CategoryCostTotal } from '../../subscriptions/subscription.types';

// The description of a category without a duplicate warning.
const NO_WARNING_NOTE = 'W normie';

// S-07: the full cost summary of the account, with the duplicate warning of every category. It
// shows the store the shell loads (no request of its own); S-08 adds limits and charts here.
// Desktop shows a table, the phone a list of cards; CSS switches them at 840px like the layouts.
@Component({
  selector: 'app-dashboard',
  imports: [AppShell, CurrencyPipe, DuplicateWarningIcon, MatButton, RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly totals = inject(CostTotalsStore);

  protected readonly state = this.totals.state;
  protected readonly subscriptionCountLabel = subscriptionCountLabel;

  // "Przekroczono próg: 3 z 2", "Osiągnięto próg: 2 z 2" or "W normie".
  protected statusNote(item: CategoryCostTotal): string {
    return duplicateWarningNote(item) ?? NO_WARNING_NOTE;
  }

  // "Spróbuj ponownie" after a failed read: the shell's totals are read again with the page.
  protected retry(): void {
    this.totals.load();
  }
}
