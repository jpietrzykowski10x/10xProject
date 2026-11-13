import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { provideRouter } from '@angular/router';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { environment } from '../../../environments/environment';
import type { RegisterRequest } from '../../auth/auth.service';
import { Register } from './register';

const REGISTER_URL = `${environment.apiUrl}/auth/register`;
const EMAIL = 'anna@example.com';

// Labels of the two required statements, matched in part (the second one contains a link).
const ADULT = /18 lat/;
const PRIVACY_POLICY = /polityk/;

let fixture: ComponentFixture<Register>;
let loader: HarnessLoader;
let httpTesting: HttpTestingController;

async function createRegister(): Promise<void> {
  TestBed.configureTestingModule({
    imports: [Register],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  httpTesting = TestBed.inject(HttpTestingController);
  fixture = TestBed.createComponent(Register);
  loader = TestbedHarnessEnvironment.loader(fixture);
  await fixture.whenStable();
}

async function typeEmail(email: string): Promise<void> {
  const field = await loader.getHarness(
    MatFormFieldHarness.with({ floatingLabelText: 'Adres e-mail' }),
  );
  const input = await field.getControl(MatInputHarness);
  if (input === null) {
    throw new Error('No text input in the e-mail field.');
  }
  await input.setValue(email);
}

async function check(label: RegExp): Promise<void> {
  await (await loader.getHarness(MatCheckboxHarness.with({ label }))).check();
}

async function save(): Promise<void> {
  await (await loader.getHarness(MatButtonHarness.with({ text: 'Załóż konto' }))).click();
}

function host(): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function alertCount(): number {
  return host().querySelectorAll('[role="alert"]').length;
}

// MatCheckbox binds aria-describedby on its inner input, not on the host, and the harness does not
// read it. In template order: the adult statement, then the privacy policy.
function describedBy(): string[] {
  return Array.from(
    host().querySelectorAll<HTMLInputElement>('mat-checkbox input[type=checkbox]'),
    (input) => input.getAttribute('aria-describedby') ?? '',
  );
}

// The element an aria-describedby points to, if it exists and is an alert.
function describedAlert(id: string): Element | null {
  return id === '' ? null : host().querySelector(`[id="${id}"][role="alert"]`);
}

afterEach(() => {
  TestBed.inject(HttpTestingController).verify();
});

describe('Register', () => {
  it('should create', async () => {
    await createRegister();

    expect(fixture.componentInstance).toBeTruthy();
  });
});

// The oracle is the API contract of POST /auth/register (RegisterRequest: both statements must be
// true) and the rule of test-plan §2 #7: a field the user has to fix shows a message after a save
// attempt, and the message is linked to its control. The statements' messages are not mat-error,
// so this test covers what Material does not. Only the presence of the messages and their link are
// asserted, not their text.
describe('Register required statements', () => {
  it('does not register without the statements and links a message to each checkbox', async () => {
    await createRegister();
    await typeEmail(EMAIL);

    expect(describedBy()).toEqual(['', '']);

    await save();

    httpTesting.expectNone({ method: 'POST', url: REGISTER_URL });
    expect(alertCount()).toBe(2);
    const [adult, privacyPolicy] = describedBy();
    expect(describedAlert(adult)).not.toBeNull();
    expect(describedAlert(privacyPolicy)).not.toBeNull();
    expect(adult).not.toBe(privacyPolicy);
  });

  it('shows the message only at the statement left unchecked', async () => {
    await createRegister();
    await typeEmail(EMAIL);
    await check(ADULT);

    await save();

    httpTesting.expectNone({ method: 'POST', url: REGISTER_URL });
    expect(alertCount()).toBe(1);
    const [adult, privacyPolicy] = describedBy();
    expect(adult).toBe('');
    expect(describedAlert(privacyPolicy)).not.toBeNull();
  });

  it('registers with both statements checked and shows no message', async () => {
    await createRegister();
    await typeEmail(EMAIL);
    await check(ADULT);
    await check(PRIVACY_POLICY);

    await save();

    const request = httpTesting.expectOne({ method: 'POST', url: REGISTER_URL });
    const body: unknown = request.request.body;
    // Read while the request is pending: once answered, the form gives way to the success notice.
    const alerts = alertCount();
    const links = describedBy();
    request.flush(null);

    const expected: RegisterRequest = {
      email: EMAIL,
      confirmedAdult: true,
      acceptedPrivacyPolicy: true,
    };
    expect(body).toEqual(expected);
    expect(alerts).toBe(0);
    expect(links).toEqual(['', '']);
  });
});
