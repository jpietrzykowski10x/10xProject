import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { PLATFORM_ID, REQUEST } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  GuardResult,
  provideRouter,
  RedirectCommand,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { isObservable } from 'rxjs';
import { environment } from '../../environments/environment';
import { authGuard, guestGuard } from './auth.guard';

// The oracle is the access rule for the two kinds of pages, not the guard code:
// - guestGuard (start page, sign-in, register) never blocks a visitor: only a confirmed signed-in
//   user is sent on to /subscriptions; an expired session, an API error or an API that does not
//   answer within 3 s leaves the visitor on the page.
// - authGuard (signed-in pages) lets in only a confirmed user; an expired session goes to /sign-in;
//   an API outage (error, or no answer within 10 s) is not a lost session, so it shows
//   /unavailable without changing the address.
// - On the server the browser does not send the cookie by itself: the guard forwards only the
//   subtracker_session pair to GET /auth/session, and without that cookie (or without a request at
//   all, as in prerendering) it does not ask the API.
// Only the HTTP boundary is replaced; AuthService and Router are the real ones.

const SESSION_URL = `${environment.apiUrl}/auth/session`;
const SIGNED_IN = { user: { id: 'u1', email: 'anna@example.com', roles: ['user'] } };
const SIGNED_OUT = { user: null };

type Platform = 'server' | 'browser';

const GUARDS: [string, CanActivateFn][] = [
  ['guestGuard', guestGuard],
  ['authGuard', authGuard],
];

// What the guard decided: undefined while the Observable has not emitted yet.
interface Decision {
  value: GuardResult | undefined;
}

function setup(platform: Platform, cookieHeader?: string | null): void {
  // undefined = no request at all (prerendering at build time); null = a request without cookies.
  const request =
    cookieHeader === undefined
      ? null
      : new Request('http://localhost/', {
          headers: cookieHeader === null ? {} : { cookie: cookieHeader },
        });
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: REQUEST, useValue: request },
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
    ],
  });
}

function run(guard: CanActivateFn): Decision {
  const decision: Decision = { value: undefined };
  const result = TestBed.runInInjectionContext(() =>
    guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
  );
  if (isObservable(result)) {
    result.subscribe((value) => (decision.value = value));
  } else if (result instanceof Promise) {
    throw new Error('Guard returned a Promise; this spec expects a value or an Observable.');
  } else {
    decision.value = result;
  }
  return decision;
}

function urlOf(tree: UrlTree): string {
  return TestBed.inject(Router).serializeUrl(tree);
}

function expectAllowed(decision: Decision): void {
  expect(decision.value).toBe(true);
}

function expectUrlTree(decision: Decision, url: string): void {
  expect(decision.value).toBeInstanceOf(UrlTree);
  expect(urlOf(decision.value as UrlTree)).toBe(url);
}

function expectUnavailable(decision: Decision): void {
  expect(decision.value).toBeInstanceOf(RedirectCommand);
  const command = decision.value as RedirectCommand;
  expect(urlOf(command.redirectTo)).toBe('/unavailable');
  expect(command.navigationBehaviorOptions?.skipLocationChange).toBe(true);
}

function expectSessionRequest(): TestRequest {
  const request = TestBed.inject(HttpTestingController).expectOne(SESSION_URL);
  expect(request.request.method).toBe('GET');
  return request;
}

function failWithServerError(request: TestRequest): void {
  request.flush('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });
}

function failWithNetworkError(request: TestRequest): void {
  request.error(new ProgressEvent('error'));
}

afterEach(() => {
  TestBed.inject(HttpTestingController).verify();
  vi.useRealTimers();
});

describe('guards on the server without a session cookie', () => {
  // undefined: prerendering, no request; null: a request with no Cookie header at all.
  it.each([
    ['no request (prerender)', undefined],
    ['a request without cookies', null],
    ['only other cookies', 'theme=dark; consent=yes'],
    ['a cookie whose name only ends like the session one', 'old_subtracker_session=abc'],
  ])('guestGuard lets the visitor in without asking the API: %s', (_case, cookieHeader) => {
    setup('server', cookieHeader);

    expectAllowed(run(guestGuard));
  });

  it.each([
    ['no request (prerender)', undefined],
    ['a request without cookies', null],
    ['only other cookies', 'theme=dark; consent=yes'],
  ])(
    'authGuard sends the visitor to /sign-in without asking the API: %s',
    (_case, cookieHeader) => {
      setup('server', cookieHeader);

      expectUrlTree(run(authGuard), '/sign-in');
    },
  );
});

describe('guards on the server with a session cookie', () => {
  const COOKIE_HEADER = 'theme=dark; subtracker_session=token-123; consent=yes';

  it.each(GUARDS)('%s forwards only the session cookie to the API', (_name, guard) => {
    setup('server', COOKIE_HEADER);

    run(guard);

    const request = expectSessionRequest();
    expect(request.request.headers.get('Cookie')).toBe('subtracker_session=token-123');
    request.flush(SIGNED_OUT);
  });

  it('guestGuard sends a signed-in visitor to /subscriptions', () => {
    setup('server', COOKIE_HEADER);
    const decision = run(guestGuard);

    expectSessionRequest().flush(SIGNED_IN);

    expectUrlTree(decision, '/subscriptions');
  });

  it('authGuard lets a signed-in visitor in', () => {
    setup('server', COOKIE_HEADER);
    const decision = run(authGuard);

    expectSessionRequest().flush(SIGNED_IN);

    expectAllowed(decision);
  });
});

// The decisions after the API call are the same in both places; only how the cookie travels differs.
describe.each<Platform>(['server', 'browser'])(
  'guards in the %s after the session check',
  (platform) => {
    // On the server the request must carry the session cookie, or the API is never asked.
    const cookieHeader = platform === 'server' ? 'subtracker_session=token-123' : undefined;

    if (platform === 'browser') {
      it.each(GUARDS)('%s leaves the Cookie header to the browser', (_name, guard) => {
        setup(platform, cookieHeader);

        run(guard);

        const request = expectSessionRequest();
        expect(request.request.headers.has('Cookie')).toBe(false);
        request.flush(SIGNED_OUT);
      });
    }

    describe('guestGuard', () => {
      it('sends a signed-in visitor to /subscriptions', () => {
        setup(platform, cookieHeader);
        const decision = run(guestGuard);

        expectSessionRequest().flush(SIGNED_IN);

        expectUrlTree(decision, '/subscriptions');
      });

      it('lets a visitor with an expired session in', () => {
        setup(platform, cookieHeader);
        const decision = run(guestGuard);

        expectSessionRequest().flush(SIGNED_OUT);

        expectAllowed(decision);
      });

      it.each([
        ['an HTTP error', failWithServerError],
        ['a network error', failWithNetworkError],
      ])('lets the visitor in after %s', (_case, fail) => {
        setup(platform, cookieHeader);
        const decision = run(guestGuard);

        fail(expectSessionRequest());

        expectAllowed(decision);
      });

      it('lets the visitor in when the API does not answer within 3 s', () => {
        vi.useFakeTimers();
        setup(platform, cookieHeader);
        const decision = run(guestGuard);
        const request = expectSessionRequest();

        vi.advanceTimersByTime(2999);
        expect(decision.value).toBeUndefined();

        vi.advanceTimersByTime(1);
        expectAllowed(decision);
        expect(request.cancelled).toBe(true);
      });
    });

    describe('authGuard', () => {
      it('lets a signed-in visitor in', () => {
        setup(platform, cookieHeader);
        const decision = run(authGuard);

        expectSessionRequest().flush(SIGNED_IN);

        expectAllowed(decision);
      });

      it('sends a visitor with an expired session to /sign-in', () => {
        setup(platform, cookieHeader);
        const decision = run(authGuard);

        expectSessionRequest().flush(SIGNED_OUT);

        expectUrlTree(decision, '/sign-in');
      });

      it.each([
        ['an HTTP error', failWithServerError],
        ['a network error', failWithNetworkError],
      ])('shows /unavailable without changing the address after %s', (_case, fail) => {
        setup(platform, cookieHeader);
        const decision = run(authGuard);

        fail(expectSessionRequest());

        expectUnavailable(decision);
      });

      it('shows /unavailable when the API does not answer within 10 s', () => {
        vi.useFakeTimers();
        setup(platform, cookieHeader);
        const decision = run(authGuard);
        const request = expectSessionRequest();

        vi.advanceTimersByTime(9999);
        expect(decision.value).toBeUndefined();

        vi.advanceTimersByTime(1);
        expectUnavailable(decision);
        expect(request.cancelled).toBe(true);
      });
    });
  },
);
