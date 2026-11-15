import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import type {
  CostTotals,
  CreateSubscriptionRequest,
  Subscription,
} from '../../subscriptions/subscription.types';
import { Subscriptions } from './subscriptions';

const SUBSCRIPTIONS_URL = `${environment.apiUrl}/subscriptions`;
const CATEGORIES_URL = `${environment.apiUrl}/categories`;
const TOTALS_URL = `${environment.apiUrl}/subscriptions/totals`;

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

// GET /subscriptions/totals for an account with only NETFLIX, and for an empty one.
const NETFLIX_TOTALS: CostTotals = {
  monthly: '43.00',
  yearly: '516.00',
  categories: [
    { category: NETFLIX.category, monthly: '43.00', yearly: '516.00', subscriptionCount: 1 },
  ],
};
const NO_TOTALS: CostTotals = { monthly: '0.00', yearly: '0.00', categories: [] };

function createPage() {
  TestBed.configureTestingModule({
    imports: [Subscriptions],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  const httpTesting = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(Subscriptions);
  return { httpTesting, fixture, loader: TestbedHarnessEnvironment.loader(fixture) };
}

// The shell reads the cost totals once on start, beside the page's list; the page reads them again
// after every change.
function flushTotals(httpTesting: HttpTestingController, totals: CostTotals): void {
  httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(totals);
}

// The monthly sum in the desktop column, with its spaces made plain ("43,00 zł").
function columnMonthly(host: HTMLElement): string | undefined {
  return host
    .querySelector('app-cost-totals:not(.totals--bar) .totals__amount')
    ?.textContent?.replace(/\s+/g, ' ')
    .trim();
}

describe('Subscriptions', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  // Only proves the page is created and its template rendered with the providers it has in the
  // app (a lost import or provider fails here). The page reads the list on start (its shell the
  // cost totals), and an empty list mounts the subscription form, which reads the categories.
  it('should create', async () => {
    const { httpTesting, fixture } = createPage();
    await fixture.whenStable();

    flushTotals(httpTesting, NO_TOTALS);
    httpTesting.expectOne({ method: 'GET', url: SUBSCRIPTIONS_URL }).flush([]);
    await fixture.whenStable();
    httpTesting.expectOne({ method: 'GET', url: CATEGORIES_URL }).flush([]);
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
  });

  // The oracle is the API contract (PUT /subscriptions/:id takes the create body) and the plan's
  // flow: "Edytuj" opens the panel with the row's data, a save shows the status message and reads
  // the list and the cost totals again. Only the HTTP boundary is replaced.
  it('edits a subscription from its row and reads the list and totals again after the save', async () => {
    const { httpTesting, fixture, loader } = createPage();
    await fixture.whenStable();
    flushTotals(httpTesting, NETFLIX_TOTALS);
    httpTesting.expectOne({ method: 'GET', url: SUBSCRIPTIONS_URL }).flush([NETFLIX]);
    await fixture.whenStable();

    await (
      await loader.getHarness(MatButtonHarness.with({ selector: '[aria-label="Edytuj Netflix"]' }))
    ).click();
    httpTesting.expectOne({ method: 'GET', url: CATEGORIES_URL }).flush([NETFLIX.category]);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('#subscription-panel h2')?.textContent?.trim()).toBe(
      'Edycja subskrypcji',
    );
    const name = await (
      await loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: 'Nazwa' }))
    ).getControl(MatInputHarness);
    expect(await name?.getValue()).toBe('Netflix');

    await name?.setValue('Netflix Premium');
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Zapisz zmiany' }))).click();

    const update = httpTesting.expectOne({
      method: 'PUT',
      url: `${SUBSCRIPTIONS_URL}/${NETFLIX.id}`,
    });
    expect(update.request.body).toEqual<CreateSubscriptionRequest>({
      name: 'Netflix Premium',
      categoryId: 'category-1',
      amount: 43,
      billingCycle: 'monthly',
      paymentMethod: 'blik',
      status: 'active',
      nextBillingDate: '2027-01-05',
    });
    const updated: Subscription = { ...NETFLIX, name: 'Netflix Premium' };
    update.flush(updated);
    await fixture.whenStable();

    httpTesting.expectOne({ method: 'GET', url: SUBSCRIPTIONS_URL }).flush([updated]);
    flushTotals(httpTesting, NETFLIX_TOTALS);
    await fixture.whenStable();

    expect(host.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'Zapisano zmiany w subskrypcji „Netflix Premium”.',
    );
    expect(host.querySelector('#subscription-panel')).toBeNull();
  });

  // Closing the panel would destroy the form and drop the PUT's answer, so while it is in flight
  // Escape and the X leave the panel open; the answer then closes it with the message.
  it('keeps the edit panel open while the save is in flight', async () => {
    const { httpTesting, fixture, loader } = createPage();
    await fixture.whenStable();
    flushTotals(httpTesting, NETFLIX_TOTALS);
    httpTesting.expectOne({ method: 'GET', url: SUBSCRIPTIONS_URL }).flush([NETFLIX]);
    await fixture.whenStable();

    await (
      await loader.getHarness(MatButtonHarness.with({ selector: '[aria-label="Edytuj Netflix"]' }))
    ).click();
    httpTesting.expectOne({ method: 'GET', url: CATEGORIES_URL }).flush([NETFLIX.category]);
    await fixture.whenStable();
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Zapisz zmiany' }))).click();
    const update = httpTesting.expectOne({
      method: 'PUT',
      url: `${SUBSCRIPTIONS_URL}/${NETFLIX.id}`,
    });

    const host = fixture.nativeElement as HTMLElement;
    const panel = host.querySelector<HTMLElement>('#subscription-panel');
    panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    host.querySelector<HTMLElement>('[aria-label="Zamknij panel"]')?.click();
    await fixture.whenStable();
    expect(host.querySelector('#subscription-panel')).not.toBeNull();

    update.flush(NETFLIX);
    await fixture.whenStable();
    httpTesting.expectOne({ method: 'GET', url: SUBSCRIPTIONS_URL }).flush([NETFLIX]);
    flushTotals(httpTesting, NETFLIX_TOTALS);
    await fixture.whenStable();

    expect(host.querySelector('#subscription-panel')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'Zapisano zmiany w subskrypcji „Netflix”.',
    );
  });

  it('closes the edit panel on "Anuluj" without saving or reading the list again', async () => {
    const { httpTesting, fixture, loader } = createPage();
    await fixture.whenStable();
    flushTotals(httpTesting, NETFLIX_TOTALS);
    httpTesting.expectOne({ method: 'GET', url: SUBSCRIPTIONS_URL }).flush([NETFLIX]);
    await fixture.whenStable();

    await (
      await loader.getHarness(MatButtonHarness.with({ selector: '[aria-label="Edytuj Netflix"]' }))
    ).click();
    httpTesting.expectOne({ method: 'GET', url: CATEGORIES_URL }).flush([NETFLIX.category]);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('#subscription-panel')).not.toBeNull();

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Anuluj' }))).click();
    await fixture.whenStable();

    expect(host.querySelector('#subscription-panel')).toBeNull();
    httpTesting.expectNone({ method: 'PUT', url: `${SUBSCRIPTIONS_URL}/${NETFLIX.id}` });
    httpTesting.expectNone({ method: 'GET', url: SUBSCRIPTIONS_URL });
    httpTesting.expectNone({ method: 'GET', url: TOTALS_URL });
  });

  // The oracle is the API contract (DELETE /subscriptions/:id answers 204) and the plan's flow:
  // "Usuń" asks in a dialog, the confirmed delete shows the status message and reads the list and
  // the cost totals again; the new totals reach the shell.
  it('deletes a subscription after the confirmation and reads the list and totals again', async () => {
    const { httpTesting, fixture, loader } = createPage();
    await fixture.whenStable();
    flushTotals(httpTesting, NETFLIX_TOTALS);
    httpTesting.expectOne({ method: 'GET', url: SUBSCRIPTIONS_URL }).flush([NETFLIX]);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(columnMonthly(host)).toBe('43,00 zł');

    await (
      await loader.getHarness(MatButtonHarness.with({ selector: '[aria-label="Usuń Netflix"]' }))
    ).click();
    await fixture.whenStable();

    const dialog =
      await TestbedHarnessEnvironment.documentRootLoader(fixture).getHarness(MatDialogHarness);
    httpTesting.expectNone({ method: 'DELETE', url: `${SUBSCRIPTIONS_URL}/${NETFLIX.id}` });
    await (await dialog.getHarness(MatButtonHarness.with({ text: 'Usuń' }))).click();

    httpTesting
      .expectOne({ method: 'DELETE', url: `${SUBSCRIPTIONS_URL}/${NETFLIX.id}` })
      .flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();

    httpTesting.expectOne({ method: 'GET', url: SUBSCRIPTIONS_URL }).flush([]);
    flushTotals(httpTesting, NO_TOTALS);
    await fixture.whenStable();
    // The empty list does not open the add panel by itself after the first answer.
    httpTesting.expectNone({ method: 'GET', url: CATEGORIES_URL });

    expect(columnMonthly(host)).toBe('0,00 zł');
    expect(host.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'Usunięto subskrypcję „Netflix”.',
    );
    expect(host.textContent).toContain('Nie masz jeszcze żadnych subskrypcji.');
  });
});
