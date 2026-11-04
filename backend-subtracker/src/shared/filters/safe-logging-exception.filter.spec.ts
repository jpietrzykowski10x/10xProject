import {
  type ArgumentsHost,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { type EnvConfig, validateEnv } from '../../config/env.js';
import { SafeLoggingExceptionFilter } from './safe-logging-exception.filter.js';

const ADDRESS = 'ktos@example.com';

function configStub(logStacks: boolean) {
  const env = validateEnv({
    MODE: 'DEV',
    POSTGRES_HOST: 'localhost',
    POSTGRES_USER: 'subtracker-adm',
    POSTGRES_PASSWORD: 'secret',
    POSTGRES_DATABASE: 'subtracker-db',
    POSTGRES_DATABASE_DEV: 'subtracker-db-dev',
    CORS_ORIGINS: 'http://localhost:4200',
    LOG_ERROR_STACKS: String(logStacks),
  });
  return {
    get: (key: keyof EnvConfig) => env[key],
  } as unknown as ConfigService<EnvConfig, true>;
}

function queryFailure(): Error {
  return Object.assign(new Error('value too long'), {
    code: '22001',
    query: 'INSERT INTO "user"',
    parameters: [ADDRESS],
  });
}

describe('SafeLoggingExceptionFilter', () => {
  const response = {};
  const host = { getArgByIndex: () => response } as unknown as ArgumentsHost;
  const reply = vi.fn();
  let logged: ReturnType<typeof vi.spyOn>;

  function createFilter(logStacks: boolean): SafeLoggingExceptionFilter {
    return Object.assign(
      new SafeLoggingExceptionFilter(configStub(logStacks)),
      {
        httpAdapterHost: { httpAdapter: { reply, isHeadersSent: () => false } },
      },
    );
  }

  beforeEach(() => {
    reply.mockReset();
    logged = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the message, code and stack of a failed query but not its parameters', () => {
    const failure = queryFailure();

    createFilter(true).catch(failure, host);

    expect(logged.mock.calls).toEqual([
      ['value too long (code: 22001)', failure.stack],
    ]);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(ADDRESS);
    expect(reply).toHaveBeenCalledWith(
      response,
      { statusCode: 500, message: 'Internal server error' },
      500,
    );
  });

  it('leaves the stack out when LOG_ERROR_STACKS is off', () => {
    createFilter(false).catch(queryFailure(), host);

    expect(logged.mock.calls).toEqual([['value too long (code: 22001)']]);
    expect(reply).toHaveBeenCalledWith(
      response,
      { statusCode: 500, message: 'Internal server error' },
      500,
    );
  });

  it('keeps the status of a middleware error but not its raw body in the log', () => {
    const failure = Object.assign(new Error('request entity too large'), {
      expose: true,
      statusCode: 413,
      status: 413,
      body: ADDRESS,
    });

    createFilter(true).catch(failure, host);

    expect(JSON.stringify(logged.mock.calls)).not.toContain(ADDRESS);
    expect(reply).toHaveBeenCalledWith(
      response,
      { statusCode: 413, message: 'request entity too large' },
      413,
    );
  });

  it('passes an HttpException through without logging it', () => {
    createFilter(true).catch(new BadRequestException('zly adres'), host);

    expect(logged).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({ statusCode: 400, message: 'zly adres' }),
      400,
    );
  });

  it('handles a thrown value that is not an error', () => {
    createFilter(true).catch('awaria', host);

    expect(logged.mock.calls).toEqual([['Non-error value thrown']]);
    expect(reply).toHaveBeenCalledWith(
      response,
      { statusCode: 500, message: 'Internal server error' },
      500,
    );
  });
});
