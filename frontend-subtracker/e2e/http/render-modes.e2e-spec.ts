import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createE2eAccounts, SESSION_COOKIE } from '../support/accounts';

// Risk: #2 (a guarded route prerendered or rendered with user data) — context/foundation/test-plan.md §2.
// Routes with a guard never get HTML from the server or from the prerender: every one of them
// serves the same CSR shell, with or without a session. The prerender covers only static pages.
const accounts = createE2eAccounts({ addressPrefix: 'e2e-browser-render-modes-' });

const GUARDED_ROUTES = [
  '/subscriptions',
  '/dashboard',
  '/budget',
  '/account',
  '/admin/users',
  // Any id: the guard runs in the browser, so the server never looks it up.
  '/admin/users/00000000-0000-4000-8000-000000000000',
  '/sign-in',
  '/register',
  '/auth/verify',
];

// The oracle is the static pages of the test plan (§7), not app.routes.server.ts. A new static page
// is a deliberate addition to this list; a guarded route showing up here was caught by '**'.
const STATIC_PAGES = ['/privacy-policy', '/unavailable'];

// The test routes of every build but `e2e`, which swaps in e2e-routes.e2e.ts (angular.json).
// CI builds only the e2e configuration, so the source is the oracle here, not a production dist.
const PRODUCTION_E2E_ROUTES = resolve(__dirname, '../../src/app/e2e-routes.ts');
const ANGULAR_JSON = resolve(__dirname, '../../angular.json');

const PRERENDERED_ROUTES = resolve(
  __dirname,
  '../../dist/frontend-subtracker-e2e/prerendered-routes.json',
);

test.beforeAll(async () => {
  // Leftovers of a run that was killed before its cleanup.
  await accounts.removeTestData();
});

test.afterAll(async () => {
  try {
    await accounts.removeTestData();
  } finally {
    await accounts.close();
  }
});

// The server appends a modulepreload link per lazy chunk of the matched route to the shell, so the
// shells of different routes differ only in those links.
function withoutModulePreloads(html: string): string {
  return html.replace(/<link rel="modulepreload" href="[^"]*">\n?/g, '');
}

test('guarded routes serve one CSR shell, identical with and without a session', async ({
  request,
}) => {
  const account = await accounts.newAccount();
  const token = await accounts.sessionFor(account);

  const shells: string[] = [];
  for (const route of GUARDED_ROUTES) {
    const bodies: string[] = [];
    for (const [variant, headers] of [
      ['without a cookie', {}],
      ['with a valid session', { Cookie: `${SESSION_COOKIE}=${token}` }],
    ] as const) {
      const response = await request.get(route, { maxRedirects: 0, headers });
      const label = `${route} ${variant}`;
      expect(response.status(), label).toBe(200);
      const body = await response.text();
      expect(body, label).not.toContain('ng-server-context');
      bodies.push(body);
    }
    // Byte for byte: nothing in the HTML depends on the visitor.
    expect(bodies[1], `${route} with a session differs from without one`).toBe(bodies[0]);
    shells.push(withoutModulePreloads(bodies[0]));
  }

  for (const [index, shell] of shells.entries()) {
    expect(shell, `${GUARDED_ROUTES[index]} is not the shell of ${GUARDED_ROUTES[0]}`).toBe(
      shells[0],
    );
  }
});

test('the build prerenders only the static pages', () => {
  const manifest = JSON.parse(readFileSync(PRERENDERED_ROUTES, 'utf8')) as {
    routes: Record<string, unknown>;
  };

  expect(Object.keys(manifest.routes).sort()).toEqual([...STATIC_PAGES].sort());
});

test('the production build has no e2e test routes', () => {
  const source = readFileSync(PRODUCTION_E2E_ROUTES, 'utf8');

  expect(source).toMatch(/^export const E2E_ROUTES: Routes = \[\];\r?$/m);
  expect(source).toMatch(/^export const E2E_SERVER_PATHS: readonly string\[\] = \[\];\r?$/m);
  expect(source).not.toContain('navigation-error');

  // CI builds only the e2e bundle, so the swap itself is checked: only the e2e configuration
  // replaces e2e-routes.ts.
  const angularJson = JSON.parse(readFileSync(ANGULAR_JSON, 'utf8')) as {
    projects: Record<
      string,
      { architect: { build: { configurations: Record<string, { fileReplacements?: unknown }> } } }
    >;
  };
  for (const project of Object.values(angularJson.projects)) {
    for (const [name, configuration] of Object.entries(project.architect.build.configurations)) {
      if (name !== 'e2e') {
        expect(JSON.stringify(configuration.fileReplacements ?? []), name).not.toContain(
          'e2e-routes',
        );
      }
    }
  }
});
