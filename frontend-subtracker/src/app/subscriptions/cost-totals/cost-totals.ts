import { CurrencyPipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { CostTotalsStore } from '../cost-totals.store';
import { subscriptionCountLabel } from '../subscription-labels';

// F2: the cost totals of the signed-in account, used twice by the app shell: in the navy desktop
// column (`column`) and as the second row of the navy phone header (`bar`). The variant changes
// only the layout and sizes. The shell loads the totals; this component only shows the store.
@Component({
  selector: 'app-cost-totals',
  imports: [CurrencyPipe],
  templateUrl: './cost-totals.html',
  styleUrl: './cost-totals.scss',
  // The column layout is the default; the bar restyles it (cost-totals.scss).
  host: { '[class.totals--bar]': "variant() === 'bar'" },
})
export class CostTotals {
  readonly variant = input.required<'column' | 'bar'>();

  protected readonly state = inject(CostTotalsStore).state;
  protected readonly subscriptionCountLabel = subscriptionCountLabel;
}
