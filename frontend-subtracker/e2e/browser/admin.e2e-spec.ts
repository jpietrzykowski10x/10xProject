import { expect, test } from '@playwright/test';
import { createE2eAccounts, sessionCookie } from '../support/accounts';

// S-09: the one critical admin flow in the browser, against the e2e build and the real API: an
// administrator finds an account, blocks it, and its owner sees the block with a contact address
// at sign-in. Plus the role guard: an ordinary user never gets the admin pages. The matrix of
// roles, states and API answers is covered by the unit tests and the backend e2e.
const accounts = createE2eAccounts({ addressPrefix: 'e2e-browser-admin-' });

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

test('an administrator blocks an account and its owner sees the block at sign-in', async ({
  browser,
  context,
  page,
}) => {
  const admin = await accounts.newAccount({ roles: ['ADMIN'] });
  const target = await accounts.newAccount();
  await context.addCookies([sessionCookie(await accounts.sessionFor(admin))]);

  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Administracja', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Adres e-mail lub jego fragment' }).fill(target.email);
  await page.getByRole('button', { name: 'Szukaj' }).click();
  await page
    .getByRole('region', { name: 'Wyniki wyszukiwania' })
    .getByRole('link', { name: target.email })
    .click();

  await expect(page.getByRole('heading', { name: target.email, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Zablokuj' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Zablokować konto?' });
  await dialog.getByRole('button', { name: 'Zablokuj' }).click();
  await expect(page.getByText('Konto zostało zablokowane.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Odblokuj' })).toBeVisible();

  // The owner, in a browser without the administrator's session.
  const ownerContext = await browser.newContext();
  try {
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto('/sign-in');
    await ownerPage.getByRole('textbox', { name: 'Adres e-mail' }).fill(target.email);
    await ownerPage.getByRole('button', { name: 'Wyślij link' }).click();

    const alert = ownerPage.getByRole('alert');
    await expect(alert).toContainText('Konto zostało zablokowane.');
    await expect(alert.getByRole('link')).toHaveAttribute('href', /^mailto:.+@.+/);
  } finally {
    await ownerContext.close();
  }
});

test('an ordinary user on the admin pages lands on the list', async ({ context, page }) => {
  const user = await accounts.newAccount();
  await context.addCookies([sessionCookie(await accounts.sessionFor(user))]);

  await page.goto('/admin/users');

  await expect(page).toHaveURL(/\/subscriptions$/);
  await expect(page.getByRole('heading', { name: 'Twoje subskrypcje', exact: true })).toBeVisible();
  // Anchored by the heading above: no admin link in the navigation.
  await expect(page.getByRole('link', { name: 'Administracja' })).toHaveCount(0);
});
