import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { environment } from '../../../../environments/environment';
import type { Category } from '../../../subscriptions/subscription.types';
import { openRenameCategoryDialog, RenameCategoryResult } from './rename-category-dialog';

const GYM: Category = { id: 'category-1', name: 'Siłownia', isDefault: false };

const CATEGORY_URL = `${environment.apiUrl}/categories/${GYM.id}`;

// An empty host: the harness loader needs a fixture, the dialog itself opens in the overlay.
@Component({ template: '' })
class Host {}

// The dialog is opened the way the page opens it, through the real MatDialog; only the HTTP
// boundary is replaced. `results` records what afterClosed() emitted.
async function openDialog() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const httpTesting = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(Host);
  const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
  const results: (RenameCategoryResult | undefined)[] = [];
  openRenameCategoryDialog(TestBed.inject(MatDialog), GYM)
    .afterClosed()
    .subscribe((result) => results.push(result));
  await fixture.whenStable();
  const field = await loader.getHarness(
    MatFormFieldHarness.with({ floatingLabelText: 'Nazwa kategorii' }),
  );
  const input = await field.getControl(MatInputHarness);
  if (input === null) {
    throw new Error('No input in the field "Nazwa kategorii"');
  }
  const saveButton = () => loader.getHarness(MatButtonHarness.with({ text: 'Zapisz' }));
  return { httpTesting, fixture, loader, results, field, input, saveButton };
}

type Opened = Awaited<ReturnType<typeof openDialog>>;

// Types the name, presses "Zapisz" and answers the PATCH.
async function saveAndAnswer(
  opened: Opened,
  name: string,
  answer: { body: Category | null; status: number; statusText: string },
) {
  await opened.input.setValue(name);
  await (await opened.saveButton()).click();
  const request = opened.httpTesting.expectOne({ method: 'PATCH', url: CATEGORY_URL });
  request.flush(answer.body, { status: answer.status, statusText: answer.statusText });
  await opened.fixture.whenStable();
  return request;
}

describe('RenameCategoryDialog', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('opens with the current name in the field', async () => {
    const { loader, input } = await openDialog();

    const dialog = await loader.getHarness(MatDialogHarness);
    expect(await dialog.getTitleText()).toBe('Zmień nazwę kategorii');
    expect(await dialog.getRole()).toBe('dialog');
    expect(await input.getValue()).toBe('Siłownia');
  });

  // The oracle is the plan: off for an empty name and for the current one; a change of the
  // letter case alone is a new name (the API allows it).
  it('keeps "Zapisz" off while the name is unchanged or empty', async () => {
    const { input, saveButton } = await openDialog();

    expect(await (await saveButton()).isDisabled()).toBe(true);

    await input.setValue('   ');
    expect(await (await saveButton()).isDisabled()).toBe(true);

    await input.setValue(' Siłownia ');
    expect(await (await saveButton()).isDisabled()).toBe(true);

    await input.setValue('siłownia');
    expect(await (await saveButton()).isDisabled()).toBe(false);
  });

  it('takes at most 50 characters', async () => {
    const { input } = await openDialog();

    expect(await (await input.host()).getAttribute('maxlength')).toBe('50');
  });

  // The oracle is the API contract: PATCH /categories/:id { name }, 200 with the category.
  it('sends the trimmed name and closes with "renamed"', async () => {
    const opened = await openDialog();

    const request = await saveAndAnswer(opened, '  Joga  ', {
      body: { ...GYM, name: 'Joga' },
      status: 200,
      statusText: 'OK',
    });

    expect(request.request.body).toStrictEqual({ name: 'Joga' });
    expect(opened.results).toEqual(['renamed']);
    expect(await opened.loader.getAllHarnesses(MatDialogHarness)).toHaveLength(0);
  });

  it('shows "Taka kategoria już istnieje." at the field on 409 and stays open', async () => {
    const opened = await openDialog();

    await saveAndAnswer(opened, 'Muzyka', { body: null, status: 409, statusText: 'Conflict' });

    expect(opened.results).toEqual([]);
    expect(await opened.field.getTextErrors()).toEqual(['Taka kategoria już istnieje.']);
    // A new name clears the error and can be saved.
    await opened.input.setValue('Joga');
    expect(await opened.field.hasErrors()).toBe(false);
    expect(await (await opened.saveButton()).isDisabled()).toBe(false);
  });

  it('closes with "missing" when the category is already gone (404)', async () => {
    const opened = await openDialog();

    await saveAndAnswer(opened, 'Joga', { body: null, status: 404, statusText: 'Not Found' });

    expect(opened.results).toEqual(['missing']);
  });

  it('stays open with one alert when the save fails', async () => {
    const opened = await openDialog();

    await saveAndAnswer(opened, 'Joga', {
      body: null,
      status: 500,
      statusText: 'Internal Server Error',
    });

    expect(opened.results).toEqual([]);
    expect(await opened.loader.getAllHarnesses(MatDialogHarness)).toHaveLength(1);
    expect(document.querySelectorAll('mat-dialog-container [role="alert"]')).toHaveLength(1);
    expect(await (await opened.saveButton()).isDisabled()).toBe(false);
  });

  // disableClose while the PATCH runs: Escape (and the backdrop) must not drop an answer.
  it('ignores Escape while the save runs and takes it again after a failure', async () => {
    const opened = await openDialog();
    const dialog = await opened.loader.getHarness(MatDialogHarness);

    await opened.input.setValue('Joga');
    await (await opened.saveButton()).click();
    const request = opened.httpTesting.expectOne({ method: 'PATCH', url: CATEGORY_URL });
    await dialog.close();
    await opened.fixture.whenStable();
    expect(await opened.loader.getAllHarnesses(MatDialogHarness)).toHaveLength(1);

    request.flush(null, { status: 500, statusText: 'Internal Server Error' });
    await opened.fixture.whenStable();
    await dialog.close();
    await opened.fixture.whenStable();
    expect(await opened.loader.getAllHarnesses(MatDialogHarness)).toHaveLength(0);
    expect(opened.results).toEqual([undefined]);
  });

  it('closes on "Anuluj" without a result and without a request', async () => {
    const { httpTesting, fixture, loader, results, input } = await openDialog();

    await input.setValue('Joga');
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Anuluj' }))).click();
    await fixture.whenStable();

    httpTesting.expectNone({ method: 'PATCH', url: CATEGORY_URL });
    expect(results).toEqual([undefined]);
  });
});
