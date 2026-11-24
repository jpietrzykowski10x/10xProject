import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { accessLog } from './access-log.js';
import type { RequestWithContext } from './request-context.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const ADDRESS = 'ktos@example.com';

function requestStub(fields: Partial<RequestWithContext>): RequestWithContext {
  return {
    method: 'GET',
    originalUrl: `/subscriptions/abc?email=${ADDRESS}&token=sekret`,
    url: `/subscriptions/abc?email=${ADDRESS}&token=sekret`,
    headers: { cookie: 'subtracker_session=sekret' },
    requestId: REQUEST_ID,
    ...fields,
  } as RequestWithContext;
}

function run(req: RequestWithContext) {
  const logger = new Logger('Access');
  const log = vi.spyOn(logger, 'log').mockImplementation(() => undefined);
  const res = Object.assign(new EventEmitter(), { statusCode: 200 });
  const next = vi.fn() as unknown as NextFunction;
  accessLog(logger)(
    req as unknown as Request,
    res as unknown as Response,
    next,
  );
  const lines = () => log.mock.calls.map((call: unknown[]) => String(call[0]));
  return { res, next, log, lines };
}

describe('accessLog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('continues at once and logs nothing before the response is done', () => {
    const { next, log } = run(requestStub({}));

    expect(next).toHaveBeenCalledWith();
    expect(log).not.toHaveBeenCalled();
  });

  it('logs the route template, the final status, the time, the user and the request id after finish', () => {
    const req = requestStub({ method: 'PUT' });
    const { res, lines } = run(req);
    // Set by the router and the session guard after the middleware has run.
    req.route = { path: '/subscriptions/:id' };
    req.user = { id: USER_ID, email: ADDRESS, roles: [] };
    res.statusCode = 403;

    res.emit('finish');

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatch(
      new RegExp(
        `^PUT /subscriptions/:id 403 \\d+ ms user=${USER_ID} req=${REQUEST_ID}$`,
      ),
    );
  });

  it('marks a request without a route and without a user', () => {
    const { res, lines } = run(requestStub({}));
    res.statusCode = 404;

    res.emit('finish');

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatch(
      new RegExp(`^GET \\(unrouted\\) 404 \\d+ ms user=- req=${REQUEST_ID}$`),
    );
  });

  it('rounds the time to whole milliseconds', () => {
    const now = vi
      .spyOn(performance, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1012.6);
    const { res, lines } = run(requestStub({}));

    res.emit('finish');

    expect(now).toHaveBeenCalledTimes(2);
    expect(lines()[0]).toBe(
      `GET (unrouted) 200 13 ms user=- req=${REQUEST_ID}`,
    );
  });

  it('logs one line with status aborted when the client closes the connection first', () => {
    const { res, lines } = run(requestStub({}));

    res.emit('close');
    res.emit('finish');

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatch(
      new RegExp(
        `^GET \\(unrouted\\) aborted \\d+ ms user=- req=${REQUEST_ID}$`,
      ),
    );
  });

  it('logs exactly one line when close follows finish', () => {
    const { res, lines } = run(requestStub({}));

    res.emit('finish');
    res.emit('close');

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toContain(' 200 ');
    expect(lines()[0]).not.toContain('aborted');
  });

  it('never takes the URL, its query, the address, a token or the cookie', () => {
    const req = requestStub({});
    const { res, log } = run(req);
    req.route = { path: '/subscriptions/:id' };
    req.user = { id: USER_ID, email: ADDRESS, roles: [] };

    res.emit('finish');

    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain('?');
    expect(logged).not.toContain('abc');
    expect(logged).not.toContain(ADDRESS);
    expect(logged).not.toContain('token');
    expect(logged).not.toContain('sekret');
  });
});
