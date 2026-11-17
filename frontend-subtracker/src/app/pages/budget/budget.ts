import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  inject,
  Injector,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import type { Subscription as RxSubscription } from 'rxjs';
import { BudgetService } from '../../budget/budget.service';
import {
  DUPLICATE_THRESHOLD_MAX,
  DUPLICATE_THRESHOLD_MIN,
  type BudgetResponse,
  type CategoryBudget,
  type UpdateBudgetRequest,
} from '../../budget/budget.types';
import { AppShell } from '../../layout/app-shell/app-shell';
import { FORM_FIELD_DEFAULTS } from '../../shared/form-field-defaults';
import { CostTotalsStore } from '../../subscriptions/cost-totals.store';

type BudgetState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; categories: CategoryBudget[] };

// The form as typed: the default threshold and one threshold per category of the baseline.
interface BudgetFormValue {
  defaultThreshold: string;
  thresholds: string[];
}

// The threshold as the API takes it: a whole number from 0 to 99, typed without a sign or decimals.
const thresholdValidators = [
  Validators.required,
  Validators.pattern(/^\d+$/),
  Validators.min(DUPLICATE_THRESHOLD_MIN),
  Validators.max(DUPLICATE_THRESHOLD_MAX),
];

// A field keeps its saved value when it holds that number; anything else typed is a change (an
// invalid one too, so "Zapisz" lets the form show the error).
const isChanged = (typed: string | undefined, saved: number): boolean =>
  typed === undefined || !/^\d+$/.test(typed) || Number(typed) !== saved;

// What PUT /budget sends for the form: only the changed fields, the default only when it changed and
// `categories` only with the changed categories. Null when nothing differs from the baseline.
function budgetChanges(
  baseline: BudgetResponse,
  value: BudgetFormValue,
): UpdateBudgetRequest | null {
  const changes: UpdateBudgetRequest = {};
  if (isChanged(value.defaultThreshold, baseline.defaultDuplicateThreshold)) {
    changes.defaultDuplicateThreshold = Number(value.defaultThreshold);
  }
  const categories = baseline.categories
    .map((item, index) => ({ item, typed: value.thresholds[index] }))
    .filter(({ item, typed }) => isChanged(typed, item.duplicateThreshold))
    .map(({ item, typed }) => ({
      categoryId: item.category.id,
      duplicateThreshold: Number(typed),
    }));
  if (categories.length > 0) {
    changes.categories = categories;
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

const SAVED_MESSAGE = 'Zapisano progi.';
// 400: a category of the form is gone (e.g. deleted in another tab), nothing was saved.
const CHANGED_MESSAGE =
  'Lista kategorii zmieniła się w międzyczasie. Nic nie zapisano, sprawdź progi i zapisz je ponownie.';
const UNAVAILABLE_MESSAGE =
  'Serwis jest chwilowo niedostępny. Nie udało się zapisać progów, spróbuj ponownie za chwilę.';

// S-07: the user's default duplicate threshold and the thresholds of every category, saved with one
// PUT /budget that names only what changed. After a save the cost totals in the shell are read
// again, so their warnings follow at once.
@Component({
  selector: 'app-budget',
  providers: [FORM_FIELD_DEFAULTS],
  imports: [
    AppShell,
    MatButton,
    MatError,
    MatFormField,
    MatHint,
    MatInput,
    MatLabel,
    ReactiveFormsModule,
  ],
  templateUrl: './budget.html',
  styleUrl: './budget.scss',
})
export class Budget implements OnInit {
  private readonly budget = inject(BudgetService);
  private readonly totals = inject(CostTotalsStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly state = signal<BudgetState>({ kind: 'loading' });
  // The last loaded or saved budget: the values the form is compared with.
  private readonly baseline = signal<BudgetResponse | null>(null);
  // One threshold control per category of the baseline, in the same order.
  protected readonly form = this.fb.group({
    defaultThreshold: this.fb.control('', thresholdValidators),
    thresholds: this.fb.array<FormControl<string>>([]),
  });
  private readonly formValue = signal<BudgetFormValue>(this.form.getRawValue());
  // Null while the form holds the baseline; "Zapisz" stays off then.
  protected readonly changes = computed(() => {
    const baseline = this.baseline();
    return baseline === null ? null : budgetChanges(baseline, this.formValue());
  });
  protected readonly sending = signal(false);
  protected readonly statusMessage = signal<string | null>(null);
  protected readonly saveError = signal<string | null>(null);
  protected readonly min = DUPLICATE_THRESHOLD_MIN;
  protected readonly max = DUPLICATE_THRESHOLD_MAX;
  private loadRequest?: RxSubscription;

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.formValue.set(this.form.getRawValue()));
  }

  ngOnInit(): void {
    this.load();
  }

  // A newer load cancels the older request, so an older response can never overwrite a newer one.
  protected load(): void {
    this.state.set({ kind: 'loading' });
    this.loadRequest?.unsubscribe();
    this.loadRequest = this.budget
      .get()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.show(response),
        error: () => this.state.set({ kind: 'error' }),
      });
  }

  protected submit(): void {
    if (this.sending()) {
      return;
    }
    if (this.state().kind !== 'ready' || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const body = this.changes();
    if (body === null) {
      return;
    }
    this.sending.set(true);
    this.statusMessage.set(null);
    this.saveError.set(null);
    this.budget
      .update(body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.sending.set(false);
          this.show(response);
          this.showStatus(SAVED_MESSAGE);
          this.totals.refresh();
        },
        error: (error: HttpErrorResponse) => {
          this.sending.set(false);
          if (error.status === 400) {
            // A category may have disappeared; the list is read again.
            this.saveError.set(CHANGED_MESSAGE);
            this.load();
          } else {
            this.saveError.set(UNAVAILABLE_MESSAGE);
          }
        },
      });
  }

  // The form is built anew from the API's answer, so it always matches the shown categories, and
  // the answer becomes the baseline the next changes are compared with.
  private show(response: BudgetResponse): void {
    this.baseline.set(response);
    const thresholds = this.form.controls.thresholds;
    thresholds.clear();
    for (const item of response.categories) {
      thresholds.push(this.fb.control(String(item.duplicateThreshold), thresholdValidators));
    }
    this.form.controls.defaultThreshold.setValue(String(response.defaultDuplicateThreshold));
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.state.set({ kind: 'ready', categories: response.categories });
  }

  // Cleared first, so the same message a second time (a second save) is announced again.
  private showStatus(message: string): void {
    this.statusMessage.set(null);
    afterNextRender(() => this.statusMessage.set(message), { injector: this.injector });
  }
}
