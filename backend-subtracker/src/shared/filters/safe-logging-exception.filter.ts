import {
  type ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseExceptionFilter } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';
import { type EnvConfig, envFromConfig } from '../../config/env.js';
import { failureCodeOf } from '../database/failure-code.js';
import { type Denial, denialOf, formatDenial } from '../logging/denial.js';
import { safeStack } from '../logging/log-format.js';
import {
  describeRequest,
  type RequestWithContext,
} from '../logging/request-context.js';
import { FixedWindowLimiter } from '../rate-limit/fixed-window-limiter.js';

const UNKNOWN_ERROR_MESSAGE = 'Internal server error';

// At most this many denial lines per code in a window; the rest are counted and reported with the
// first line of the next window.
export const DENIAL_LOG_LIMIT = 10;
export const DENIAL_LOG_WINDOW_MS = 60_000;

// Nest 12 refuses a cross-site request in its own middleware and hands a ForbiddenException with
// one of these messages to this filter; there is no hook to learn the reason otherwise. The texts
// are copied from node_modules/@nestjs/core/security/cross-origin-protection.js (DENIED_MESSAGES);
// test/denials.e2e-spec.ts fails when an upgrade changes them.
const CSRF_SEC_FETCH_SITE_MESSAGE =
  'Cross-origin request detected from Sec-Fetch-Site header';
const CSRF_ORIGIN_MESSAGE =
  'Cross-origin request detected, and/or browser is out of date: ' +
  'Sec-Fetch-Site is missing, and Origin does not match Host';
const CSRF_CODES: Readonly<Record<string, string>> = {
  [CSRF_SEC_FETCH_SITE_MESSAGE]: 'csrf_sec_fetch_site',
  [CSRF_ORIGIN_MESSAGE]: 'csrf_origin',
};
const MAX_ORIGIN_LENGTH = 100;

// The message and code of a failure; for a failed query only its code, since its message can
// quote the parameters of the query. Other messages stay, on one line: some span several (e.g.
// TypeORM's EntityNotFoundError quotes its criteria as indented JSON).
function describeError(exception: unknown): string {
  if (typeof exception !== 'object' || exception === null) {
    return 'Non-error value thrown';
  }
  if (exception instanceof QueryFailedError) {
    return `QueryFailedError (code: ${failureCodeOf(exception)})`;
  }
  const { message, code } = exception as { message?: unknown; code?: unknown };
  const text =
    typeof message === 'string'
      ? message.replace(/\s+/g, ' ').trim()
      : 'Error without a message';
  return typeof code === 'string' || typeof code === 'number'
    ? `${text} (code: ${code})`
    : text;
}

// `scheme://host[:port]` of the Origin header in lower case, cut to 100 characters; `invalid` when
// it is not a URL with an origin, `none` when the header is missing. The site's name only: it tells
// a wrong CORS_ORIGINS apart from a foreign site.
function originOf(request: RequestWithContext | undefined): string {
  const header: unknown = request?.headers?.origin;
  if (typeof header !== 'string' || header === '') {
    return 'none';
  }
  try {
    const { origin } = new URL(header);
    return origin === 'null'
      ? 'invalid'
      : origin.toLowerCase().slice(0, MAX_ORIGIN_LENGTH);
  } catch {
    return 'invalid';
  }
}

function csrfDenial(
  exception: HttpException,
  request: RequestWithContext | undefined,
): Denial | undefined {
  if (exception.getStatus() !== HttpStatus.FORBIDDEN) {
    return undefined;
  }
  const code = Object.hasOwn(CSRF_CODES, exception.message)
    ? CSRF_CODES[exception.message]
    : undefined;
  return code === undefined
    ? undefined
    : { code, ids: { origin: originOf(request) } };
}

// Nest's default filter logs the whole error object: the parameters of a failed query, which hold
// e-mail addresses, or the raw body of a refused request. This one logs server errors only (an
// HttpException with a 5xx status too), as the request's method, route template, user and id plus
// the message and code (only the code of a failed query), and the stack under LOG_ERROR_STACKS. A client error is logged only when it
// carries a denial (withDenial) or is a CSRF refusal: one `warn` line in the `Denials` context, at
// most DENIAL_LOG_LIMIT per code a minute. Responses stay the same as the default's.
@Catch()
export class SafeLoggingExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');
  private readonly denialLogger = new Logger('Denials');
  private readonly denialLimiter = new FixedWindowLimiter({
    limit: DENIAL_LOG_LIMIT,
    windowMs: DENIAL_LOG_WINDOW_MS,
  });
  private readonly logStacks: boolean;

  constructor(config: ConfigService<EnvConfig, true>) {
    super();
    this.logStacks = envFromConfig(config).LOG_ERROR_STACKS;
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    // Only HTTP is served today; another context (e.g. a future gateway) gets lines without a request.
    const request =
      host.getType() === 'http'
        ? host.switchToHttp().getRequest<RequestWithContext>()
        : undefined;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // A 5xx thrown on purpose is still a server failure; the response stays Nest's own.
      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logFailure(exception, request);
      } else {
        this.logDenial(
          denialOf(exception) ?? csrfDenial(exception, request),
          status,
          request,
        );
      }
      super.catch(exception, host);
      return;
    }

    // Errors from middleware such as the body parser carry their own status.
    const [statusCode, message] = this.isHttpError(exception)
      ? [exception.statusCode, exception.message]
      : [HttpStatus.INTERNAL_SERVER_ERROR, UNKNOWN_ERROR_MESSAGE];
    // Like a 400 from validation, a client's mistake is not logged unless it carries a denial:
    // anyone could grow the log. The denial is read from the original error, before it is replaced.
    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logFailure(exception, request);
    } else {
      this.logDenial(denialOf(exception), statusCode, request);
    }
    super.catch(new HttpException({ statusCode, message }, statusCode), host);
  }

  // `<METHOD> <route template> user=<id> req=<id>: <message> (code: X)`: which request failed and
  // for whom, without its URL, query, body or headers.
  private logFailure(
    exception: unknown,
    request: RequestWithContext | undefined,
  ): void {
    const line = `${describeRequest(request)}: ${describeError(exception)}`;
    if (this.logStacks && exception instanceof Error && exception.stack) {
      this.logger.error(line, safeStack(exception.stack));
    } else {
      this.logger.error(line);
    }
  }

  private logDenial(
    denial: Denial | undefined,
    status: number,
    request: RequestWithContext | undefined,
  ): void {
    if (denial === undefined) {
      return;
    }
    const { allowed, suppressedInPreviousWindow } = this.denialLimiter.take(
      denial.code,
      Date.now(),
    );
    if (!allowed) {
      return;
    }
    const line = formatDenial(denial, status, describeRequest(request));
    this.denialLogger.warn(
      suppressedInPreviousWindow > 0
        ? `${line} (suppressed ${suppressedInPreviousWindow} in the previous window)`
        : line,
    );
  }
}
