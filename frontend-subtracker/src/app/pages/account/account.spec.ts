import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { provideRouter, Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService, type AuthUser } from '../../auth/auth.service';
import { CostTotalsStore } from '../../subscriptions/cost-totals.store';
import type { CostTotals } from '../../subscriptions/subscription.types';
import { Account } from './account';

const SESSION_URL = `${environment.apiUrl}/auth/session`;
const TOTALS_URL = `${environment.apiUrl}/subscriptions/totals`;
const DELETE_URL = `${environment.apiUrl}/auth/delete-account`;

const USER: AuthUser = { id: 'user-1', email: 'jan.kowalski@example.com', roles: [] };
const NO_TOTALS: CostTotals = {
  monthly: '0.00',
  yearly: '0.00',
  monthlyLimit: null,
  budgetAlert: 'none',
  categories: [],
};

// The page with its shell, after authGuard has read the session (AuthService.currentUser set).
async function createPage() {
  TestBed.configureTestingModule({
    imports: [Account],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  const httpTesting = TestBed.inject(HttpTestingController);
  TestBed.inject(AuthService).session().subscribe();
  httpTesting.expectOne({ method: 'GET', url: SESSION_URL }).flush({ user: USER });
  const fixture = TestBed.createComponent(Account);
  const pageLoader = TestbedHarnessEnvironment.loader(fixture);
  const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
  await fixture.whenStable();
  httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(NO_TOTALS);
  await fixture.whenStable();
  return { httpTesting, fixture, pageLoader, loader, host: fixture.nativeElement as HTMLElement };
}

describe('Account', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('should create', async () => {
    const { fixture, host } = await createPage();

    expect(fixture.componentInstance).toBeTruthy();
    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Konto');
    expect(host.querySelector('.account__email')?.textContent?.trim()).toBe(USER.email);
  });

  // State sequencing of the plan: after the 204 the user is gone, then the cost totals, then the
  // start page is opened with { accountDeleted: true } for its notice.
  it('after the deletion drops the user and the totals and goes to / with the state', async () => {
    const { httpTesting, fixture, pageLoader, loader } = await createPage();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const clear = vi.spyOn(TestBed.inject(CostTotalsStore), 'clear');

    await (await pageLoader.getHarness(MatButtonHarness.with({ text: 'Usuń konto' }))).click();
    const dialog = await loader.getHarness(MatDialogHarness);
    const field = await dialog.getHarness(
      MatFormFieldHarness.with({ floatingLabelText: 'Wpisz swój adres e-mail, aby potwierdzić' }),
    );
    await (await field.getControl(MatInputHarness))?.setValue(USER.email);
    await (await dialog.getHarness(MatButtonHarness.with({ text: 'Usuń konto' }))).click();
    httpTesting
      .expectOne({ method: 'POST', url: DELETE_URL })
      .flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();

    expect(TestBed.inject(AuthService).currentUser()).toBeNull();
    expect(clear).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/'], { state: { accountDeleted: true } });
  });

  it('stays on the page when the dialog is cancelled', async () => {
    const { fixture, pageLoader, loader } = await createPage();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
    const clear = vi.spyOn(TestBed.inject(CostTotalsStore), 'clear');

    await (await pageLoader.getHarness(MatButtonHarness.with({ text: 'Usuń konto' }))).click();
    const dialog = await loader.getHarness(MatDialogHarness);
    await (await dialog.getHarness(MatButtonHarness.with({ text: 'Anuluj' }))).click();
    await fixture.whenStable();

    expect(clear).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(TestBed.inject(AuthService).currentUser()).toEqual(USER);
  });
});
