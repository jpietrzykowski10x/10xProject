import { HttpErrorResponse } from '@angular/common/http';

// Must match ACCOUNT_BLOCKED_CODE in backend-subtracker/src/auth/account-blocked.exception.ts.
export const ACCOUNT_BLOCKED_CODE = 'account_blocked';

// The sign-in routes (register, request-link, verify) answer a blocked account with 403 and
// `{ code: 'account_blocked', contact }`. Any other 403 (e.g. a refused CSRF check) is not a block.
// Returns the contact address to show, or null when the error is something else.
export function accountBlockedContact(error: HttpErrorResponse): string | null {
  if (error.status !== 403) {
    return null;
  }
  const body: unknown = error.error;
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const { code, contact } = body as { code?: unknown; contact?: unknown };
  if (code !== ACCOUNT_BLOCKED_CODE) {
    return null;
  }
  return typeof contact === 'string' ? contact : '';
}
