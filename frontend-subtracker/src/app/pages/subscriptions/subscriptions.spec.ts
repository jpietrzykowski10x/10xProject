import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import type {
  CreateSubscriptionRequest,
  Subscription,
} from '../../subscriptions/subscription.types';
import { Subscriptions } from './subscriptions';

const SUBSCRIPTIONS_URL = `${environment.apiUrl}/subscriptions`;
const CATEGORIES_URL = `${environment.apiUrl}/categories`;

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

function createPage() {
  TestBed.configureTestingModule({
    imports: [Subscriptions],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  const httpTesting = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(Subscriptions);
  return { httpTesting, fixture, loader: TestbedHarnessEnvironment.loader(fixture) };
}

describe('Subscriptions', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  // Only proves the page is created and its template rendered with the providers it has in the
  // app (a lost import or provider fails here). The page reads the list on start, and an empty
  // list mounts the subscription form, which reads the categories.
  it('should create', async () => {
    const { httpTesting, fixture } = createPage();
    await fixture.whenStable();

    httpTesting.expectOne({ method: 'GET', url: SUBSCRIPTIONS_URL }).flush([]);
    await fixture.whenStable();
    httpTesting.expectOne({ method: 'GET', url: CATEGORIES_URL }).flush([]);
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
  });

  // The oracle is the API contract (PUT /subscriptions/:id takes the create body) and the plan's
  // flow: "Edytuj" opens the panel with the row's data, a save shows the status message and reads
  // the list again. Only the HTTP boundary is replaced.
  it('edits a subscription from its row and reads the list again after the save', async () => {
    const { httpTesting, fixture, loader } = createPage();
    await fixture.whenStable();
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
    await fixture.whenStable();

    expect(host.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'Zapisano zmiany w subskrypcji „Netflix Premium”.',
    );
    expect(host.querySelector('#subscription-panel')).toBeNull();
  });

  it('closes the edit panel on "Anuluj" without saving or reading the list again', async () => {
    const { httpTesting, fixture, loader } = createPage();
    await fixture.whenStable();
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
  });
});
