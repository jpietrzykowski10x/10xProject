// Reading the errors nodemailer throws: `code` (e.g. EENVELOPE), `command` (the SMTP command that
// failed), `responseCode` (its 3-digit reply code) and `response` (the server's reply as text).
export interface SmtpErrorFields {
  code?: unknown;
  command?: unknown;
  responseCode?: unknown;
  response?: unknown;
}

export function smtpFieldsOf(error: unknown): SmtpErrorFields {
  return typeof error === 'object' && error !== null ? error : {};
}

// RFC 3463: class.subject.detail right after the reply code of the first reply line.
const ENHANCED_STATUS = /^\d{3}[ -]([245]\.\d{1,3}\.\d{1,3})\b/;

// Only the status, never the rest of the reply: that can quote the address.
export function enhancedStatusOf(error: unknown): string | undefined {
  const { response } = smtpFieldsOf(error);
  if (typeof response !== 'string') {
    return undefined;
  }
  return ENHANCED_STATUS.exec(response)?.[1];
}

// RFC 3463 and RFC 7505 statuses that blame the recipient's address: bad mailbox (5.1.1), bad
// domain (5.1.2), bad syntax (5.1.3), mailbox moved (5.1.6), domain takes no mail (5.1.10). Not
// the rest of 5.1.x: 5.1.7 and 5.1.8 blame our sender and Postfix (smtpd_delay_reject) answers
// them at RCPT TO, and 5.1.0 is too vague to stay silent about.
const RECIPIENT_TYPO_STATUSES: ReadonlySet<string> = new Set([
  '5.1.1',
  '5.1.2',
  '5.1.3',
  '5.1.6',
  '5.1.10',
]);

// The server permanently refused the recipient's address, most likely a typo. Any other refusal,
// a refused sender or a temporary one points at our side or the server.
export function isRecipientTypo(error: unknown): boolean {
  const { code, command, responseCode } = smtpFieldsOf(error);
  const status = enhancedStatusOf(error);
  return (
    code === 'EENVELOPE' &&
    command === 'RCPT TO' &&
    typeof responseCode === 'number' &&
    responseCode >= 500 &&
    status !== undefined &&
    RECIPIENT_TYPO_STATUSES.has(status)
  );
}

// "code: EENVELOPE, status: 5.7.1" for a log line: never the full reply, which can quote the
// address. A missing or empty code reads as "unknown".
export function smtpFailureDetails(error: unknown): string {
  const { code } = smtpFieldsOf(error);
  const name = typeof code === 'string' && code.length > 0 ? code : 'unknown';
  const status = enhancedStatusOf(error);
  return status === undefined
    ? `code: ${name}`
    : `code: ${name}, status: ${status}`;
}
