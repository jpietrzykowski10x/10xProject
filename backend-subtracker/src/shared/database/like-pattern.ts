// The escape character of the LIKE / ILIKE patterns built here. A query names it with
// `ESCAPE '\'`, so the meaning does not depend on the server default.
export const LIKE_ESCAPE = '\\';

// A user's fragment as a LIKE pattern that matches it literally anywhere in the value: `%`, `_`
// and the escape character itself lose their special meaning.
export function containsPattern(fragment: string): string {
  const literal = fragment.replace(
    /[\\%_]/g,
    (char) => `${LIKE_ESCAPE}${char}`,
  );
  return `%${literal}%`;
}
