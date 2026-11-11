import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { AppShell } from '../../layout/app-shell/app-shell';
import type { Subscription } from '../../subscriptions/subscription.types';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { SubscriptionTable } from './subscription-table/subscription-table';

type ListState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; subscriptions: Subscription[] };

@Component({
  selector: 'app-subscriptions',
  imports: [AppShell, MatButton, SubscriptionTable],
  templateUrl: './subscriptions.html',
  styleUrl: './subscriptions.scss',
})
export class Subscriptions implements OnInit {
  private readonly subscriptions = inject(SubscriptionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly state = signal<ListState>({ kind: 'loading' });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.state.set({ kind: 'loading' });
    // The API returns the list in display order; it is not sorted again here.
    this.subscriptions
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (subscriptions) => this.state.set({ kind: 'ready', subscriptions }),
        error: () => this.state.set({ kind: 'error' }),
      });
  }
}
