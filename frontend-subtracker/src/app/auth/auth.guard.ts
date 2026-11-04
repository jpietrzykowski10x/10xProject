import { isPlatformServer } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, RedirectCommand, Router } from '@angular/router';
import { catchError, map, of, timeout } from 'rxjs';
import { AuthService } from './auth.service';

const GUEST_CHECK_TIMEOUT_MS = 3000;

// For pages meant for signed-out visitors. These are prerendered, so the check runs only in the
// browser. It never blocks them: when the API fails or hangs, the visitor still gets the page, and
// the timeout keeps a hanging API from delaying hydration.
export const guestGuard: CanActivateFn = () => {
  if (isPlatformServer(inject(PLATFORM_ID))) {
    return true;
  }
  const router = inject(Router);

  return inject(AuthService)
    .me()
    .pipe(
      timeout(GUEST_CHECK_TIMEOUT_MS),
      map(() => router.parseUrl('/subscriptions')),
      catchError(() => of(true)),
    );
};

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);

  return inject(AuthService)
    .me()
    .pipe(
      map(() => true),
      catchError((error: HttpErrorResponse) =>
        of(
          error.status === 401
            ? router.parseUrl('/sign-in')
            : // An API outage, e.g. during a deploy, is not a lost session. Keeping the URL means
              // refreshing the page checks the session again.
              new RedirectCommand(router.parseUrl('/unavailable'), { skipLocationChange: true }),
        ),
      ),
    );
};
