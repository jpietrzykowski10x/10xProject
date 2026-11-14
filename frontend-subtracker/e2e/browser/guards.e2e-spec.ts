import { expect, test } from '@playwright/test';
import { API_ORIGIN, createE2eAccounts, sessionCookie } from '../support/accounts';

// The guards of client-rendered routes run only in the browser: against the real router, the e2e
// build and the API. The decision matrix itself is covered by the guard's unit tests; here only the
// network is replaced (page.route), never AuthService. An expired session differs from no session
// only in the API's answer, which the unit and backend e2e tests cover.
const accounts = createE2eAccounts({ addressPrefix: 'e2e-browser-guards-' });

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

test('without a session the list sends the visitor to sign-in', async ({ page }) => {
  await page.goto('/subscriptions');

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Logowanie', exact: true })).toBeVisible();
});

test('when the API is unreachable the list shows the unavailable page and keeps its address', async ({
  context,
  page,
}) => {
  const account = await accounts.newAccount();
  await context.addCookies([sessionCookie(await accounts.sessionFor(account))]);
  // A network failure (status 0), not an API answer: the guard must not take it for a lost session.
  await page.route(
    (url) => url.origin === API_ORIGIN && url.pathname === '/auth/session',
    (route) => route.abort(),
  );

  await page.goto('/subscriptions');

  await expect(
    page.getByRole('heading', { name: 'Serwis chwilowo niedostępny', exact: true }),
  ).toBeVisible();
  // skipLocationChange: refreshing the page checks the session again.
  await expect(page).toHaveURL(/\/subscriptions$/);
});

test('with a valid session sign-in sends the user to the list', async ({ context, page }) => {
  const account = await accounts.newAccount();
  await context.addCookies([sessionCookie(await accounts.sessionFor(account))]);

  await page.goto('/sign-in');

  // The cookie has to travel from the browser to the API, for the guards and for the list itself
  // (a 401 there would end on /sign-in again).
  await expect(page).toHaveURL(/\/subscriptions$/);
  await expect(page.getByRole('heading', { name: 'Twoje subskrypcje', exact: true })).toBeVisible();
});
