import {
  type ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseExceptionFilter } from '@nestjs/core';
import { type EnvConfig, envFromConfig } from '../../config/env.js';
import {
  describeRequest,
  type RequestWithContext,
} from '../logging/request-context.js';

const UNKNOWN_ERROR_MESSAGE = 'Internal server error';

function describeError(exception: unknown): string {
  if (typeof exception !== 'object' || exception === null) {
    return 'Non-error value thrown';
  }
  const { message, code } = exception as { message?: unknown; code?: unknown };
  const text =
    typeof message === 'string' ? message : 'Error without a message';
  return typeof code === 'string' || typeof code === 'number'
    ? `${text} (code: ${code})`
    : text;
}

// Nest's default filter logs the whole error object: the parameters of a failed query, which hold
// e-mail addresses, or the raw body of a refused request. This one logs server errors only (an
// HttpException with a 5xx status too), as the request's method, route template, user and id plus
// the message and code, and the stack under LOG_ERROR_STACKS. Responses stay the same as the default's.
@Catch()
export class SafeLoggingExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');
  private readonly logStacks: boolean;

  constructor(config: ConfigService<EnvConfig, true>) {
    super();
    this.logStacks = envFromConfig(config).LOG_ERROR_STACKS;
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<RequestWithContext>();

    if (exception instanceof HttpException) {
      // A 5xx thrown on purpose is still a server failure; the response stays Nest's own.
      if (exception.getStatus() >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logFailure(exception, request);
      }
      super.catch(exception, host);
      return;
    }

    // Errors from middleware such as the body parser carry their own status.
    const [statusCode, message] = this.isHttpError(exception)
      ? [exception.statusCode, exception.message]
      : [HttpStatus.INTERNAL_SERVER_ERROR, UNKNOWN_ERROR_MESSAGE];
    // Like a 400 from validation, a client's mistake is not logged: anyone could grow the log.
    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logFailure(exception, request);
    }
    super.catch(new HttpException({ statusCode, message }, statusCode), host);
  }

  // `<METHOD> <route template> user=<id> req=<id>: <message> (code: X)`: which request failed and
  // for whom, without its URL, query, body or headers.
  private logFailure(exception: unknown, request: RequestWithContext): void {
    const line = `${describeRequest(request)}: ${describeError(exception)}`;
    if (this.logStacks && exception instanceof Error && exception.stack) {
      this.logger.error(line, exception.stack);
    } else {
      this.logger.error(line);
    }
  }
}
