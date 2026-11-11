import { isPlatformServer } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, RedirectCommand, Router } from '@angular/router';
import { catchError, map, of, timeout } from 'rxjs';
import { AuthService } from './auth.service';

// On client-rendered routes the page stays blank until the guard finishes. The prerendered start
// page (/) is the exception: its HTML is visible while guestGuard waits.
const GUEST_CHECK_TIMEOUT_MS = 3000;
const AUTH_CHECK_TIMEOUT_MS = 10000;

// For pages meant for signed-out visitors. It never blocks them: when the API fails or hangs, the
// visitor still gets the page.
export const guestGuard: CanActivateFn = () => {
  // Prerendering at build time has no visitor, session or API, so it renders the guest page. In the
  // browser the guard runs again after start-up and sends a signed-in visitor to /subscriptions.
  if (isPlatformServer(inject(PLATFORM_ID))) {
    return true;
  }

  const router = inject(Router);

  return inject(AuthService)
    .session()
    .pipe(
      timeout(GUEST_CHECK_TIMEOUT_MS),
      map((user) => (user === null ? true : router.parseUrl('/subscriptions'))),
      catchError(() => of(true)),
    );
};

export const authGuard: CanActivateFn = () => {
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
