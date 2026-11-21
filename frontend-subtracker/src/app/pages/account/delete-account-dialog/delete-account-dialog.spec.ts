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
import { provideRouter, Router } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { CostTotalsStore } from '../../../subscriptions/cost-totals.store';
import { DeleteAccountResult, openDeleteAccountDialog } from './delete-account-dialog';

const ACCOUNT_EMAIL = 'jan.kowalski@example.com';
const DELETE_URL = `${environment.apiUrl}/auth/delete-account`;
const CONFIRM_LABEL = 'Wpisz swój adres e-mail, aby potwierdzić';

// An empty host: the harness loader needs a fixture, the dialog itself opens in the overlay.
@Component({ template: '' })
class Host {}

type Loader = ReturnType<typeof TestbedHarnessEnvironment.documentRootLoader>;

// The dialog is opened the way the page opens it, through the real MatDialog; only the HTTP
// boundary is replaced. `results` records what afterClosed() emitted.
async function openDialog() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  const httpTesting = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(Host);
  const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
  const results: (DeleteAccountResult | undefined)[] = [];
  openDeleteAccountDialog(TestBed.inject(MatDialog), ACCOUNT_EMAIL)
    .afterClosed()
    .subscribe((result) => results.push(result));
  await fixture.whenStable();
  return { httpTesting, fixture, loader, results };
}

async function typeConfirmation(loader: Loader, value: string): Promise<void> {
  const field = await loader.getHarness(
    MatFormFieldHarness.with({ floatingLabelText: CONFIRM_LABEL }),
  );
  const input = await field.getControl(MatInputHarness);
  if (input === null) {
    throw new Error(`No input in the field "${CONFIRM_LABEL}"`);
  }
  await input.setValue(value);
}

const deleteButton = (loader: Loader) =>
  loader.getHarness(MatButtonHarness.with({ text: 'Usuń konto' }));

const alerts = () => document.querySelectorAll('mat-dialog-container [role="alert"]');

describe('DeleteAccountDialog', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('warns that the deletion cannot be undone and starts on "Anuluj"', async () => {
    const { loader } = await openDialog();

    const dialog = await loader.getHarness(MatDialogHarness);
    expect(await dialog.getTitleText()).toBe('Usunąć konto?');
    expect(await dialog.getRole()).toBe('alertdialog');
    const describedBy = await dialog.getAriaDescribedby();
    expect(document.getElementById(describedBy ?? '')?.textContent).toContain(
      'usunięcia nie da się cofnąć',
    );
    expect(document.activeElement?.textContent?.trim()).toBe('Anuluj');
  });

  // The oracle is the API contract: the address is compared after trim() and lower-casing
  // (backend normalizeEmail), so the button follows the same rule.
  it.each([
    ['', false],
    ['inny@example.com', false],
    ['jan.kowalski@example.co', false],
    [ACCOUNT_EMAIL, true],
    ['  Jan.Kowalski@EXAMPLE.com  ', true],
  ])('with %j typed, "Usuń konto" is enabled: %j', async (typed, enabled) => {
    const { loader } = await openDialog();

    await typeConfirmation(loader, typed);

    expect(await (await deleteButton(loader)).isDisabled()).toBe(!enabled);
  });

  it('sends nothing for a wrong address, also on Enter', async () => {
    const { httpTesting, fixture, loader } = await openDialog();

    await typeConfirmation(loader, 'inny@example.com');
    await (await deleteButton(loader)).click();
    document.querySelector('mat-dialog-container form')?.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    httpTesting.expectNone({ method: 'POST', url: DELETE_URL });
  });

  // The body is what was typed; the API normalizes it (DeleteAccountDto). An email input trims
  // the spaces itself, so only the letter case shows that nothing is normalized here.
  it('posts the typed address, locks while sending and closes with true on 204', async () => {
    const { httpTesting, fixture, loader, results } = await openDialog();

    await typeConfirmation(loader, 'Jan.Kowalski@EXAMPLE.com');
    await (await deleteButton(loader)).click();
    const request = httpTesting.expectOne({ method: 'POST', url: DELETE_URL });
    expect(request.request.body).toEqual({ email: 'Jan.Kowalski@EXAMPLE.com' });

    await fixture.whenStable();
    expect(await (await deleteButton(loader)).isDisabled()).toBe(true);
    expect(
      await (await loader.getHarness(MatButtonHarness.with({ text: 'Anuluj' }))).isDisabled(),
    ).toBe(true);
    // A second click during the request sends nothing more (verify() in afterEach).
    await (await deleteButton(loader)).click();

    request.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();

    expect(results).toEqual([true]);
    expect(await loader.getAllHarnesses(MatDialogHarness)).toHaveLength(0);
  });

  it.each([
    [400, 'Adres nie zgadza się z adresem konta.'],
    [500, 'Serwis jest chwilowo niedostępny. Konto nie zostało usunięte'],
    [0, 'Serwis jest chwilowo niedostępny. Konto nie zostało usunięte'],
  ])('stays open with one alert after a %j', async (status, message) => {
    const { httpTesting, fixture, loader, results } = await openDialog();

    await typeConfirmation(loader, ACCOUNT_EMAIL);
    await (await deleteButton(loader)).click();
    httpTesting
      .expectOne({ method: 'POST', url: DELETE_URL })
      .flush(null, { status, statusText: 'Error' });
    await fixture.whenStable();

    expect(results).toEqual([]);
    expect(await loader.getAllHarnesses(MatDialogHarness)).toHaveLength(1);
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0].textContent).toContain(message);
    // The dialog is usable again: another try is possible.
    expect(await (await deleteButton(loader)).isDisabled()).toBe(false);
  });

  // The 401 interceptor skips /auth/, so the dialog itself ends the gone session's state.
  it('closes, drops the cost totals and goes to /sign-in on a 401', async () => {
    const { httpTesting, fixture, loader, results } = await openDialog();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const clear = vi.spyOn(TestBed.inject(CostTotalsStore), 'clear');

    await typeConfirmation(loader, ACCOUNT_EMAIL);
    await (await deleteButton(loader)).click();
    httpTesting
      .expectOne({ method: 'POST', url: DELETE_URL })
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();

    expect(results).toEqual([false]);
    expect(clear).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/sign-in');
  });

  it('closes on "Anuluj" without a result and without a request', async () => {
    const { httpTesting, fixture, loader, results } = await openDialog();

    await typeConfirmation(loader, ACCOUNT_EMAIL);
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Anuluj' }))).click();
    await fixture.whenStable();

    httpTesting.expectNone({ method: 'POST', url: DELETE_URL });
    expect(results).toEqual([undefined]);
    expect(await loader.getAllHarnesses(MatDialogHarness)).toHaveLength(0);
  });
});
