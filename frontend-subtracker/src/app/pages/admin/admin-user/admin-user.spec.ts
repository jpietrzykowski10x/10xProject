import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { environment } from '../../../../environments/environment';
import type { AdminUserDetail, AdminUserSummary } from '../../../admin/admin.types';
import { AdminUser } from './admin-user';

const ID = '11111111-1111-4111-8111-111111111111';
const USER_URL = `${environment.apiUrl}/admin/users/${ID}`;

function detail(user: Partial<AdminUserSummary> = {}): AdminUserDetail {
  return {
    user: {
      id: ID,
      email: 'anna@example.com',
      role: 'user',
      isActive: true,
      createdAt: '2026-11-13T12:00:00.000Z',
      canManage: true,
      emailVerifiedAt: '2026-11-13T12:05:00.000Z',
      ...user,
    },
    subscriptions: [
      {
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
      },
    ],
    totals: {
      monthly: '43.00',
      yearly: '516.00',
      monthlyLimit: '200.00',
      budgetAlert: 'none',
      categories: [],
    },
    budget: {
      defaultDuplicateThreshold: 3,
      monthlyLimit: '200.00',
      categories: [
        {
          category: { id: 'category-1', name: 'Rozrywka', isDefault: true },
          duplicateThreshold: 3,
          monthlyLimit: null,
        },
      ],
    },
  };
}

let harness: RouterTestingHarness;
let loader: HarnessLoader;
let httpTesting: HttpTestingController;

async function createPage(query = ''): Promise<void> {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([{ path: 'admin/users/:id', component: AdminUser }]),
    ],
  });
  httpTesting = TestBed.inject(HttpTestingController);
  harness = await RouterTestingHarness.create(`/admin/users/${ID}${query}`);
  loader = TestbedHarnessEnvironment.loader(harness.fixture);
}

async function answer(body: AdminUserDetail | null, status = 200): Promise<void> {
  const request = httpTesting.expectOne({ method: 'GET', url: USER_URL });
  if (status === 200) {
    request.flush(body);
  } else {
    request.flush({ statusCode: status }, { status, statusText: 'Error' });
  }
  await harness.fixture.whenStable();
}

function host(): HTMLElement {
  return harness.routeNativeElement as HTMLElement;
}

async function buttonTexts(): Promise<string[]> {
  const buttons = await loader.getAllHarnesses(
    MatButtonHarness.with({ ancestor: '.admin-user__actions' }),
  );
  return Promise.all(buttons.map((button) => button.getText()));
}

afterEach(() => {
  try {
    httpTesting.verify();
  } finally {
    TestBed.resetTestingModule();
  }
});

// The oracle is the API contract of GET /admin/users/:id (backend AdminUserDetail) and the plan of
// S-09: a read-only view (no row actions), the account's own totals, no totals of the shell, and
// the actions only with canManage, matching the account's state (409 otherwise).
describe('AdminUser', () => {
  it('shows the account read-only with its own totals and limits', async () => {
    await createPage();
    await answer(detail());

    expect(host().querySelector('h1')?.textContent?.trim()).toBe('anna@example.com');
    expect(host().textContent).toContain('Netflix');
    // One totals panel: the account's, not the shell's two.
    expect(host().querySelectorAll('app-cost-totals')).toHaveLength(1);
    expect(host().querySelector('.admin-user__totals .totals__amount')?.textContent).toContain(
      '43,00',
    );
    expect(host().querySelectorAll('[aria-label^="Edytuj"], [aria-label^="Usuń"]')).toHaveLength(0);
    expect(host().querySelector('.admin-user__limits')?.textContent).toContain('200,00');
  });

  it.each<[string, Partial<AdminUserSummary>, string[]]>([
    ['an active account', { isActive: true }, ['Zablokuj', 'Wyloguj wszędzie']],
    ['a blocked account', { isActive: false }, ['Odblokuj']],
    ['an account the administrator does not outrank', { canManage: false }, []],
  ])('offers the right actions for %s', async (_case, user, expected) => {
    await createPage();
    await answer(detail(user));

    expect(await buttonTexts()).toEqual(expected);
  });

  // The list's query came along in the address; the back link leads to the same list.
  it.each([
    ['', '/admin/users'],
    ['?q=anna&status=blocked', '/admin/users?q=anna&status=blocked'],
  ])('links back to the search with the query "%s"', async (query, href) => {
    await createPage(query);
    await answer(detail());

    expect(host().querySelector('.admin-user__back')?.getAttribute('href')).toBe(href);
  });

  it('keeps the search query in the back link after an action', async () => {
    await createPage('?q=anna&status=active');
    await answer(detail());

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Zablokuj' }))).click();
    const dialog = await TestbedHarnessEnvironment.documentRootLoader(harness.fixture).getHarness(
      MatDialogHarness,
    );
    await (await dialog.getHarness(MatButtonHarness.with({ text: 'Zablokuj' }))).click();
    httpTesting
      .expectOne({ method: 'POST', url: `${USER_URL}/block` })
      .flush({ ...detail().user, isActive: false });
    await harness.fixture.whenStable();
    await answer(detail({ isActive: false }));

    expect(host().querySelector('.admin-user__back')?.getAttribute('href')).toBe(
      '/admin/users?q=anna&status=active',
    );
  });

  it.each([
    [404, 'Nie ma takiego konta'],
    [403, 'Brak uprawnień'],
  ])('shows the message for a %i', async (status, message) => {
    await createPage();
    await answer(null, status);

    const alerts = host().querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain(message);
  });

  it('blocks after the confirmation and reads the account again', async () => {
    await createPage();
    await answer(detail());

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Zablokuj' }))).click();
    const dialog = await TestbedHarnessEnvironment.documentRootLoader(harness.fixture).getHarness(
      MatDialogHarness,
    );
    await (await dialog.getHarness(MatButtonHarness.with({ text: 'Zablokuj' }))).click();

    const request = httpTesting.expectOne({ method: 'POST', url: `${USER_URL}/block` });
    expect(request.request.body).toBeNull();
    request.flush({ ...detail().user, isActive: false });
    await harness.fixture.whenStable();
    await answer(detail({ isActive: false }));

    expect(host().querySelector('[role="status"]')?.textContent).toContain('zablokowane');
    expect(await buttonTexts()).toEqual(['Odblokuj']);
  });

  it('says why a refused action did nothing and reads the account again', async () => {
    await createPage();
    await answer(detail());

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Wyloguj wszędzie' }))).click();
    const dialog = await TestbedHarnessEnvironment.documentRootLoader(harness.fixture).getHarness(
      MatDialogHarness,
    );
    await (await dialog.getHarness(MatButtonHarness.with({ text: 'Wyloguj wszędzie' }))).click();

    httpTesting
      .expectOne({ method: 'POST', url: `${USER_URL}/reset-sessions` })
      .flush({ statusCode: 409 }, { status: 409, statusText: 'Conflict' });
    await harness.fixture.whenStable();
    await answer(detail({ isActive: false }));

    const alerts = host().querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain('Stan konta');
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    await createPage();
    await answer(detail());

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Zablokuj' }))).click();
    const dialog = await TestbedHarnessEnvironment.documentRootLoader(harness.fixture).getHarness(
      MatDialogHarness,
    );
    await (await dialog.getHarness(MatButtonHarness.with({ text: 'Anuluj' }))).click();
    await harness.fixture.whenStable();

    httpTesting.expectNone({ method: 'POST', url: `${USER_URL}/block` });
  });
});
