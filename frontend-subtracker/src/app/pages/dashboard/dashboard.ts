import { CurrencyPipe } from '@angular/common';
import { Component, computed, inject, LOCALE_ID } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { AppShell } from '../../layout/app-shell/app-shell';
import { budgetAlertLevel } from '../../subscriptions/budget-alert';
import { CostTotalsStore } from '../../subscriptions/cost-totals.store';
import { DuplicateWarningIcon } from '../../subscriptions/duplicate-warning-icon/duplicate-warning-icon';
import {
  type BudgetBar,
  budgetAlertNote,
  budgetBar,
  categoryLimitNote,
  duplicateWarningNote,
  subscriptionCountLabel,
} from '../../subscriptions/subscription-labels';
import type { CategoryCostTotal } from '../../subscriptions/subscription.types';

// The description of a category without a duplicate warning, or within its limit.
const NO_WARNING_NOTE = 'W normie';

// S-07/S-08: the full cost summary of the account, with the duplicate warning and the monthly limit
// of every category and the overall limit next to the sums. It shows the store the shell loads (no
// request of its own). Desktop shows a table, the phone a list of cards; CSS switches them at 840px
// like the layouts.
@Component({
  selector: 'app-dashboard',
  imports: [AppShell, CurrencyPipe, DuplicateWarningIcon, MatButton, RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly totals = inject(CostTotalsStore);
  private readonly locale = inject(LOCALE_ID);

  protected readonly state = this.totals.state;
  protected readonly subscriptionCountLabel = subscriptionCountLabel;
  protected readonly budgetAlertLevel = budgetAlertLevel;

  // S-08: the bar of the overall monthly limit, as in the cost totals column; null without a limit
  // ("Brak limitu" instead).
  protected readonly budget = computed<BudgetBar | null>(() => {
    const current = this.state();
    return current.kind === 'ready' ? budgetBar(current.totals, this.locale) : null;
  });

  // "Przekroczono próg: 3 z 2", "Osiągnięto próg: 2 z 2" or "W normie".
  protected statusNote(item: CategoryCostTotal): string {
    return duplicateWarningNote(item) ?? NO_WARNING_NOTE;
  }

  // S-08: "Przekroczono limit", "Wykorzystano limit", "Zbliżasz się do limitu", "W normie" within
  // the limit. Only called for a category with a limit.
  protected limitStatusNote(item: CategoryCostTotal): string {
    return budgetAlertNote(item.budgetAlert) ?? NO_WARNING_NOTE;
  }

  // "Limit: 90,00 z 80,00 zł" on a card; null for a category without a limit.
  protected limitNote(item: CategoryCostTotal): string | null {
    return categoryLimitNote(item, this.locale);
  }

  // "Spróbuj ponownie" after a failed read: the shell's totals are read again with the page.
  protected retry(): void {
    this.totals.load();
  }
}
