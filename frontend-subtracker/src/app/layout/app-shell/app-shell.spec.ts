import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatMenuHarness } from '@angular/material/menu/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import { ErrorReporter } from '../../shared/error-reporter';
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

// The oracle is the access rule of S-09: "Administracja" (/admin/users) is in both navigations
// only for the ADMIN and SUPER_ADMIN roles. Anchor: the three pages everyone has are there.
describe('AppShell admin link', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  async function renderAs(roles: string[]) {
    TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const httpTesting = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthService).session().subscribe();
    httpTesting
      .expectOne(`${environment.apiUrl}/auth/session`)
      .flush({ user: { id: 'u1', email: EMAIL, roles } });
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
    const columnLinks = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>(
        'nav[aria-label="Główna nawigacja"] a',
      ),
    ).map((link) => link.getAttribute('href'));
    const menu = await loader.getHarness(MatMenuHarness);
    await menu.open();
    const menuItems = await menu.getItems({ text: 'Administracja' });
    return { columnLinks, menuItems };
  }

  it.each([[['USER']], [[]]])('hides the link from a user with the roles %j', async (roles) => {
    const { columnLinks, menuItems } = await renderAs(roles);

    expect(columnLinks).toEqual(['/dashboard', '/subscriptions', '/budget']);
    expect(menuItems).toHaveLength(0);
  });

  it.each([[['ADMIN']], [['SUPER_ADMIN']]])(
    'shows the link to a user with the roles %j',
    async (roles) => {
      const { columnLinks, menuItems } = await renderAs(roles);

      expect(columnLinks).toEqual(['/dashboard', '/subscriptions', '/budget', '/admin/users']);
      expect(menuItems).toHaveLength(1);
      expect(await (await menuItems[0].host()).getAttribute('href')).toBe('/admin/users');
    },
  );
});

// The oracle is the rule of S-15: a failed sign-out keeps the visitor signed in with an alert,
// and its cause is reported (ErrorReporter) under 'AppShell'.
describe('AppShell sign-out failure', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('shows an alert and reports the error when the sign-out fails', async () => {
    TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const report = vi.spyOn(TestBed.inject(ErrorReporter), 'report').mockImplementation(() => {});
    const httpTesting = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AppShell);
    fixture.componentRef.setInput('showTotals', false);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    host.querySelector<HTMLButtonElement>('.shell__logout')?.click();
    httpTesting
      .expectOne({ method: 'POST', url: `${environment.apiUrl}/auth/logout` })
      .error(new ProgressEvent('error'));
    await fixture.whenStable();

    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('AppShell', expect.anything());
  });
});

// The oracle is the plan of S-09: the admin pages show another account, so the shell neither loads
// nor shows the administrator's own totals there. verify() proves no totals request was sent.
describe('AppShell without totals', () => {
  it('sends no totals request and shows no totals', async () => {
    TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(AppShell);
    fixture.componentRef.setInput('showTotals', false);
    await fixture.whenStable();

    TestBed.inject(HttpTestingController).verify();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('app-cost-totals')).toHaveLength(
      0,
    );
  });
});
