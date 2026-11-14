import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Browser e2e (npm run e2e) against the built SSR server (npm run build:e2e) and the real API with
// its database. Both read backend-subtracker/.env: the API itself, the tests through
// e2e/support/accounts.ts. Locally that is the dev database; in CI the job writes the file.
const backendDir = resolve(__dirname, '../backend-subtracker');
const backendEnv = resolve(backendDir, '.env');
if (existsSync(backendEnv)) {
  process.loadEnvFile(backendEnv);
}

const SSR_ORIGIN = 'http://localhost:4000';
const API_ORIGIN = 'http://localhost:3000';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

// The tests create accounts and delete rows by prefix, so they never run outside the local DEV
// setup. The API must also accept the SSR origin, or CORS and the CSRF check reject the browser.
function assertLocalDevSetup(): void {
  const problems: string[] = [];
  if (process.env['MODE'] !== 'DEV') {
    problems.push(`MODE is ${process.env['MODE'] ?? 'not set'}, expected DEV`);
  }
  const host = process.env['POSTGRES_HOST'];
  if (host === undefined || !LOCAL_HOSTS.includes(host.trim())) {
    problems.push(
      `POSTGRES_HOST is ${host ?? 'not set'}, expected one of ${LOCAL_HOSTS.join(', ')}`,
    );
  }
  // Read like the backend (parseCorsOrigins): comma-separated origins, trailing slashes ignored.
  const corsOrigins = (process.env['CORS_ORIGINS'] ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''));
  if (!corsOrigins.includes(SSR_ORIGIN)) {
    problems.push(
      `CORS_ORIGINS must list ${SSR_ORIGIN} as comma-separated origins, ` +
        `e.g. CORS_ORIGINS=http://localhost:4200,${SSR_ORIGIN}`,
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `e2e tests run only against the local DEV setup (${backendEnv}): ${problems.join('; ')}.`,
    );
  }
}

assertLocalDevSetup();

const reuseExistingServer = !process.env['CI'];

export default defineConfig({
  testDir: 'e2e',
  // Not *.spec.ts: ng test collects those.
  testMatch: '**/*.e2e-spec.ts',
  // One database for every file: files run one after another.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  // A flaky test must show up, not pass on the second try.
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: SSR_ORIGIN,
    trace: 'retain-on-failure',
  },
  projects: [
    // Plain HTTP against the servers: tests use only the `request` fixture.
    { name: 'http', testDir: 'e2e/http' },
    { name: 'chromium', testDir: 'e2e/browser', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      // The e2e build: production settings, local API.
      command: 'node dist/frontend-subtracker-e2e/server/server.mjs',
      // PORT from backend-subtracker/.env is the API's port, so the SSR port is set explicitly.
      env: { PORT: '4000' },
      url: `${SSR_ORIGIN}/privacy-policy`,
      reuseExistingServer,
      timeout: 120_000,
    },
    {
      // Built API (npm run build in backend-subtracker); locally a running start:dev works too.
      command: 'npm run start:prod',
      cwd: backendDir,
      url: `${API_ORIGIN}/health`,
      reuseExistingServer,
      timeout: 120_000,
    },
  ],
});
