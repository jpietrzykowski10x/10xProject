export enum MailType {
  MAGIC_LINK = 'MAGIC_LINK',
  OPERATOR_ALERT = 'OPERATOR_ALERT',
}

export enum MailStatus {
  SENT = 'SENT',
  FAILED = 'FAILED',
}

// Mail addressed to users; operator alerts go only through notifyOperator.
export type UserMailType = Exclude<MailType, MailType.OPERATOR_ALERT>;

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
