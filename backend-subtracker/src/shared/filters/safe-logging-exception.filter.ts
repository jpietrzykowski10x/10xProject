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
// e-mail addresses, or the raw body of a refused request. This one logs the message and code, plus
// the stack under LOG_ERROR_STACKS. Responses stay the same as the default's.
@Catch()
export class SafeLoggingExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');
  private readonly logStacks: boolean;

  constructor(config: ConfigService<EnvConfig, true>) {
    super();
    this.logStacks = envFromConfig(config).LOG_ERROR_STACKS;
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException) {
      super.catch(exception, host);
      return;
    }

    if (this.logStacks && exception instanceof Error && exception.stack) {
      this.logger.error(describeError(exception), exception.stack);
    } else {
      this.logger.error(describeError(exception));
    }
    // Errors from middleware such as the body parser carry their own status.
    const [statusCode, message] = this.isHttpError(exception)
      ? [exception.statusCode, exception.message]
      : [HttpStatus.INTERNAL_SERVER_ERROR, UNKNOWN_ERROR_MESSAGE];
    super.catch(new HttpException({ statusCode, message }, statusCode), host);
  }
}
