import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import type { BudgetResponse, UpdateBudgetRequest } from '../../budget/budget.types';
import type { CostTotals } from '../../subscriptions/subscription.types';
import { Budget } from './budget';

const BUDGET_URL = `${environment.apiUrl}/budget`;
const TOTALS_URL = `${environment.apiUrl}/subscriptions/totals`;

const DEFAULT_LABEL = 'Domyślny próg';

// GET /budget: the user's default threshold (3 until they save one) and every category of the
// account in the order of GET /categories; Streaming has no threshold of its own, so it shows the
// default, Muzyka a stored 0 (backend budget.service.ts).
const BUDGET: BudgetResponse = {
  defaultDuplicateThreshold: 3,
  categories: [
    {
      category: { id: 'category-streaming', name: 'Streaming', isDefault: true },
      duplicateThreshold: 3,
    },
    {
      category: { id: 'category-muzyka', name: 'Muzyka', isDefault: true },
      duplicateThreshold: 0,
    },
  ],
};
const NO_TOTALS: CostTotals = {
  monthly: '0.00',
  yearly: '0.00',
  monthlyLimit: null,
  budgetAlert: 'none',
  categories: [],
};

type Loader = ReturnType<typeof TestbedHarnessEnvironment.loader>;

// The page with its shell: the shell reads the cost totals, the page the budget.
async function createPage() {
  TestBed.configureTestingModule({
    imports: [Budget],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  const httpTesting = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(Budget);
  const loader = TestbedHarnessEnvironment.loader(fixture);
  await fixture.whenStable();
  httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(NO_TOTALS);
  httpTesting.expectOne({ method: 'GET', url: BUDGET_URL }).flush(BUDGET);
  await fixture.whenStable();
  return { httpTesting, fixture, loader, host: fixture.nativeElement as HTMLElement };
}

// A field found by its label as the user sees it: a category name or "Domyślny próg".
async function thresholdField(loader: Loader, label: string) {
  const field = await loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: label }));
  const input = await field.getControl(MatInputHarness);
  if (input === null) {
    throw new Error(`No input in the field "${label}"`);
  }
  return { field, input };
}

const saveButton = (loader: Loader) => loader.getHarness(MatButtonHarness.with({ text: 'Zapisz' }));

describe('Budget', () => {
  // The module is reset even when verify() finds an open request, so a failing test cannot leave
  // an instantiated TestBed behind and fail the tests after it.
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('should create', async () => {
    const { fixture } = await createPage();

    expect(fixture.componentInstance).toBeTruthy();
  });

  it('shows the default threshold and the threshold of every category from GET /budget', async () => {
    const { loader } = await createPage();

    expect(await (await thresholdField(loader, DEFAULT_LABEL)).input.getValue()).toBe('3');
    expect(await (await thresholdField(loader, 'Streaming')).input.getValue()).toBe('3');
    expect(await (await thresholdField(loader, 'Muzyka')).input.getValue()).toBe('0');
  });

  // The oracle is the API contract (dtos/update-budget.dto.ts): a whole number from 0 to 99.
  it.each([
    ['100', 'above the maximum'],
    ['', 'empty'],
    ['-1', 'negative'],
    ['1,5', 'not a whole number'],
  ])('refuses %j (%s) without a request', async (value) => {
    const { httpTesting, fixture, loader } = await createPage();
    const streaming = await thresholdField(loader, 'Streaming');

    await streaming.input.setValue(value);
    await (await saveButton(loader)).click();
    await fixture.whenStable();

    expect(await streaming.field.hasErrors()).toBe(true);
    httpTesting.expectNone({ method: 'PUT', url: BUDGET_URL });
  });

  it('refuses a default threshold above the maximum without a request', async () => {
    const { httpTesting, fixture, loader } = await createPage();
    const defaultField = await thresholdField(loader, DEFAULT_LABEL);

    await defaultField.input.setValue('100');
    await (await saveButton(loader)).click();
    await fixture.whenStable();

    expect(await defaultField.field.hasErrors()).toBe(true);
    httpTesting.expectNone({ method: 'PUT', url: BUDGET_URL });
  });

  // The oracle is the plan: "Zapisz" is off while the form holds the last loaded values, and a
  // field typed back to its old value is no change.
  it('keeps "Zapisz" off without changes and after a field returns to its old value', async () => {
    const { loader } = await createPage();
    const streaming = await thresholdField(loader, 'Streaming');
    const defaultField = await thresholdField(loader, DEFAULT_LABEL);

    expect(await (await saveButton(loader)).isDisabled()).toBe(true);

    await streaming.input.setValue('1');
    expect(await (await saveButton(loader)).isDisabled()).toBe(false);

    await streaming.input.setValue('3');
    expect(await (await saveButton(loader)).isDisabled()).toBe(true);

    await defaultField.input.setValue('5');
    expect(await (await saveButton(loader)).isDisabled()).toBe(false);

    await defaultField.input.setValue('3');
    expect(await (await saveButton(loader)).isDisabled()).toBe(true);
  });

  // The oracle is the API contract (PUT /budget changes only what it names) and the plan: only the
  // changed categories go out, the default only when it changed, and after the save the cost
  // totals are read again, so the shell's warnings follow; the saved values are the new baseline.
  it('sends only the changed categories and reads the cost totals again', async () => {
    const { httpTesting, fixture, loader, host } = await createPage();

    await (await thresholdField(loader, 'Streaming')).input.setValue('1');
    await (await saveButton(loader)).click();

    const update = httpTesting.expectOne({ method: 'PUT', url: BUDGET_URL });
    expect(update.request.body).toStrictEqual<UpdateBudgetRequest>({
      categories: [{ categoryId: 'category-streaming', duplicateThreshold: 1 }],
    });
    update.flush({
      ...BUDGET,
      categories: [{ ...BUDGET.categories[0], duplicateThreshold: 1 }, BUDGET.categories[1]],
    } satisfies BudgetResponse);
    await fixture.whenStable();

    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(NO_TOTALS);
    await fixture.whenStable();

    expect(host.querySelector('[role="status"]')?.textContent?.trim()).toBe('Zapisano progi.');
    expect(await (await thresholdField(loader, 'Streaming')).input.getValue()).toBe('1');
    expect(await (await saveButton(loader)).isDisabled()).toBe(true);
  });

  it('sends only the default threshold when only the default changed', async () => {
    const { httpTesting, fixture, loader } = await createPage();

    await (await thresholdField(loader, DEFAULT_LABEL)).input.setValue('5');
    await (await saveButton(loader)).click();

    const update = httpTesting.expectOne({ method: 'PUT', url: BUDGET_URL });
    expect(update.request.body).toStrictEqual<UpdateBudgetRequest>({
      defaultDuplicateThreshold: 5,
    });
    // Streaming has no threshold of its own, so it follows the new default.
    update.flush({
      defaultDuplicateThreshold: 5,
      categories: [{ ...BUDGET.categories[0], duplicateThreshold: 5 }, BUDGET.categories[1]],
    } satisfies BudgetResponse);
    await fixture.whenStable();
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(NO_TOTALS);
    await fixture.whenStable();

    expect(await (await thresholdField(loader, DEFAULT_LABEL)).input.getValue()).toBe('5');
    expect(await (await thresholdField(loader, 'Streaming')).input.getValue()).toBe('5');
    expect(await (await saveButton(loader)).isDisabled()).toBe(true);
  });

  it('sends the default and the changed category together', async () => {
    const { httpTesting, fixture, loader } = await createPage();

    await (await thresholdField(loader, DEFAULT_LABEL)).input.setValue('4');
    await (await thresholdField(loader, 'Muzyka')).input.setValue('99');
    await (await saveButton(loader)).click();

    const update = httpTesting.expectOne({ method: 'PUT', url: BUDGET_URL });
    expect(update.request.body).toStrictEqual<UpdateBudgetRequest>({
      defaultDuplicateThreshold: 4,
      categories: [{ categoryId: 'category-muzyka', duplicateThreshold: 99 }],
    });
    update.flush({
      defaultDuplicateThreshold: 4,
      categories: [
        { ...BUDGET.categories[0], duplicateThreshold: 4 },
        { ...BUDGET.categories[1], duplicateThreshold: 99 },
      ],
    } satisfies BudgetResponse);
    await fixture.whenStable();
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(NO_TOTALS);
    await fixture.whenStable();
  });

  // 400: a category of the form is gone (another tab deleted it), nothing was saved; the list is
  // read again with a message.
  it('reads the budget again after a 400', async () => {
    const { httpTesting, fixture, loader, host } = await createPage();

    await (await thresholdField(loader, 'Muzyka')).input.setValue('1');
    await (await saveButton(loader)).click();
    httpTesting.expectOne({ method: 'PUT', url: BUDGET_URL }).flush(
      { message: 'categories must name only usable categories' },
      {
        status: 400,
        statusText: 'Bad Request',
      },
    );
    await fixture.whenStable();

    httpTesting
      .expectOne({ method: 'GET', url: BUDGET_URL })
      .flush({ ...BUDGET, categories: [BUDGET.categories[0]] } satisfies BudgetResponse);
    await fixture.whenStable();

    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(
      await loader.getAllHarnesses(MatFormFieldHarness.with({ floatingLabelText: 'Muzyka' })),
    ).toHaveLength(0);
    httpTesting.expectNone({ method: 'GET', url: TOTALS_URL });
  });

  it('keeps the typed form after another failure, with a message and without reading it again', async () => {
    const { httpTesting, fixture, loader, host } = await createPage();

    await (await thresholdField(loader, 'Streaming')).input.setValue('1');
    await (await saveButton(loader)).click();
    httpTesting
      .expectOne({ method: 'PUT', url: BUDGET_URL })
      .flush(null, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();

    httpTesting.expectNone({ method: 'GET', url: BUDGET_URL });
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(await (await thresholdField(loader, 'Streaming')).input.getValue()).toBe('1');
    // The change is still unsaved, so it can be sent again.
    expect(await (await saveButton(loader)).isDisabled()).toBe(false);
  });
});
