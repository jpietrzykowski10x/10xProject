import { QueryFailedError } from 'typeorm';

const FOREIGN_KEY_VIOLATION = '23503';

// True when the query failed on the named foreign key: a referenced row went missing (or a
// referenced row was deleted while still in use). Lets a service turn a race on a rule it checked
// beforehand into a 4xx instead of a 500.
export function isForeignKeyViolation(
  error: unknown,
  constraint: string,
): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const { code, constraint: violated } = error.driverError as {
    code?: unknown;
    constraint?: unknown;
  };
  return code === FOREIGN_KEY_VIOLATION && violated === constraint;
}
