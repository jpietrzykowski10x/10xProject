import type { HttpException } from '@nestjs/common';

// Why a request was refused, for one `warn` line of the exception filter. The module that knows
// the reason sets its own code; `shared/` knows none of them.
export interface Denial {
  // e.g. `role_missing`.
  code: string;
  // Only ids (uuid) and words from a closed set (e.g. action=block, why=rank), never data sent by
  // the client; the one exception is the origin of a CSRF refusal, set by the filter.
  ids?: Readonly<Record<string, string>>;
  // Names of the refused fields, never their values.
  fields?: readonly string[];
}

const DENIAL = Symbol('denial');

type MarkedException = HttpException & { [DENIAL]?: Denial };

// Marks the exception with the reason and returns the same object. The mark is a symbol property,
// so the response body and status stay what they were.
export function withDenial<T extends HttpException>(
  exception: T,
  denial: Denial,
): T {
  Object.defineProperty(exception, DENIAL, {
    value: denial,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return exception;
}

export function denialOf(exception: unknown): Denial | undefined {
  if (typeof exception !== 'object' || exception === null) {
    return undefined;
  }
  return (exception as MarkedException)[DENIAL];
}

// A barrier against a future mistake: whatever slips into a denial, the line keeps only these
// characters and shows the rest as `?`.
const NOT_CODE = /[^a-z_]/g;
// `_` for words such as action=reset_sessions.
const NOT_ID_VALUE = /[^0-9a-z_.:/-]/g;
const NOT_FIELD = /[^a-zA-Z0-9_.]/g;

const clean = (text: string, disallowed: RegExp) =>
  text.replace(disallowed, '?');

// `<code> <status> <request description> [<key>=<value> …] [fields=a,b]`, e.g.
// `role_missing 403 GET /admin/users user=<uuid> req=<uuid> actor=<uuid>`.
export function formatDenial(
  denial: Denial,
  status: number,
  requestDescription: string,
): string {
  const parts = [
    clean(denial.code, NOT_CODE),
    String(status),
    requestDescription,
  ];
  for (const [key, value] of Object.entries(denial.ids ?? {})) {
    parts.push(`${clean(key, NOT_CODE)}=${clean(value, NOT_ID_VALUE)}`);
  }
  if (denial.fields !== undefined && denial.fields.length > 0) {
    parts.push(
      `fields=${denial.fields.map((field) => clean(field, NOT_FIELD)).join(',')}`,
    );
  }
  return parts.join(' ');
}
