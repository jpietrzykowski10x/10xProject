import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { provideRouter } from '@angular/router';
import type { MockInstance } from 'vitest';
import { environment } from '../../../environments/environment';
import { ErrorReporter } from '../../shared/error-reporter';
import { SignIn } from './sign-in';

// Only proves the component is created and its template rendered with the providers it has in the
// app (a lost import or provider fails here); it says nothing about behaviour. verify() also proves
// that rendering sends no request.
describe('SignIn', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('should create', async () => {
    TestBed.configureTestingModule({
      imports: [SignIn],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(SignIn);
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
  });
});

// The oracle is the API contract of a blocked account (backend AccountBlockedResponse, S-09):
// POST /auth/request-link answers 403 with `code: 'account_blocked'` and the contact address, and
// the page shows the block with a mailto link instead of "service unavailable". Another 403 (e.g.
// a refused CSRF check) stays "unavailable", and only that unknown error is reported (ErrorReporter).
describe('SignIn blocked account', () => {
  const REQUEST_LINK_URL = `${environment.apiUrl}/auth/request-link`;
  const CONTACT = 'pomoc@example.com';

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  async function requestLink(): Promise<{
    fixture: ComponentFixture<SignIn>;
    request: TestRequest;
    report: MockInstance<ErrorReporter['report']>;
  }> {
    TestBed.configureTestingModule({
      imports: [SignIn],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const report = vi.spyOn(TestBed.inject(ErrorReporter), 'report').mockImplementation(() => {});
    const fixture = TestBed.createComponent(SignIn);
    const loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
    const field = await loader.getHarness(
      MatFormFieldHarness.with({ floatingLabelText: 'Adres e-mail' }),
    );
    await (await field.getControl(MatInputHarness))?.setValue('anna@example.com');
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Wyślij link' }))).click();
    const request = TestBed.inject(HttpTestingController).expectOne({
      method: 'POST',
      url: REQUEST_LINK_URL,
    });
    return { fixture, request, report };
  }

  it('shows the block with the contact address', async () => {
    const { fixture, request, report } = await requestLink();

    request.flush(
      { statusCode: 403, code: 'account_blocked', contact: CONTACT, message: 'Account blocked' },
      { status: 403, statusText: 'Forbidden' },
    );
    await fixture.whenStable();

    const alerts = (fixture.nativeElement as HTMLElement).querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain('zablokowane');
    expect(alerts[0].querySelector('a')?.getAttribute('href')).toBe(`mailto:${CONTACT}`);
    expect(report).not.toHaveBeenCalled();
  });

  it('does not report a 400 of validation', async () => {
    const { fixture, request, report } = await requestLink();

    request.flush(
      { statusCode: 400, message: ['email must be an email'] },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();

    expect(report).not.toHaveBeenCalled();
  });

  it('shows "unavailable" for another 403 and reports it', async () => {
    const { fixture, request, report } = await requestLink();

    request.flush(
      { statusCode: 403, message: 'Forbidden' },
      { status: 403, statusText: 'Forbidden' },
    );
    await fixture.whenStable();

    const alerts = (fixture.nativeElement as HTMLElement).querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).not.toContain('zablokowane');
    expect(alerts[0].querySelector('a')).toBeNull();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('SignIn', expect.anything());
  });
});
