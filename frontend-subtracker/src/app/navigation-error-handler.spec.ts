import { PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationError, provideRouter, RedirectCommand, Router } from '@angular/router';
import { handleNavigationError } from './navigation-error-handler';
import { ErrorReporter } from './shared/error-reporter';

// The oracle is the plan's contract: on the server a failed navigation is reported, the response
// gets 500 and the page becomes /unavailable with the address kept; in the browser (until phase 3)
// the handler returns nothing, so the router rethrows the error as before.

const CAUSE = new Error('guard failed');
const NAVIGATION_ERROR = new NavigationError(1, '/e2e/navigation-error', CAUSE);

function setUp(platform: 'server' | 'browser', response: ResponseInit | null): ErrorReporter {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PLATFORM_ID, useValue: platform },
      { provide: RESPONSE_INIT, useValue: response },
    ],
  });
  return TestBed.inject(ErrorReporter);
}

function handle(): RedirectCommand | void {
  return TestBed.runInInjectionContext(() => handleNavigationError(NAVIGATION_ERROR));
}

describe('on the server', () => {
  it('reports the cause, sets status 500 and shows /unavailable without changing the address', () => {
    const response: ResponseInit = { status: 200 };
    const report = vi.spyOn(setUp('server', response), 'report').mockImplementation(() => {});

    const result = handle();

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('Navigation', CAUSE);
    expect(response.status).toBe(500);
    expect(result).toBeInstanceOf(RedirectCommand);
    const command = result as RedirectCommand;
    expect(TestBed.inject(Router).serializeUrl(command.redirectTo)).toBe('/unavailable');
    expect(command.navigationBehaviorOptions).toEqual({ skipLocationChange: true });
  });

  it('still redirects without a response (prerendering at build time)', () => {
    const report = vi.spyOn(setUp('server', null), 'report').mockImplementation(() => {});

    expect(handle()).toBeInstanceOf(RedirectCommand);
    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe('in the browser', () => {
  it('returns nothing and reports nothing, so the router rethrows the error', () => {
    const report = vi.spyOn(setUp('browser', null), 'report').mockImplementation(() => {});

    expect(handle()).toBeUndefined();
    expect(report).not.toHaveBeenCalled();
  });
});
