import {
  type ArgumentsHost,
  BadRequestException,
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { type EnvConfig, validateEnv } from '../../config/env.js';
import type { RequestWithContext } from '../logging/request-context.js';
import { SafeLoggingExceptionFilter } from './safe-logging-exception.filter.js';

const ADDRESS = 'ktos@example.com';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const SUBSCRIPTION_ID = '33333333-3333-4333-8333-333333333333';
// What every line logged for `request` below starts with.
const CONTEXT = `PUT /subscriptions/:id user=${USER_ID} req=${REQUEST_ID}`;

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

// A routed request of a signed-in user whose URL carries the id and an address in the query.
function routedRequest(): RequestWithContext {
  return {
    method: 'PUT',
    originalUrl: `/subscriptions/${SUBSCRIPTION_ID}?email=${ADDRESS}`,
    url: `/subscriptions/${SUBSCRIPTION_ID}?email=${ADDRESS}`,
    route: { path: '/subscriptions/:id' },
    user: { id: USER_ID, email: ADDRESS, roles: [] },
    requestId: REQUEST_ID,
  } as unknown as RequestWithContext;
}

function hostFor(request: RequestWithContext, response: object): ArgumentsHost {
  return {
    getArgByIndex: () => response,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
}

describe('SafeLoggingExceptionFilter', () => {
  const response = {};
  const host = hostFor(routedRequest(), response);
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

  it('logs the request context, message, code and stack of a failed query but not its parameters', () => {
    const failure = queryFailure();

    createFilter(true).catch(failure, host);

    expect(logged.mock.calls).toEqual([
      [`${CONTEXT}: value too long (code: 22001)`, failure.stack],
    ]);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(ADDRESS);
    expect(reply).toHaveBeenCalledWith(
      response,
      { statusCode: 500, message: 'Internal server error' },
      500,
    );
  });

  it('keeps the URL, the query and the id from the path out of the line', () => {
    createFilter(false).catch(queryFailure(), host);

    const line = JSON.stringify(logged.mock.calls);
    expect(line).not.toContain(SUBSCRIPTION_ID);
    expect(line).not.toContain('?');
    expect(line).not.toContain(ADDRESS);
  });

  it('marks a request without a route or a user', () => {
    const unrouted = {
      method: 'POST',
      originalUrl: `/nowhere?email=${ADDRESS}`,
      requestId: REQUEST_ID,
    } as unknown as RequestWithContext;

    createFilter(false).catch(queryFailure(), hostFor(unrouted, response));

    expect(logged.mock.calls).toEqual([
      [
        `POST (unrouted) user=- req=${REQUEST_ID}: value too long (code: 22001)`,
      ],
    ]);
  });

  it('leaves the stack out when LOG_ERROR_STACKS is off', () => {
    createFilter(false).catch(queryFailure(), host);

    expect(logged.mock.calls).toEqual([
      [`${CONTEXT}: value too long (code: 22001)`],
    ]);
    expect(reply).toHaveBeenCalledWith(
      response,
      { statusCode: 500, message: 'Internal server error' },
      500,
    );
  });

  it('logs a middleware server error without its raw body', () => {
    const failure = Object.assign(new Error('bad gateway'), {
      expose: false,
      statusCode: 502,
      status: 502,
      body: ADDRESS,
    });

    createFilter(true).catch(failure, host);

    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0][0]).toBe(`${CONTEXT}: bad gateway`);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(ADDRESS);
    expect(reply).toHaveBeenCalledWith(
      response,
      { statusCode: 502, message: 'bad gateway' },
      502,
    );
  });

  it('keeps the status of a client error from middleware and does not log it', () => {
    const failure = Object.assign(new Error('request entity too large'), {
      expose: true,
      statusCode: 413,
      status: 413,
      body: ADDRESS,
    });

    createFilter(true).catch(failure, host);

    expect(logged).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      response,
      { statusCode: 413, message: 'request entity too large' },
      413,
    );
  });

  it('passes a client HttpException through without logging it', () => {
    createFilter(true).catch(new BadRequestException('zly adres'), host);

    expect(logged).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({ statusCode: 400, message: 'zly adres' }),
      400,
    );
  });

  it('logs a server HttpException and keeps its response', () => {
    const failure = new ServiceUnavailableException('mail down');

    createFilter(false).catch(failure, host);

    expect(logged.mock.calls).toEqual([[`${CONTEXT}: mail down`]]);
    expect(reply).toHaveBeenCalledWith(response, failure.getResponse(), 503);
  });

  it('logs a plain 500 HttpException with its stack', () => {
    const failure = new HttpException('broken', 500);

    createFilter(true).catch(failure, host);

    expect(logged.mock.calls).toEqual([[`${CONTEXT}: broken`, failure.stack]]);
  });

  it('handles a thrown value that is not an error', () => {
    createFilter(true).catch('awaria', host);

    expect(logged.mock.calls).toEqual([[`${CONTEXT}: Non-error value thrown`]]);
    expect(reply).toHaveBeenCalledWith(
      response,
      { statusCode: 500, message: 'Internal server error' },
      500,
    );
  });
});
