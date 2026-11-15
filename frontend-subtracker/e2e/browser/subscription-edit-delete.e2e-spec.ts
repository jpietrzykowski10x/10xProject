import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { API_ORIGIN, createE2eAccounts, SESSION_COOKIE, sessionCookie } from '../support/accounts';

// Edit and delete in a real browser against the real API (desktop layout): the edit panel saves
// through PUT and the change survives a reload, and the delete dialog sends DELETE so the row is
// gone after a reload. Field rules, messages and the phone layout are covered by component tests;
// account isolation of PUT/DELETE by the backend e2e tests.
const accounts = createE2eAccounts({ addressPrefix: 'e2e-browser-edit-delete-' });

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

// A day 30 days ahead in local time, as the API takes it ("YYYY-MM-DD").
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

// The list as rendered from the API's answer (not the status message, which also names it).
function subscriptionList(page: Page) {
  return page.getByRole('region', { name: 'Lista subskrypcji', exact: true });
}

test('a subscription edited in the panel and then deleted in the dialog stays changed and then gone after a reload', async ({
  context,
  page,
  request,
}) => {
  const stamp = Date.now();
  const anchorName = `E2E edit anchor ${stamp}`;
  const name = `E2E edit target ${stamp}`;
  const editedName = `E2E edit target changed ${stamp}`;

  const account = await accounts.newAccount();
  const token = await accounts.sessionFor(account);
  // The anchor stays on the list, so "the deleted row is not shown" is checked on a loaded list.
  await createSubscriptionThroughApi(request, token, anchorName);
  await createSubscriptionThroughApi(request, token, name);

  await context.addCookies([sessionCookie(token)]);
  await page.goto('/subscriptions');
  await expect(subscriptionList(page).getByText(name)).toBeVisible();

  // 1. Edit: the panel opens with the row's data; a new name and amount are saved.
  await page.getByRole('button', { name: `Edytuj ${name}`, exact: true }).click();
  const nameField = page.getByRole('textbox', { name: 'Nazwa', exact: true });
  await expect(nameField).toHaveValue(name);
  await nameField.fill(editedName);
  await page.getByRole('textbox', { name: 'Kwota w PLN' }).fill('31,50');
  await page.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click();

  // 2. After a reload the list comes from the API, so the change was stored.
  await expect(subscriptionList(page).getByText(editedName)).toBeVisible();
  await page.reload();
  const list = subscriptionList(page);
  await expect(list.getByText(editedName)).toBeVisible();
  await expect(list.getByText(/31,50/).first()).toBeVisible();
  await expect(list.getByText(name)).toHaveCount(0);

  // 3. Delete: the dialog names the subscription; "Usuń" in it sends DELETE.
  await page.getByRole('button', { name: `Usuń ${editedName}`, exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Usunąć subskrypcję?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(editedName)).toBeVisible();
  await dialog.getByRole('button', { name: 'Usuń', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // 4. After a reload: the anchor first (the list has loaded), then the deleted row is gone.
  await page.reload();
  await expect(subscriptionList(page).getByText(anchorName)).toBeVisible();
  await expect(page.getByText(editedName)).toHaveCount(0);
});
