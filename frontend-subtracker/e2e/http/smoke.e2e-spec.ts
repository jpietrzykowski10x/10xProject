import { expect, test } from '@playwright/test';
import { API_ORIGIN, createE2eAccounts, SESSION_COOKIE } from '../support/accounts';

// The skeleton works: both servers are up from the right build and a session from the helper is
// valid for the API. When this fails, the problem is the setup, not a guard.
const accounts = createE2eAccounts({ addressPrefix: 'e2e-browser-smoke-' });

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

test('the SSR server serves a prerendered page', async ({ request }) => {
  const response = await request.get('/privacy-policy');
  expect(response.status()).toBe(200);
});

test('the API accepts a session made by the helper', async ({ request }) => {
  const account = await accounts.newAccount();
  const token = await accounts.sessionFor(account);

  const response = await request.get(`${API_ORIGIN}/auth/session`, {
    headers: { Cookie: `${SESSION_COOKIE}=${token}` },
  });

  expect(response.status()).toBe(200);
  const body = (await response.json()) as { user: { email: string } | null };
  expect(body.user?.email).toBe(account.email);
});

test('the API treats an expired session as signed out', async ({ request }) => {
  const account = await accounts.newAccount();
  const token = await accounts.sessionFor(account, { expired: true });

  const response = await request.get(`${API_ORIGIN}/auth/session`, {
    headers: { Cookie: `${SESSION_COOKIE}=${token}` },
  });

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ user: null });
});
