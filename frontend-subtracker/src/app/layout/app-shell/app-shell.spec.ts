import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatMenuHarness } from '@angular/material/menu/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../auth/auth.service';
import type { CostTotals } from '../../subscriptions/subscription.types';
import { AppShell } from './app-shell';

const TOTALS_URL = `${environment.apiUrl}/subscriptions/totals`;
const EMAIL = 'jan@example.com';

// Only proves the component is created and its template rendered with the providers it has in the
// app (a lost import or provider fails here). verify() also proves that the only request of a
// render is the one read of the cost totals.
describe('AppShell', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('should create', async () => {
    TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const httpTesting = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AppShell);
    await fixture.whenStable();

    const totals: CostTotals = {
      monthly: '0.00',
      yearly: '0.00',
      monthlyLimit: null,
      budgetAlert: 'none',
      categories: [],
    };
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(totals);
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
  });

  // The oracle is the plan of S-07: the desktop navigation leads to the three pages of the app.
  // The phone menu renders the same list in an overlay, only when it is opened.
  it('links the dashboard, the subscriptions and the budget in the navigation', async () => {
    TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const httpTesting = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AppShell);
    await fixture.whenStable();
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush({
      monthly: '0.00',
      yearly: '0.00',
      monthlyLimit: null,
      budgetAlert: 'none',
      categories: [],
    } satisfies CostTotals);
    await fixture.whenStable();

    const links = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>(
        'nav[aria-label="Główna nawigacja"] a',
      ),
    ).map((link) => [link.textContent?.trim(), link.getAttribute('href')]);
    expect(links).toEqual([
      ['Dashboard', '/dashboard'],
      ['Subskrypcje', '/subscriptions'],
      ['Budżet', '/budget'],
    ]);
  });

  // The oracle is the owner's decision in S-10: the signed-in address itself links the account
  // page, in the desktop column and in the phone menu (opened, since the menu renders its items
  // only then), outside the main navigation.
  it('links the account page from the address in both navigations', async () => {
    TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const httpTesting = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthService).session().subscribe();
    httpTesting
      .expectOne(`${environment.apiUrl}/auth/session`)
      .flush({ user: { id: 'u1', email: EMAIL, roles: ['USER'] } });
    const fixture = TestBed.createComponent(AppShell);
    const loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush({
      monthly: '0.00',
      yearly: '0.00',
      monthlyLimit: null,
      budgetAlert: 'none',
      categories: [],
    } satisfies CostTotals);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    const columnLinks = Array.from(host.querySelectorAll<HTMLAnchorElement>('.shell__account a'));
    expect(
      columnLinks.map((link) => [link.textContent?.trim(), link.getAttribute('href')]),
    ).toEqual([[EMAIL, '/account']]);

    const menu = await loader.getHarness(MatMenuHarness);
    await menu.open();
    expect(await menu.getItems({ text: 'Konto' })).toHaveLength(0);
    const items = await menu.getItems({ text: EMAIL });
    expect(items).toHaveLength(1);
    expect(await (await items[0].host()).getAttribute('href')).toBe('/account');
  });
});
