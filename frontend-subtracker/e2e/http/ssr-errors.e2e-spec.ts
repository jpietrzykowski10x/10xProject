import { expect, test } from '@playwright/test';
import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Risk: none of §2: roadmap S-15 (a failed server-side navigation was a "Cannot GET" 404 with no log line) — context/foundation/test-plan.md §2.
// A navigation that throws while the server renders it gives 500 with the /unavailable page and one
// ERROR [Navigation] line in the S-14 format, without the query. The test route exists only in the
// e2e build (angular.json swaps e2e-routes.ts for e2e-routes.e2e.ts). Playwright's webServer does
// not hand its output to the tests, so this file starts its own SSR process on another port and
// reads its stdout/stderr.
const PORT = 4100;
const ORIGIN = `http://localhost:${PORT}`;
const SERVER = resolve(__dirname, '../../dist/frontend-subtracker-e2e/server/server.mjs');
const START_TIMEOUT_MS = 30_000;

let server: ChildProcess | undefined;
let stdout = '';
let stderr = '';

// Only what the SSR server needs: playwright.config.ts loads backend-subtracker/.env (database and
// SMTP credentials) into process.env, and none of it belongs in this process. SystemRoot (and
// ComSpec) let node start on Windows.
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PORT: String(PORT), NO_COLOR: '1' };
  for (const name of ['PATH', 'SystemRoot', 'ComSpec']) {
    const value = process.env[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return env;
}

// Resolves on the child's own startup line, so a foreign process already on the port is never
// taken for it; rejects at once when the child exits first (e.g. EADDRINUSE).
function waitForServer(child: ChildProcess): Promise<void> {
  const started = new RegExp(String.raw`Started subtracker-frontend version \S+ on port ${PORT}\b`);
  return new Promise((done, fail) => {
    const timer = setTimeout(() => {
      cleanUp();
      fail(new Error(`The SSR server did not start on port ${PORT} within ${START_TIMEOUT_MS} ms`));
    }, START_TIMEOUT_MS);
    const onData = () => {
      if (started.test(stdout)) {
        cleanUp();
        done();
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanUp();
      fail(new Error(`The SSR server exited (${code ?? signal}) before it started: ${stderr}`));
    };
    const cleanUp = () => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.off('exit', onExit);
    };
    child.stdout?.on('data', onData);
    child.once('exit', onExit);
  });
}

// Resolves once the process is gone, so the port is free for the next run.
function stopServer(): Promise<void> {
  const child = server;
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((done) => {
    child.once('exit', () => done());
    child.kill();
  });
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line !== '');
}

test.beforeAll(async () => {
  server = spawn(process.execPath, [SERVER], {
    env: childEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Registered before waitForServer's listener, so `stdout` already holds the chunk it tests.
  server.stdout?.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  server.stderr?.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  await waitForServer(server);
});

test.afterAll(async () => {
  await stopServer();
});

test('a navigation that throws on the server gives 500, the unavailable page and one ERROR line', async ({
  request,
}) => {
  const response = await request.get(`${ORIGIN}/e2e/navigation-error?q=secret`, {
    maxRedirects: 0,
  });

  expect(response.status()).toBe(500);
  expect(await response.text()).toContain('Serwis chwilowo niedostępny');

  // The access line is written when the response is finished, a moment after the client has it.
  await expect
    .poll(() => lines(stdout).filter((line) => line.includes('[Access] GET /e2e/navigation-error')))
    .toEqual([expect.stringMatching(/ LOG \[Access\] GET \/e2e\/navigation-error 500 \d+ ms$/)]);

  const errors = lines(stderr).filter((line) => line.includes(' ERROR '));
  expect(errors).toEqual([
    expect.stringMatching(
      / ERROR \[Navigation\] GET \/e2e\/navigation-error Error: e2e navigation error$/,
    ),
  ]);
  expect(stdout + stderr).not.toContain('secret');
  expect(stderr).not.toContain('\x1b');
});
