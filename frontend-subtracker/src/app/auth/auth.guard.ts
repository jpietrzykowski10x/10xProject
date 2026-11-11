import { isPlatformServer } from '@angular/common';
import { inject, PLATFORM_ID, REQUEST } from '@angular/core';
import { CanActivateFn, RedirectCommand, Router } from '@angular/router';
import { catchError, map, of, timeout } from 'rxjs';
import { AuthService } from './auth.service';

// On client-rendered routes the page stays blank until the guard finishes. The start page (/) is
// rendered on the server, where guestGuard checks the session before any HTML is sent.
const GUEST_CHECK_TIMEOUT_MS = 3000;
const AUTH_CHECK_TIMEOUT_MS = 10000;
// Must match SESSION_COOKIE_NAME in backend-subtracker/src/auth/auth.constants.ts.
const SESSION_COOKIE_NAME = 'subtracker_session';

type SessionCookie = { onServer: false } | { onServer: true; cookie: string | null };

// In the browser the session cookie travels with the request by itself. On the server the guard
// has to forward it: only the session pair, not the visitor's whole Cookie header. Prerendering at
// build time has no request, so there is no cookie.
function sessionCookie(): SessionCookie {
  if (!isPlatformServer(inject(PLATFORM_ID))) {
    return { onServer: false };
  }
  const header = inject(REQUEST)?.headers.get('cookie') ?? '';
  const pair = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  return { onServer: true, cookie: pair ?? null };
}

// For pages meant for signed-out visitors. It never blocks them: when the API fails or hangs, the
// visitor still gets the page.
export const guestGuard: CanActivateFn = () => {
  const router = inject(Router);
  const session = sessionCookie();

  // On the server a visitor without a session cookie is a guest, so the API is not asked. With a
  // cookie, a signed-in visitor gets a redirect before any HTML is sent, instead of the start page
  // flashing before the browser-side check.
  if (session.onServer && session.cookie === null) {
    return true;
  }

  return inject(AuthService)
    .session(session.onServer ? (session.cookie ?? undefined) : undefined)
    .pipe(
      timeout(GUEST_CHECK_TIMEOUT_MS),
      map((user) => (user === null ? true : router.parseUrl('/subscriptions'))),
      catchError(() => of(true)),
    );
};

// For pages that need a signed-in user. Protected routes are client-rendered; on the server this
// guard runs only after guestGuard redirected a signed-in visitor from /, and it checks the same
// forwarded cookie. A protected route left out of app.routes.server.ts would be prerendered: there
// is no request then, so the guard sends the build to /sign-in instead of shipping the page.
export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const session = sessionCookie();

  if (session.onServer && session.cookie === null) {
    return router.parseUrl('/sign-in');
  }

  return inject(AuthService)
    .session(session.onServer ? (session.cookie ?? undefined) : undefined)
    .pipe(
      timeout(AUTH_CHECK_TIMEOUT_MS),
      map((user) => (user === null ? router.parseUrl('/sign-in') : true)),
      // An API outage, e.g. during a deploy, is not a lost session. Keeping the URL means
      // refreshing the page checks the session again.
      catchError(() =>
        of(new RedirectCommand(router.parseUrl('/unavailable'), { skipLocationChange: true })),
      ),
    );
};
