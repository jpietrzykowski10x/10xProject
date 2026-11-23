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

// The server permanently refused this mailbox (5.1.x: bad address, unknown user), most likely a
// typo. Any other refusal, a refused sender or a temporary one points at our side or the server.
export function isRecipientTypo(error: unknown): boolean {
  const { code, command, responseCode } = smtpFieldsOf(error);
  return (
    code === 'EENVELOPE' &&
    command === 'RCPT TO' &&
    typeof responseCode === 'number' &&
    responseCode >= 500 &&
    (enhancedStatusOf(error)?.startsWith('5.1.') ?? false)
  );
}
