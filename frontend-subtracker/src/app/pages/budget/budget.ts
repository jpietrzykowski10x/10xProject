import { formatNumber, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  LOCALE_ID,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  type AbstractControl,
  FormControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  type ValidationErrors,
  Validators,
} from '@angular/forms';
import type { ErrorStateMatcher } from '@angular/material/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatTooltip } from '@angular/material/tooltip';
import type { Observable } from 'rxjs';
import type { Subscription as RxSubscription } from 'rxjs';
import { BudgetService } from '../../budget/budget.service';
import {
  DUPLICATE_THRESHOLD_MAX,
  DUPLICATE_THRESHOLD_MIN,
  type BudgetResponse,
  type CategoryBudget,
  type CategoryBudgetRequest,
  type UpdateBudgetRequest,
} from '../../budget/budget.types';
import { AppShell } from '../../layout/app-shell/app-shell';
import { FORM_FIELD_DEFAULTS } from '../../shared/form-field-defaults';
import { numberToGrosze, toAmountText, toGrosze } from '../../shared/grosze';
import { CostTotalsStore } from '../../subscriptions/cost-totals.store';
import { CATEGORY_NAME_MAX_LENGTH, type Category } from '../../subscriptions/subscription.types';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { optionalAmountValidator, parseAmount } from '../../subscriptions/subscription-validators';
import { openDeleteCategoryDialog } from './delete-category-dialog/delete-category-dialog';
import { openRenameCategoryDialog } from './rename-category-dialog/rename-category-dialog';

type BudgetState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; categories: CategoryBudget[] };

// The form as typed: the default threshold and the overall limit, then one threshold and one limit
// per category of the baseline, in its order.
interface BudgetFormValue {
  defaultThreshold: string;
  monthlyLimit: string;
  thresholds: string[];
  limits: string[];
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

// S-08: a limit field as the API takes it: empty is no limit (null), otherwise the typed amount;
// undefined for an amount the API would refuse (the form shows the error then).
function typedLimit(typed: string | undefined): number | null | undefined {
  const value = typed ?? '';
  if (value.trim() === '') {
    return null;
  }
  return parseAmount(value) ?? undefined;
}

// A limit field keeps its saved limit when it is empty for no limit or holds the same amount
// ("80" for "80.00"); anything else is a change, an invalid one too.
function isLimitChanged(typed: string | undefined, saved: string | null): boolean {
  const limit = typedLimit(typed);
  if (limit === undefined) {
    return true;
  }
  if (limit === null || saved === null) {
    return limit !== null || saved !== null;
  }
  return numberToGrosze(limit) !== toGrosze(saved);
}

// What PUT /budget sends for the form: only the changed fields, and `categories` only with the
// changed categories, each naming only its changed fields. A changed limit goes out as its amount,
// a cleared one as null. Null when nothing differs from the baseline.
// Called only for a valid form (submit() returns on form.invalid): an invalid typed limit maps to
// null here, which would remove the saved limit.
function budgetChanges(
  baseline: BudgetResponse,
  value: BudgetFormValue,
): UpdateBudgetRequest | null {
  const changes: UpdateBudgetRequest = {};
  if (isChanged(value.defaultThreshold, baseline.defaultDuplicateThreshold)) {
    changes.defaultDuplicateThreshold = Number(value.defaultThreshold);
  }
  if (isLimitChanged(value.monthlyLimit, baseline.monthlyLimit)) {
    changes.monthlyLimit = typedLimit(value.monthlyLimit) ?? null;
  }
  const categories: CategoryBudgetRequest[] = [];
  baseline.categories.forEach((item, index) => {
    const change: CategoryBudgetRequest = { categoryId: item.category.id };
    const threshold = value.thresholds[index];
    if (isChanged(threshold, item.duplicateThreshold)) {
      change.duplicateThreshold = Number(threshold);
    }
    const limit = value.limits[index];
    if (isLimitChanged(limit, item.monthlyLimit)) {
      change.monthlyLimit = typedLimit(limit) ?? null;
    }
    if (Object.keys(change).length > 1) {
      categories.push(change);
    }
  });
  if (categories.length > 0) {
    changes.categories = categories;
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

// S-08: the hint (not an error) when the category limits typed add up to more than the overall
// limit typed; null without an overall limit or while the sum fits in it. Fields with an invalid
// amount do not count.
function limitsSumHint(value: BudgetFormValue, locale: string): string | null {
  const overall = typedLimit(value.monthlyLimit);
  if (overall === null || overall === undefined) {
    return null;
  }
  const sum = value.limits.reduce((total, typed) => {
    const limit = typedLimit(typed);
    return limit === null || limit === undefined ? total : total + numberToGrosze(limit);
  }, 0);
  if (sum <= numberToGrosze(overall)) {
    return null;
  }
  const format = (grosze: number) => formatNumber(grosze / 100, locale, '1.2-2');
  return (
    `Suma limitów kategorii (${format(sum)} zł) przekracza limit całościowy ` +
    `(${format(numberToGrosze(overall))} zł).`
  );
}

const SAVED_MESSAGE = 'Zapisano ustawienia budżetu.';
// 400: a category of the form is gone (e.g. deleted in another tab), nothing was saved.
const CHANGED_MESSAGE =
  'Lista kategorii zmieniła się w międzyczasie. Nic nie zapisano, sprawdź ustawienia i zapisz je ponownie.';
const UNAVAILABLE_MESSAGE =
  'Serwis jest chwilowo niedostępny. Nie udało się zapisać ustawień, spróbuj ponownie za chwilę.';

// S-17: what the status region says after a dialog of an own category.
const RENAMED_MESSAGE = 'Zmieniono nazwę kategorii.';
const DELETED_MESSAGE = 'Usunięto kategorię.';
const MISSING_CATEGORY_MESSAGE = 'Kategoria już nie istnieje.';
// The tooltip of the category actions while the form has unsaved changes: the list is read again
// after a rename or a delete, which would drop them.
const UNSAVED_CHANGES_TOOLTIP = 'Najpierw zapisz albo cofnij zmiany progów i limitów.';
const ADDED_MESSAGE = 'Dodano kategorię.';

// S-17: a category name as the page compares it with the loaded ones, without regard to the letter
// case (the API refuses such a name with 409 anyway).
const nameKey = (name: string): string => name.trim().normalize('NFC').toLocaleLowerCase('pl');

// The new category's error shows as soon as the name is typed, not only after the field is left,
// and never because "Zapisz" submitted the budget form around it.
const NEW_CATEGORY_ERROR_STATE: ErrorStateMatcher = {
  isErrorState: (control: AbstractControl | null) =>
    control !== null && control.invalid && control.dirty,
};

// S-07/S-08: the user's default duplicate threshold and overall monthly limit, and the threshold
// and limit of every category, saved with one PUT /budget that names only what changed. After a
// save the cost totals in the shell are read again, so their warnings and the limit bar follow at
// once.
// S-17: an own category has "Zmień nazwę" and "Usuń" icons by its name, each opening a dialog that
// sends the request itself; both are off while the form has unsaved changes. After any answer the
// budget and the cost totals are read again. Below the list "Nowa kategoria" adds an own category
// with POST /categories, outside the budget form (its own control, Enter adds instead of saving)
// and, like the icons, off while the form has unsaved changes.
@Component({
  selector: 'app-budget',
  providers: [FORM_FIELD_DEFAULTS],
  imports: [
    AppShell,
    MatButton,
    MatError,
    MatFormField,
    MatHint,
    MatIconButton,
    MatInput,
    MatLabel,
    MatTooltip,
    NgTemplateOutlet,
    ReactiveFormsModule,
  ],
  templateUrl: './budget.html',
  styleUrl: './budget.scss',
})
export class Budget implements OnInit {
  private readonly budget = inject(BudgetService);
  private readonly subscriptions = inject(SubscriptionsService);
  private readonly totals = inject(CostTotalsStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly locale = inject(LOCALE_ID);
  private readonly dialog = inject(MatDialog);
  // The heading of the categories; it takes the focus after a category was renamed or deleted.
  private readonly categoriesLegend = viewChild<ElementRef<HTMLElement>>('categoriesLegend');
  // The name of a new category; it keeps the focus after the category was added.
  private readonly newCategoryInput = viewChild<ElementRef<HTMLInputElement>>('newCategoryInput');

  protected readonly state = signal<BudgetState>({ kind: 'loading' });
  // The last loaded or saved budget: the values the form is compared with.
  private readonly baseline = signal<BudgetResponse | null>(null);
  // One threshold control and one limit control per category of the baseline, in the same order.
  protected readonly form = this.fb.group({
    defaultThreshold: this.fb.control('', thresholdValidators),
    monthlyLimit: this.fb.control('', optionalAmountValidator),
    thresholds: this.fb.array<FormControl<string>>([]),
    limits: this.fb.array<FormControl<string>>([]),
  });
  private readonly formValue = signal<BudgetFormValue>(this.form.getRawValue());
  // Null while the form holds the baseline; "Zapisz" stays off then.
  protected readonly changes = computed(() => {
    const baseline = this.baseline();
    return baseline === null ? null : budgetChanges(baseline, this.formValue());
  });
  // S-08: "Suma limitów kategorii (…) przekracza limit całościowy (…)."; null when it fits.
  protected readonly limitsHint = computed(() => limitsSumHint(this.formValue(), this.locale));
  protected readonly sending = signal(false);
  protected readonly statusMessage = signal<string | null>(null);
  protected readonly saveError = signal<string | null>(null);
  protected readonly min = DUPLICATE_THRESHOLD_MIN;
  protected readonly max = DUPLICATE_THRESHOLD_MAX;
  protected readonly unsavedChangesTooltip = UNSAVED_CHANGES_TOOLTIP;

  // S-17: the keys of the loaded categories, and of the names the API refused (409) since the
  // last load. Declared before the control: its validator reads them while it is built.
  private readonly refusedKeys = signal<ReadonlySet<string>>(new Set());
  private readonly categoryKeys = computed(() => {
    const current = this.state();
    const keys = new Set(this.refusedKeys());
    if (current.kind === 'ready') {
      for (const item of current.categories) {
        keys.add(nameKey(item.category.name));
      }
    }
    return keys;
  });
  // The name of a new category, not part of the budget form, so it never changes changes(). Its
  // only error is a taken name; an empty one just keeps "Dodaj" off.
  protected readonly newCategoryName = new FormControl('', {
    nonNullable: true,
    validators: (control: AbstractControl<string>): ValidationErrors | null => {
      const key = nameKey(control.value);
      return key !== '' && this.categoryKeys().has(key) ? { taken: true } : null;
    },
  });
  private readonly newCategoryValue = signal('');
  protected readonly addingCategory = signal(false);
  protected readonly addCategoryFailed = signal(false);
  // "Dodaj" is off for an empty or taken name, while the budget form has unsaved changes (adding
  // reads the list again, which would drop them) and while a category is being added.
  protected readonly canAddCategory = computed(() => {
    const key = nameKey(this.newCategoryValue());
    return (
      key !== '' &&
      !this.categoryKeys().has(key) &&
      this.changes() === null &&
      !this.addingCategory()
    );
  });
  protected readonly categoryNameMaxLength = CATEGORY_NAME_MAX_LENGTH;
  protected readonly newCategoryErrorState = NEW_CATEGORY_ERROR_STATE;

  private loadRequest?: RxSubscription;
  // Set by a category dialog's answer (the heading of the categories) or an added category (the
  // name field): the next loaded list gets the focus there.
  private focusOnLoad: 'categories' | 'newCategory' | null = null;

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.formValue.set(this.form.getRawValue()));
    this.newCategoryName.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => this.newCategoryValue.set(value));
    // The name is off while the budget form has unsaved changes (a reactive control is disabled
    // through its API, not the template's [disabled]); a newly loaded list may take or free the
    // typed name, so it is validated again.
    effect(() => {
      const unsaved = this.changes() !== null;
      this.categoryKeys();
      if (unsaved) {
        this.newCategoryName.disable({ emitEvent: false });
      } else {
        this.newCategoryName.enable({ emitEvent: false });
      }
    });
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
        next: (response) => {
          this.show(response);
          const focus = this.focusOnLoad;
          this.focusOnLoad = null;
          if (focus !== null) {
            const target = () =>
              focus === 'categories' ? this.categoriesLegend() : this.newCategoryInput();
            afterNextRender(() => target()?.nativeElement.focus(), { injector: this.injector });
          }
        },
        error: () => {
          this.focusOnLoad = null;
          this.state.set({ kind: 'error' });
        },
      });
  }

  // S-17: only with the form as loaded (the icons stay focusable while off, disabledInteractive).
  protected rename(category: Category): void {
    if (this.changes() !== null) {
      return;
    }
    this.afterCategoryDialog(
      openRenameCategoryDialog(this.dialog, category).afterClosed(),
      RENAMED_MESSAGE,
    );
  }

  protected remove(category: Category): void {
    if (this.changes() !== null) {
      return;
    }
    this.afterCategoryDialog(
      openDeleteCategoryDialog(this.dialog, category).afterClosed(),
      DELETED_MESSAGE,
    );
  }

  // Without a result nothing changed and MatDialog returns the focus to the icon. After a rename,
  // a delete or a 404 (the category was already gone) the list is read again like on the first
  // load, the shell's cost totals too (their category names), and the focus moves to the heading
  // of the categories: the icon that opened the dialog is rebuilt or gone.
  private afterCategoryDialog(
    closed: Observable<'renamed' | 'deleted' | 'missing' | undefined>,
    doneMessage: string,
  ): void {
    closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      if (result === undefined) {
        return;
      }
      this.saveError.set(null);
      this.showStatus(result === 'missing' ? MISSING_CATEGORY_MESSAGE : doneMessage);
      this.focusOnLoad = 'categories';
      this.load();
      this.totals.refresh();
    });
  }

  // Enter in the name adds the category and never submits the budget form around the field.
  protected onNewCategoryEnter(event: Event): void {
    event.preventDefault();
    this.addCategory();
  }

  // S-17: "Dodaj" stays focusable while off (disabledInteractive), so a click can still get here.
  // After 201 the field is emptied and the list is read again like after a rename, with the focus
  // back in the field; a 409 (a name taken, e.g. in another tab) is an error of the field.
  protected addCategory(): void {
    if (!this.canAddCategory()) {
      return;
    }
    const name = this.newCategoryName.value.trim().normalize('NFC');
    this.addingCategory.set(true);
    this.addCategoryFailed.set(false);
    this.subscriptions
      .createCategory({ name })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.addingCategory.set(false);
          this.newCategoryName.reset();
          this.saveError.set(null);
          this.showStatus(ADDED_MESSAGE);
          this.focusOnLoad = 'newCategory';
          this.load();
          this.totals.refresh();
        },
        error: (error: HttpErrorResponse) => {
          this.addingCategory.set(false);
          if (error.status === 409) {
            // The validator reports it until the next load, so "Dodaj" stays off for this name.
            this.refusedKeys.update((keys) => new Set([...keys, nameKey(name)]));
            this.newCategoryName.markAsDirty();
          } else {
            this.addCategoryFailed.set(true);
          }
        },
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
    const { thresholds, limits } = this.form.controls;
    thresholds.clear();
    limits.clear();
    for (const item of response.categories) {
      thresholds.push(this.fb.control(String(item.duplicateThreshold), thresholdValidators));
      limits.push(this.fb.control(toAmountText(item.monthlyLimit), optionalAmountValidator));
    }
    this.form.controls.defaultThreshold.setValue(String(response.defaultDuplicateThreshold));
    this.form.controls.monthlyLimit.setValue(toAmountText(response.monthlyLimit));
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.refusedKeys.set(new Set());
    this.state.set({ kind: 'ready', categories: response.categories });
  }

  // Cleared first, so the same message a second time (a second save) is announced again.
  private showStatus(message: string): void {
    this.statusMessage.set(null);
    afterNextRender(() => this.statusMessage.set(message), { injector: this.injector });
  }
}
