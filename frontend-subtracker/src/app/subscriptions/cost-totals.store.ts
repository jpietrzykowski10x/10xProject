import { inject, Injectable, signal } from '@angular/core';
import type { Subscription as RxSubscription } from 'rxjs';
import type { CostTotals } from './subscription.types';
import { SubscriptionsService } from './subscriptions.service';

export type CostTotalsState =
  { kind: 'loading' } | { kind: 'ready'; totals: CostTotals } | { kind: 'error' };

const LOADING: CostTotalsState = { kind: 'loading' };

// The one source of the cost totals for the app shell (desktop column and phone header) and the
// /subscriptions page, which refreshes them after every change. It outlives the shell, so the first
// load of a shell and a sign-out drop the totals: the next account never sees the previous one's.
// A newer request cancels the older one, so an older response can never overwrite a newer one.
@Injectable({ providedIn: 'root' })
export class CostTotalsStore {
  private readonly subscriptions = inject(SubscriptionsService);
  private readonly current = signal<CostTotalsState>(LOADING);
  private request?: RxSubscription;

  readonly state = this.current.asReadonly();

  // Drops what is shown and reads the totals again.
  load(): void {
    this.current.set(LOADING);
    this.fetch();
  }

  // Reads the totals again (after a save or a delete) and keeps the current ones on screen until
  // the answer. A failure keeps totals already shown; only with nothing shown it is an error.
  refresh(): void {
    this.fetch();
  }

  // After a sign-out: nothing of the previous account stays.
  clear(): void {
    this.request?.unsubscribe();
    this.current.set(LOADING);
  }

  private fetch(): void {
    this.request?.unsubscribe();
    this.request = this.subscriptions.totals().subscribe({
      next: (totals) => this.current.set({ kind: 'ready', totals }),
      error: () => {
        if (this.current().kind !== 'ready') {
          this.current.set({ kind: 'error' });
        }
      },
    });
  }
}
