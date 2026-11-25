import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { requestParts, type RequestWithContext } from './request-context.js';

// One `log` line per request, after the response is done:
// `<METHOD> <route template|(unrouted)> <status> <ms> ms user=<uuid|-> req=<uuid|->`, or status
// `aborted` when the client closed the connection first. The pieces come from requestParts, so
// the line never carries the URL, its query, an address, a token, a cookie or the body.
// Registered in applyHttpSecurity right after assignRequestId, so 404s, preflights and CSRF
// refusals get a line too. Read at `finish`, when the guard has set the user and the router the
// route template, and res.statusCode is the final status (after the exception filter).
export function accessLog(
  logger: Logger = new Logger('Access'),
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const startedAt = performance.now();
    let logged = false;
    const write = (status: number | 'aborted') => {
      if (logged) {
        return;
      }
      logged = true;
      const { method, route, user, requestId } = requestParts(
        req as RequestWithContext,
      );
      const ms = Math.round(performance.now() - startedAt);
      logger.log(
        `${method} ${route} ${status} ${ms} ms user=${user} req=${requestId}`,
      );
    };
    res.once('finish', () => write(res.statusCode));
    // `close` follows `finish` on every completed response; without it the connection closed before
    // the response was done: the client gave up, or a handler never answered (requestTimeout).
    res.once('close', () => write('aborted'));
    next();
  };
}
