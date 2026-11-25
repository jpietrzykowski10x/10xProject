import { expect, test } from '@playwright/test';
import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Risk: none of §2: roadmap S-15 (a failed server-side navigation was a "Cannot GET" 404 with no log line) — context/foundation/test-plan.md §2.
// A navigation that throws while the server renders it gives 500 with the /unavailable page and one
// ERROR [Navigation] line in the S-14 format, without the query. The test route exists only in the
// e2e build (environment.e2e.ts, e2e-routes.ts). Playwright's webServer does not hand its output to
// the tests, so this file starts its own SSR process on another port and reads its stdout/stderr.
const PORT = 4100;
const ORIGIN = `http://localhost:${PORT}`;
const SERVER = resolve(__dirname, '../../dist/frontend-subtracker-e2e/server/server.mjs');
const START_TIMEOUT_MS = 30_000;

let server: ChildProcess | undefined;
let stdout = '';
let stderr = '';

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null) {
      throw new Error(`The SSR server exited with ${server?.exitCode}: ${stderr}`);
    }
    try {
      const response = await fetch(`${ORIGIN}/privacy-policy`);
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`The SSR server did not answer on ${ORIGIN} within ${START_TIMEOUT_MS} ms`);
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
    env: { ...process.env, PORT: String(PORT), NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  server.stderr?.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  await waitForServer();
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
