import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { MockInstance } from 'vitest';
import { environment } from '../../../../environments/environment';
import { ErrorReporter } from '../../../shared/error-reporter';
import type { AdminStatusFilter, AdminUserSummary } from '../../../admin/admin.types';
import { AdminUsers } from './admin-users';

const SEARCH_URL = `${environment.apiUrl}/admin/users`;

const ANNA: AdminUserSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'anna@example.com',
  role: 'user',
  isActive: false,
  createdAt: '2026-11-13T12:00:00.000Z',
  canManage: true,
};

let harness: RouterTestingHarness;
let loader: HarnessLoader;
let httpTesting: HttpTestingController;
// ErrorReporter.report: only an unknown error is reported, under 'AdminUsers'.
let report: MockInstance<ErrorReporter['report']>;

// The page behind the real router, so the query travels through the address (?q=&status=).
async function createPage(url = '/admin/users'): Promise<void> {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([{ path: 'admin/users', component: AdminUsers }]),
    ],
  });
  httpTesting = TestBed.inject(HttpTestingController);
  report = vi.spyOn(TestBed.inject(ErrorReporter), 'report').mockImplementation(() => {});
  harness = await RouterTestingHarness.create(url);
  loader = TestbedHarnessEnvironment.loader(harness.fixture);
}

async function search(q: string, status?: 'Wszystkie' | 'Aktywny' | 'Zablokowany'): Promise<void> {
  const field = await loader.getHarness(
    MatFormFieldHarness.with({ floatingLabelText: 'Adres e-mail lub jego fragment' }),
  );
  await (await field.getControl(MatInputHarness))?.setValue(q);
  if (status !== undefined) {
    const select = await loader.getHarness(
      MatFormFieldHarness.with({ floatingLabelText: 'Status' }),
    );
    const control = (await select.getControl(MatSelectHarness)) as MatSelectHarness;
    await control.open();
    await control.clickOptions({ text: status });
  }
  await (await loader.getHarness(MatButtonHarness.with({ text: 'Szukaj' }))).click();
  await harness.fixture.whenStable();
}

function host(): HTMLElement {
  return harness.routeNativeElement as HTMLElement;
}

afterEach(() => {
  try {
    httpTesting.verify();
  } finally {
    TestBed.resetTestingModule();
  }
});

describe('AdminUsers', () => {
  it('should create without a request', async () => {
    await createPage();

    expect(harness.routeDebugElement?.componentInstance).toBeInstanceOf(AdminUsers);
  });
});

// The oracle is the API contract of GET /admin/users (backend SearchUsersDto): `q` of at least
// 3 characters, or none with `status=blocked`; at most 20 results. Each result links its account.
describe('AdminUsers search', () => {
  it('sends the fragment and lists the accounts with links', async () => {
    await createPage();
    await search('anna');

    const request = httpTesting.expectOne((req) => req.url === SEARCH_URL);
    expect(request.request.params.get('q')).toBe('anna');
    expect(request.request.params.has('status')).toBe(false);
    request.flush([ANNA]);
    await harness.fixture.whenStable();

    const link = host().querySelector<HTMLAnchorElement>('[aria-label="Wyniki wyszukiwania"] a');
    expect(link?.textContent?.trim()).toBe(ANNA.email);
    expect(link?.getAttribute('href')).toBe(`/admin/users/${ANNA.id}?q=anna`);
    expect(host().textContent).toContain('Zablokowane');
    expect(host().textContent).toContain('Użytkownik');
  });

  it('lists the blocked accounts without a fragment', async () => {
    await createPage();
    await search('', 'Zablokowany');

    const request = httpTesting.expectOne((req) => req.url === SEARCH_URL);
    expect(request.request.params.has('q')).toBe(false);
    expect(request.request.params.get('status')).toBe('blocked');
    request.flush([]);
    await harness.fixture.whenStable();

    expect(host().textContent).toContain('Nie znaleziono żadnego konta.');
  });

  it.each<[string, AdminStatusFilter]>([
    ['Aktywny', 'active'],
    ['Wszystkie', 'all'],
  ])('sends nothing without a fragment for status %s', async (label) => {
    await createPage();
    await search('', label as 'Aktywny' | 'Wszystkie');

    httpTesting.expectNone((req) => req.url === SEARCH_URL);
  });

  it('sends status=active and links each account with the list query', async () => {
    await createPage();
    await search('anna', 'Aktywny');

    const request = httpTesting.expectOne((req) => req.url === SEARCH_URL);
    expect(request.request.params.get('status')).toBe('active');
    request.flush([ANNA]);
    await harness.fixture.whenStable();

    const link = host().querySelector<HTMLAnchorElement>('[aria-label="Wyniki wyszukiwania"] a');
    expect(link?.getAttribute('href')).toBe(`/admin/users/${ANNA.id}?q=anna&status=active`);
  });

  it('sends nothing for a fragment shorter than 3 characters and says why', async () => {
    await createPage();
    await search('an');

    httpTesting.expectNone((req) => req.url === SEARCH_URL);
    expect(host().querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it('runs the search from the address, e.g. after going back from an account', async () => {
    await createPage('/admin/users?q=anna&status=blocked');

    const request = httpTesting.expectOne((req) => req.url === SEARCH_URL);
    expect(request.request.params.get('status')).toBe('blocked');
    request.flush([ANNA]);
    await harness.fixture.whenStable();

    expect(
      host()
        .querySelector('[aria-label="Wyniki wyszukiwania"] .results__email')
        ?.textContent?.trim(),
    ).toBe(ANNA.email);
  });

  it('shows "Brak uprawnień" for a 403', async () => {
    await createPage('/admin/users?q=anna');

    httpTesting
      .expectOne((req) => req.url === SEARCH_URL)
      .flush({ statusCode: 403 }, { status: 403, statusText: 'Forbidden' });
    await harness.fixture.whenStable();

    const alerts = host().querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain('Brak uprawnień');
    expect(report).not.toHaveBeenCalled();
  });

  it('shows one alert and reports the error after a server error', async () => {
    await createPage('/admin/users?q=anna');

    httpTesting
      .expectOne((req) => req.url === SEARCH_URL)
      .flush('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });
    await harness.fixture.whenStable();

    expect(host().querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('AdminUsers', expect.anything());
  });
});
