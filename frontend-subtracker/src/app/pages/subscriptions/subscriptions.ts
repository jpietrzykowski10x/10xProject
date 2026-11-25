import { BreakpointObserver } from '@angular/cdk/layout';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  Injector,
  OnInit,
  PLATFORM_ID,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatOption } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatPaginator, MatPaginatorIntl, type PageEvent } from '@angular/material/paginator';
import { MatSelect } from '@angular/material/select';
import { ActivatedRoute, Router } from '@angular/router';
import { map, type Subscription as RxSubscription } from 'rxjs';
import { AppShell } from '../../layout/app-shell/app-shell';
import { PHONE_MEDIA_QUERY, WIDE_MEDIA_QUERY } from '../../shared/breakpoints';
import { ErrorReporter } from '../../shared/error-reporter';
import { FORM_FIELD_DEFAULTS } from '../../shared/form-field-defaults';
import { PlPaginatorIntl } from '../../shared/pl-paginator-intl';
import { openCancelSubscriptionDialog } from '../../subscriptions/cancel-subscription-dialog/cancel-subscription-dialog';
import { CostTotalsStore } from '../../subscriptions/cost-totals.store';
import { openDeleteSubscriptionDialog } from '../../subscriptions/delete-subscription-dialog/delete-subscription-dialog';
import { SubscriptionForm } from '../../subscriptions/subscription-form/subscription-form';
import {
  addedSubscriptionMessage,
  ALL_FILTER_LABEL,
  cancelledSubscriptionMessage,
  conflictSubscriptionMessage,
  deletedSubscriptionMessage,
  missingSubscriptionMessage,
  noFilterResultsMessage,
  noSubscriptionsMessage,
  resumedSubscriptionMessage,
  resumeFailedMessage,
  SORT_LABELS,
  STATUS_LABELS,
  updatedSubscriptionMessage,
} from '../../subscriptions/subscription-labels';
import {
  hasFilters,
  paramsFromQuery,
  queryFromParams,
  sameQuery,
} from '../../subscriptions/subscription-list-query';
import {
  type Category,
  SUBSCRIPTION_PAGE_SIZE,
  SUBSCRIPTION_SORTS,
  type Subscription,
  type SubscriptionListQuery,
  type SubscriptionSort,
  type SubscriptionStatus,
} from '../../subscriptions/subscription.types';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { SubscriptionTable } from './subscription-table/subscription-table';

// `items` is the page on screen, `total` the number of rows that match the filters on all pages.
type ListState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; items: Subscription[]; total: number };

type PanelMode =
  { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; subscription: Subscription };

const CLOSED: PanelMode = { kind: 'closed' };

// The value of the "Wszystkie" option in the category and status fields. A null option value
// would make mat-select clear its trigger instead of showing the option.
const ALL = 'all';
type FilterValue<T extends string> = T | typeof ALL;

// F2-Lista and F2-Tel-Dodawanie: the list and one panel, for adding ("Nowa subskrypcja") or
// editing a row ("Edycja subskrypcji"). Only CSS decides how the panel looks: a column beside the
// table from 1200px, a drawer over it from 840px, the whole content area (list hidden) on the
// phone. It is one element with one form, so typed data survives a resize.
// S-18: the order, the filters and the page live in the address (subscription-list-query.ts); the
// API sorts, filters and cuts the list into pages, and every change of the address reads it again.
// Layout A: the fields "Sortuj", "Kategoria" and "Status" above the table, the paginator under it.
@Component({
  selector: 'app-subscriptions',
  providers: [FORM_FIELD_DEFAULTS, { provide: MatPaginatorIntl, useClass: PlPaginatorIntl }],
  imports: [
    AppShell,
    MatButton,
    MatFormField,
    MatLabel,
    MatOption,
    MatPaginator,
    MatSelect,
    SubscriptionForm,
    SubscriptionTable,
  ],
  templateUrl: './subscriptions.html',
  styleUrl: './subscriptions.scss',
})
export class Subscriptions implements OnInit {
  private readonly subscriptions = inject(SubscriptionsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reporter = inject(ErrorReporter);
  private readonly injector = inject(Injector);
  private readonly breakpoints = inject(BreakpointObserver);
  private readonly dialog = inject(MatDialog);
  private readonly totals = inject(CostTotalsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  // On a mat-flat-button host the template ref is the MatButton instance (no nativeElement);
  // MatButton has its own focus().
  private readonly addButton = viewChild.required<MatButton>('addButton');
  private readonly phoneAddButton = viewChild.required<MatButton>('phoneAddButton');
  private readonly panelTitle = viewChild<ElementRef<HTMLElement>>('panelTitle');
  private readonly listArea = viewChild.required<ElementRef<HTMLElement>>('listArea');
  private readonly form = viewChild(SubscriptionForm);
  private readonly categorySelect = viewChild<MatSelect>('categorySelect');
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  // The empty list opens the panel by itself once per visit, and never after the first answer.
  private autoOpenDecided = false;

  // What the list shows, read from the address; an equal query (e.g. an unknown parameter added)
  // is not a change, so it does not read the list again.
  readonly query = toSignal(this.route.queryParamMap.pipe(map(queryFromParams)), {
    requireSync: true,
    equal: sameQuery,
  });
  // The account's categories for the category filter, read once on entry. Without them the filter
  // offers only "Wszystkie"; the list works either way.
  protected readonly categories = signal<Category[]>([]);
  // An empty result of the filters reads "Brak subskrypcji spełniających filtry." instead of the
  // empty account's message, and never opens the add panel.
  protected readonly filtered = computed(() => hasFilters(this.query()));
  protected readonly categoryValue = computed<FilterValue<string>>(
    () => this.query().category ?? ALL,
  );
  protected readonly statusValue = computed<FilterValue<SubscriptionStatus>>(
    () => this.query().status ?? ALL,
  );
  protected readonly all = ALL;
  protected readonly allLabel = ALL_FILTER_LABEL;
  protected readonly sorts = SUBSCRIPTION_SORTS;
  protected readonly sortLabels = SORT_LABELS;
  protected readonly statuses = Object.keys(STATUS_LABELS) as SubscriptionStatus[];
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly pageSize = SUBSCRIPTION_PAGE_SIZE;
  protected readonly noSubscriptionsMessage = noSubscriptionsMessage;
  protected readonly noFilterResultsMessage = noFilterResultsMessage;
  protected readonly state = signal<ListState>({ kind: 'loading' });
  private loadRequest?: RxSubscription;
  protected readonly panel = signal<PanelMode>(CLOSED);
  // The add form stays in the DOM after a plain close, so reopening continues with the typed
  // data; a save or opening an edit drops it, so the next opening starts with an empty form.
  // An edit form never stays: closing it removes it.
  private readonly keepAddDraft = signal(false);
  protected readonly adding = computed(() => this.panel().kind === 'add');
  protected readonly panelOpen = computed(() => this.panel().kind !== 'closed');
  protected readonly editing = computed(() => {
    const panel = this.panel();
    return panel.kind === 'edit' ? panel.subscription : null;
  });
  protected readonly formMounted = computed(() => this.panelOpen() || this.keepAddDraft());
  // Which form is mounted: a new one is created whenever this changes, so the values of one
  // target never leak into the next (add → edit A → edit B → add).
  protected readonly panelKey = computed(() => this.editing()?.id ?? 'new');
  // The "Dodaj subskrypcję" buttons control the panel only while it holds the add form.
  protected readonly addFormMounted = computed(() => this.formMounted() && this.editing() === null);
  // The "Edytuj" button that opened the edit panel; the focus returns to it on close.
  private editTrigger: HTMLElement | null = null;
  protected readonly statusMessage = signal<string | null>(null);
  // A failed "Przywróć" (network or server error); the list stays as it was.
  protected readonly actionError = signal<string | null>(null);
  // The subscription whose "Przywróć" is in flight; its button is disabled until the answer.
  protected readonly resumingId = signal<string | null>(null);
  // A failed quiet load (after a save) keeps the list on screen and offers to read it again.
  protected readonly refreshFailed = signal(false);
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
  protected readonly listCovered = computed(() => this.panelOpen() && !this.isWide());
  // While the panel's form (add or edit) is saving, the panel stays as it is: closing or swapping
  // it would destroy the form and drop the answer, so the save always ends with its message.
  private readonly formSending = computed(() => this.form()?.sending() ?? false);
  // The subscription whose edit is being saved. From 1200px its row stays clickable beside the
  // panel, so its cancel, resume and delete are disabled until the answer: the panel cannot close
  // during the save, and a later save of its form (a full PUT) would undo such an action.
  protected readonly savingId = computed(() =>
    this.formSending() ? (this.editing()?.id ?? null) : null,
  );

  constructor() {
    // When the panel starts covering the list (it opens below 1200px, or the window narrows while
    // it is open), the list turns inert and the browser would drop a focus inside it on <body>.
    // Such a focus moves to the panel title. Opening from the add button focuses the title anyway;
    // the auto-open happens with the focus outside the list, so it does not move it.
    let wasCovered = false;
    effect(() => {
      const covered = this.listCovered();
      const becameCovered = covered && !wasCovered;
      wasCovered = covered;
      if (!becameCovered || !this.isBrowser) {
        return;
      }
      const listArea = untracked(this.listArea).nativeElement;
      if (!listArea.contains(this.document.activeElement)) {
        return;
      }
      afterNextRender(() => this.panelTitle()?.nativeElement.focus({ preventScroll: true }), {
        injector: this.injector,
      });
    });

    // The first query reads the list on entry; every later one (another order, filter or page)
    // reads it again, quietly once a list is on screen, so the table does not blink away.
    effect(() => {
      this.query();
      untracked(() => this.load(this.state().kind === 'ready'));
    });
  }

  ngOnInit(): void {
    this.loadCategories();
  }

  // Another order, filter or page: the address changes and the list is read again (the effect in
  // the constructor). Another order or filter starts from page 1, unless the patch names a page.
  // The address is replaced, not pushed, so "back" leaves the list instead of stepping through it.
  setQuery(patch: Partial<SubscriptionListQuery>): void {
    const current = this.query();
    const next: SubscriptionListQuery = { ...current, ...patch };
    const reordered =
      next.sort !== current.sort ||
      next.category !== current.category ||
      next.status !== current.status;
    if (reordered && patch.page === undefined) {
      next.page = 1;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: paramsFromQuery(next),
      replaceUrl: true,
    });
  }

  protected sortChanged(sort: SubscriptionSort): void {
    this.setQuery({ sort });
  }

  protected categoryChanged(value: FilterValue<string>): void {
    this.setQuery({ category: value === ALL ? null : value });
  }

  protected statusChanged(value: FilterValue<SubscriptionStatus>): void {
    this.setQuery({ status: value === ALL ? null : value });
  }

  // The paginator counts pages from 0, the address from 1.
  protected pageChanged(event: PageEvent): void {
    this.setQuery({ page: event.pageIndex + 1 });
  }

  // "Wyczyść filtry" under an empty result keeps the order. The button goes with the empty result,
  // so the focus moves to the category field, which stays.
  protected clearFilters(): void {
    this.setQuery({ category: null, status: null, page: 1 });
    this.categorySelect()?.focus();
  }

  // The page of the current query. `quiet` keeps the current list on screen while it is read again
  // (after a save, or another order, filter or page).
  // A newer load cancels the older request, so an older response can never overwrite a newer one.
  // A failed quiet load keeps the list already on screen and shows the refreshFailed notice.
  protected load(quiet = false): void {
    if (!quiet) {
      this.state.set({ kind: 'loading' });
    }
    this.loadRequest?.unsubscribe();
    const query = this.query();
    // The API returns the page in the query's order; it is not sorted again here.
    this.loadRequest = this.subscriptions
      .list(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ items, total, pageSize }) => {
          this.refreshFailed.set(false);
          // A page past the end (rows removed, or an old link) moves to the last page, which the
          // changed address then reads; nothing of the empty page is shown meanwhile.
          if (items.length === 0 && total > 0) {
            this.setQuery({ page: Math.ceil(total / pageSize) });
            return;
          }
          this.state.set({ kind: 'ready', items, total });
          // Only an account without subscriptions, not an empty result of a filter.
          this.autoOpen(total === 0 && !hasFilters(query));
        },
        error: (error: unknown) => {
          this.reporter.report('Subscriptions', error);
          if (quiet && this.state().kind === 'ready') {
            this.refreshFailed.set(true);
          } else {
            this.refreshFailed.set(false);
            this.state.set({ kind: 'error' });
          }
        },
      });
  }

  // A failure is reported and leaves the categories empty, so the filter offers only "Wszystkie".
  private loadCategories(): void {
    this.subscriptions
      .categories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (categories) => this.categories.set(categories),
        error: (error: unknown) => this.reporter.report('Subscriptions', error),
      });
  }

  // From an edit (the list is visible beside the panel from 1200px) it switches to adding.
  protected toggleAdding(): void {
    if (this.formSending()) {
      return;
    }
    if (this.adding()) {
      this.close();
    } else {
      this.editTrigger = null;
      this.keepAddDraft.set(true);
      this.open({ kind: 'add' });
    }
  }

  // Opening an edit drops an add draft. Editing the same subscription again keeps its form.
  protected openEdit(subscription: Subscription): void {
    if (this.formSending()) {
      return;
    }
    const active = this.document.activeElement;
    this.editTrigger = active instanceof HTMLElement ? active : null;
    this.keepAddDraft.set(false);
    this.open({ kind: 'edit', subscription });
  }

  // Escape closes the panel, except when it is closing an open select inside the form: the
  // select's trigger keeps the focus (aria-expanded="true") and may not have handled the key yet.
  // Only an aria-expanded inside the panel counts, not one on an ancestor such as the shell.
  // The datepicker calendar lives in an overlay outside the panel, so its Escape never gets here.
  protected onPanelEscape(event: Event): void {
    const panel = event.currentTarget instanceof Element ? event.currentTarget : null;
    const target = event.target instanceof Element ? event.target : null;
    const expanded = target?.closest('[aria-expanded="true"]');
    if (event.defaultPrevented || (expanded && panel?.contains(expanded))) {
      return;
    }
    this.close();
  }

  // Ignored while the form is saving (Escape, the X, "Dodaj subskrypcję" all end up here).
  protected close(): void {
    if (this.formSending()) {
      return;
    }
    const trigger = this.editing() !== null ? this.editTrigger : null;
    this.editTrigger = null;
    this.panel.set(CLOSED);
    this.autoOpenDecided = true;
    this.focusAfterClose(trigger);
  }

  // "Spróbuj ponownie" after a failed read: the cost totals in the shell most likely failed with the
  // list, so they are read again too, quietly (totals already shown stay until the answer).
  protected retry(quiet = false): void {
    this.load(quiet);
    this.totals.refresh();
  }

  // The saved subscription takes its place in the API's order, so the list is read again; so are
  // the cost totals in the shell, quietly.
  protected onSaved(subscription: Subscription): void {
    const message =
      this.editing() === null
        ? addedSubscriptionMessage(subscription.name)
        : updatedSubscriptionMessage(subscription.name);
    this.keepAddDraft.set(false);
    this.close();
    this.showStatus(message);
    this.load(true);
    this.totals.refresh();
  }

  // The edited subscription is gone (deleted in another tab); the list is read again without it.
  protected onMissing(): void {
    this.editTrigger = null;
    this.close();
    this.showStatus(missingSubscriptionMessage);
    this.load(true);
    this.totals.refresh();
  }

  // "Usuń" in a row asks for a confirmation; the dialog sends the DELETE itself. Without a result
  // nothing changes and MatDialog returns the focus to "Usuń". After a delete (or a 404: it was
  // already gone) the row and its "Usuń" disappear with the next load, so the focus moves to the
  // "Dodaj subskrypcję" control. An edit panel of that subscription closes; any other panel stays.
  protected confirmRemove(subscription: Subscription): void {
    if (this.savingId() === subscription.id) {
      return;
    }
    openDeleteSubscriptionDialog(this.dialog, subscription)
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (result === undefined) {
          return;
        }
        if (this.editing()?.id === subscription.id) {
          this.editTrigger = null;
          this.close();
        } else {
          this.focusAddControl();
        }
        this.showStatus(
          result === 'deleted'
            ? deletedSubscriptionMessage(subscription.name)
            : missingSubscriptionMessage,
        );
        this.load(true);
        this.totals.refresh();
      });
  }

  // "Anuluj subskrypcję" in a row asks for a confirmation; the dialog sends the POST itself.
  // Without a result nothing changes and MatDialog returns the focus to the button. Any answer
  // swaps the row's action, so the focus moves like after a delete; an edit panel of that
  // subscription closes, because its form holds the old status and saving would undo the cancel.
  protected confirmCancel(subscription: Subscription): void {
    if (this.savingId() === subscription.id) {
      return;
    }
    openCancelSubscriptionDialog(this.dialog, subscription)
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (result === undefined) {
          return;
        }
        this.afterLifecycleAction(
          subscription,
          result === 'cancelled'
            ? cancelledSubscriptionMessage(subscription.name)
            : result === 'missing'
              ? missingSubscriptionMessage
              : conflictSubscriptionMessage,
        );
      });
  }

  // "Przywróć" needs no confirmation: it only undoes a cancel. While the POST is in flight the
  // button is disabled; a failure keeps the list as it is, with a message.
  protected resume(subscription: Subscription): void {
    if (this.resumingId() !== null || this.savingId() === subscription.id) {
      return;
    }
    this.resumingId.set(subscription.id);
    this.actionError.set(null);
    this.subscriptions
      .resume(subscription.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.resumingId.set(null);
          this.afterLifecycleAction(subscription, resumedSubscriptionMessage(subscription.name));
        },
        error: (error: HttpErrorResponse) => {
          this.resumingId.set(null);
          if (error.status === 404) {
            this.afterLifecycleAction(subscription, missingSubscriptionMessage);
          } else if (error.status === 409) {
            this.afterLifecycleAction(subscription, conflictSubscriptionMessage);
          } else {
            this.reporter.report('Subscriptions', error);
            this.actionError.set(resumeFailedMessage(subscription.name));
          }
        },
      });
  }

  // After a cancel or resume (or its 404/409) the row's action button is replaced with the next
  // load, so, like after a delete, an edit panel of that subscription closes and otherwise the
  // focus moves to "Dodaj subskrypcję". The list and the cost totals are read again.
  private afterLifecycleAction(subscription: Subscription, message: string): void {
    if (this.editing()?.id === subscription.id) {
      this.editTrigger = null;
      this.close();
    } else {
      this.focusAddControl();
    }
    this.actionError.set(null);
    this.showStatus(message);
    this.load(true);
    this.totals.refresh();
  }

  // Set once the list is visible again (on the phone it was hidden), so the region announces it.
  // Cleared first, so the same message a second time (e.g. after a second delete) is announced.
  private showStatus(message: string): void {
    this.statusMessage.set(null);
    afterNextRender(() => this.statusMessage.set(message), { injector: this.injector });
  }

  private open(mode: PanelMode): void {
    this.autoOpenDecided = true;
    this.statusMessage.set(null);
    this.actionError.set(null);
    this.refreshFailed.set(false);
    this.panel.set(mode);
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
      this.keepAddDraft.set(true);
      this.panel.set({ kind: 'add' });
    }
  }

  // Back to the "Edytuj" button that opened an edit, if it is still on the list, otherwise to
  // the "Dodaj subskrypcję" control of the current width. On the phone both reappear with the
  // list, so the focus waits for the next render.
  private focusAfterClose(trigger: HTMLElement | null): void {
    afterNextRender(
      () => {
        if (trigger?.isConnected) {
          trigger.focus();
        } else {
          this.addControl().focus();
        }
      },
      { injector: this.injector },
    );
  }

  private focusAddControl(): void {
    afterNextRender(() => this.addControl().focus(), { injector: this.injector });
  }

  private addControl(): MatButton {
    return this.isPhone() ? this.phoneAddButton() : this.addButton();
  }
}
