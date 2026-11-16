import { BreakpointObserver } from '@angular/cdk/layout';
import { CurrencyPipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatTooltip } from '@angular/material/tooltip';
import { map } from 'rxjs';
import { PHONE_MEDIA_QUERY } from '../../../shared/breakpoints';
import { DateOnlyPipe } from '../../../shared/date-only.pipe';
import { TypedCellDef, TypedRowDef } from '../../../shared/typed-table-defs';
import { monthlyAmount } from '../../../subscriptions/subscription-amounts';
import {
  BILLING_CYCLE_NOTES,
  BILLING_CYCLE_SHORT,
  dateNote,
  PAYMENT_METHOD_LABELS,
  phoneDatePrefix,
  referenceDate,
  STATUS_LABELS,
} from '../../../subscriptions/subscription-labels';
import type { Subscription } from '../../../subscriptions/subscription.types';

const DESKTOP_COLUMNS = ['name', 'payment', 'status', 'date', 'amount', 'actions'];
const PHONE_COLUMNS = ['summary'];

// One table for both layouts. Desktop (F2-Lista): five columns and the row actions, with a header
// row. Phone (F2-Tel-Lista): one column whose cell is a button expanding a detail row, which holds
// the row actions; the header row gets no cells there, so the phone carries no hidden desktop
// headers. /subscriptions is rendered only in the browser (RenderMode.Client), so the breakpoint is
// known before the first paint. The table only emits the actions; the page handles them.
@Component({
  selector: 'app-subscription-table',
  imports: [
    CurrencyPipe,
    DateOnlyPipe,
    MatButton,
    MatIconButton,
    MatTableModule,
    MatTooltip,
    NgTemplateOutlet,
    TypedCellDef,
    TypedRowDef,
  ],
  templateUrl: './subscription-table.html',
  styleUrl: './subscription-table.scss',
})
export class SubscriptionTable {
  readonly subscriptions = input.required<Subscription[]>();
  // The subscription whose "Przywróć" is in flight. One resume at a time: every "Przywróć" stays
  // disabled until the answer, so no click is silently ignored.
  readonly resumingId = input<string | null>(null);
  // The subscription whose edit is being saved; its cancel, resume and delete wait for the answer.
  readonly savingId = input<string | null>(null);
  readonly edit = output<Subscription>();
  readonly remove = output<Subscription>();
  // "Anuluj subskrypcję" (active, trial) and "Przywróć" (cancelled_pending); a cancelled
  // subscription has neither.
  readonly cancel = output<Subscription>();
  readonly resume = output<Subscription>();

  private readonly breakpoints = inject(BreakpointObserver);

  // isMatched reads the media query synchronously, so the first frame already has the right columns.
  protected readonly isPhone = toSignal(
    this.breakpoints.observe(PHONE_MEDIA_QUERY).pipe(map((state) => state.matches)),
    { initialValue: this.breakpoints.isMatched(PHONE_MEDIA_QUERY) },
  );
  protected readonly columns = computed(() => (this.isPhone() ? PHONE_COLUMNS : DESKTOP_COLUMNS));
  protected readonly headerColumns = computed(() => (this.isPhone() ? [] : DESKTOP_COLUMNS));
  protected readonly expandedId = signal<string | null>(null);

  // "za N dni" counts from the day the list was opened.
  protected readonly today = new Date();

  protected readonly statusLabels = STATUS_LABELS;
  protected readonly paymentLabels = PAYMENT_METHOD_LABELS;
  protected readonly cycleNotes = BILLING_CYCLE_NOTES;
  protected readonly cycleShort = BILLING_CYCLE_SHORT;
  protected readonly referenceDate = referenceDate;
  protected readonly dateNote = dateNote;
  protected readonly phoneDatePrefix = phoneDatePrefix;
  protected readonly monthlyAmount = monthlyAmount;

  protected readonly trackById = (_index: number, subscription: Subscription): string =>
    subscription.id;

  protected cancellable(subscription: Subscription): boolean {
    return subscription.status === 'active' || subscription.status === 'trial';
  }

  protected toggle(id: string): void {
    this.expandedId.update((current) => (current === id ? null : id));
  }
}
