import { isPlatformServer } from '@angular/common';
import { inject, PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { NavigationError, RedirectCommand, Router } from '@angular/router';
import { ErrorReporter } from './shared/error-reporter';

// The router's handler of a navigation that threw (a guard, a resolver, a lazy import), given to
// provideRouter through withNavigationErrorHandler; it runs in an injection context.
//
// On the server the error is recorded in the SSR log, the response gets status 500 and the page
// becomes /unavailable with the requested address kept. Without this, @angular/ssr answers null
// for a failed navigation and Express sends its "Cannot GET" 404. RESPONSE_INIT is the response
// of the request being rendered; prerendering at build time has none (null).
//
// In the browser nothing yet: returning nothing makes the router rethrow the error, which reaches
// the default ErrorHandler (console.error) as before.
export function handleNavigationError(error: NavigationError): RedirectCommand | void {
  if (!isPlatformServer(inject(PLATFORM_ID))) {
    return;
  }

  inject(ErrorReporter).report('Navigation', error.error);
  const response = inject(RESPONSE_INIT, { optional: true });
  if (response !== null) {
    response.status = 500;
  }
  const router = inject(Router);
  return new RedirectCommand(router.parseUrl('/unavailable'), { skipLocationChange: true });
}
