// The case-insensitive form of a name, for uniqueness checks and lookups. Folded in the
// application with Polish rules, so the result does not depend on the database locale: with
// LC_CTYPE=C, PostgreSQL lower() folds only ASCII and would treat "Ślub" and "ślub" as two names.
// Expects a name that is already trimmed (DTOs trim on input) and changes nothing but the case.
export function toNameKey(name: string): string {
  return name.toLocaleLowerCase('pl');
}
