import { isPlatformServer } from '@angular/common';
import { inject, PLATFORM_ID, REQUEST } from '@angular/core';
import { CanActivateFn, RedirectCommand, Router } from '@angular/router';
import { catchError, map, of, timeout } from 'rxjs';
import { AuthService } from './auth.service';

// On client-rendered routes the page stays blank until the guard finishes. The start page (/) is
// rendered on the server, where guestGuard checks the session before any HTML is sent.
const GUEST_CHECK_TIMEOUT_MS = 3000;
const SESSION_COOKIE_NAME = 'subtracker_session';
const AUTH_CHECK_TIMEOUT_MS = 10000;

// For pages meant for signed-out visitors. It never blocks them: when the API fails or hangs, the
// visitor still gets the page.
export const guestGuard: CanActivateFn = () => {
  const router = inject(Router);
  let cookie: string | undefined;

  // On the server the guard sees the visitor's request: without a session cookie it lets the guest
  // through without asking the API; with one it forwards the cookie, so a signed-in visitor gets a
  // redirect instead of the start page flashing before the browser-side check. Prerendering at
  // build time has no request at all and renders the guest page.
  if (isPlatformServer(inject(PLATFORM_ID))) {
    cookie = inject(REQUEST)?.headers.get('cookie') ?? undefined;
    if (!cookie?.includes(`${SESSION_COOKIE_NAME}=`)) {
      return true;
    }
  }

  return inject(AuthService)
    .session(cookie)
    .pipe(
      timeout(GUEST_CHECK_TIMEOUT_MS),
      map((user) => (user === null ? true : router.parseUrl('/subscriptions'))),
      catchError(() => of(true)),
    );
};

export const authGuard: CanActivateFn = () => {
  // Protected routes are client-rendered, so on the server this guard only runs after guestGuard has
  // confirmed the session and redirected from /. Checking again here, without the visitor's cookie,
  // would send the render to /sign-in and loop back through guestGuard.
  if (isPlatformServer(inject(PLATFORM_ID))) {
    return true;
  }

  const router = inject(Router);

  return inject(AuthService)
    .session()
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
