import { QueryFailedError } from 'typeorm';

// A short, safe description of a failure for logs, alerts and the job register: the database
// error code (e.g. 57014) or the error's own `code` when it has one, else the error class. Never
// the message, which can quote the data of the query.
export function failureCodeOf(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'unknown';
  }
  if (error instanceof QueryFailedError) {
    const { code } = error.driverError as { code?: unknown };
    if (typeof code === 'string') {
      return code;
    }
  }
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : error.name;
}
