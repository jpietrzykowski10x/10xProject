import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createE2eAccounts, SESSION_COOKIE } from '../support/accounts';

// Routes with a guard never get HTML from the server or from the prerender: every one of them
// serves the same CSR shell, with or without a session. The prerender covers only static pages.
const accounts = createE2eAccounts({ addressPrefix: 'e2e-browser-render-modes-' });

const GUARDED_ROUTES = ['/subscriptions', '/sign-in', '/register', '/auth/verify'];

// The oracle is the static pages of the test plan (§7), not app.routes.server.ts. A new static page
// is a deliberate addition to this list; a guarded route showing up here was caught by '**'.
const STATIC_PAGES = ['/privacy-policy', '/unavailable'];

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
