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
