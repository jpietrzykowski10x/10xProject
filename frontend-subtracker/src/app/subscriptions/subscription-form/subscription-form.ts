import { HttpErrorResponse } from '@angular/common/http';
import {
  booleanAttribute,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE, MatOption } from '@angular/material/core';
import {
  MatDatepicker,
  MatDatepickerInput,
  MatDatepickerIntl,
  MatDatepickerToggle,
} from '@angular/material/datepicker';
import { MatError, MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSelect } from '@angular/material/select';
import { catchError, map, merge, of, switchMap } from 'rxjs';
import { FORM_FIELD_DEFAULTS } from '../../shared/form-field-defaults';
import { PL_DATE_FORMATS, PlDateAdapter } from '../../shared/pl-date-adapter';
import { PlDatepickerIntl } from '../../shared/pl-datepicker-intl';
import { notBeforeDate } from '../../shared/validation/not-before-date';
import { trimmedRequired } from '../../shared/validation/trimmed-required';
import { BILLING_CYCLE_LABELS, PAYMENT_METHOD_LABELS, STATUS_LABELS } from '../subscription-labels';
import { toCreateSubscriptionRequest } from '../subscription-request';
import { amountValidator } from '../subscription-validators';
import {
  BillingCycle,
  Category,
  CATEGORY_NAME_MAX_LENGTH,
  CreateSubscriptionRequest,
  PaymentMethod,
  Subscription,
  SUBSCRIPTION_NAME_MAX_LENGTH,
  SubscriptionStatus,
} from '../subscription.types';
import { SubscriptionsService } from '../subscriptions.service';

type SaveState = 'idle' | 'sending' | 'invalid' | 'unavailable';

// The value of the "Dodaj własną…" option; category ids are UUIDs, so it cannot clash.
const NEW_CATEGORY = 'new';

// While “Dodaj własną…” is selected, no category is chosen yet.
const notNewCategory = (control: AbstractControl<string>): ValidationErrors | null =>
  control.value === NEW_CATEGORY ? { required: true } : null;

const keysOf = <K extends string>(labels: Record<K, string>): K[] => Object.keys(labels) as K[];

// The FR-004 form, in the field order of F2-Lista: the add panel on /subscriptions uses it at every
// width (a column, a drawer or the phone's full add view). It saves the subscription itself and
// emits it once the API has accepted it.
@Component({
  selector: 'app-subscription-form',
  imports: [
    MatButton,
    MatButtonToggle,
    MatButtonToggleGroup,
    MatDatepicker,
    MatDatepickerInput,
    MatDatepickerToggle,
    MatError,
    MatFormField,
    MatInput,
    MatLabel,
    MatOption,
    MatSelect,
    MatSuffix,
    ReactiveFormsModule,
  ],
  // Datepickers in Polish, typed as dd.mm.rrrr. Provided here, not in app.config.ts: the only
  // datepickers are in this form, and a root import of @angular/material/core would move about
  // 35 kB into the initial bundle. provideNativeDateAdapter() always provides NativeDateAdapter
  // itself, so the subclass is provided directly.
  providers: [
    FORM_FIELD_DEFAULTS,
    { provide: DateAdapter, useClass: PlDateAdapter },
    { provide: MAT_DATE_LOCALE, useValue: 'pl-PL' },
    { provide: MAT_DATE_FORMATS, useValue: PL_DATE_FORMATS },
    { provide: MatDatepickerIntl, useClass: PlDatepickerIntl },
  ],
  templateUrl: './subscription-form.html',
  styleUrl: './subscription-form.scss',
})
export class SubscriptionForm implements OnInit {
  // The save button sticks to the bottom of the screen (the phone add view, F2-Tel-Dodawanie).
  readonly stickyActions = input(false, { transform: booleanAttribute });
  readonly saved = output<Subscription>();

  private readonly subscriptions = inject(SubscriptionsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly categorySelect = viewChild.required<MatSelect>('categorySelect');

  // Declared before the group: the next-billing validator reads them while the group is built.
  private readonly status = this.fb.control<SubscriptionStatus>('active');
  private readonly trialEndDate = this.fb.control<Date | null>(
    { value: null, disabled: true },
    Validators.required,
  );

  protected readonly form = this.fb.group({
    name: ['', trimmedRequired],
    categoryId: ['', [Validators.required, notNewCategory]],
    amount: ['', amountValidator],
    billingCycle: this.fb.control<BillingCycle>('monthly'),
    paymentMethod: this.fb.control<PaymentMethod | ''>('', Validators.required),
    status: this.status,
    // Only a trial has it; the control is disabled (not validated, not sent) otherwise.
    trialEndDate: this.trialEndDate,
    // For a trial the first payment cannot come before the trial ends (as in the API).
    nextBillingDate: this.fb.control<Date | null>(null, [
      Validators.required,
      notBeforeDate(() => (this.status.value === 'trial' ? this.trialEndDate.value : null)),
    ]),
  });
  protected readonly categoryName = this.fb.control('', trimmedRequired);

  protected readonly categories = signal<Category[]>([]);
  protected readonly categoriesFailed = signal(false);
  protected readonly addingCategory = signal(false);
  protected readonly categoryFailed = signal(false);
  protected readonly state = signal<SaveState>('idle');

  private readonly statusValue = toSignal(this.status.valueChanges, {
    initialValue: this.status.value,
  });
  protected readonly isTrial = computed(() => this.statusValue() === 'trial');
  private readonly categoryValue = toSignal(this.form.controls.categoryId.valueChanges, {
    initialValue: this.form.controls.categoryId.value,
  });
  protected readonly addingOwnCategory = computed(() => this.categoryValue() === NEW_CATEGORY);

  protected readonly newCategory = NEW_CATEGORY;
  protected readonly nameMaxLength = SUBSCRIPTION_NAME_MAX_LENGTH;
  protected readonly categoryNameMaxLength = CATEGORY_NAME_MAX_LENGTH;
  protected readonly cycles = keysOf(BILLING_CYCLE_LABELS);
  protected readonly cycleLabels = BILLING_CYCLE_LABELS;
  protected readonly paymentMethods = keysOf(PAYMENT_METHOD_LABELS);
  protected readonly paymentLabels = PAYMENT_METHOD_LABELS;
  protected readonly statuses = keysOf(STATUS_LABELS);
  protected readonly statusLabels = STATUS_LABELS;

  constructor() {
    this.status.valueChanges.pipe(takeUntilDestroyed()).subscribe((status) => {
      if (status === 'trial') {
        this.trialEndDate.enable();
      } else {
        this.trialEndDate.disable();
      }
    });
    // The billing date's rule depends on the status and the end of the trial.
    merge(this.status.valueChanges, this.trialEndDate.valueChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.form.controls.nextBillingDate.updateValueAndValidity());
  }

  ngOnInit(): void {
    this.loadCategories();
  }

  protected loadCategories(): void {
    this.categoriesFailed.set(false);
    this.subscriptions
      .categories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (categories) => this.categories.set(categories),
        error: () => this.categoriesFailed.set(true),
      });
  }

  // Enter in the category name adds the category instead of submitting the whole form.
  protected onCategoryEnter(event: Event): void {
    event.preventDefault();
    this.addCategory();
  }

  protected addCategory(): void {
    this.categoryName.markAsTouched();
    if (this.categoryName.invalid || this.addingCategory()) {
      return;
    }

    this.addingCategory.set(true);
    this.categoryFailed.set(false);
    this.subscriptions
      .createCategory({ name: this.categoryName.value.trim() })
      .pipe(
        // The list is read again for the API's order; without it the new category goes last.
        switchMap((created) =>
          this.subscriptions.categories().pipe(
            catchError(() => of([...this.categories(), created])),
            map((categories) => ({ created, categories })),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ created, categories }) => {
          this.addingCategory.set(false);
          this.categories.set(categories);
          this.categoriesFailed.set(false);
          this.categoryName.reset();
          // Only if "Dodaj własną…" is still chosen: a category picked while the request was in
          // flight is the user's choice and stays.
          if (this.form.controls.categoryId.value === NEW_CATEGORY) {
            this.form.controls.categoryId.setValue(created.id);
            // The name field disappears with the option; focus stays on the category.
            this.categorySelect().focus();
          }
        },
        error: (error: HttpErrorResponse) => {
          this.addingCategory.set(false);
          if (error.status === 409) {
            this.categoryName.setErrors({ conflict: true });
          } else {
            this.categoryFailed.set(true);
          }
        },
      });
  }

  protected submit(): void {
    if (this.state() === 'sending') {
      return;
    }
    this.form.markAllAsTouched();
    const request = this.request();
    if (request === null) {
      this.focusFirstInvalid();
      return;
    }

    this.state.set('sending');
    this.subscriptions
      .create(request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (subscription) => {
          this.state.set('idle');
          this.saved.emit(subscription);
        },
        error: (error: HttpErrorResponse) =>
          this.state.set(error.status === 400 ? 'invalid' : 'unavailable'),
      });
  }

  // The request body, or null while any field is invalid.
  private request(): CreateSubscriptionRequest | null {
    if (this.form.invalid) {
      return null;
    }
    return toCreateSubscriptionRequest(this.form.getRawValue());
  }

  private focusFirstInvalid(): void {
    this.host.nativeElement.querySelector<HTMLElement>('[formcontrolname].ng-invalid')?.focus();
  }
}
