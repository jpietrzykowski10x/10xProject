import { BreakpointObserver } from '@angular/cdk/layout';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { map, type Subscription as RxSubscription } from 'rxjs';
import { AppShell } from '../../layout/app-shell/app-shell';
import { PHONE_MEDIA_QUERY, WIDE_MEDIA_QUERY } from '../../shared/breakpoints';
import { SubscriptionForm } from '../../subscriptions/subscription-form/subscription-form';
import { addedSubscriptionMessage } from '../../subscriptions/subscription-labels';
import type { Subscription } from '../../subscriptions/subscription.types';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { SubscriptionTable } from './subscription-table/subscription-table';

type ListState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; subscriptions: Subscription[] };

// F2-Lista and F2-Tel-Dodawanie: the list and one "adding" state with the "Nowa subskrypcja"
// panel. Only CSS decides how the panel looks: a column beside the table from 1200px, a drawer
// over it from 840px, the whole content area (list hidden) on the phone. It is one element with
// one form, so typed data survives a resize.
@Component({
  selector: 'app-subscriptions',
  imports: [AppShell, MatButton, SubscriptionForm, SubscriptionTable],
  templateUrl: './subscriptions.html',
  styleUrl: './subscriptions.scss',
})
export class Subscriptions implements OnInit {
  private readonly subscriptions = inject(SubscriptionsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly breakpoints = inject(BreakpointObserver);
  // On a mat-flat-button host the template ref is the MatButton instance (no nativeElement);
  // MatButton has its own focus().
  private readonly addButton = viewChild.required<MatButton>('addButton');
  private readonly phoneAddButton = viewChild.required<MatButton>('phoneAddButton');
  private readonly panelTitle = viewChild<ElementRef<HTMLElement>>('panelTitle');

  // The empty list opens the panel by itself once per visit, and never after the first answer.
  private autoOpenDecided = false;

  protected readonly state = signal<ListState>({ kind: 'loading' });
  private loadRequest?: RxSubscription;
  protected readonly adding = signal(false);
  // The form stays in the DOM after a plain close, so reopening continues with the typed data;
  // a save removes it, so the next opening starts with an empty form.
  protected readonly formMounted = signal(false);
  protected readonly addedMessage = signal<string | null>(null);
  protected readonly isPhone = toSignal(
    this.breakpoints.observe(PHONE_MEDIA_QUERY).pipe(map((state) => state.matches)),
    { initialValue: this.breakpoints.isMatched(PHONE_MEDIA_QUERY) },
  );
  // From 1200px the panel stands beside the list; below that it covers it (a drawer, or the whole
  // content area on the phone), so the list is made inert while the panel is open.
  private readonly isWide = toSignal(
    this.breakpoints.observe(WIDE_MEDIA_QUERY).pipe(map((state) => state.matches)),
    { initialValue: this.breakpoints.isMatched(WIDE_MEDIA_QUERY) },
  );
  protected readonly listCovered = computed(() => this.adding() && !this.isWide());

  ngOnInit(): void {
    this.load();
  }

  // `quiet` keeps the current list on screen while it is read again (after a save).
  // A newer load cancels the older request, so an older response can never overwrite a newer one.
  // A failed quiet load keeps the list already on screen.
  protected load(quiet = false): void {
    if (!quiet) {
      this.state.set({ kind: 'loading' });
    }
    this.loadRequest?.unsubscribe();
    // The API returns the list in display order; it is not sorted again here.
    this.loadRequest = this.subscriptions
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (subscriptions) => {
          this.state.set({ kind: 'ready', subscriptions });
          this.autoOpen(subscriptions.length === 0);
        },
        error: () => {
          if (!(quiet && this.state().kind === 'ready')) {
            this.state.set({ kind: 'error' });
          }
        },
      });
  }

  protected toggleAdding(): void {
    if (this.adding()) {
      this.close();
    } else {
      this.open();
    }
  }

  // Escape closes the panel, except when it is closing an open select inside the form: the
  // select's trigger keeps the focus (aria-expanded="true") and may not have handled the key yet.
  // The datepicker calendar lives in an overlay outside the panel, so its Escape never gets here.
  protected onPanelEscape(event: Event): void {
    const target = event.target instanceof Element ? event.target : null;
    if (event.defaultPrevented || target?.closest('[aria-expanded="true"]')) {
      return;
    }
    this.close();
  }

  protected close(): void {
    this.adding.set(false);
    this.autoOpenDecided = true;
    this.focusAddControl();
  }

  // The new subscription takes its place in the API's order, so the list is read again.
  protected onSaved(subscription: Subscription): void {
    this.formMounted.set(false);
    this.close();
    // Set once the list is visible again (on the phone it was hidden), so the region announces it.
    afterNextRender(() => this.addedMessage.set(addedSubscriptionMessage(subscription.name)), {
      injector: this.injector,
    });
    this.load(true);
  }

  private open(): void {
    this.autoOpenDecided = true;
    this.addedMessage.set(null);
    this.formMounted.set(true);
    this.adding.set(true);
    afterNextRender(
      () => {
        // The phone add view replaces the list, so it starts at the top of the page.
        if (this.isPhone()) {
          window.scrollTo(0, 0);
        }
        this.panelTitle()?.nativeElement.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  // Desktop only, without moving the focus. On the phone the empty state and the bar stay.
  private autoOpen(empty: boolean): void {
    if (this.autoOpenDecided) {
      return;
    }
    this.autoOpenDecided = true;
    if (empty && !this.isPhone()) {
      this.formMounted.set(true);
      this.adding.set(true);
    }
  }

  // Back to the "Dodaj subskrypcję" control of the current width; on the phone it reappears
  // with the list, so the focus waits for the next render.
  private focusAddControl(): void {
    afterNextRender(() => (this.isPhone() ? this.phoneAddButton() : this.addButton()).focus(), {
      injector: this.injector,
    });
  }
}
