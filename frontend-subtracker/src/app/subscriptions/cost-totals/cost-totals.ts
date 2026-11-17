import { CurrencyPipe } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { CostTotalsStore } from '../cost-totals.store';
import { mostSevereDuplicateWarning } from '../duplicate-warning';
import { DuplicateWarningIcon } from '../duplicate-warning-icon/duplicate-warning-icon';
import {
  duplicateWarningNote,
  duplicateWarningsSummary,
  subscriptionCountLabel,
} from '../subscription-labels';
import type { DuplicateWarning } from '../subscription.types';

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

  protected readonly state = inject(CostTotalsStore).state;
  protected readonly subscriptionCountLabel = subscriptionCountLabel;
  protected readonly duplicateWarningNote = duplicateWarningNote;

  // S-07: the most severe duplicate warning of the categories, shown on the collapsed list.
  protected readonly worstWarning = computed<DuplicateWarning>(() => {
    const current = this.state();
    return current.kind === 'ready'
      ? mostSevereDuplicateWarning(current.totals.categories)
      : 'none';
  });

  // The accessible name of the icon on the collapsed list ("1 kategoria przekroczyła próg").
  protected readonly warningsSummary = computed(() => {
    const current = this.state();
    return current.kind === 'ready' ? duplicateWarningsSummary(current.totals.categories) : null;
  });
}
