import { ForbiddenException, HttpStatus } from '@nestjs/common';

// Lets the frontend tell a blocked account apart from other 403s, e.g. a refused CSRF check.
export const ACCOUNT_BLOCKED_CODE = 'account_blocked';

export interface AccountBlockedResponse {
  statusCode: HttpStatus.FORBIDDEN;
  code: typeof ACCOUNT_BLOCKED_CODE;
  // SUPPORT_EMAIL: where the account's owner can ask about the block.
  contact: string;
  message: 'Account blocked';
}

// The one answer of the sign-in routes that differs by account: an administrator's decision the
// owner has to learn about, so it is not hidden behind the neutral 202.
export class AccountBlockedException extends ForbiddenException {
  constructor(contact: string) {
    const body: AccountBlockedResponse = {
      statusCode: HttpStatus.FORBIDDEN,
      code: ACCOUNT_BLOCKED_CODE,
      contact,
      message: 'Account blocked',
    };
    super(body);
  }
}
