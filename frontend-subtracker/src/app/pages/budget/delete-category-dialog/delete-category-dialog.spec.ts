import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import type { MockInstance } from 'vitest';
import { environment } from '../../../../environments/environment';
import { ErrorReporter } from '../../../shared/error-reporter';
import type { Category } from '../../../subscriptions/subscription.types';
import { DeleteCategoryResult, openDeleteCategoryDialog } from './delete-category-dialog';

const GYM: Category = { id: 'category-1', name: 'Siłownia', isDefault: false };

const CATEGORY_URL = `${environment.apiUrl}/categories/${GYM.id}`;

// An empty host: the harness loader needs a fixture, the dialog itself opens in the overlay.
@Component({ template: '' })
class Host {}

// The dialog is opened the way the page opens it, through the real MatDialog; only the HTTP
// boundary is replaced. `results` records what afterClosed() emitted.
// ErrorReporter.report: only an unknown error is reported, under 'DeleteCategoryDialog'.
let report: MockInstance<ErrorReporter['report']>;

async function openDialog() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  report = vi.spyOn(TestBed.inject(ErrorReporter), 'report').mockImplementation(() => {});
  const httpTesting = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(Host);
  const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
  const results: (DeleteCategoryResult | undefined)[] = [];
  openDeleteCategoryDialog(TestBed.inject(MatDialog), GYM)
    .afterClosed()
    .subscribe((result) => results.push(result));
  await fixture.whenStable();
  const deleteButton = () => loader.getHarness(MatButtonHarness.with({ text: 'Usuń' }));
  return { httpTesting, fixture, loader, results, deleteButton };
}

type Opened = Awaited<ReturnType<typeof openDialog>>;

// Presses "Usuń" and answers the DELETE.
async function deleteAndAnswer(opened: Opened, status: number, statusText: string) {
  await (await opened.deleteButton()).click();
  opened.httpTesting
    .expectOne({ method: 'DELETE', url: CATEGORY_URL })
    .flush(null, { status, statusText });
  await opened.fixture.whenStable();
}

describe('DeleteCategoryDialog', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('names the category and says that its threshold and limit go too', async () => {
    const { loader } = await openDialog();

    const dialog = await loader.getHarness(MatDialogHarness);
    expect(await dialog.getTitleText()).toBe('Usunąć kategorię Siłownia?');
    // An alert dialog, described by the sentence on what goes with the category.
    expect(await dialog.getRole()).toBe('alertdialog');
    const describedBy = await dialog.getAriaDescribedby();
    expect(document.getElementById(describedBy ?? '')?.textContent).toContain(
      'próg i limit miesięczny',
    );
  });

  // The oracle is the API contract: DELETE /categories/:id, 204 when deleted.
  it('sends the DELETE on "Usuń" and closes with "deleted"', async () => {
    const opened = await openDialog();

    await deleteAndAnswer(opened, 204, 'No Content');

    expect(opened.results).toEqual(['deleted']);
    expect(await opened.loader.getAllHarnesses(MatDialogHarness)).toHaveLength(0);
  });

  // 409: the category has subscriptions; the dialog says what to do first and "Usuń" stays off.
  it('explains a category with subscriptions (409) and keeps "Usuń" off', async () => {
    const opened = await openDialog();

    await deleteAndAnswer(opened, 409, 'Conflict');

    expect(opened.results).toEqual([]);
    const alerts = document.querySelectorAll('mat-dialog-container [role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Ta kategoria ma subskrypcje. Przenieś je do innej kategorii albo usuń, a potem usuń kategorię.',
    );
    expect(await (await opened.deleteButton()).isDisabled()).toBe(true);
    await (await opened.deleteButton()).click();
    opened.httpTesting.expectNone({ method: 'DELETE', url: CATEGORY_URL });
    expect(report).not.toHaveBeenCalled();
  });

  it('closes with "missing" when the category is already gone (404)', async () => {
    const opened = await openDialog();

    await deleteAndAnswer(opened, 404, 'Not Found');

    expect(opened.results).toEqual(['missing']);
    expect(report).not.toHaveBeenCalled();
  });

  it('stays open with one alert when the delete fails', async () => {
    const opened = await openDialog();

    await deleteAndAnswer(opened, 500, 'Internal Server Error');

    expect(opened.results).toEqual([]);
    expect(await opened.loader.getAllHarnesses(MatDialogHarness)).toHaveLength(1);
    expect(document.querySelectorAll('mat-dialog-container [role="alert"]')).toHaveLength(1);
    expect(await (await opened.deleteButton()).isDisabled()).toBe(false);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('DeleteCategoryDialog', expect.anything());
  });

  // disableClose while the DELETE runs: Escape (and the backdrop) must not drop an answer.
  it('ignores Escape while the delete runs and takes it again after a failure', async () => {
    const opened = await openDialog();
    const dialog = await opened.loader.getHarness(MatDialogHarness);

    await (await opened.deleteButton()).click();
    const request = opened.httpTesting.expectOne({ method: 'DELETE', url: CATEGORY_URL });
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
    const { httpTesting, fixture, loader, results } = await openDialog();

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Anuluj' }))).click();
    await fixture.whenStable();

    httpTesting.expectNone({ method: 'DELETE', url: CATEGORY_URL });
    expect(results).toEqual([undefined]);
  });
});
