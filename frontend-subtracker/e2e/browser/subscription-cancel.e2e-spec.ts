import { expect, type Page, test } from '@playwright/test';
import { createE2eAccounts, sessionCookie } from '../support/accounts';
import { createSubscriptionThroughApi } from '../support/subscriptions';

// Risk: #7 (cancel dialog and resume work end to end); roadmap S-05 — context/foundation/test-plan.md §2.
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
  await createSubscriptionThroughApi(request, token, name);

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
