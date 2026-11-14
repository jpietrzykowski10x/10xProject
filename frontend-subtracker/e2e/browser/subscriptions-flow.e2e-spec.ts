import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { API_ORIGIN, createE2eAccounts, SESSION_COOKIE, sessionCookie } from '../support/accounts';

// The main flow of the product in a real browser: a subscription added in the form reaches the API
// and comes back on the owner's list, and after a sign-out another account signed in in the same
// tab (same storage, HTTP cache and browser context) does not see it. Isolation in the API itself
// is covered by the backend e2e tests; here only what the browser could keep between accounts.
// Field values and messages are not asserted: the form's component tests cover them.
const accounts = createE2eAccounts({ addressPrefix: 'e2e-browser-flow-' });

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

interface CategoryResponse {
  id: string;
}

// A day 30 days ahead in local time, as the API ("YYYY-MM-DD") and the form ("dd.mm.rrrr") take it.
function futureDay(): { iso: string; polish: string } {
  const day = new Date();
  day.setDate(day.getDate() + 30);
  const yyyy = String(day.getFullYear());
  const mm = String(day.getMonth() + 1).padStart(2, '0');
  const dd = String(day.getDate()).padStart(2, '0');
  return { iso: `${yyyy}-${mm}-${dd}`, polish: `${dd}.${mm}.${yyyy}` };
}

// Straight to the API with the account's cookie. A client without browser headers passes the
// CSRF check, so no Origin header is needed.
async function createSubscriptionThroughApi(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<void> {
  const headers = { Cookie: `${SESSION_COOKIE}=${token}` };
  const categories = await request.get(`${API_ORIGIN}/categories`, { headers });
  expect(categories.status()).toBe(200);
  const categoryList = (await categories.json()) as CategoryResponse[];
  expect(categoryList.length, 'no default categories (were the migrations run?)').toBeGreaterThan(
    0,
  );
  const [category] = categoryList;
  const created = await request.post(`${API_ORIGIN}/subscriptions`, {
    headers,
    data: {
      name,
      categoryId: category.id,
      amount: 25,
      billingCycle: 'monthly',
      paymentMethod: 'blik',
      status: 'active',
      nextBillingDate: futureDay().iso,
    },
  });
  expect(created.status()).toBe(201);
}

// The list as rendered from the API's answer (not the "added" message, which also names it).
function subscriptionList(page: Page) {
  return page.getByRole('region', { name: 'Lista subskrypcji', exact: true });
}

test('a subscription added in the form stays on its owner list and not on the next account in the same tab', async ({
  context,
  page,
  request,
}) => {
  const stamp = Date.now();
  const nameA = `E2E flow A ${stamp}`;
  const olderNameA = `E2E flow A older ${stamp}`;
  const nameB = `E2E flow B ${stamp}`;

  const accountA = await accounts.newAccount();
  const accountB = await accounts.newAccount();
  const tokenA = await accounts.sessionFor(accountA);
  const tokenB = await accounts.sessionFor(accountB);
  // A starts with a subscription, so the add panel does not open by itself (an empty list opens
  // it on desktop) and the new one has to join a list already on screen.
  await createSubscriptionThroughApi(request, tokenA, olderNameA);
  await createSubscriptionThroughApi(request, tokenB, nameB);

  // 1. Account A adds a subscription through the form.
  await context.addCookies([sessionCookie(tokenA)]);
  await page.goto('/subscriptions');
  await expect(subscriptionList(page).getByText(olderNameA)).toBeVisible();

  await page
    .getByRole('button', { name: 'Dodaj subskrypcję', exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole('textbox', { name: 'Nazwa', exact: true }).fill(nameA);
  await page.getByRole('combobox', { name: 'Kategoria' }).click();
  // Waits for the categories from the API; "Dodaj własną…" is there before they arrive.
  await page.getByRole('option').filter({ hasNotText: 'Dodaj własną' }).first().click();
  await page.getByRole('textbox', { name: 'Kwota w PLN' }).fill('12,99');
  await page.getByRole('combobox', { name: 'Forma płatności' }).click();
  await page.getByRole('option', { name: 'BLIK', exact: true }).click();
  await page.getByRole('textbox', { name: 'Następne rozliczenie' }).fill(futureDay().polish);
  await page.getByRole('button', { name: 'Zapisz subskrypcję', exact: true }).click();

  // 2. On the list after the save, and still there after a reload: it came from the API, not from
  // the form's local state.
  await expect(subscriptionList(page).getByText(nameA)).toBeVisible();
  await page.reload();
  await expect(subscriptionList(page).getByText(nameA)).toBeVisible();

  // 3. Signing out ends on sign-in (the API ended the session, or the guard would let A back in).
  await page
    .getByRole('button', { name: 'Wyloguj', exact: true })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/sign-in$/);

  // 4. Account B in the same tab.
  await context.addCookies([sessionCookie(tokenB)]);
  await page.goto('/subscriptions');

  // 5. The anchor first: B's own address and list are on screen, so the page has loaded for B.
  // Only then does "A's subscription is not shown" mean something.
  await expect(
    page.getByText(accountB.email, { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(subscriptionList(page).getByText(nameB)).toBeVisible();
  await expect(page.getByText(nameA)).toHaveCount(0);
  await expect(page.getByText(olderNameA)).toHaveCount(0);
});
