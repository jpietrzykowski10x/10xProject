import { CurrencyPipe } from '@angular/common';
import { Component, LOCALE_ID, computed, inject, input } from '@angular/core';
import {
  type AlertLevel,
  budgetAlertLevel,
  budgetBarFill,
  categoryAlertLevel,
  mostSevereAlertLevel,
} from '../budget-alert';
import { CostTotalsStore } from '../cost-totals.store';
import { DuplicateWarningIcon } from '../duplicate-warning-icon/duplicate-warning-icon';
import {
  budgetAlertNote,
  budgetUsageText,
  categoryAlertsSummary,
  categoryLimitNote,
  duplicateWarningNote,
  subscriptionCountLabel,
} from '../subscription-labels';
import type { BudgetAlert, CategoryCostTotal } from '../subscription.types';

// The overall monthly limit as the column shows it under the monthly sum (S-08).
interface BudgetBar {
  // 0–100, capped at a full bar.
  fill: number;
  // "170,00 z 200,00 zł (85%)"
  usage: string;
  alert: BudgetAlert;
  level: AlertLevel;
  // "Zbliżasz się do limitu"; null without an alert.
  note: string | null;
}

// F2: the cost totals of the signed-in account, used twice by the app shell: in the navy desktop
// column (`column`) and as the second row of the navy phone header (`bar`). The variant changes
// only the layout and sizes. The shell loads the totals; this component only shows the store.
@Component({
  selector: 'app-cost-totals',
  imports: [CurrencyPipe, DuplicateWarningIcon],
  templateUrl: './cost-totals.html',
  styleUrl: './cost-totals.scss',
  // The column layout is the default; the bar restyles it (cost-totals.scss).
  host: { '[class.totals--bar]': "variant() === 'bar'" },
})
export class CostTotals {
  readonly variant = input.required<'column' | 'bar'>();

  private readonly locale = inject(LOCALE_ID);

  protected readonly state = inject(CostTotalsStore).state;
  protected readonly subscriptionCountLabel = subscriptionCountLabel;
  protected readonly duplicateWarningNote = duplicateWarningNote;
  protected readonly budgetAlertNote = budgetAlertNote;
  protected readonly budgetAlertLevel = budgetAlertLevel;
  protected readonly categoryAlertLevel = categoryAlertLevel;

  // S-08: the bar of the overall monthly limit; null without a limit (no bar, no text).
  protected readonly budget = computed<BudgetBar | null>(() => {
    const current = this.state();
    if (current.kind !== 'ready' || current.totals.monthlyLimit === null) {
      return null;
    }
    const { monthly, monthlyLimit, budgetAlert } = current.totals;
    return {
      fill: budgetBarFill(monthly, monthlyLimit),
      usage: budgetUsageText(monthly, monthlyLimit, this.locale),
      alert: budgetAlert,
      level: budgetAlertLevel(budgetAlert),
      note: budgetAlertNote(budgetAlert),
    };
  });

  // S-07/S-08: the most severe state of the categories, duplicates and limits together, shown on the
  // collapsed list.
  protected readonly worstWarning = computed<AlertLevel>(() => {
    const current = this.state();
    return current.kind === 'ready' ? mostSevereAlertLevel(current.totals.categories) : 'none';
  });

  // The accessible name of the icon on the collapsed list ("1 kategoria przekroczyła próg,
  // 1 kategoria zbliża się do limitu").
  protected readonly warningsSummary = computed(() => {
    const current = this.state();
    return current.kind === 'ready' ? categoryAlertsSummary(current.totals.categories) : null;
  });

  // "Limit: 90,00 z 80,00 zł"; null for a category without a limit.
  protected limitNote(item: CategoryCostTotal): string | null {
    return categoryLimitNote(item, this.locale);
  }
}
