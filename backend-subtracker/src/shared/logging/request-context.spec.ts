import type { NextFunction, Request, Response } from 'express';
import {
  assignRequestId,
  describeRequest,
  REQUEST_ID_HEADER,
  type RequestWithContext,
} from './request-context.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const USER_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

function requestStub(fields: Partial<RequestWithContext>): RequestWithContext {
  return {
    method: 'GET',
    originalUrl: '/subscriptions/abc?email=ktos@example.com',
    url: '/subscriptions/abc?email=ktos@example.com',
    ...fields,
  } as RequestWithContext;
}

describe('assignRequestId', () => {
  function run(headers: Record<string, string> = {}) {
    const req = { headers } as unknown as Request;
    const setHeader = vi.fn();
    const next = vi.fn() as unknown as NextFunction;
    assignRequestId(req, { setHeader } as unknown as Response, next);
    return { req: req as RequestWithContext, setHeader, next };
  }

  it('gives the request a new UUID, sets the response header and continues', () => {
    const { req, setHeader, next } = run();

    expect(req.requestId).toMatch(UUID);
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, req.requestId);
    expect(next).toHaveBeenCalledWith();
  });

  it('ignores an incoming X-Request-Id and gives every request its own id', () => {
    const first = run({ 'x-request-id': 'abc' });
    const second = run({ 'x-request-id': 'abc' });

    expect(first.req.requestId).toMatch(UUID);
    expect(first.req.requestId).not.toBe(second.req.requestId);
  });
});

describe('describeRequest', () => {
  it('names the method, the route template, the user and the request id', () => {
    const req = requestStub({
      method: 'PUT',
      route: { path: '/subscriptions/:id' },
      user: { id: USER_ID, email: 'ktos@example.com', roles: [] },
      requestId: REQUEST_ID,
    });

    expect(describeRequest(req)).toBe(
      `PUT /subscriptions/:id user=${USER_ID} req=${REQUEST_ID}`,
    );
  });

  it('marks a request without a route, a user or an id', () => {
    expect(describeRequest(requestStub({ method: 'POST' }))).toBe(
      'POST (unrouted) user=- req=-',
    );
  });

  it('never takes the URL, its query or the address', () => {
    const line = describeRequest(
      requestStub({
        route: { path: '/subscriptions/:id' },
        user: { id: USER_ID, email: 'ktos@example.com', roles: [] },
        requestId: REQUEST_ID,
      }),
    );

    expect(line).not.toContain('abc');
    expect(line).not.toContain('?');
    expect(line).not.toContain('ktos@example.com');
  });
});
