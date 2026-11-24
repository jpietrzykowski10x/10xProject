import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedRequest } from '../types/auth-user.js';

export const REQUEST_ID_HEADER = 'X-Request-Id';

// `requestId` is set by assignRequestId on every request; `user` only by the session guard.
export interface RequestWithContext extends AuthenticatedRequest {
  requestId?: string;
}

// The first middleware of the app (applyHttpSecurity), so even a request refused by CORS or CSRF
// has an id. An incoming X-Request-Id is ignored: the id in the log must be one the API made.
export function assignRequestId(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = randomUUID();
  (req as RequestWithContext).requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}

// The pieces of a log line about a request: method, route template, user id and request id (`-`
// when unknown). The route template (e.g. /subscriptions/:id) only: never originalUrl or url, whose
// query may carry an address or a token. A request refused before routing (CSRF, unknown path) has
// no template and gets `(unrouted)`.
export interface RequestParts {
  method: string;
  route: string;
  user: string;
  requestId: string;
}

export function requestParts(req: RequestWithContext): RequestParts {
  const route = req.route as { path?: unknown } | undefined;
  return {
    method: req.method,
    route: typeof route?.path === 'string' ? route.path : '(unrouted)',
    user: req.user?.id ?? '-',
    requestId: req.requestId ?? '-',
  };
}

// `<METHOD> <route template|(unrouted)> user=<uuid|-> req=<uuid|->` for a log line.
export function describeRequest(req: RequestWithContext | undefined): string {
  if (req === undefined) {
    return '(no http request)';
  }
  const { method, route, user, requestId } = requestParts(req);
  return `${method} ${route} user=${user} req=${requestId}`;
}
