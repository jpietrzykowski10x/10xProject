import { inject } from '@angular/core';
import { CanActivateFn, RedirectCommand, Router } from '@angular/router';
import { catchError, map, of, timeout } from 'rxjs';
import { AuthService } from './auth.service';

// Both guards run on client-rendered routes, so the page stays blank until they finish.
const GUEST_CHECK_TIMEOUT_MS = 3000;
const AUTH_CHECK_TIMEOUT_MS = 10000;

// For pages meant for signed-out visitors. It never blocks them: when the API fails or hangs, the
// visitor still gets the page.
export const guestGuard: CanActivateFn = () => {
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
