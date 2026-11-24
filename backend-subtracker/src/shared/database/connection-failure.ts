import { failureCodeOf } from './failure-code.js';

// Server shutdown or "not accepting connections yet" (SQLSTATE class 57P) and socket errors of the
// driver: the database is gone, not one row's data.
const CONNECTION_CODES = new Set([
  '57P01',
  '57P02',
  '57P03',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
]);

// Whether an error means the database connection failed (SQLSTATE class 08 or the codes above), so
// a loop over rows should stop instead of failing every remaining row the same way.
export function isConnectionFailure(error: unknown): boolean {
  const code = failureCodeOf(error);
  return code.startsWith('08') || CONNECTION_CODES.has(code);
}
