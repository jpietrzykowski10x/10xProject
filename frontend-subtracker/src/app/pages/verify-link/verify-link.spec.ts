import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { environment } from '../../../environments/environment';
import { VerifyLink } from './verify-link';

// Only proves the component is created and its template rendered with the providers it has in the
// app (a lost import or provider fails here); it says nothing about behaviour. verify() also proves
// that rendering sends no request.
describe('VerifyLink', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('should create', async () => {
    TestBed.configureTestingModule({
      imports: [VerifyLink],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(VerifyLink);
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
  });
});

// The oracle is the API contract of a blocked account (backend AccountBlockedResponse, S-09): a
// valid link of a blocked account answers 403 with `code: 'account_blocked'` and the contact
// address; the page shows the block with a mailto link instead of "unavailable".
describe('VerifyLink blocked account', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('shows the block with the contact address', async () => {
    const contact = 'pomoc@example.com';
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'auth/verify', component: VerifyLink }]),
      ],
    });
    const harness = await RouterTestingHarness.create('/auth/verify#token=abc');
    const loader = TestbedHarnessEnvironment.loader(harness.fixture);
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Zaloguj' }))).click();

    TestBed.inject(HttpTestingController)
      .expectOne({ method: 'POST', url: `${environment.apiUrl}/auth/verify` })
      .flush(
        { statusCode: 403, code: 'account_blocked', contact, message: 'Account blocked' },
        { status: 403, statusText: 'Forbidden' },
      );
    await harness.fixture.whenStable();

    const host = harness.routeNativeElement as HTMLElement;
    const alerts = host.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain('zablokowane');
    expect(alerts[0].querySelector('a')?.getAttribute('href')).toBe(`mailto:${contact}`);
    expect(host.querySelectorAll('button')).toHaveLength(0);
  });
});
