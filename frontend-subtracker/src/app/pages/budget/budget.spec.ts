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

const DEFAULT_LABEL = 'Domyślny próg ilościowy dla kategorii';
const OVERALL_LIMIT_LABEL = 'Miesięczny limit całościowy (zł)';
const THRESHOLD_LABEL = 'Próg';
const LIMIT_LABEL = 'Limit miesięczny (zł)';

const STREAMING = 'category-streaming';
const MUZYKA = 'category-muzyka';

// GET /budget: the user's default threshold (3 until they save one), no overall limit, and every
// category of the account in the order of GET /categories; Streaming has no threshold of its own,
// so it shows the default, and a limit of 80 zł; Muzyka a stored threshold 0 and no limit (backend
// budget.service.ts).
const BUDGET: BudgetResponse = {
  defaultDuplicateThreshold: 3,
  monthlyLimit: null,
  categories: [
    {
      category: { id: STREAMING, name: 'Streaming', isDefault: true },
      duplicateThreshold: 3,
      monthlyLimit: '80.00',
    },
    {
      category: { id: MUZYKA, name: 'Muzyka', isDefault: true },
      duplicateThreshold: 0,
      monthlyLimit: null,
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
async function createPage(budget: BudgetResponse = BUDGET) {
  TestBed.configureTestingModule({
    imports: [Budget],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  const httpTesting = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(Budget);
  const loader = TestbedHarnessEnvironment.loader(fixture);
  await fixture.whenStable();
  httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(NO_TOTALS);
  httpTesting.expectOne({ method: 'GET', url: BUDGET_URL }).flush(budget);
  await fixture.whenStable();
  return { httpTesting, fixture, loader, host: fixture.nativeElement as HTMLElement };
}

// A field found by its label as the user sees it ("Domyślny próg ilościowy dla kategorii", "Próg", "Limit miesięczny (zł)").
async function fieldIn(loader: Loader, label: string) {
  const field = await loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: label }));
  const input = await field.getControl(MatInputHarness);
  if (input === null) {
    throw new Error(`No input in the field "${label}"`);
  }
  return { field, input };
}

// A field of one category's group (its name labels the group): "Próg" or "Limit miesięczny (zł)".
async function categoryField(loader: Loader, categoryId: string, label: string) {
  return fieldIn(await loader.getChildLoader(`[data-category="${categoryId}"]`), label);
}

const saveButton = (loader: Loader) => loader.getHarness(MatButtonHarness.with({ text: 'Zapisz' }));

function text(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

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

    expect(await (await fieldIn(loader, DEFAULT_LABEL)).input.getValue()).toBe('3');
    expect(await (await categoryField(loader, STREAMING, THRESHOLD_LABEL)).input.getValue()).toBe(
      '3',
    );
    expect(await (await categoryField(loader, MUZYKA, THRESHOLD_LABEL)).input.getValue()).toBe('0');
  });

  // The oracle is the API contract (S-08): a limit is an amount or null for none; the field shows
  // it the Polish way and stays empty without a limit.
  it('shows the overall limit and the limit of every category from GET /budget', async () => {
    const { loader } = await createPage({ ...BUDGET, monthlyLimit: '1200.50' });

    expect(await (await fieldIn(loader, OVERALL_LIMIT_LABEL)).input.getValue()).toBe('1200,50');
    expect(await (await categoryField(loader, STREAMING, LIMIT_LABEL)).input.getValue()).toBe(
      '80,00',
    );
    expect(await (await categoryField(loader, MUZYKA, LIMIT_LABEL)).input.getValue()).toBe('');
  });

  // The oracle is the API contract (dtos/update-budget.dto.ts): a whole number from 0 to 99.
  it.each([
    ['100', 'above the maximum'],
    ['', 'empty'],
    ['-1', 'negative'],
    ['1,5', 'not a whole number'],
  ])('refuses the threshold %j (%s) without a request', async (value) => {
    const { httpTesting, fixture, loader } = await createPage();
    const streaming = await categoryField(loader, STREAMING, THRESHOLD_LABEL);

    await streaming.input.setValue(value);
    await (await saveButton(loader)).click();
    await fixture.whenStable();

    expect(await streaming.field.hasErrors()).toBe(true);
    httpTesting.expectNone({ method: 'PUT', url: BUDGET_URL });
  });

  it('refuses a default threshold above the maximum without a request', async () => {
    const { httpTesting, fixture, loader } = await createPage();
    const defaultField = await fieldIn(loader, DEFAULT_LABEL);

    await defaultField.input.setValue('100');
    await (await saveButton(loader)).click();
    await fixture.whenStable();

    expect(await defaultField.field.hasErrors()).toBe(true);
    httpTesting.expectNone({ method: 'PUT', url: BUDGET_URL });
  });

  // The oracle is the API contract (IsAmount): an amount from 0 to 99 999,99 with at most two
  // decimals, for the overall limit and a category's limit alike.
  describe.each([
    ['the overall limit', (loader: Loader) => fieldIn(loader, OVERALL_LIMIT_LABEL)],
    ['a category limit', (loader: Loader) => categoryField(loader, MUZYKA, LIMIT_LABEL)],
  ])('%s', (_name, limitField) => {
    it.each([
      ['100000', 'above the maximum'],
      ['-1', 'negative'],
      ['12,345', 'three decimals'],
    ])('refuses %j (%s) without a request', async (value) => {
      const { httpTesting, fixture, loader } = await createPage();
      const limit = await limitField(loader);

      await limit.input.setValue(value);
      await (await saveButton(loader)).click();
      await fixture.whenStable();

      expect(await limit.field.hasErrors()).toBe(true);
      httpTesting.expectNone({ method: 'PUT', url: BUDGET_URL });
    });
  });

  // The oracle is the plan: "Zapisz" is off while the form holds the last loaded values, and a
  // field typed back to its old value is no change.
  it('keeps "Zapisz" off without changes and after a field returns to its old value', async () => {
    const { loader } = await createPage();
    const streaming = await categoryField(loader, STREAMING, THRESHOLD_LABEL);
    const defaultField = await fieldIn(loader, DEFAULT_LABEL);

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

  // The same amount typed another way ("80" for 80,00 zł) is no change.
  it('keeps "Zapisz" off for a limit typed back as the same amount', async () => {
    const { loader } = await createPage();
    const limit = await categoryField(loader, STREAMING, LIMIT_LABEL);

    await limit.input.setValue('81');
    expect(await (await saveButton(loader)).isDisabled()).toBe(false);

    await limit.input.setValue('80');
    expect(await (await saveButton(loader)).isDisabled()).toBe(true);
  });

  // The oracle is the API contract (PUT /budget changes only what it names) and the plan: only the
  // changed categories go out, the default only when it changed, and after the save the cost
  // totals are read again, so the shell's warnings follow; the saved values are the new baseline.
  it('sends only the changed categories and reads the cost totals again', async () => {
    const { httpTesting, fixture, loader, host } = await createPage();

    await (await categoryField(loader, STREAMING, THRESHOLD_LABEL)).input.setValue('1');
    await (await saveButton(loader)).click();

    const update = httpTesting.expectOne({ method: 'PUT', url: BUDGET_URL });
    expect(update.request.body).toStrictEqual<UpdateBudgetRequest>({
      categories: [{ categoryId: STREAMING, duplicateThreshold: 1 }],
    });
    update.flush({
      ...BUDGET,
      categories: [{ ...BUDGET.categories[0], duplicateThreshold: 1 }, BUDGET.categories[1]],
    } satisfies BudgetResponse);
    await fixture.whenStable();

    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(NO_TOTALS);
    await fixture.whenStable();

    expect(host.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'Zapisano ustawienia budżetu.',
    );
    expect(await (await categoryField(loader, STREAMING, THRESHOLD_LABEL)).input.getValue()).toBe(
      '1',
    );
    expect(await (await saveButton(loader)).isDisabled()).toBe(true);
  });

  it('sends only the default threshold when only the default changed', async () => {
    const { httpTesting, fixture, loader } = await createPage();

    await (await fieldIn(loader, DEFAULT_LABEL)).input.setValue('5');
    await (await saveButton(loader)).click();

    const update = httpTesting.expectOne({ method: 'PUT', url: BUDGET_URL });
    expect(update.request.body).toStrictEqual<UpdateBudgetRequest>({
      defaultDuplicateThreshold: 5,
    });
    // Streaming has no threshold of its own, so it follows the new default.
    update.flush({
      ...BUDGET,
      defaultDuplicateThreshold: 5,
      categories: [{ ...BUDGET.categories[0], duplicateThreshold: 5 }, BUDGET.categories[1]],
    } satisfies BudgetResponse);
    await fixture.whenStable();
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(NO_TOTALS);
    await fixture.whenStable();

    expect(await (await fieldIn(loader, DEFAULT_LABEL)).input.getValue()).toBe('5');
    expect(await (await categoryField(loader, STREAMING, THRESHOLD_LABEL)).input.getValue()).toBe(
      '5',
    );
    expect(await (await saveButton(loader)).isDisabled()).toBe(true);
  });

  it('sends the default and the changed category together', async () => {
    const { httpTesting, fixture, loader } = await createPage();

    await (await fieldIn(loader, DEFAULT_LABEL)).input.setValue('4');
    await (await categoryField(loader, MUZYKA, THRESHOLD_LABEL)).input.setValue('99');
    await (await saveButton(loader)).click();

    const update = httpTesting.expectOne({ method: 'PUT', url: BUDGET_URL });
    expect(update.request.body).toStrictEqual<UpdateBudgetRequest>({
      defaultDuplicateThreshold: 4,
      categories: [{ categoryId: MUZYKA, duplicateThreshold: 99 }],
    });
    update.flush({
      ...BUDGET,
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

  // The oracle is the API contract (S-08): the overall limit goes out as a number typed the Polish
  // way, and after the save the cost totals are read again, so the bar in the column follows.
  it('sends a new overall limit as a number and reads the cost totals again', async () => {
    const { httpTesting, fixture, loader } = await createPage();

    await (await fieldIn(loader, OVERALL_LIMIT_LABEL)).input.setValue('1 200,50');
    await (await saveButton(loader)).click();

    const update = httpTesting.expectOne({ method: 'PUT', url: BUDGET_URL });
    expect(update.request.body).toStrictEqual<UpdateBudgetRequest>({ monthlyLimit: 1200.5 });
    update.flush({ ...BUDGET, monthlyLimit: '1200.50' } satisfies BudgetResponse);
    await fixture.whenStable();
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(NO_TOTALS);
    await fixture.whenStable();

    expect(await (await fieldIn(loader, OVERALL_LIMIT_LABEL)).input.getValue()).toBe('1200,50');
    expect(await (await saveButton(loader)).isDisabled()).toBe(true);
  });

  // The oracle is the API contract (S-08): `monthlyLimit: null` removes a limit.
  it('sends null for a cleared limit', async () => {
    const { httpTesting, fixture, loader } = await createPage({
      ...BUDGET,
      monthlyLimit: '200.00',
    });

    await (await fieldIn(loader, OVERALL_LIMIT_LABEL)).input.setValue('');
    await (await categoryField(loader, STREAMING, LIMIT_LABEL)).input.setValue('');
    await (await saveButton(loader)).click();

    const update = httpTesting.expectOne({ method: 'PUT', url: BUDGET_URL });
    expect(update.request.body).toStrictEqual<UpdateBudgetRequest>({
      monthlyLimit: null,
      categories: [{ categoryId: STREAMING, monthlyLimit: null }],
    });
    update.flush({
      ...BUDGET,
      categories: [{ ...BUDGET.categories[0], monthlyLimit: null }, BUDGET.categories[1]],
    } satisfies BudgetResponse);
    await fixture.whenStable();
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(NO_TOTALS);
    await fixture.whenStable();
  });

  // The oracle is the API contract (S-08): a category names only the fields that change, so a
  // limit alone leaves the threshold out (a default category keeps following the default).
  it('sends a category with only its limit when only the limit changed', async () => {
    const { httpTesting, fixture, loader } = await createPage();

    await (await categoryField(loader, MUZYKA, LIMIT_LABEL)).input.setValue('49,99');
    await (await saveButton(loader)).click();

    const update = httpTesting.expectOne({ method: 'PUT', url: BUDGET_URL });
    expect(update.request.body).toStrictEqual<UpdateBudgetRequest>({
      categories: [{ categoryId: MUZYKA, monthlyLimit: 49.99 }],
    });
    update.flush({
      ...BUDGET,
      categories: [BUDGET.categories[0], { ...BUDGET.categories[1], monthlyLimit: '49.99' }],
    } satisfies BudgetResponse);
    await fixture.whenStable();
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(NO_TOTALS);
    await fixture.whenStable();
  });

  it('sends the threshold and the limit of a category in one item', async () => {
    const { httpTesting, fixture, loader } = await createPage();

    await (await categoryField(loader, MUZYKA, THRESHOLD_LABEL)).input.setValue('2');
    await (await categoryField(loader, MUZYKA, LIMIT_LABEL)).input.setValue('0');
    await (await saveButton(loader)).click();

    const update = httpTesting.expectOne({ method: 'PUT', url: BUDGET_URL });
    expect(update.request.body).toStrictEqual<UpdateBudgetRequest>({
      categories: [{ categoryId: MUZYKA, duplicateThreshold: 2, monthlyLimit: 0 }],
    });
    update.flush({
      ...BUDGET,
      categories: [
        BUDGET.categories[0],
        { ...BUDGET.categories[1], duplicateThreshold: 2, monthlyLimit: '0.00' },
      ],
    } satisfies BudgetResponse);
    await fixture.whenStable();
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(NO_TOTALS);
    await fixture.whenStable();
  });

  // The oracle is the plan: a hint, not an error, while the category limits typed add up to more
  // than the overall limit; the save stays possible.
  it('hints while the category limits add up to more than the overall limit', async () => {
    const { loader, host } = await createPage();
    const hint = () => host.querySelector('.budget__hint');

    await (await fieldIn(loader, OVERALL_LIMIT_LABEL)).input.setValue('100');
    expect(hint()).toBeNull();

    await (await categoryField(loader, MUZYKA, LIMIT_LABEL)).input.setValue('30');
    expect(text(hint())).toBe(
      'Suma limitów kategorii (110,00 zł) przekracza limit całościowy (100,00 zł).',
    );
    expect(await (await saveButton(loader)).isDisabled()).toBe(false);

    await (await categoryField(loader, MUZYKA, LIMIT_LABEL)).input.setValue('20');
    expect(hint()).toBeNull();

    await (await categoryField(loader, MUZYKA, LIMIT_LABEL)).input.setValue('20,01');
    expect(hint()).not.toBeNull();

    await (await fieldIn(loader, OVERALL_LIMIT_LABEL)).input.setValue('');
    expect(hint()).toBeNull();
  });

  // 400: a category of the form is gone (another tab deleted it), nothing was saved; the list is
  // read again with a message.
  it('reads the budget again after a 400', async () => {
    const { httpTesting, fixture, loader, host } = await createPage();

    await (await categoryField(loader, MUZYKA, THRESHOLD_LABEL)).input.setValue('1');
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
    expect(host.querySelector(`[data-category="${MUZYKA}"]`)).toBeNull();
    httpTesting.expectNone({ method: 'GET', url: TOTALS_URL });
  });

  it('keeps the typed form after another failure, with a message and without reading it again', async () => {
    const { httpTesting, fixture, loader, host } = await createPage();

    await (await categoryField(loader, STREAMING, THRESHOLD_LABEL)).input.setValue('1');
    await (await saveButton(loader)).click();
    httpTesting
      .expectOne({ method: 'PUT', url: BUDGET_URL })
      .flush(null, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();

    httpTesting.expectNone({ method: 'GET', url: BUDGET_URL });
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(await (await categoryField(loader, STREAMING, THRESHOLD_LABEL)).input.getValue()).toBe(
      '1',
    );
    // The change is still unsaved, so it can be sent again.
    expect(await (await saveButton(loader)).isDisabled()).toBe(false);
  });
});
