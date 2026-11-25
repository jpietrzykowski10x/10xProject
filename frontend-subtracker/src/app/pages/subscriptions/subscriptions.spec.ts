import { type HttpRequest, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatPaginatorHarness } from '@angular/material/paginator/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { provideRouter, Router } from '@angular/router';
import type { MockInstance } from 'vitest';
import { environment } from '../../../environments/environment';
import { ErrorReporter } from '../../shared/error-reporter';
import type {
  Category,
  CostTotals,
  CreateSubscriptionRequest,
  Subscription,
  SubscriptionPage,
} from '../../subscriptions/subscription.types';
import { Subscriptions } from './subscriptions';

const SUBSCRIPTIONS_URL = `${environment.apiUrl}/subscriptions`;
const CATEGORIES_URL = `${environment.apiUrl}/categories`;
const TOTALS_URL = `${environment.apiUrl}/subscriptions/totals`;
// A category id in the address must be a UUID, or the page drops it (the API would answer 400).
const CATEGORY_ID = '3f2b8c1e-9d4a-4f6b-8a2c-1e5d7f9b0c3a';
// An own category of the account with a UUID, as the category filter needs it.
const TOOLS: Category = { id: CATEGORY_ID, name: 'Oprogramowanie i narzędzia', isDefault: false };

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
  monthlyLimit: null,
  budgetAlert: 'none',
  categories: [
    {
      category: NETFLIX.category,
      monthly: '43.00',
      yearly: '516.00',
      subscriptionCount: 1,
      duplicateThreshold: 3,
      duplicateWarning: 'none',
      monthlyLimit: null,
      budgetAlert: 'none',
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

// ErrorReporter.report: an unknown error is reported under the reporting class's name, a
// recognized answer (404, 409) is not.
let report: MockInstance<ErrorReporter['report']>;

// The page opened at `url` (its address is the list's state: ?sort=&category=&status=&page=).
async function createPage(url = '/') {
  TestBed.configureTestingModule({
    imports: [Subscriptions],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  report = vi.spyOn(TestBed.inject(ErrorReporter), 'report').mockImplementation(() => {});
  const httpTesting = TestBed.inject(HttpTestingController);
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  const fixture = TestBed.createComponent(Subscriptions);
  return { httpTesting, fixture, router, loader: TestbedHarnessEnvironment.loader(fixture) };
}

// GET /subscriptions answers with one page of 25 rows (backend SUBSCRIPTION_PAGE_SIZE).
function pageOf(items: Subscription[], total = items.length, page = 1): SubscriptionPage {
  return { items, total, page, pageSize: 25 };
}

// GET /subscriptions with any parameters (an `{ url }` match compares the URL with its parameters).
function isListRequest(request: HttpRequest<unknown>): boolean {
  return request.method === 'GET' && request.url === SUBSCRIPTIONS_URL;
}

function listRequest(httpTesting: HttpTestingController): TestRequest {
  return httpTesting.expectOne(isListRequest, 'GET /subscriptions');
}

// The parameters of a list request, each with all its values.
function paramsOf(request: TestRequest): Record<string, string[]> {
  const params = request.request.params;
  return Object.fromEntries(params.keys().map((key) => [key, params.getAll(key) ?? []]));
}

// The shell reads the cost totals once on start, beside the page's list; the page reads them again
// after every change.
function flushTotals(httpTesting: HttpTestingController, totals: CostTotals): void {
  httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(totals);
}

// On entry the shell reads the totals and the page the categories for its filter, then the list
// of the address's query.
async function start(
  httpTesting: HttpTestingController,
  fixture: ComponentFixture<Subscriptions>,
  page: SubscriptionPage,
  totals: CostTotals,
  categories: Category[] = [NETFLIX.category],
): Promise<void> {
  await fixture.whenStable();
  flushTotals(httpTesting, totals);
  httpTesting.expectOne({ method: 'GET', url: CATEGORIES_URL }).flush(categories);
  listRequest(httpTesting).flush(page);
  await fixture.whenStable();
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
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  // Only proves the page is created and its template rendered with the providers it has in the
  // app (a lost import or provider fails here). The page reads the categories and the list on
  // start (its shell the cost totals), and an empty list mounts the subscription form, which reads
  // the categories too.
  it('should create', async () => {
    const { httpTesting, fixture } = await createPage();
    await start(httpTesting, fixture, pageOf([]), NO_TOTALS);
    httpTesting.expectOne({ method: 'GET', url: CATEGORIES_URL }).flush([]);
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
  });

  // The oracle is the API contract (PUT /subscriptions/:id takes the create body) and the plan's
  // flow: "Edytuj" opens the panel with the row's data, a save shows the status message and reads
  // the list and the cost totals again. Only the HTTP boundary is replaced.
  it('edits a subscription from its row and reads the list and totals again after the save', async () => {
    const { httpTesting, fixture, loader } = await createPage();
    await start(httpTesting, fixture, pageOf([NETFLIX]), NETFLIX_TOTALS);

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

    listRequest(httpTesting).flush(pageOf([updated]));
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
    const { httpTesting, fixture, loader } = await createPage();
    await start(httpTesting, fixture, pageOf([NETFLIX]), NETFLIX_TOTALS);

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
    listRequest(httpTesting).flush(pageOf([NETFLIX]));
    flushTotals(httpTesting, NETFLIX_TOTALS);
    await fixture.whenStable();

    expect(host.querySelector('#subscription-panel')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'Zapisano zmiany w subskrypcji „Netflix”.',
    );
  });

  // From 1200px the row stays clickable beside the panel. While its edit is saving the panel cannot
  // close, so a cancel then would leave a form with the old status whose next save undoes it.
  it('does not cancel a subscription while its edit is being saved', async () => {
    const { httpTesting, fixture, loader } = await createPage();
    await start(httpTesting, fixture, pageOf([NETFLIX]), NETFLIX_TOTALS);

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
    await fixture.whenStable();

    const cancel = await loader.getHarness(
      MatButtonHarness.with({ selector: '[aria-label="Anuluj subskrypcję Netflix"]' }),
    );
    expect(await cancel.isDisabled()).toBe(true);
    await cancel.click();
    await fixture.whenStable();
    expect(
      await TestbedHarnessEnvironment.documentRootLoader(fixture).getAllHarnesses(MatDialogHarness),
    ).toHaveLength(0);

    update.flush(NETFLIX);
    await fixture.whenStable();
    listRequest(httpTesting).flush(pageOf([NETFLIX]));
    flushTotals(httpTesting, NETFLIX_TOTALS);
    await fixture.whenStable();
    httpTesting.expectNone({ method: 'POST', url: `${SUBSCRIPTIONS_URL}/${NETFLIX.id}/cancel` });
  });

  it('closes the edit panel on "Anuluj" without saving or reading the list again', async () => {
    const { httpTesting, fixture, loader } = await createPage();
    await start(httpTesting, fixture, pageOf([NETFLIX]), NETFLIX_TOTALS);

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
    httpTesting.expectNone(isListRequest);
    httpTesting.expectNone({ method: 'GET', url: TOTALS_URL });
  });

  // With the API down on entry both the list and the totals fail; "Spróbuj ponownie" reads both
  // again, so the shell does not keep "Nie udało się wczytać sum." until the next change.
  it('reads the list and the totals again on "Spróbuj ponownie" after a failed start', async () => {
    const { httpTesting, fixture, loader } = await createPage();
    await fixture.whenStable();
    const failure = { status: 500, statusText: 'Server Error' };
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush('error', failure);
    httpTesting.expectOne({ method: 'GET', url: CATEGORIES_URL }).flush([NETFLIX.category]);
    listRequest(httpTesting).flush('error', failure);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Nie udało się wczytać sum.');
    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledWith('Subscriptions', expect.anything());
    expect(report).toHaveBeenCalledWith('CostTotalsStore', expect.anything());

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Spróbuj ponownie' }))).click();

    listRequest(httpTesting).flush(pageOf([NETFLIX]));
    flushTotals(httpTesting, NETFLIX_TOTALS);
    await fixture.whenStable();

    expect(columnMonthly(host)).toBe('43,00 zł');
    expect(host.textContent).not.toContain('Nie udało się wczytać sum.');
  });

  // The oracle is the API contract (DELETE /subscriptions/:id answers 204) and the plan's flow:
  // "Usuń" asks in a dialog, the confirmed delete shows the status message and reads the list and
  // the cost totals again; the new totals reach the shell.
  it('deletes a subscription after the confirmation and reads the list and totals again', async () => {
    const { httpTesting, fixture, loader } = await createPage();
    await start(httpTesting, fixture, pageOf([NETFLIX]), NETFLIX_TOTALS);
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

    listRequest(httpTesting).flush(pageOf([]));
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

  // The oracle is the API contract (POST /subscriptions/:id/cancel answers 200 with the
  // subscription) and the plan's flow: the dialog confirms, the edit panel of that subscription
  // closes (its form holds the old status, a save would undo the cancel), the status message shows
  // and the list and the cost totals are read again.
  it('cancels a subscription open in the edit panel, closes the panel and reads the list and totals again', async () => {
    const { httpTesting, fixture, loader } = await createPage();
    await start(httpTesting, fixture, pageOf([NETFLIX]), NETFLIX_TOTALS);

    await (
      await loader.getHarness(MatButtonHarness.with({ selector: '[aria-label="Edytuj Netflix"]' }))
    ).click();
    httpTesting.expectOne({ method: 'GET', url: CATEGORIES_URL }).flush([NETFLIX.category]);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('#subscription-panel')).not.toBeNull();

    await (
      await loader.getHarness(
        MatButtonHarness.with({ selector: '[aria-label="Anuluj subskrypcję Netflix"]' }),
      )
    ).click();
    await fixture.whenStable();
    const dialog =
      await TestbedHarnessEnvironment.documentRootLoader(fixture).getHarness(MatDialogHarness);
    await (await dialog.getHarness(MatButtonHarness.with({ text: 'Anuluj subskrypcję' }))).click();

    const cancelled: Subscription = { ...NETFLIX, status: 'cancelled_pending' };
    httpTesting
      .expectOne({ method: 'POST', url: `${SUBSCRIPTIONS_URL}/${NETFLIX.id}/cancel` })
      .flush(cancelled);
    await fixture.whenStable();

    listRequest(httpTesting).flush(pageOf([cancelled]));
    // A cancelled_pending subscription still counts until its billing date.
    flushTotals(httpTesting, NETFLIX_TOTALS);
    await fixture.whenStable();

    expect(host.querySelector('#subscription-panel')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'Anulowano subskrypcję „Netflix”.',
    );
    expect(columnMonthly(host)).toBe('43,00 zł');
    // The row now offers "Przywróć" instead.
    expect(
      await loader.getAllHarnesses(
        MatButtonHarness.with({ selector: '[aria-label="Przywróć Netflix"]' }),
      ),
    ).toHaveLength(1);
  });

  // POST /subscriptions/:id/resume answers 200; "Przywróć" has no dialog.
  it('resumes a cancelled_pending subscription and reads the list and totals again', async () => {
    const pending: Subscription = { ...NETFLIX, status: 'cancelled_pending' };
    const { httpTesting, fixture, loader } = await createPage();
    await start(httpTesting, fixture, pageOf([pending]), NETFLIX_TOTALS);

    const resume = await loader.getHarness(
      MatButtonHarness.with({ selector: '[aria-label="Przywróć Netflix"]' }),
    );
    await resume.click();
    const request = httpTesting.expectOne({
      method: 'POST',
      url: `${SUBSCRIPTIONS_URL}/${NETFLIX.id}/resume`,
    });
    // Disabled while in flight; a second click sends nothing.
    expect(await resume.isDisabled()).toBe(true);
    await resume.click();
    httpTesting.expectNone({ method: 'POST', url: `${SUBSCRIPTIONS_URL}/${NETFLIX.id}/resume` });

    request.flush(NETFLIX);
    await fixture.whenStable();
    listRequest(httpTesting).flush(pageOf([NETFLIX]));
    flushTotals(httpTesting, NETFLIX_TOTALS);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'Przywrócono subskrypcję „Netflix”.',
    );
    expect(
      await loader.getAllHarnesses(
        MatButtonHarness.with({ selector: '[aria-label="Anuluj subskrypcję Netflix"]' }),
      ),
    ).toHaveLength(1);
  });

  // The cancel dialog answers 'missing' (404: deleted, e.g. in another tab) or 'conflict' (409:
  // the status changed); the page shows the message and reads the list and the totals again.
  it.each([
    { status: 404, statusText: 'Not Found', message: 'Tej subskrypcji już nie ma na liście.' },
    {
      status: 409,
      statusText: 'Conflict',
      message: 'Stan subskrypcji zmienił się w międzyczasie.',
    },
  ])(
    'reads the list and totals again with a message when the cancel answers $status',
    async ({ status, statusText, message }) => {
      const { httpTesting, fixture, loader } = await createPage();
      await start(httpTesting, fixture, pageOf([NETFLIX]), NETFLIX_TOTALS);

      await (
        await loader.getHarness(
          MatButtonHarness.with({ selector: '[aria-label="Anuluj subskrypcję Netflix"]' }),
        )
      ).click();
      await fixture.whenStable();
      const dialog =
        await TestbedHarnessEnvironment.documentRootLoader(fixture).getHarness(MatDialogHarness);
      await (
        await dialog.getHarness(MatButtonHarness.with({ text: 'Anuluj subskrypcję' }))
      ).click();
      httpTesting
        .expectOne({ method: 'POST', url: `${SUBSCRIPTIONS_URL}/${NETFLIX.id}/cancel` })
        .flush(null, { status, statusText });
      await fixture.whenStable();

      listRequest(httpTesting).flush(pageOf([]));
      flushTotals(httpTesting, NETFLIX_TOTALS);
      await fixture.whenStable();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('[role="status"]')?.textContent?.trim()).toBe(message);
      expect(report).not.toHaveBeenCalled();
    },
  );

  // 409: the status changed in the meantime (e.g. in another tab); the list is read again.
  it('reads the list again with a message when the resume finds another status (409)', async () => {
    const pending: Subscription = { ...NETFLIX, status: 'cancelled_pending' };
    const { httpTesting, fixture, loader } = await createPage();
    await start(httpTesting, fixture, pageOf([pending]), NETFLIX_TOTALS);

    await (
      await loader.getHarness(
        MatButtonHarness.with({ selector: '[aria-label="Przywróć Netflix"]' }),
      )
    ).click();
    httpTesting
      .expectOne({ method: 'POST', url: `${SUBSCRIPTIONS_URL}/${NETFLIX.id}/resume` })
      .flush(null, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    listRequest(httpTesting).flush(pageOf([NETFLIX]));
    flushTotals(httpTesting, NETFLIX_TOTALS);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'Stan subskrypcji zmienił się w międzyczasie.',
    );
    expect(report).not.toHaveBeenCalled();
  });

  it('keeps the list with an alert when the resume fails', async () => {
    const pending: Subscription = { ...NETFLIX, status: 'cancelled_pending' };
    const { httpTesting, fixture, loader } = await createPage();
    await start(httpTesting, fixture, pageOf([pending]), NETFLIX_TOTALS);

    const resume = await loader.getHarness(
      MatButtonHarness.with({ selector: '[aria-label="Przywróć Netflix"]' }),
    );
    await resume.click();
    httpTesting
      .expectOne({ method: 'POST', url: `${SUBSCRIPTIONS_URL}/${NETFLIX.id}/resume` })
      .flush(null, { status: 500, statusText: 'Internal Server Error' });
    await fixture.whenStable();

    httpTesting.expectNone(isListRequest);
    httpTesting.expectNone({ method: 'GET', url: TOTALS_URL });
    const host = fixture.nativeElement as HTMLElement;
    const alerts = host.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent?.trim()).toBe(
      'Nie udało się przywrócić subskrypcji „Netflix”. Spróbuj ponownie.',
    );
    // The button is enabled again for another try.
    expect(await resume.isDisabled()).toBe(false);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('Subscriptions', expect.anything());
  });

  // S-18. The oracle is the API contract (backend dtos/list-subscriptions.dto.ts: sort, category,
  // status and page, each optional with its default) and the plan: the address is the list's
  // state, only values other than the default are written, another order or filter starts from
  // page 1, a page past the end moves to the last one.
  describe('list query in the address', () => {
    it('asks for the default query when the address has no parameters', async () => {
      const { httpTesting, fixture } = await createPage('/');
      await fixture.whenStable();
      flushTotals(httpTesting, NETFLIX_TOTALS);
      httpTesting.expectOne({ method: 'GET', url: CATEGORIES_URL }).flush([NETFLIX.category]);

      const request = listRequest(httpTesting);
      expect(paramsOf(request)).toStrictEqual({});
      request.flush(pageOf([NETFLIX]));
      await fixture.whenStable();
    });

    it('sends the parameters of the address with the list request', async () => {
      const { httpTesting, fixture } = await createPage(
        `/?sort=name_asc&category=${CATEGORY_ID}&status=active&page=2`,
      );
      await fixture.whenStable();
      flushTotals(httpTesting, NETFLIX_TOTALS);
      httpTesting.expectOne({ method: 'GET', url: CATEGORIES_URL }).flush([NETFLIX.category]);

      const request = listRequest(httpTesting);
      expect(paramsOf(request)).toStrictEqual({
        sort: ['name_asc'],
        category: [CATEGORY_ID],
        status: ['active'],
        page: ['2'],
      });
      request.flush(pageOf([NETFLIX], 26, 2));
      await fixture.whenStable();
    });

    it('leaves out the values of the address the API would refuse', async () => {
      const { httpTesting, fixture } = await createPage(
        '/?sort=price&category=rozrywka&status=paused&page=0',
      );
      await fixture.whenStable();
      flushTotals(httpTesting, NETFLIX_TOTALS);
      httpTesting.expectOne({ method: 'GET', url: CATEGORIES_URL }).flush([NETFLIX.category]);

      const request = listRequest(httpTesting);
      expect(paramsOf(request)).toStrictEqual({});
      request.flush(pageOf([NETFLIX]));
      await fixture.whenStable();
    });

    it('starts from page 1 when the order changes and keeps the filter', async () => {
      const { httpTesting, fixture, router } = await createPage('/?status=active&page=3');
      await start(httpTesting, fixture, pageOf([NETFLIX], 60, 3), NETFLIX_TOTALS);

      fixture.componentInstance.setQuery({ sort: 'name_desc' });
      await fixture.whenStable();

      const request = listRequest(httpTesting);
      expect(paramsOf(request)).toStrictEqual({ sort: ['name_desc'], status: ['active'] });
      expect(router.url).toBe('/?sort=name_desc&status=active');
      request.flush(pageOf([NETFLIX], 60, 1));
      await fixture.whenStable();
    });

    it('keeps the order and the filter on another page', async () => {
      const { httpTesting, fixture, router } = await createPage('/?sort=amount_desc&status=trial');
      await start(httpTesting, fixture, pageOf([NETFLIX], 60, 1), NETFLIX_TOTALS);

      fixture.componentInstance.setQuery({ page: 2 });
      await fixture.whenStable();

      const request = listRequest(httpTesting);
      expect(paramsOf(request)).toStrictEqual({
        sort: ['amount_desc'],
        status: ['trial'],
        page: ['2'],
      });
      expect(router.url).toBe('/?sort=amount_desc&status=trial&page=2');
      request.flush(pageOf([NETFLIX], 60, 2));
      await fixture.whenStable();
    });

    // 60 rows are 3 pages of 25 (25 + 25 + 10), so page 4 is past the end and page 3 is the last.
    it('moves to the last page when the page of the address is past the end', async () => {
      const { httpTesting, fixture, router, loader } = await createPage('/?page=4');
      await start(httpTesting, fixture, pageOf([], 60, 4), NETFLIX_TOTALS);
      const host = fixture.nativeElement as HTMLElement;
      expect(host.textContent).not.toContain('Nie masz jeszcze żadnych subskrypcji.');

      const request = listRequest(httpTesting);
      expect(paramsOf(request)).toStrictEqual({ page: ['3'] });
      expect(router.url).toBe('/?page=3');
      request.flush(pageOf([NETFLIX], 60, 3));
      await fixture.whenStable();

      expect(
        await loader.getAllHarnesses(
          MatButtonHarness.with({ selector: '[aria-label="Edytuj Netflix"]' }),
        ),
      ).toHaveLength(1);
      // Not an empty account, so the add panel stays closed.
      expect(host.querySelector('#subscription-panel')).toBeNull();
    });

    it('opens the add panel by itself for an account without subscriptions', async () => {
      const { httpTesting, fixture } = await createPage('/');
      await start(httpTesting, fixture, pageOf([]), NO_TOTALS);
      // The panel's form reads the categories for its own select.
      httpTesting.expectOne({ method: 'GET', url: CATEGORIES_URL }).flush([NETFLIX.category]);
      await fixture.whenStable();

      const panel = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
        '#subscription-panel',
      );
      expect(panel).not.toBeNull();
      expect(panel?.hidden).toBe(false);
    });

    it('does not open the add panel for an empty result of a filter', async () => {
      const { httpTesting, fixture } = await createPage('/?status=trial');
      await start(httpTesting, fixture, pageOf([]), NETFLIX_TOTALS);

      httpTesting.expectNone({ method: 'GET', url: CATEGORIES_URL });
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('#subscription-panel')).toBeNull();
    });

    it('reads the same page of the same query again after a save', async () => {
      const { httpTesting, fixture, loader } = await createPage('/?sort=name_asc&page=2');
      await start(httpTesting, fixture, pageOf([NETFLIX], 26, 2), NETFLIX_TOTALS);

      await (
        await loader.getHarness(
          MatButtonHarness.with({ selector: '[aria-label="Edytuj Netflix"]' }),
        )
      ).click();
      httpTesting.expectOne({ method: 'GET', url: CATEGORIES_URL }).flush([NETFLIX.category]);
      await fixture.whenStable();
      await (await loader.getHarness(MatButtonHarness.with({ text: 'Zapisz zmiany' }))).click();
      httpTesting
        .expectOne({ method: 'PUT', url: `${SUBSCRIPTIONS_URL}/${NETFLIX.id}` })
        .flush(NETFLIX);
      await fixture.whenStable();

      const request = listRequest(httpTesting);
      expect(paramsOf(request)).toStrictEqual({ sort: ['name_asc'], page: ['2'] });
      request.flush(pageOf([NETFLIX], 26, 2));
      flushTotals(httpTesting, NETFLIX_TOTALS);
      await fixture.whenStable();
    });

    // The categories only feed the filter: their failure is reported, the list still shows.
    it('shows the list and reports the error when the categories for the filter fail', async () => {
      const { httpTesting, fixture, loader } = await createPage();
      await fixture.whenStable();
      flushTotals(httpTesting, NETFLIX_TOTALS);
      httpTesting
        .expectOne({ method: 'GET', url: CATEGORIES_URL })
        .flush('error', { status: 500, statusText: 'Server Error' });
      listRequest(httpTesting).flush(pageOf([NETFLIX]));
      await fixture.whenStable();

      expect(
        await loader.getAllHarnesses(
          MatButtonHarness.with({ selector: '[aria-label="Edytuj Netflix"]' }),
        ),
      ).toHaveLength(1);
      expect(report).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledWith('Subscriptions', expect.anything());
    });
  });

  // S-18, phase 3. The oracle is the plan's layout A: three fields above the table whose choice
  // goes into the address (and so into the request), the paginator under the table only when the
  // rows do not fit on one page of 25, and an empty result of a filter told apart from an empty
  // account.
  describe('list controls', () => {
    async function select(
      loader: Awaited<ReturnType<typeof createPage>>['loader'],
      label: string,
    ): Promise<MatSelectHarness> {
      const field = await loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: label }));
      const control = await field.getControl(MatSelectHarness);
      if (control === null) {
        throw new Error(`No select in the field "${label}"`);
      }
      return control;
    }

    async function optionTexts(control: MatSelectHarness): Promise<string[]> {
      await control.open();
      const texts = await Promise.all(
        (await control.getOptions()).map((option) => option.getText()),
      );
      await control.close();
      return texts;
    }

    it('shows the sort, category and status fields with their values and options', async () => {
      const { httpTesting, fixture, loader } = await createPage(
        `/?sort=amount_desc&category=${CATEGORY_ID}`,
      );
      await start(httpTesting, fixture, pageOf([NETFLIX]), NETFLIX_TOTALS, [
        NETFLIX.category,
        TOOLS,
      ]);

      const sort = await select(loader, 'Sortuj');
      const category = await select(loader, 'Kategoria');
      const status = await select(loader, 'Status');
      expect(await sort.getValueText()).toBe('Najdroższe miesięcznie');
      expect(await category.getValueText()).toBe(TOOLS.name);
      expect(await status.getValueText()).toBe('Wszystkie');

      expect(await optionTexts(sort)).toStrictEqual([
        'Najbliższe najpierw',
        'Nazwa A–Ż',
        'Nazwa Ż–A',
        'Najdroższe miesięcznie',
        'Najtańsze miesięcznie',
        'Data rosnąco',
        'Data malejąco',
      ]);
      expect(await optionTexts(category)).toStrictEqual(['Wszystkie', 'Rozrywka', TOOLS.name]);
      expect(await optionTexts(status)).toStrictEqual([
        'Wszystkie',
        'Trial',
        'Aktywna',
        'W trakcie anulowania',
        'Anulowana',
      ]);
    });

    it('reads page 1 of another order chosen in the sort field', async () => {
      const { httpTesting, fixture, router, loader } = await createPage('/?status=active&page=2');
      await start(httpTesting, fixture, pageOf([NETFLIX], 30, 2), NETFLIX_TOTALS);

      await (await select(loader, 'Sortuj')).clickOptions({ text: 'Nazwa A–Ż' });
      await fixture.whenStable();

      const request = listRequest(httpTesting);
      expect(paramsOf(request)).toStrictEqual({ sort: ['name_asc'], status: ['active'] });
      expect(router.url).toBe('/?sort=name_asc&status=active');
      request.flush(pageOf([NETFLIX], 30, 1));
      await fixture.whenStable();
    });

    it('filters by a category and by a status, and "Wszystkie" turns a filter off', async () => {
      const { httpTesting, fixture, router, loader } = await createPage('/?status=trial');
      await start(httpTesting, fixture, pageOf([NETFLIX]), NETFLIX_TOTALS, [
        NETFLIX.category,
        TOOLS,
      ]);

      await (await select(loader, 'Kategoria')).clickOptions({ text: TOOLS.name });
      await fixture.whenStable();
      let request = listRequest(httpTesting);
      expect(paramsOf(request)).toStrictEqual({ category: [CATEGORY_ID], status: ['trial'] });
      request.flush(pageOf([NETFLIX]));
      await fixture.whenStable();

      await (await select(loader, 'Status')).clickOptions({ text: 'Wszystkie' });
      await fixture.whenStable();
      request = listRequest(httpTesting);
      expect(paramsOf(request)).toStrictEqual({ category: [CATEGORY_ID] });
      expect(router.url).toBe(`/?category=${CATEGORY_ID}`);
      request.flush(pageOf([NETFLIX]));
      await fixture.whenStable();
    });

    it('moves to the next page with the paginator and keeps the order', async () => {
      const { httpTesting, fixture, router, loader } = await createPage('/?sort=date_desc');
      await start(httpTesting, fixture, pageOf([NETFLIX], 60), NETFLIX_TOTALS);

      const paginator = await loader.getHarness(MatPaginatorHarness);
      expect(await paginator.getRangeLabel()).toBe('1–25 z 60');
      await paginator.goToNextPage();
      await fixture.whenStable();

      const request = listRequest(httpTesting);
      expect(paramsOf(request)).toStrictEqual({ sort: ['date_desc'], page: ['2'] });
      expect(router.url).toBe('/?sort=date_desc&page=2');
      request.flush(pageOf([NETFLIX], 60, 2));
      await fixture.whenStable();
      expect(await paginator.getRangeLabel()).toBe('26–50 z 60');
    });

    // 25 rows are exactly one page (backend SUBSCRIPTION_PAGE_SIZE).
    it('has no paginator when every row fits on one page', async () => {
      const { httpTesting, fixture, loader } = await createPage();
      await start(httpTesting, fixture, pageOf([NETFLIX], 25), NETFLIX_TOTALS);

      expect(
        await loader.getAllHarnesses(
          MatButtonHarness.with({ selector: '[aria-label="Edytuj Netflix"]' }),
        ),
      ).toHaveLength(1);
      expect(await loader.getAllHarnesses(MatPaginatorHarness)).toHaveLength(0);
    });

    it('tells an empty result of a filter apart and "Wyczyść filtry" keeps the order', async () => {
      const { httpTesting, fixture, router, loader } = await createPage(
        `/?sort=name_asc&category=${CATEGORY_ID}&status=trial`,
      );
      await start(httpTesting, fixture, pageOf([]), NETFLIX_TOTALS, [NETFLIX.category, TOOLS]);

      const host = fixture.nativeElement as HTMLElement;
      expect(host.textContent).toContain('Brak subskrypcji spełniających filtry.');
      expect(host.textContent).not.toContain('Nie masz jeszcze żadnych subskrypcji.');
      // The fields stay, so another filter can be chosen.
      expect(await loader.getAllHarnesses(MatSelectHarness)).toHaveLength(3);

      await (await loader.getHarness(MatButtonHarness.with({ text: 'Wyczyść filtry' }))).click();
      await fixture.whenStable();

      const request = listRequest(httpTesting);
      expect(paramsOf(request)).toStrictEqual({ sort: ['name_asc'] });
      expect(router.url).toBe('/?sort=name_asc');
      request.flush(pageOf([NETFLIX]));
      await fixture.whenStable();
      expect(host.textContent).not.toContain('Brak subskrypcji spełniających filtry.');
      expect(
        await loader.getAllHarnesses(
          MatButtonHarness.with({ selector: '[aria-label="Edytuj Netflix"]' }),
        ),
      ).toHaveLength(1);
    });

    it('keeps the empty account message without fields or "Wyczyść filtry"', async () => {
      const { httpTesting, fixture, loader } = await createPage('/?sort=name_asc');
      await start(httpTesting, fixture, pageOf([]), NO_TOTALS);
      // The add panel opens by itself and its form reads the categories.
      httpTesting.expectOne({ method: 'GET', url: CATEGORIES_URL }).flush([NETFLIX.category]);
      await fixture.whenStable();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.textContent).toContain('Nie masz jeszcze żadnych subskrypcji.');
      expect(host.textContent).not.toContain('Brak subskrypcji spełniających filtry.');
      expect(
        await loader.getAllHarnesses(MatButtonHarness.with({ text: 'Wyczyść filtry' })),
      ).toHaveLength(0);
      expect(
        await loader.getAllHarnesses(MatFormFieldHarness.with({ floatingLabelText: 'Sortuj' })),
      ).toHaveLength(0);
    });
  });
});
