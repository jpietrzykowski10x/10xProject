import {
  HttpException,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common';
import { type Denial, withDenial } from '../logging/denial.js';

// Code of the `warn` line for a body refused by validation (SafeLoggingExceptionFilter).
export const VALIDATION_DENIAL = 'validation';

// The constraint class-validator reports for a property the DTO does not declare
// (forbidNonWhitelisted).
const WHITELIST_CONSTRAINT = 'whitelistValidation';

// A property outside the DTO is a JSON key chosen by the client, so it may hold an address or any
// text. Only a name shaped like an identifier goes into the log; the rest are only counted.
const IDENTIFIER_SHAPE = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;

// A body with hundreds of unknown keys must not make one huge line: the first names (sorted) are
// enough to see the mismatch, the rest are counted in `ids.more`.
export const MAX_LOGGED_FIELDS = 20;

// `fields`: the paths of the refused properties (nested ones joined with dots), without values or
// constraint texts, unique and sorted; `ids.unknown`: how many properties outside the DTO were left
// out of `fields` because of their shape; `ids.more`: how many fields beyond MAX_LOGGED_FIELDS were cut.
export function validationDenial(errors: readonly ValidationError[]): Denial {
  const fields = new Set<string>();
  let unknown = 0;

  const visit = (error: ValidationError, parentPath: string) => {
    const path =
      parentPath === '' ? error.property : `${parentPath}.${error.property}`;
    const constraints = Object.keys(error.constraints ?? {});
    if (constraints.includes(WHITELIST_CONSTRAINT)) {
      if (IDENTIFIER_SHAPE.test(error.property)) {
        fields.add(path);
      } else {
        unknown += 1;
      }
    } else if (constraints.length > 0) {
      fields.add(path);
    }
    for (const child of error.children ?? []) {
      visit(child, path);
    }
  };
  for (const error of errors) {
    visit(error, '');
  }

  const sorted = [...fields].sort();
  const more = sorted.length - MAX_LOGGED_FIELDS;
  const ids = {
    ...(unknown > 0 ? { unknown: String(unknown) } : {}),
    ...(more > 0 ? { more: String(more) } : {}),
  };
  return {
    code: VALIDATION_DENIAL,
    fields: sorted.slice(0, MAX_LOGGED_FIELDS),
    ...(Object.keys(ids).length > 0 ? { ids } : {}),
  };
}

// The global ValidationPipe whose 400 carries a `validation` denial for the log. The exception
// itself, and so the response body, is the one the default factory makes.
export class LoggingValidationPipe extends ValidationPipe {
  override createExceptionFactory(): (
    validationErrors?: ValidationError[],
  ) => unknown {
    const factory = super.createExceptionFactory();
    return (validationErrors: ValidationError[] = []) => {
      const exception = factory(validationErrors);
      return exception instanceof HttpException
        ? withDenial(exception, validationDenial(validationErrors))
        : exception;
    };
  }
}
