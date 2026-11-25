import { DOCUMENT, isPlatformServer } from '@angular/common';
import { inject, PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { NavigationError, RedirectCommand, Router } from '@angular/router';
import { isChunkLoadError, shouldReload } from './shared/chunk-reload';
import { ErrorReporter } from './shared/error-reporter';

// The router's handler of a navigation that threw (a guard, a resolver, a lazy import), given to
// provideRouter through withNavigationErrorHandler; it runs in an injection context.
//
// On the server the error is recorded in the SSR log, the response gets status 500 and the page
// becomes /unavailable with the requested address kept. Without this, @angular/ssr answers null
// for a failed navigation and Express sends its "Cannot GET" 404. RESPONSE_INIT is the response
// of the request being rendered; prerendering at build time has none (null).
//
// In the browser a lazy import that failed is a file gone after a deploy (chunk-reload.ts): the
// page is loaded again at the target address, at most once per address per 60 s. A failure within
// that window is reported and shows /unavailable with the address kept, so nothing loops. Any
// other error is left alone: a value other than RedirectCommand makes the router rethrow it, and
// it reaches the default ErrorHandler (console.error) as before.
export function handleNavigationError(error: NavigationError): RedirectCommand | false | void {
  if (!isPlatformServer(inject(PLATFORM_ID))) {
    return handleInBrowser(error);
  }

  inject(ErrorReporter).report('Navigation', error.error);
  const response = inject(RESPONSE_INIT, { optional: true });
  if (response !== null) {
    response.status = 500;
  }
  return unavailable();
}

function handleInBrowser(error: NavigationError): RedirectCommand | false | void {
  if (!isChunkLoadError(error.error)) {
    return;
  }
  const document = inject(DOCUMENT);
  // shouldReload writes its marker before the reload starts; without a storage it says no.
  if (shouldReload(sessionStorageOrNull(document), error.url, Date.now())) {
    // error.url is the serialized target ("/register?x=1"), resolved against the page's address.
    // The router still rethrows the error (one console line) while the new page loads.
    document.location.assign(error.url);
    return false;
  }
  inject(ErrorReporter).report('ChunkLoad', error.error);
  return unavailable();
}

// Reading sessionStorage throws when the browser blocks site data.
function sessionStorageOrNull(document: Document): Storage | null {
  try {
    return document.defaultView?.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function unavailable(): RedirectCommand {
  const router = inject(Router);
  return new RedirectCommand(router.parseUrl('/unavailable'), { skipLocationChange: true });
}
