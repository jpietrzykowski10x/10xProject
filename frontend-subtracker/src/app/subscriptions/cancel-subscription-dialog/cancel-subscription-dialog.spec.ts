import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { InteractivityChecker } from '@angular/cdk/a11y';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, Injectable, type Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { environment } from '../../../environments/environment';
import type { Subscription } from '../subscription.types';
import {
  CancelSubscriptionResult,
  openCancelSubscriptionDialog,
} from './cancel-subscription-dialog';

const NETFLIX: Subscription = {
  id: 'subscription-1',
  name: 'Netflix',
  category: { id: 'category-1', name: 'Rozrywka', isDefault: true },
  amount: '43.00',
  billingCycle: 'monthly',
  paymentMethod: 'blik',
  status: 'active',
  trialEndDate: null,
  nextBillingDate: '2027-01-05',
  createdAt: '2026-11-13T12:00:00.000Z',
};

// A trial ends before its first billing date; the dialog names the end of the trial.
const TRIAL: Subscription = {
  ...NETFLIX,
  id: 'subscription-2',
  name: 'Max',
  status: 'trial',
  trialEndDate: '2026-12-01',
  nextBillingDate: '2026-12-02',
};

const CANCEL_URL = `${environment.apiUrl}/subscriptions/${NETFLIX.id}/cancel`;

// An empty host: the harness loader needs a fixture, the dialog itself opens in the overlay.
@Component({ template: '' })
class Host {}

// jsdom lays nothing out, so to the CDK every element has no size and is not visible, and the
// dialog's "first-tabbable" focus falls back to its container. Only that layout check is replaced;
// which element is tabbable and where the focus goes is still decided by the real dialog.
@Injectable()
class LaidOutInteractivityChecker extends InteractivityChecker {
  override isVisible(): boolean {
    return true;
  }
}

// The dialog is opened the way the page opens it, through the real MatDialog; only the HTTP
// boundary is replaced. `results` records what afterClosed() emitted, `results.length` whether it did.
async function openDialog(subscription: Subscription = NETFLIX, providers: Provider[] = []) {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), ...providers],
  });
  const httpTesting = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(Host);
  const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
  const results: (CancelSubscriptionResult | undefined)[] = [];
  openCancelSubscriptionDialog(TestBed.inject(MatDialog), subscription)
    .afterClosed()
    .subscribe((result) => results.push(result));
  await fixture.whenStable();
  return { httpTesting, fixture, loader, results };
}

// The dialog's description, the sentence ariaDescribedBy points at, with its spaces made plain.
async function description(
  loader: ReturnType<typeof TestbedHarnessEnvironment.documentRootLoader>,
) {
  const dialog = await loader.getHarness(MatDialogHarness);
  const describedBy = await dialog.getAriaDescribedby();
  return document
    .getElementById(describedBy ?? '')
    ?.textContent?.replace(/\s+/g, ' ')
    .trim();
}

// "Anuluj subskrypcję" sends the POST; the API answers with the given status.
async function confirmAndAnswer(
  opened: Awaited<ReturnType<typeof openDialog>>,
  answer: { body: Subscription | null; status: number; statusText: string },
): Promise<void> {
  const { httpTesting, fixture, loader } = opened;
  await (await loader.getHarness(MatButtonHarness.with({ text: 'Anuluj subskrypcję' }))).click();
  const request = httpTesting.expectOne({ method: 'POST', url: CANCEL_URL });
  // The contract: POST /subscriptions/:id/cancel without a body.
  expect(request.request.body).toBeNull();
  request.flush(answer.body, { status: answer.status, statusText: answer.statusText });
  await fixture.whenStable();
}

describe('CancelSubscriptionDialog', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  // The oracle is the plan's text: an active subscription runs to its billing date
  // (2027-01-05 shown as the list shows dates, 05.01.2027) and then leaves the totals.
  it('tells an active subscription runs to its billing date', async () => {
    const { loader } = await openDialog();

    const dialog = await loader.getHarness(MatDialogHarness);
    expect(await dialog.getTitleText()).toBe('Anulować subskrypcję?');
    expect(await dialog.getRole()).toBe('alertdialog');
    expect(await description(loader)).toBe(
      'Subskrypcja „Netflix” będzie oznaczona jako W trakcie anulowania i zniknie z sum po 05.01.2027.',
    );
  });

  // A cancelled trial ends with the trial (2026-12-01), without a payment.
  it('tells a trial ends with the trial, without a payment', async () => {
    const { loader } = await openDialog(TRIAL);

    expect(await description(loader)).toBe(
      'Okres próbny „Max” kończy się 01.12.2026. Po tym dniu subskrypcja zostanie anulowana bez płatności.',
    );
  });

  it('opens with the focus on "Wróć"', async () => {
    const { loader } = await openDialog(NETFLIX, [
      { provide: InteractivityChecker, useClass: LaidOutInteractivityChecker },
    ]);

    const back = await loader.getHarness(MatButtonHarness.with({ text: 'Wróć' }));
    expect(await back.isFocused()).toBe(true);
  });

  it('sends the POST on "Anuluj subskrypcję" and closes with "cancelled"', async () => {
    const opened = await openDialog();

    await confirmAndAnswer(opened, {
      body: { ...NETFLIX, status: 'cancelled_pending' },
      status: 200,
      statusText: 'OK',
    });

    expect(opened.results).toEqual(['cancelled']);
    expect(await opened.loader.getAllHarnesses(MatDialogHarness)).toHaveLength(0);
  });

  it('closes with "missing" when the subscription is gone (404)', async () => {
    const opened = await openDialog();

    await confirmAndAnswer(opened, { body: null, status: 404, statusText: 'Not Found' });

    expect(opened.results).toEqual(['missing']);
  });

  it('closes with "conflict" when the status changed in the meantime (409)', async () => {
    const opened = await openDialog();

    await confirmAndAnswer(opened, { body: null, status: 409, statusText: 'Conflict' });

    expect(opened.results).toEqual(['conflict']);
  });

  it('stays open with one alert when the cancel fails', async () => {
    const opened = await openDialog();

    await confirmAndAnswer(opened, {
      body: null,
      status: 500,
      statusText: 'Internal Server Error',
    });

    expect(opened.results).toEqual([]);
    expect(await opened.loader.getAllHarnesses(MatDialogHarness)).toHaveLength(1);
    expect(document.querySelectorAll('mat-dialog-container [role="alert"]')).toHaveLength(1);
  });

  it('disables both buttons while the POST is in flight', async () => {
    const { httpTesting, fixture, loader } = await openDialog();

    const confirm = await loader.getHarness(MatButtonHarness.with({ text: 'Anuluj subskrypcję' }));
    await confirm.click();
    const request = httpTesting.expectOne({ method: 'POST', url: CANCEL_URL });

    expect(await confirm.isDisabled()).toBe(true);
    expect(
      await (await loader.getHarness(MatButtonHarness.with({ text: 'Wróć' }))).isDisabled(),
    ).toBe(true);

    request.flush({ ...NETFLIX, status: 'cancelled_pending' });
    await fixture.whenStable();
  });

  it('closes on "Wróć" without a result and without a request', async () => {
    const { httpTesting, fixture, loader, results } = await openDialog();

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Wróć' }))).click();
    await fixture.whenStable();

    httpTesting.expectNone({ method: 'POST', url: CANCEL_URL });
    expect(results).toEqual([undefined]);
    expect(await loader.getAllHarnesses(MatDialogHarness)).toHaveLength(0);
  });
});
