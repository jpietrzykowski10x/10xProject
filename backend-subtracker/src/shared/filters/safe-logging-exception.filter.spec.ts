import {
  type ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { type EnvConfig, validateEnv } from '../../config/env.js';
import { withDenial } from '../logging/denial.js';
import type { RequestWithContext } from '../logging/request-context.js';
import {
  DENIAL_LOG_WINDOW_MS,
  SafeLoggingExceptionFilter,
} from './safe-logging-exception.filter.js';

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
    headers: { origin: 'https://app.example.com' },
  } as unknown as RequestWithContext;
}

// A request refused by Nest's CSRF check, before routing, with these headers.
function csrfRequest(headers: Record<string, string>): RequestWithContext {
  return {
    method: 'POST',
    originalUrl: `/auth/logout?email=${ADDRESS}`,
    requestId: REQUEST_ID,
    headers,
  } as unknown as RequestWithContext;
}

const CSRF_SEC_FETCH_SITE =
  'Cross-origin request detected from Sec-Fetch-Site header';
const CSRF_ORIGIN =
  'Cross-origin request detected, and/or browser is out of date: Sec-Fetch-Site is missing, and Origin does not match Host';

function hostFor(request: RequestWithContext, response: object): ArgumentsHost {
  return {
    getType: () => 'http',
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
  let warned: ReturnType<typeof vi.spyOn>;

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
    warned = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
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
    expect(warned).not.toHaveBeenCalled();
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

  it('logs an error from a context other than HTTP without a request', () => {
    const rpcHost = {
      getType: () => 'rpc',
      getArgByIndex: () => response,
      switchToHttp: () => {
        throw new Error('not an HTTP context');
      },
    } as unknown as ArgumentsHost;

    createFilter(false).catch(queryFailure(), rpcHost);

    expect(logged.mock.calls).toEqual([
      ['(no http request): value too long (code: 22001)'],
    ]);
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

  describe('denials', () => {
    const START = Date.parse('2026-11-23T10:00:00.000Z');
    const roleDenial = () =>
      withDenial(new ForbiddenException(), {
        code: 'role_missing',
        ids: { actor: USER_ID },
      });

    it('logs a marked client error once, as a warn line in the Denials context, and keeps its response', () => {
      const denied = roleDenial();

      createFilter(true).catch(denied, host);

      expect(logged).not.toHaveBeenCalled();
      expect(warned.mock.calls).toEqual([
        [`role_missing 403 ${CONTEXT} actor=${USER_ID}`],
      ]);
      expect(warned.mock.contexts[0]).toMatchObject({ context: 'Denials' });
      expect(reply).toHaveBeenCalledWith(response, denied.getResponse(), 403);
    });

    it('logs the denial of a middleware error, read before the error is replaced', () => {
      const failure = withDenial(
        Object.assign(new Error('payload too large'), {
          expose: true,
          statusCode: 413,
          status: 413,
        }) as unknown as HttpException,
        { code: 'body_too_large' },
      );

      createFilter(true).catch(failure, host);

      expect(warned.mock.calls).toEqual([[`body_too_large 413 ${CONTEXT}`]]);
      expect(reply).toHaveBeenCalledWith(
        response,
        { statusCode: 413, message: 'payload too large' },
        413,
      );
    });

    it('writes at most 10 lines per code a minute and reports the rest in the next window', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(START);
      const filter = createFilter(false);

      for (let i = 0; i < 11; i++) {
        filter.catch(roleDenial(), host);
      }
      // Another code has its own limit.
      filter.catch(
        withDenial(new BadRequestException(), { code: 'validation' }),
        host,
      );

      expect(warned).toHaveBeenCalledTimes(11);
      expect(
        warned.mock.calls.filter((call: unknown[]) =>
          String(call[0]).startsWith('role_missing'),
        ),
      ).toHaveLength(10);
      expect(reply).toHaveBeenCalledTimes(12);

      vi.setSystemTime(START + DENIAL_LOG_WINDOW_MS);
      filter.catch(roleDenial(), host);
      filter.catch(roleDenial(), host);

      expect(warned.mock.calls.slice(11)).toEqual([
        [
          `role_missing 403 ${CONTEXT} actor=${USER_ID} (suppressed 1 in the previous window)`,
        ],
        [`role_missing 403 ${CONTEXT} actor=${USER_ID}`],
      ]);
    });

    it('recognises a CSRF refusal by Sec-Fetch-Site with the origin of the request', () => {
      createFilter(false).catch(
        new ForbiddenException(CSRF_SEC_FETCH_SITE),
        hostFor(
          csrfRequest({
            origin: 'https://Evil.Example:8443',
            'sec-fetch-site': 'cross-site',
          }),
          response,
        ),
      );

      expect(warned.mock.calls).toEqual([
        [
          `csrf_sec_fetch_site 403 POST (unrouted) user=- req=${REQUEST_ID} origin=https://evil.example:8443`,
        ],
      ]);
      expect(JSON.stringify(warned.mock.calls)).not.toContain(ADDRESS);
    });

    it('recognises a CSRF refusal by Origin and keeps only scheme, host and port', () => {
      createFilter(false).catch(
        new ForbiddenException(CSRF_ORIGIN),
        hostFor(
          csrfRequest({ origin: `https://evil.example/path?email=${ADDRESS}` }),
          response,
        ),
      );

      expect(warned.mock.calls).toEqual([
        [
          `csrf_origin 403 POST (unrouted) user=- req=${REQUEST_ID} origin=https://evil.example`,
        ],
      ]);
      expect(JSON.stringify(warned.mock.calls)).not.toContain(ADDRESS);
    });

    it.each([
      [{}, 'none'],
      [{ origin: 'not a url' }, 'invalid'],
      [{ origin: 'null' }, 'invalid'],
    ])('marks the origin of %j as %s', (headers, origin) => {
      createFilter(false).catch(
        new ForbiddenException(CSRF_ORIGIN),
        hostFor(csrfRequest(headers), response),
      );

      expect(warned.mock.calls).toEqual([
        [
          `csrf_origin 403 POST (unrouted) user=- req=${REQUEST_ID} origin=${origin}`,
        ],
      ]);
    });

    it('cuts a long origin to 100 characters', () => {
      const longOrigin = `https://${'a'.repeat(200)}.example`;

      createFilter(false).catch(
        new ForbiddenException(CSRF_SEC_FETCH_SITE),
        hostFor(csrfRequest({ origin: longOrigin }), response),
      );

      const line = String(warned.mock.calls[0][0]);
      expect(line.slice(line.indexOf('origin=') + 'origin='.length)).toBe(
        longOrigin.slice(0, 100),
      );
    });

    it('does not log another 403 or a CSRF text with another status', () => {
      const filter = createFilter(false);

      filter.catch(new ForbiddenException('Cannot manage this account'), host);
      filter.catch(new BadRequestException(CSRF_ORIGIN), host);

      expect(warned).not.toHaveBeenCalled();
    });
  });
});
