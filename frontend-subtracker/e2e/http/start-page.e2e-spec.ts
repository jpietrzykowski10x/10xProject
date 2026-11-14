import { expect, test, type APIResponse } from '@playwright/test';
import { createE2eAccounts, SESSION_COOKIE } from '../support/accounts';

// The start page is rendered on the server per request (RenderMode.Server): its HTML depends on the
// visitor's cookie, so no cache may keep it, and the server-side guestGuard forwards the cookie to
// the API and redirects a signed-in visitor before any HTML is sent. "API does not answer" on the
// server is covered by the guard's unit tests, not here.
const accounts = createE2eAccounts({ addressPrefix: 'e2e-browser-start-page-' });

// Angular marks HTML rendered on the server for this request; prerendered and CSR pages lack it.
const SERVER_RENDERED = 'ng-server-context="ssr"';

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

function expectNotCacheable(response: APIResponse): void {
  const cacheControl = response.headers()['cache-control'] ?? '';
  expect(cacheControl).toContain('private');
  expect(cacheControl).toContain('no-store');
}

test('without a cookie the start page is rendered on the server and not cached', async ({
  request,
}) => {
  const response = await request.get('/', { maxRedirects: 0 });

  expect(response.status()).toBe(200);
  expectNotCacheable(response);
  expect(await response.text()).toContain(SERVER_RENDERED);
});

test('with a valid session the server redirects to the list before sending any HTML', async ({
  request,
}) => {
  const account = await accounts.newAccount();
  const token = await accounts.sessionFor(account);

  const response = await request.get('/', {
    maxRedirects: 0,
    headers: { Cookie: `${SESSION_COOKIE}=${token}` },
  });

  expect(response.status()).toBe(302);
  expect(response.headers()['location']).toMatch(/\/subscriptions$/);
  // The redirect depends on the cookie just like the page, so it is not cacheable either.
  expectNotCacheable(response);
});

test('with an expired session the start page is shown and the session answer is not embedded', async ({
  request,
}) => {
  const account = await accounts.newAccount();
  const token = await accounts.sessionFor(account, { expired: true });

  const response = await request.get('/', {
    maxRedirects: 0,
    headers: { Cookie: `${SESSION_COOKIE}=${token}` },
  });

  // The API answers an expired session with `user: null` (not 401): the visitor is a guest.
  expect(response.status()).toBe(200);
  expectNotCacheable(response);
  const html = await response.text();
  expect(html).toContain(SERVER_RENDERED);
  // The server asked the API for the session; its answer must not reach the transfer state. Entries
  // are stored under a hashed key, so the check looks for the answer's body ({"user":null}), not
  // its URL. app.config.ts filters /auth/session out; Angular's defaults (requests with
  // credentials, a no-store answer) keep it out as well, so this goes red only when all are gone.
  const transferState = html.match(
    /<script id="ng-state" type="application\/json">([\s\S]*?)<\/script>/,
  );
  expect(transferState, 'no transfer state script in the HTML').not.toBeNull();
  expect(transferState?.[1]).not.toContain('"user"');
});
