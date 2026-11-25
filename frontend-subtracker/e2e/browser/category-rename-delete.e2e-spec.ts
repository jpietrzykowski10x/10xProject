import { expect, type Page, test } from '@playwright/test';
import { createE2eAccounts, sessionCookie } from '../support/accounts';
import { createCategoryThroughApi, createSubscriptionThroughApi } from '../support/subscriptions';

// Roadmap S-17 (FR-025): adding, renaming and deleting an own category on /budget in a real browser
// against the real API (desktop layout). A rename shows the new name in the row, a category with a
// subscription is refused with the message in the dialog, an empty one is deleted and stays gone
// after a reload, and the icons are off while a threshold is typed but not saved. The dialogs'
// texts and results, the page's reload and the defaults without icons are covered by component
// tests; 404/409, account isolation and the race with a subscription by the backend e2e tests.
const accounts = createE2eAccounts({ addressPrefix: 'e2e-browser-categories-' });

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

// The row of a category, labelled by its name (role="group" on /budget).
function categoryRow(page: Page, name: string) {
  return page.getByRole('group', { name, exact: true });
}

function statusMessage(page: Page, message: string) {
  return page.getByRole('status').filter({ hasText: message });
}

test('an own category is renamed, a category with a subscription is refused, an empty one is deleted', async ({
  context,
  page,
  request,
}) => {
  const stamp = Date.now();
  const empty = `E2E pusta ${stamp}`;
  const renamed = `E2E nowa nazwa ${stamp}`;
  const used = `E2E z subskrypcją ${stamp}`;

  const account = await accounts.newAccount();
  const token = await accounts.sessionFor(account);
  await createCategoryThroughApi(request, token, empty);
  const usedId = await createCategoryThroughApi(request, token, used);
  await createSubscriptionThroughApi(request, token, `E2E subskrypcja ${stamp}`, {
    categoryId: usedId,
  });

  await context.addCookies([sessionCookie(token)]);
  await page.goto('/budget');
  await expect(categoryRow(page, empty)).toBeVisible();

  // 1. Rename: the dialog opens with the current name; the new one is in the row afterwards.
  await page.getByRole('button', { name: `Zmień nazwę kategorii ${empty}`, exact: true }).click();
  const renameDialog = page.getByRole('dialog', { name: 'Zmień nazwę kategorii' });
  const nameField = renameDialog.getByRole('textbox', { name: 'Nazwa kategorii' });
  await expect(nameField).toHaveValue(empty);
  await nameField.fill(renamed);
  await renameDialog.getByRole('button', { name: 'Zapisz', exact: true }).click();
  await expect(renameDialog).toHaveCount(0);
  await expect(statusMessage(page, 'Zmieniono nazwę kategorii.')).toBeVisible();
  await expect(categoryRow(page, renamed)).toBeVisible();
  await expect(categoryRow(page, empty)).toHaveCount(0);

  // 2. A category with a subscription: the API refuses it and the dialog says what to do first.
  await page.getByRole('button', { name: `Usuń kategorię ${used}`, exact: true }).click();
  const refusedDialog = page.getByRole('alertdialog', { name: `Usunąć kategorię ${used}?` });
  await refusedDialog.getByRole('button', { name: 'Usuń', exact: true }).click();
  await expect(
    refusedDialog.getByText(
      'Ta kategoria ma subskrypcje. Przenieś je do innej kategorii albo usuń, a potem usuń kategorię.',
    ),
  ).toBeVisible();
  await expect(refusedDialog.getByRole('button', { name: 'Usuń', exact: true })).toBeDisabled();
  await refusedDialog.getByRole('button', { name: 'Anuluj', exact: true }).click();
  await expect(refusedDialog).toHaveCount(0);
  await expect(categoryRow(page, used)).toBeVisible();

  // 3. The empty category is deleted; after a reload the list comes from the API, so it is gone.
  await page.getByRole('button', { name: `Usuń kategorię ${renamed}`, exact: true }).click();
  const deleteDialog = page.getByRole('alertdialog', { name: `Usunąć kategorię ${renamed}?` });
  await deleteDialog.getByRole('button', { name: 'Usuń', exact: true }).click();
  await expect(deleteDialog).toHaveCount(0);
  await expect(statusMessage(page, 'Usunięto kategorię.')).toBeVisible();
  await expect(categoryRow(page, renamed)).toHaveCount(0);
  await page.reload();
  await expect(categoryRow(page, used)).toBeVisible();
  await expect(categoryRow(page, renamed)).toHaveCount(0);

  // 4. A typed but unsaved threshold turns the icons off; typing the old value back turns them on.
  const threshold = categoryRow(page, used).getByRole('textbox', { name: 'Próg' });
  const deleteUsed = page.getByRole('button', { name: `Usuń kategorię ${used}`, exact: true });
  const saved = await threshold.inputValue();
  await threshold.fill(saved === '7' ? '8' : '7');
  await expect(deleteUsed).toBeDisabled();
  await expect(
    page.getByRole('button', { name: `Zmień nazwę kategorii ${used}`, exact: true }),
  ).toBeDisabled();
  await threshold.fill(saved);
  await expect(deleteUsed).toBeEnabled();
});

// "Nowa kategoria" below the list: the added category gets its own row from the API, the field is
// empty again and "Dodaj" off until a new name is typed. Taken names, 409 and the errors are
// covered by component tests.
test('an own category is added on /budget', async ({ context, page }) => {
  const added = `E2E dodana ${Date.now()}`;

  const account = await accounts.newAccount();
  const token = await accounts.sessionFor(account);
  await context.addCookies([sessionCookie(token)]);
  await page.goto('/budget');

  const nameField = page.getByRole('textbox', { name: 'Nazwa nowej kategorii' });
  const addButton = page.getByRole('button', { name: 'Dodaj', exact: true });
  await expect(addButton).toBeDisabled();
  await nameField.fill(added);
  await expect(addButton).toBeEnabled();
  await addButton.click();

  await expect(statusMessage(page, 'Dodano kategorię.')).toBeVisible();
  await expect(categoryRow(page, added)).toBeVisible();
  await expect(nameField).toHaveValue('');
  await expect(addButton).toBeDisabled();
  await expect(
    page.getByRole('button', { name: `Usuń kategorię ${added}`, exact: true }),
  ).toBeVisible();
});
