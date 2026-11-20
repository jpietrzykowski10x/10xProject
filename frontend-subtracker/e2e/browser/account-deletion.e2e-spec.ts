import { type APIRequestContext, expect, test } from '@playwright/test';
import { API_ORIGIN, createE2eAccounts, SESSION_COOKIE, sessionCookie } from '../support/accounts';

// Account deletion in a real browser against the real API (desktop layout): the e-mail address in
// the column leads to /account, the dialog lets "Usuń konto" through only for the account's own
// address, the API deletes the account and clears the cookie, and the start page says so. What is
// left in the database after the deletion is covered by the backend e2e tests; the dialog's errors,
// the address normalisation and the phone menu by component tests.
const accounts = createE2eAccounts({ addressPrefix: 'e2e-browser-account-deletion-' });

test.beforeAll(async () => {
  // Leftovers of a run that was killed before its cleanup.
  await accounts.removeTestData();
});

test.afterAll(async () => {
  // Also safe when the test deleted its account: only rows that are still there are removed.
  try {
    await accounts.removeTestData();
  } finally {
    await accounts.close();
  }
});

interface CategoryResponse {
  id: string;
}

// A day 30 days ahead in local time, as the API takes it ("YYYY-MM-DD"). Never a past day: the
// lifecycle job on the API's start would move it on.
function futureDay(): string {
  const day = new Date();
  day.setDate(day.getDate() + 30);
  const yyyy = String(day.getFullYear());
  const mm = String(day.getMonth() + 1).padStart(2, '0');
  const dd = String(day.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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
  const [category] = (await categories.json()) as CategoryResponse[];
  expect(category, 'no default categories (were the migrations run?)').toBeDefined();
  const created = await request.post(`${API_ORIGIN}/subscriptions`, {
    headers,
    data: {
      name,
      categoryId: category.id,
      amount: 25,
      billingCycle: 'monthly',
      paymentMethod: 'blik',
      status: 'active',
      nextBillingDate: futureDay(),
    },
  });
  expect(created.status()).toBe(201);
}

test('an account deleted from /account is gone: the start page says so and the old session is signed out', async ({
  context,
  page,
  request,
}) => {
  const name = `E2E account deletion ${Date.now()}`;
  const account = await accounts.newAccount();
  const token = await accounts.sessionFor(account);
  await createSubscriptionThroughApi(request, token, name);

  await context.addCookies([sessionCookie(token)]);
  await page.goto('/subscriptions');
  await expect(
    page.getByRole('region', { name: 'Lista subskrypcji', exact: true }).getByText(name),
  ).toBeVisible();

  // 1. The address in the column is the way to the account page (the phone menu has a copy).
  await page
    .getByRole('link', { name: `${account.email}, konto`, exact: true })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: 'Konto', exact: true })).toBeVisible();

  // 2. The dialog: "Usuń konto" stays off for an address other than the account's own.
  await page.getByRole('button', { name: 'Usuń konto', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Usunąć konto?' });
  await expect(dialog).toBeVisible();
  const confirmButton = dialog.getByRole('button', { name: 'Usuń konto', exact: true });
  const addressField = dialog.getByRole('textbox', {
    name: 'Wpisz swój adres e-mail, aby potwierdzić',
  });
  await addressField.fill(`other-${account.email}`);
  await expect(confirmButton).toBeDisabled();

  // 3. The own address lets the deletion through; the start page confirms it.
  await addressField.fill(account.email);
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('status')).toHaveText(
    'Konto zostało usunięte razem ze wszystkimi danymi.',
  );

  // 4. The account is gone: the old cookie no longer opens a session, in the API or in the app.
  const me = await request.get(`${API_ORIGIN}/auth/me`, {
    headers: { Cookie: `${SESSION_COOKIE}=${token}` },
  });
  expect(me.status()).toBe(401);
  await page.goto('/subscriptions');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Logowanie', exact: true })).toBeVisible();
});
