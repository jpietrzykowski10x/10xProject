import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { accessMessage, deployedVersionFrom, renderErrorLines, serverLine } from './server-log';

/**
 * Browser assets live in ../browser in the dist layout, and in ./public in the
 * flattened MyDevil package (see scripts/prepare-mydevil.mjs).
 */
const mydevilBrowserFolder = join(import.meta.dirname, 'public');
const browserDistFolder = existsSync(mydevilBrowserFolder)
  ? mydevilBrowserFolder
  : join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * True when this process serves HTTP itself (the main module, or run via PM2): not in `ng serve`
 * and not while the build prerenders routes, which both use reqHandler without listening.
 */
const listening = isMainModule(import.meta.url) || Boolean(process.env['pm_id']);

/**
 * No Content-Security-Policy yet: Angular's inline state and event-replay scripts need a nonce or
 * hashes, which is worth doing with its own browser testing.
 */
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/{*splat}', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Access log: one line per request that did not hit a static file (registered after
 * express.static), once the response is done, or with status `aborted` when the client closed the
 * connection first. The path goes without its query (accessMessage), so a searched address or a
 * token never reaches the log. Only when the server listens, so the build and `ng serve` stay quiet.
 */
if (listening) {
  app.use((req, res, next) => {
    const startedAt = performance.now();
    let logged = false;
    const write = (status: number | 'aborted') => {
      if (logged) {
        return;
      }
      logged = true;
      const ms = Math.round(performance.now() - startedAt);
      console.log(serverLine('LOG', 'Access', accessMessage(req, status, ms)));
    };
    res.once('finish', () => write(res.statusCode));
    // `close` follows `finish` on every completed response; without it the connection closed before
    // the response was done: the client gave up, or a handler never answered (requestTimeout).
    res.once('close', () => write('aborted'));
    next();
  });
}

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

/**
 * A render that failed (handle() rejected): one ERROR line in the log format above, with the
 * method and the path without its query, and the stack frames on the following lines, instead of
 * Express's bare stack. The client gets a short 500 without the stack. A client that gave up
 * (AbortError) leaves no line: the access log already shows `aborted`. Registered last, so the
 * access log above still writes its line. Four parameters, or Express does not treat it as an
 * error handler.
 */
app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const lines = listening ? renderErrorLines(req, error) : null;
  if (lines !== null) {
    const [first, ...frames] = lines;
    console.error(serverLine('ERROR', 'Render', first ?? ''));
    for (const frame of frames) {
      console.error(frame);
    }
  }
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(500).type('text/plain').send('Internal server error.');
});

/**
 * The text of `.deploy-info` in the release directory (the working directory under forever,
 * written by deploy.sh), or null when there is none (local runs, e2e).
 */
function readDeployInfo(): string | null {
  try {
    return readFileSync(join(process.cwd(), '.deploy-info'), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (listening) {
  const port = process.env['PORT'] || 4000;
  const version = deployedVersionFrom(readDeployInfo());
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(
      serverLine(
        'LOG',
        'Bootstrap',
        `Started subtracker-frontend version ${version} on port ${port}`,
      ),
    );
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
