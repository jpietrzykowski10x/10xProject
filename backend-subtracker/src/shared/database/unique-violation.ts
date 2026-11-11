import { QueryFailedError } from 'typeorm';

const UNIQUE_VIOLATION = '23505';

// True when the query failed on the named unique constraint or index. Lets a service turn a
// race on a uniqueness rule it checked beforehand into a 409 instead of a 500.
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const { code, constraint: violated } = error.driverError as {
    code?: unknown;
    constraint?: unknown;
  };
  return code === UNIQUE_VIOLATION && violated === constraint;
}
