import { HttpErrorResponse } from '@angular/common/http';
import { accountBlockedContact } from './account-blocked';

const CONTACT = 'pomoc@example.com';

function failure(status: number, error: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error });
}

// The oracle is the API contract of the blocked account (backend AccountBlockedResponse): 403 with
// `code: 'account_blocked'` and the contact address. Any other error is not a block.
describe('accountBlockedContact', () => {
  it('returns the contact of a blocked account', () => {
    expect(
      accountBlockedContact(
        failure(403, {
          statusCode: 403,
          code: 'account_blocked',
          contact: CONTACT,
          message: 'Account blocked',
        }),
      ),
    ).toBe(CONTACT);
  });

  it.each([
    ['a 403 without the code (e.g. CSRF)', failure(403, { statusCode: 403, message: 'Forbidden' })],
    ['a 403 with another code', failure(403, { code: 'other', contact: CONTACT })],
    ['a 403 with a text body', failure(403, 'Forbidden')],
    ['a 403 without a body', failure(403, null)],
    ['a 400 with the code', failure(400, { code: 'account_blocked', contact: CONTACT })],
    ['a network error', failure(0, new ProgressEvent('error'))],
  ])('returns null for %s', (_case, error) => {
    expect(accountBlockedContact(error)).toBeNull();
  });
});
