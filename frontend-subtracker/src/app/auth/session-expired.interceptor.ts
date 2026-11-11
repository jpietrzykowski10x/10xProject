import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';

// A 401 from the API outside /auth means the session ended while a page was open (expired, or
// signed out on another tab): authGuard only runs on navigation, so without this the page would
// show "service unavailable" forever. /auth is skipped: there a 401 is an expected answer (an
// invalid sign-in link) and /auth/session returns 200 for a signed-out visitor.
// The error is still passed on, so the caller's own state (e.g. "sending") is reset.
export const sessionExpiredInterceptor: HttpInterceptorFn = (request, next) => {
  const router = inject(Router);
  const isGuardedApiRequest =
    request.url.startsWith(`${environment.apiUrl}/`) &&
    !request.url.startsWith(`${environment.apiUrl}/auth/`);

  return next(request).pipe(
    catchError((error: unknown) => {
      if (isGuardedApiRequest && error instanceof HttpErrorResponse && error.status === 401) {
        void router.navigateByUrl('/sign-in');
      }
      return throwError(() => error);
    }),
  );
};
