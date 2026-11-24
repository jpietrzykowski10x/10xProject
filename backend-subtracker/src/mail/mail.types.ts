export enum MailType {
  MAGIC_LINK = 'MAGIC_LINK',
  TRIAL_REMINDER = 'TRIAL_REMINDER',
  OPERATOR_ALERT = 'OPERATOR_ALERT',
  ACCOUNT_BLOCKED = 'ACCOUNT_BLOCKED',
  ACCOUNT_UNBLOCKED = 'ACCOUNT_UNBLOCKED',
  SESSIONS_RESET = 'SESSIONS_RESET',
}

// Replaces the address of a deleted account in the mail archive: a valid address in the reserved
// .invalid domain, so it fits `recipient` and passes any address format check.
export const ANONYMIZED_RECIPIENT = 'zanonimizowano@anonymized.invalid';

export enum MailStatus {
  SENT = 'SENT',
  FAILED = 'FAILED',
}

// Mail addressed to users; operator alerts go only through notifyOperator.
export type UserMailType = Exclude<MailType, MailType.OPERATOR_ALERT>;

// Mail about the access to the account itself: the only user mail a blocked account still gets.
export const ACCOUNT_ACCESS_MAIL_TYPES: readonly UserMailType[] = [
  MailType.ACCOUNT_BLOCKED,
  MailType.ACCOUNT_UNBLOCKED,
  MailType.SESSIONS_RESET,
];

// What became of a user mail. Only `sent` means the transport accepted it:
// - no_account: no account with the address, nothing sent or audited;
// - blocked: the account is blocked and the type is not about the access to it, nothing sent;
// - lookup_failed: the account could not be checked, nothing sent, a FAILED row and an alert;
// - send_failed: the transport refused it, a FAILED row and an alert;
// - recipient_typo: the server refused the address itself, a FAILED row without an alert.
export type MailOutcome =
  | 'sent'
  | 'no_account'
  | 'blocked'
  | 'lookup_failed'
  | 'send_failed'
  | 'recipient_typo';

// For callers that only need to know whether the mail went out.
export function isDelivered(outcome: MailOutcome): outcome is 'sent' {
  return outcome === 'sent';
}

export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

export type MailChannel = 'user' | 'operator';

export interface MailMessage extends MailContent {
  channel: MailChannel;
  to: string;
}
