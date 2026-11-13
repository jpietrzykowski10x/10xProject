import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDatepickerInputHarness } from '@angular/material/datepicker/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { environment } from '../../../environments/environment';
import type { Category, CreateSubscriptionRequest, Subscription } from '../subscription.types';
import { SubscriptionForm } from './subscription-form';

// The oracle is the API contract of POST /subscriptions (subscription.types.ts,
// CreateSubscriptionRequest; backend DTO) and the rule of test-plan §2 #7: for every state of the
// form a conditional field is either in the DOM or not, a hidden field never blocks saving, and a
// field the user has to fix shows an error after a save attempt. The whole body is compared, so an
// extra field fails too. Fields are found by their label (the user's handle); error texts are not
// asserted. Only the HTTP boundary is replaced; SubscriptionsService and the form are the real ones.

const CATEGORIES_URL = `${environment.apiUrl}/categories`;
const SUBSCRIPTIONS_URL = `${environment.apiUrl}/subscriptions`;

const CATEGORY: Category = { id: 'category-1', name: 'Rozrywka', isDefault: true };
const OWN_CATEGORY: Category = { id: 'category-2', name: 'Muzyka', isDefault: false };

const NAME = 'Nazwa';
const CATEGORY_FIELD = 'Kategoria';
const NEW_CATEGORY_NAME = 'Nazwa nowej kategorii';
const AMOUNT = 'Kwota w PLN';
const PAYMENT_METHOD = 'Forma płatności';
const STATUS = 'Status';
const TRIAL_END = 'Koniec okresu próbnego';
const NEXT_BILLING = 'Następne rozliczenie';

const ADD_OWN_CATEGORY = 'Dodaj własną…';
const SAVE = 'Zapisz subskrypcję';

// What a valid form sends, from the contract: amount as a number, dates as YYYY-MM-DD, no trial end
// outside a trial.
const BODY: CreateSubscriptionRequest = {
  name: 'Netflix',
  categoryId: CATEGORY.id,
  amount: 43,
  billingCycle: 'monthly',
  paymentMethod: 'blik',
  status: 'active',
  nextBillingDate: '2027-01-05',
};

const SAVED: Subscription = {
  id: 'subscription-1',
  name: 'Netflix',
  category: CATEGORY,
  amount: '43.00',
  billingCycle: 'monthly',
  paymentMethod: 'blik',
  status: 'active',
  trialEndDate: null,
  nextBillingDate: '2027-01-05',
  createdAt: '2026-11-13T12:00:00.000Z',
};

// What the user types or picks; null leaves the field as it is.
interface FormInput {
  name: string | null;
  category: string | null;
  amount: string | null;
  paymentMethod: string | null;
  nextBillingDate: string | null;
}

const VALID_INPUT: FormInput = {
  name: 'Netflix',
  category: CATEGORY.name,
  amount: '43,00',
  paymentMethod: 'BLIK',
  nextBillingDate: '05.01.2027',
};

let fixture: ComponentFixture<SubscriptionForm>;
let loader: HarnessLoader;
let httpTesting: HttpTestingController;

// Creates the form and renders it; GET /categories is left open for the test to answer.
async function createForm(): Promise<void> {
  TestBed.configureTestingModule({
    imports: [SubscriptionForm],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  httpTesting = TestBed.inject(HttpTestingController);
  fixture = TestBed.createComponent(SubscriptionForm);
  loader = TestbedHarnessEnvironment.loader(fixture);
  await fixture.whenStable();
}

// The usual start: the form with its category list loaded.
async function createLoadedForm(): Promise<void> {
  await createForm();
  httpTesting.expectOne({ method: 'GET', url: CATEGORIES_URL }).flush([CATEGORY]);
  await fixture.whenStable();
}

function field(label: string): Promise<MatFormFieldHarness> {
  return loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: label }));
}

async function fieldCount(label: string): Promise<number> {
  return (await loader.getAllHarnesses(MatFormFieldHarness.with({ floatingLabelText: label })))
    .length;
}

async function typeInto(label: string, text: string): Promise<void> {
  const input = await (await field(label)).getControl(MatInputHarness);
  if (input === null) {
    throw new Error(`No text input in the field "${label}".`);
  }
  await input.setValue(text);
}

async function typeDate(label: string, text: string): Promise<void> {
  const input = await (await field(label)).getControl(MatDatepickerInputHarness);
  if (input === null) {
    throw new Error(`No date input in the field "${label}".`);
  }
  await input.setValue(text);
}

async function pick(label: string, option: string): Promise<void> {
  const select = await (await field(label)).getControl(MatSelectHarness);
  if (select === null) {
    throw new Error(`No select in the field "${label}".`);
  }
  await select.clickOptions({ text: option });
}

// Fills every always-visible required field with a valid value; status and trial are left alone.
async function fillValidForm(overrides: Partial<FormInput> = {}): Promise<void> {
  const input = { ...VALID_INPUT, ...overrides };
  if (input.name !== null) {
    await typeInto(NAME, input.name);
  }
  if (input.category !== null) {
    await pick(CATEGORY_FIELD, input.category);
  }
  if (input.amount !== null) {
    await typeInto(AMOUNT, input.amount);
  }
  if (input.paymentMethod !== null) {
    await pick(PAYMENT_METHOD, input.paymentMethod);
  }
  if (input.nextBillingDate !== null) {
    await typeDate(NEXT_BILLING, input.nextBillingDate);
  }
}

async function clickButton(text: string): Promise<void> {
  await (await loader.getHarness(MatButtonHarness.with({ text }))).click();
}

async function save(): Promise<void> {
  await clickButton(SAVE);
}

// The single POST /subscriptions the save sent, answered so that verify() passes.
function expectSavedBody(): CreateSubscriptionRequest {
  const request = httpTesting.expectOne({ method: 'POST', url: SUBSCRIPTIONS_URL });
  const body = request.request.body as CreateSubscriptionRequest;
  request.flush(SAVED);
  return body;
}

function expectNothingSaved(): void {
  httpTesting.expectNone({ method: 'POST', url: SUBSCRIPTIONS_URL });
}

afterEach(() => {
  TestBed.inject(HttpTestingController).verify();
});

describe('SubscriptionForm conditional fields and field errors', () => {
  it('shows the error of an empty own category name after a save attempt', async () => {
    await createLoadedForm();
    await fillValidForm({ category: ADD_OWN_CATEGORY });

    await save();

    expectNothingSaved();
    expect(await (await field(NEW_CATEGORY_NAME)).hasErrors()).toBe(true);
    expect(await (await field(CATEGORY_FIELD)).hasErrors()).toBe(true);
  });

  it('shows the trial end field exactly while the status is a trial', async () => {
    await createLoadedForm();

    expect(await fieldCount(TRIAL_END)).toBe(0);

    await pick(STATUS, 'Trial');
    expect(await fieldCount(TRIAL_END)).toBe(1);

    await pick(STATUS, 'Aktywna');
    expect(await fieldCount(TRIAL_END)).toBe(0);
  });

  it('saves an active subscription without the hidden trial end field', async () => {
    await createLoadedForm();
    await fillValidForm();

    await save();

    expect(expectSavedBody()).toEqual(BODY);
  });

  it('does not send a trial end typed before the status changed away from a trial', async () => {
    await createLoadedForm();
    await pick(STATUS, 'Trial');
    await typeDate(TRIAL_END, '01.01.2027');
    await pick(STATUS, 'Aktywna');
    await fillValidForm();

    await save();

    expect(expectSavedBody()).toEqual(BODY);
  });

  describe('a trial', () => {
    it('is not saved without its end, and the trial end field shows an error', async () => {
      await createLoadedForm();
      await pick(STATUS, 'Trial');
      await fillValidForm();

      await save();

      expectNothingSaved();
      expect(await (await field(TRIAL_END)).hasErrors()).toBe(true);
    });

    it('is not saved with billing before the trial ends, and billing shows an error', async () => {
      await createLoadedForm();
      await pick(STATUS, 'Trial');
      await typeDate(TRIAL_END, '10.01.2027');
      await fillValidForm({ nextBillingDate: '09.01.2027' });

      await save();

      expectNothingSaved();
      expect(await (await field(NEXT_BILLING)).hasErrors()).toBe(true);
    });

    it('is saved with billing on the day the trial ends', async () => {
      await createLoadedForm();
      await pick(STATUS, 'Trial');
      await typeDate(TRIAL_END, '10.01.2027');
      await fillValidForm({ nextBillingDate: '10.01.2027' });

      await save();

      expect(expectSavedBody()).toEqual({
        ...BODY,
        status: 'trial',
        trialEndDate: '2027-01-10',
        nextBillingDate: '2027-01-10',
      });
    });
  });

  it('shows the own category name field exactly while "Dodaj własną…" is picked', async () => {
    await createLoadedForm();

    expect(await fieldCount(NEW_CATEGORY_NAME)).toBe(0);

    await pick(CATEGORY_FIELD, ADD_OWN_CATEGORY);
    expect(await fieldCount(NEW_CATEGORY_NAME)).toBe(1);

    await pick(CATEGORY_FIELD, CATEGORY.name);
    expect(await fieldCount(NEW_CATEGORY_NAME)).toBe(0);
  });

  it('saves after "Dodaj własną…" was picked and left, with the category name empty', async () => {
    await createLoadedForm();
    await pick(CATEGORY_FIELD, ADD_OWN_CATEGORY);
    await pick(CATEGORY_FIELD, CATEGORY.name);
    await fillValidForm({ category: null });

    await save();

    expect(expectSavedBody()).toEqual(BODY);
  });

  describe('adding an own category', () => {
    it('creates the trimmed name, reloads the list and saves with the new category', async () => {
      await createLoadedForm();
      await pick(CATEGORY_FIELD, ADD_OWN_CATEGORY);
      await typeInto(NEW_CATEGORY_NAME, '  Muzyka  ');

      await clickButton('Dodaj');

      const created = httpTesting.expectOne({ method: 'POST', url: CATEGORIES_URL });
      expect(created.request.body).toEqual({ name: 'Muzyka' });
      created.flush(OWN_CATEGORY);
      httpTesting.expectOne({ method: 'GET', url: CATEGORIES_URL }).flush([CATEGORY, OWN_CATEGORY]);
      await fixture.whenStable();

      expect(await fieldCount(NEW_CATEGORY_NAME)).toBe(0);

      await fillValidForm({ category: null });
      await save();

      expect(expectSavedBody()).toEqual({ ...BODY, categoryId: OWN_CATEGORY.id });
    });

    it('keeps the name field with an error when the name already exists', async () => {
      await createLoadedForm();
      await pick(CATEGORY_FIELD, ADD_OWN_CATEGORY);
      await typeInto(NEW_CATEGORY_NAME, 'Rozrywka');

      await clickButton('Dodaj');

      httpTesting
        .expectOne({ method: 'POST', url: CATEGORIES_URL })
        .flush({ message: 'Category already exists' }, { status: 409, statusText: 'Conflict' });
      await fixture.whenStable();

      httpTesting.expectNone({ method: 'GET', url: CATEGORIES_URL });
      expect(await fieldCount(NEW_CATEGORY_NAME)).toBe(1);
      expect(await (await field(NEW_CATEGORY_NAME)).hasErrors()).toBe(true);
    });
  });

  it('shows an alert when the categories cannot be loaded', async () => {
    await createForm();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('[role="alert"]').length).toBe(0);

    httpTesting
      .expectOne({ method: 'GET', url: CATEGORIES_URL })
      .flush('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });
    await fixture.whenStable();

    expect(host.querySelectorAll('[role="alert"]').length).toBe(1);
  });

  it('should create with its template rendered', async () => {
    await createLoadedForm();

    expect(fixture.componentInstance).toBeTruthy();
    expect(await fieldCount(NAME)).toBe(1);
  });
});

// The oracle is the API contract (amount as a number, dates as calendar days YYYY-MM-DD) and the
// calendar (2028 is a leap year, 2027 is not). These rows only prove that the form has the parsers
// and the Polish date adapter wired in and that their result reaches the request body; the other
// parsing cases are in subscription-request.spec.ts and the shared parser specs.
describe('SubscriptionForm typed text in the POST /subscriptions body', () => {
  // Values typed into the fields; a trial end also switches the status to a trial.
  interface TypedInput {
    amount?: string;
    nextBillingDate?: string;
    trialEndDate?: string;
  }

  it.each<[string, TypedInput, CreateSubscriptionRequest]>([
    ['an amount with a decimal comma', { amount: '12,99' }, { ...BODY, amount: 12.99 }],
    ['an amount with a space between thousands', { amount: '1 299,00' }, { ...BODY, amount: 1299 }],
    [
      'an amount with a no-break space between thousands',
      { amount: '1\u00A0299,00' },
      { ...BODY, amount: 1299 },
    ],
    // Day 5, month 1: without the Polish date adapter it would be read as 1 May.
    [
      'a billing date as day.month.year',
      { nextBillingDate: '05.01.2027' },
      { ...BODY, nextBillingDate: '2027-01-05' },
    ],
    [
      'a billing date on 29 February of a leap year',
      { nextBillingDate: '29.02.2028' },
      { ...BODY, nextBillingDate: '2028-02-29' },
    ],
    [
      'a trial ending on the billing day',
      { trialEndDate: '05.01.2027', nextBillingDate: '05.01.2027' },
      { ...BODY, status: 'trial', trialEndDate: '2027-01-05', nextBillingDate: '2027-01-05' },
    ],
  ])('sends %s as typed', async (_, typed, body) => {
    await createLoadedForm();
    if (typed.trialEndDate !== undefined) {
      await pick(STATUS, 'Trial');
      await typeDate(TRIAL_END, typed.trialEndDate);
    }
    await fillValidForm({
      amount: typed.amount ?? VALID_INPUT.amount,
      nextBillingDate: typed.nextBillingDate ?? VALID_INPUT.nextBillingDate,
    });

    await save();

    expect(expectSavedBody()).toEqual(body);
  });

  it.each<[string, string, Partial<FormInput>]>([
    ['an amount with three decimal places', AMOUNT, { amount: '12,999' }],
    ['29 February of a common year', NEXT_BILLING, { nextBillingDate: '29.02.2027' }],
    ['31 February', NEXT_BILLING, { nextBillingDate: '31.02.2027' }],
  ])('does not save %s and shows the field error', async (_, label, typed) => {
    await createLoadedForm();
    await fillValidForm(typed);

    await save();

    expectNothingSaved();
    expect(await (await field(label)).hasErrors()).toBe(true);
  });
});
