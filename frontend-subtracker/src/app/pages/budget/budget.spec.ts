import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatTooltipHarness } from '@angular/material/tooltip/testing';
import { provideRouter } from '@angular/router';
import type { MockInstance } from 'vitest';
import { environment } from '../../../environments/environment';
import { ErrorReporter } from '../../shared/error-reporter';
import type { BudgetResponse, UpdateBudgetRequest } from '../../budget/budget.types';
import type { CostTotals } from '../../subscriptions/subscription.types';
import { Budget } from './budget';

const BUDGET_URL = `${environment.apiUrl}/budget`;
const TOTALS_URL = `${environment.apiUrl}/subscriptions/totals`;
const CATEGORIES_URL = `${environment.apiUrl}/categories`;

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
// S-17: the same budget with an own category after the defaults (GET /budget lists every category
// in the order of GET /categories, each with its isDefault).
const GYM = 'category-gym';
const WITH_OWN: BudgetResponse = {
  ...BUDGET,
  categories: [
    ...BUDGET.categories,
    {
      category: { id: GYM, name: 'Siłownia', isDefault: false },
      duplicateThreshold: 3,
      monthlyLimit: null,
    },
  ],
};
const RENAME_GYM = 'Zmień nazwę kategorii Siłownia';
const DELETE_GYM = 'Usuń kategorię Siłownia';
const UNSAVED_TOOLTIP = 'Najpierw zapisz albo cofnij zmiany progów i limitów.';

const NO_TOTALS: CostTotals = {
  monthly: '0.00',
  yearly: '0.00',
  monthlyLimit: null,
  budgetAlert: 'none',
  categories: [],
};

type Loader = ReturnType<typeof TestbedHarnessEnvironment.loader>;

// ErrorReporter.report: an unknown error is reported under 'Budget', a recognized answer (400 of
// the save, 409 of a new category) is not.
let report: MockInstance<ErrorReporter['report']>;

// The page with its shell: the shell reads the cost totals, the page the budget.
async function createPage(budget: BudgetResponse = BUDGET) {
  TestBed.configureTestingModule({
    imports: [Budget],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  report = vi.spyOn(TestBed.inject(ErrorReporter), 'report').mockImplementation(() => {});
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

// S-17: an icon of an own category, found by its accessible name ("Usuń kategorię Siłownia").
const iconButton = (loader: Loader, label: string) =>
  loader.getHarness(MatButtonHarness.with({ selector: `[aria-label="${label}"]` }));

// The dialogs open in the overlay, outside the page's element.
const dialogLoader = (fixture: ComponentFixture<Budget>) =>
  TestbedHarnessEnvironment.documentRootLoader(fixture);

const dialogButton = (fixture: ComponentFixture<Budget>, label: string) =>
  dialogLoader(fixture).getHarness(
    MatButtonHarness.with({ text: label, ancestor: 'mat-dialog-container' }),
  );

// After a dialog's answer the page reads the budget again like on its first load and the shell
// its cost totals, says what happened in the status region and moves the focus to the heading of
// the categories.
async function expectReloaded(
  page: Awaited<ReturnType<typeof createPage>>,
  budget: BudgetResponse,
  message: string,
) {
  const { httpTesting, fixture, host } = page;
  httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(NO_TOTALS);
  httpTesting.expectOne({ method: 'GET', url: BUDGET_URL }).flush(budget);
  await fixture.whenStable();
  expect(text(host.querySelector('[role="status"]'))).toBe(message);
  expect(document.activeElement).toBe(host.querySelector('.budget__legend'));
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

  it('shows an alert and reports the error when the budget cannot be read', async () => {
    TestBed.configureTestingModule({
      imports: [Budget],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    report = vi.spyOn(TestBed.inject(ErrorReporter), 'report').mockImplementation(() => {});
    const httpTesting = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Budget);
    await fixture.whenStable();
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(NO_TOTALS);
    httpTesting
      .expectOne({ method: 'GET', url: BUDGET_URL })
      .flush(null, { status: 503, statusText: 'Service Unavailable' });
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('Budget', expect.anything());
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
    expect(report).not.toHaveBeenCalled();
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
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('Budget', expect.anything());
  });

  // S-17. The oracle is the plan: only an own category (isDefault false in GET /budget) has the
  // two icons; the API renames and deletes no default one.
  it('shows "Zmień nazwę" and "Usuń" only by an own category', async () => {
    const { host } = await createPage(WITH_OWN);

    const labels = [...host.querySelectorAll('.budget__category button[aria-label]')].map(
      (button) => button.getAttribute('aria-label'),
    );
    expect(labels).toEqual([RENAME_GYM, DELETE_GYM]);
    expect(host.querySelector(`[data-category="${GYM}"] button`)).not.toBeNull();
    expect(host.querySelector(`[data-category="${STREAMING}"] button`)).toBeNull();
    expect(host.querySelector(`[data-category="${MUZYKA}"] button`)).toBeNull();
  });

  // A rename or a delete reads the list again, which would drop typed changes, so the icons are
  // off (still focusable, with a tooltip saying why) until the form holds the loaded values again.
  it('turns the icons off with a tooltip while the form has unsaved changes', async () => {
    const { httpTesting, fixture, loader } = await createPage(WITH_OWN);
    const threshold = await categoryField(loader, STREAMING, THRESHOLD_LABEL);

    expect(await (await iconButton(loader, RENAME_GYM)).isDisabled()).toBe(false);

    await threshold.input.setValue('1');
    for (const label of [RENAME_GYM, DELETE_GYM]) {
      const button = await iconButton(loader, label);
      expect(await button.isDisabled()).toBe(true);
      const tooltip = await loader.getHarness(
        MatTooltipHarness.with({ selector: `[aria-label="${label}"]` }),
      );
      await tooltip.show();
      expect(await tooltip.getTooltipText()).toBe(UNSAVED_TOOLTIP);
      await tooltip.hide();
      // disabledInteractive: a click still arrives and must open nothing.
      await button.click();
    }
    await fixture.whenStable();
    expect(await dialogLoader(fixture).getAllHarnesses(MatDialogHarness)).toHaveLength(0);

    await threshold.input.setValue('3');
    expect(await (await iconButton(loader, DELETE_GYM)).isDisabled()).toBe(false);
    httpTesting.expectNone({ method: 'GET', url: BUDGET_URL });
  });

  it('reads the budget and the totals again after a rename', async () => {
    const page = await createPage(WITH_OWN);
    const { httpTesting, fixture, loader, host } = page;

    await (await iconButton(loader, RENAME_GYM)).click();
    await fixture.whenStable();
    const field = await dialogLoader(fixture).getHarness(
      MatFormFieldHarness.with({ floatingLabelText: 'Nazwa kategorii' }),
    );
    await (await field.getControl(MatInputHarness))?.setValue('Joga');
    await (await dialogButton(fixture, 'Zapisz')).click();
    httpTesting
      .expectOne({ method: 'PATCH', url: `${CATEGORIES_URL}/${GYM}` })
      .flush({ id: GYM, name: 'Joga', isDefault: false });
    await fixture.whenStable();

    await expectReloaded(
      page,
      {
        ...WITH_OWN,
        categories: [
          ...BUDGET.categories,
          { ...WITH_OWN.categories[2], category: { id: GYM, name: 'Joga', isDefault: false } },
        ],
      },
      'Zmieniono nazwę kategorii.',
    );
    expect(text(host.querySelector(`[data-category="${GYM}"] .budget__category-name`))).toBe(
      'Joga',
    );
  });

  it('reads the budget and the totals again after a delete', async () => {
    const page = await createPage(WITH_OWN);
    const { httpTesting, fixture, loader, host } = page;

    await (await iconButton(loader, DELETE_GYM)).click();
    await fixture.whenStable();
    await (await dialogButton(fixture, 'Usuń')).click();
    httpTesting
      .expectOne({ method: 'DELETE', url: `${CATEGORIES_URL}/${GYM}` })
      .flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();

    await expectReloaded(page, BUDGET, 'Usunięto kategorię.');
    expect(host.querySelector(`[data-category="${GYM}"]`)).toBeNull();
  });

  it('reads the budget and the totals again when the category is already gone (404)', async () => {
    const page = await createPage(WITH_OWN);
    const { httpTesting, fixture, loader } = page;

    await (await iconButton(loader, RENAME_GYM)).click();
    await fixture.whenStable();
    const field = await dialogLoader(fixture).getHarness(
      MatFormFieldHarness.with({ floatingLabelText: 'Nazwa kategorii' }),
    );
    await (await field.getControl(MatInputHarness))?.setValue('Joga');
    await (await dialogButton(fixture, 'Zapisz')).click();
    httpTesting
      .expectOne({ method: 'PATCH', url: `${CATEGORIES_URL}/${GYM}` })
      .flush({ message: 'Category not found' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();

    await expectReloaded(page, BUDGET, 'Kategoria już nie istnieje.');
  });

  it('changes nothing when a category dialog is closed without a result', async () => {
    const { httpTesting, fixture, loader, host } = await createPage(WITH_OWN);

    await (await iconButton(loader, DELETE_GYM)).click();
    await fixture.whenStable();
    await (await dialogButton(fixture, 'Anuluj')).click();
    await fixture.whenStable();

    httpTesting.expectNone({ method: 'GET', url: BUDGET_URL });
    httpTesting.expectNone({ method: 'GET', url: TOTALS_URL });
    expect(text(host.querySelector('[role="status"]'))).toBe('');
  });

  // S-17: "Nowa kategoria" below the list, outside the budget form.
  describe('a new category', () => {
    const NEW_NAME_LABEL = 'Nazwa nowej kategorii';
    const TAKEN_ERROR = 'Taka kategoria już istnieje.';
    const addButton = (loader: Loader) =>
      loader.getHarness(MatButtonHarness.with({ text: 'Dodaj' }));
    const newNameField = (loader: Loader) => fieldIn(loader, NEW_NAME_LABEL);
    const newNameInput = (host: HTMLElement) =>
      host.querySelector<HTMLInputElement>('.budget__new-category input');

    // The oracle is the plan: off without a name and for a name a loaded category already has, in
    // any letter case, a default one too (the API would answer 409).
    it.each([
      ['', 'empty'],
      ['   ', 'only spaces'],
      ['siłownia', 'an own category in lower case'],
      ['SIŁOWNIA', 'an own category in upper case'],
      ['  Streaming ', 'a default category with spaces around'],
      ['MUZYKA', 'a default category in upper case'],
    ])('keeps "Dodaj" off for %j (%s)', async (value) => {
      const { loader } = await createPage(WITH_OWN);
      const { input } = await newNameField(loader);

      await input.setValue(value);

      expect(await (await addButton(loader)).isDisabled()).toBe(true);
    });

    it('turns "Dodaj" on for a new name and shows the error for a taken one', async () => {
      const { loader } = await createPage(WITH_OWN);
      const { field, input } = await newNameField(loader);

      await input.setValue('Joga');
      expect(await (await addButton(loader)).isDisabled()).toBe(false);
      expect(await field.hasErrors()).toBe(false);

      await input.setValue('siŁownia');
      expect(await field.getTextErrors()).toEqual([TAKEN_ERROR]);
    });

    // Adding reads the list again, which would drop the typed thresholds and limits.
    it('is off while the budget form has unsaved changes', async () => {
      const { httpTesting, loader } = await createPage(WITH_OWN);
      const { input } = await newNameField(loader);
      await input.setValue('Joga');
      const threshold = await categoryField(loader, STREAMING, THRESHOLD_LABEL);

      await threshold.input.setValue('1');
      const button = await addButton(loader);
      expect(await button.isDisabled()).toBe(true);
      expect(await input.isDisabled()).toBe(true);
      const tooltip = await loader.getHarness(
        MatTooltipHarness.with({ selector: '.budget__new-category-button' }),
      );
      await tooltip.show();
      expect(await tooltip.getTooltipText()).toBe(UNSAVED_TOOLTIP);
      await tooltip.hide();
      // disabledInteractive: a click still arrives and must send nothing.
      await button.click();
      httpTesting.expectNone({ method: 'POST', url: CATEGORIES_URL });

      await threshold.input.setValue('3');
      expect(await input.isDisabled()).toBe(false);
      expect(await (await addButton(loader)).isDisabled()).toBe(false);
    });

    it('adds the category, empties the field and reads the budget and the totals again', async () => {
      const { httpTesting, fixture, loader, host } = await createPage(WITH_OWN);
      const { input } = await newNameField(loader);

      await input.setValue('  Joga ');
      await (await addButton(loader)).click();
      const create = httpTesting.expectOne({ method: 'POST', url: CATEGORIES_URL });
      expect(create.request.body).toStrictEqual({ name: 'Joga' });
      create.flush({ id: 'category-joga', name: 'Joga', isDefault: false });
      await fixture.whenStable();

      httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(NO_TOTALS);
      httpTesting.expectOne({ method: 'GET', url: BUDGET_URL }).flush({
        ...WITH_OWN,
        categories: [
          ...WITH_OWN.categories,
          {
            category: { id: 'category-joga', name: 'Joga', isDefault: false },
            duplicateThreshold: 3,
            monthlyLimit: null,
          },
        ],
      } satisfies BudgetResponse);
      await fixture.whenStable();

      expect(text(host.querySelector('[role="status"]'))).toBe('Dodano kategorię.');
      expect(host.querySelector('[data-category="category-joga"]')).not.toBeNull();
      const field = await newNameField(loader);
      expect(await field.input.getValue()).toBe('');
      expect(await field.field.hasErrors()).toBe(false);
      expect(await (await addButton(loader)).isDisabled()).toBe(true);
      expect(document.activeElement).toBe(newNameInput(host));
      httpTesting.expectNone({ method: 'PUT', url: BUDGET_URL });
    });

    // The answer reads the list again and rebuilds the form, so nothing may be typed meanwhile.
    it('keeps the budget form off while the category is being added', async () => {
      const { httpTesting, fixture, loader } = await createPage(WITH_OWN);
      const { input } = await newNameField(loader);

      await input.setValue('Joga');
      await (await addButton(loader)).click();
      const create = httpTesting.expectOne({ method: 'POST', url: CATEGORIES_URL });

      const threshold = await categoryField(loader, STREAMING, THRESHOLD_LABEL);
      expect(await threshold.input.isDisabled()).toBe(true);
      expect(await (await fieldIn(loader, OVERALL_LIMIT_LABEL)).input.isDisabled()).toBe(true);
      expect(await (await saveButton(loader)).isDisabled()).toBe(true);

      create.flush(null, { status: 500, statusText: 'Server Error' });
      await fixture.whenStable();
      expect(await threshold.input.isDisabled()).toBe(false);
    });

    // A name taken in the meantime (e.g. in another tab) is refused by the API.
    it('shows the error of the field after a 409', async () => {
      const { httpTesting, fixture, loader } = await createPage(WITH_OWN);
      const { field, input } = await newNameField(loader);

      await input.setValue('Joga');
      await (await addButton(loader)).click();
      httpTesting
        .expectOne({ method: 'POST', url: CATEGORIES_URL })
        .flush({ message: 'Category already exists' }, { status: 409, statusText: 'Conflict' });
      await fixture.whenStable();

      expect(await field.getTextErrors()).toEqual([TAKEN_ERROR]);
      expect(await (await addButton(loader)).isDisabled()).toBe(true);
      httpTesting.expectNone({ method: 'GET', url: BUDGET_URL });
      expect(report).not.toHaveBeenCalled();
    });

    it('keeps the name with a message after another failure', async () => {
      const { httpTesting, fixture, loader, host } = await createPage(WITH_OWN);
      const { input } = await newNameField(loader);

      await input.setValue('Joga');
      await (await addButton(loader)).click();
      httpTesting
        .expectOne({ method: 'POST', url: CATEGORIES_URL })
        .flush(null, { status: 500, statusText: 'Server Error' });
      await fixture.whenStable();

      expect(text(host.querySelector('.budget__new-category [role="alert"]'))).toBe(
        'Nie udało się dodać kategorii. Spróbuj ponownie.',
      );
      expect(await input.getValue()).toBe('Joga');
      expect(await (await addButton(loader)).isDisabled()).toBe(false);
      httpTesting.expectNone({ method: 'GET', url: BUDGET_URL });
      expect(report).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledWith('Budget', expect.anything());
    });

    // Enter in a field submits the form around it; here it adds the category and the default is
    // prevented, so the budget form is never saved.
    it('adds the category with Enter and never saves the budget form', async () => {
      const { httpTesting, fixture, loader, host } = await createPage(WITH_OWN);
      await (await newNameField(loader)).input.setValue('Joga');

      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      newNameInput(host)?.dispatchEvent(enter);
      await fixture.whenStable();

      expect(enter.defaultPrevented).toBe(true);
      httpTesting
        .expectOne({ method: 'POST', url: CATEGORIES_URL })
        .flush({ id: 'category-joga', name: 'Joga', isDefault: false });
      await fixture.whenStable();
      httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(NO_TOTALS);
      httpTesting.expectOne({ method: 'GET', url: BUDGET_URL }).flush(WITH_OWN);
      await fixture.whenStable();
      httpTesting.expectNone({ method: 'PUT', url: BUDGET_URL });
    });
  });
});
