// Codes of the `warn` lines (SafeLoggingExceptionFilter) for a refused sign-in link or session.
// The client never sees them: it gets the same 401 (or 403 account_blocked) for each.

export const LinkDenial = {
  // No row with this hash, which includes a link replaced by a newer one (issueLink deletes it).
  UNKNOWN: 'link_unknown',
  // Already used; checked before expiry, so a used and expired link is `link_used`.
  USED: 'link_used',
  EXPIRED: 'link_expired',
  // The token's account disappeared between the lookup and the lock.
  USER_MISSING: 'link_user_missing',
  ACCOUNT_BLOCKED: 'link_account_blocked',
  // Raised in two places: a parallel request used the token up after the lookup (consumed.affected
  // !== 1, with `token` and `account`), or the second read in refusedLink finds it unused and live
  // again (it changed between the reads; `token` only, the owner is not read there).
  RACE: 'link_race',
} as const;

export type LinkDenial = (typeof LinkDenial)[keyof typeof LinkDenial];

// Why SessionService.check refused the request's cookie, in the order it checks.
export type SessionRejection =
  | 'session_missing'
  | 'session_unknown'
  | 'session_revoked'
  | 'session_expired'
  | 'session_inactive';
