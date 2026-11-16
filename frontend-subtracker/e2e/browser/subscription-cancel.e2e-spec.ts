import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { API_ORIGIN, createE2eAccounts, SESSION_COOKIE, sessionCookie } from '../support/accounts';

// Cancel and resume in a real browser against the real API (desktop layout): "Anuluj subskrypcję"
// confirms in the dialog and the row turns "W trakcie anulowania", "Przywróć" makes it "Aktywna"
// again; each state is checked after a reload, so it was stored. The dialog's texts and results,
// the actions per status and the phone layout are covered by component tests; the transitions,
// 404/409 and account isolation by the backend e2e tests.
const accounts = createE2eAccounts({ addressPrefix: 'e2e-browser-cancel-' });

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
async function createActiveSubscriptionThroughApi(
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

// The row of the subscription in the list as rendered from the API's answer (not the status
// message, which also names it).
function row(page: Page, name: string) {
  return page
    .getByRole('region', { name: 'Lista subskrypcji', exact: true })
    .getByRole('row')
    .filter({ hasText: name });
}

test('a subscription cancelled in the dialog is "W trakcie anulowania" and "Przywróć" makes it "Aktywna" again, both after a reload', async ({
  context,
  page,
  request,
}) => {
  const name = `E2E cancel target ${Date.now()}`;

  const account = await accounts.newAccount();
  const token = await accounts.sessionFor(account);
  await createActiveSubscriptionThroughApi(request, token, name);

  await context.addCookies([sessionCookie(token)]);
  await page.goto('/subscriptions');
  await expect(row(page, name).getByText('Aktywna', { exact: true })).toBeVisible();

  // 1. Cancel: the dialog names the subscription; "Anuluj subskrypcję" in it sends the POST.
  await page.getByRole('button', { name: `Anuluj subskrypcję ${name}`, exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Anulować subskrypcję?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(name)).toBeVisible();
  await dialog.getByRole('button', { name: 'Anuluj subskrypcję', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row(page, name).getByText('W trakcie anulowania', { exact: true })).toBeVisible();

  // 2. After a reload the list comes from the API, so the cancel was stored.
  await page.reload();
  await expect(row(page, name).getByText('W trakcie anulowania', { exact: true })).toBeVisible();

  // 3. Resume: no dialog, the row is active again, also after a reload.
  await page.getByRole('button', { name: `Przywróć ${name}`, exact: true }).click();
  await expect(row(page, name).getByText('Aktywna', { exact: true })).toBeVisible();
  await page.reload();
  await expect(row(page, name).getByText('Aktywna', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Anuluj subskrypcję ${name}`, exact: true }),
  ).toBeVisible();
});
