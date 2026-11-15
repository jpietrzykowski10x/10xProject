import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { environment } from '../../../environments/environment';
import type { Subscription } from '../subscription.types';
import {
  DeleteSubscriptionResult,
  openDeleteSubscriptionDialog,
} from './delete-subscription-dialog';

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

const DELETE_URL = `${environment.apiUrl}/subscriptions/${NETFLIX.id}`;

// An empty host: the harness loader needs a fixture, the dialog itself opens in the overlay.
@Component({ template: '' })
class Host {}

// The dialog is opened the way the page opens it, through the real MatDialog; only the HTTP
// boundary is replaced. `closed` records what afterClosed() emitted, `results.length` whether it did.
async function openDialog() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const httpTesting = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(Host);
  const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
  const results: (DeleteSubscriptionResult | undefined)[] = [];
  openDeleteSubscriptionDialog(TestBed.inject(MatDialog), NETFLIX)
    .afterClosed()
    .subscribe((result) => results.push(result));
  await fixture.whenStable();
  return { httpTesting, fixture, loader, results };
}

describe('DeleteSubscriptionDialog', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('names the subscription it is about to delete', async () => {
    const { loader } = await openDialog();

    const dialog = await loader.getHarness(MatDialogHarness);
    expect(await dialog.getTitleText()).toBe('Usunąć subskrypcję?');
    expect(await dialog.getContentText()).toContain('„Netflix”');
    // An alert dialog, described by the sentence that names the subscription.
    expect(await dialog.getRole()).toBe('alertdialog');
    const describedBy = await dialog.getAriaDescribedby();
    expect(document.getElementById(describedBy ?? '')?.textContent).toContain('„Netflix”');
  });

  // The oracle is the API contract: DELETE /subscriptions/:id, 204 when deleted.
  it('sends the DELETE on "Usuń" and closes with "deleted"', async () => {
    const { httpTesting, fixture, loader, results } = await openDialog();

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Usuń' }))).click();
    httpTesting.expectOne({ method: 'DELETE', url: DELETE_URL }).flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    await fixture.whenStable();

    expect(results).toEqual(['deleted']);
    expect(await loader.getAllHarnesses(MatDialogHarness)).toHaveLength(0);
  });

  it('closes with "missing" when the subscription is already gone (404)', async () => {
    const { httpTesting, fixture, loader, results } = await openDialog();

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Usuń' }))).click();
    httpTesting
      .expectOne({ method: 'DELETE', url: DELETE_URL })
      .flush(null, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();

    expect(results).toEqual(['missing']);
  });

  it('stays open with one alert when the delete fails', async () => {
    const { httpTesting, fixture, loader, results } = await openDialog();

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Usuń' }))).click();
    httpTesting
      .expectOne({ method: 'DELETE', url: DELETE_URL })
      .flush(null, { status: 500, statusText: 'Internal Server Error' });
    await fixture.whenStable();

    expect(results).toEqual([]);
    expect(await loader.getAllHarnesses(MatDialogHarness)).toHaveLength(1);
    expect(document.querySelectorAll('mat-dialog-container [role="alert"]')).toHaveLength(1);
  });

  it('closes on "Anuluj" without a result and without a request', async () => {
    const { httpTesting, fixture, loader, results } = await openDialog();

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Anuluj' }))).click();
    await fixture.whenStable();

    httpTesting.expectNone({ method: 'DELETE', url: DELETE_URL });
    expect(results).toEqual([undefined]);
    expect(await loader.getAllHarnesses(MatDialogHarness)).toHaveLength(0);
  });
});
