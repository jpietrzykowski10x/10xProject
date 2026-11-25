import { expect, type Page, test } from '@playwright/test';
import { createE2eAccounts, sessionCookie } from '../support/accounts';
import { createCategoryThroughApi, createSubscriptionThroughApi } from '../support/subscriptions';

// Risk: #5 (Polish name order of the list), #7 (the list's fields, paginator and empty filter result); roadmap S-18 — context/foundation/test-plan.md §2.
// The list's order, filters and pages in a real browser against the real API: the API sorts in
// Polish order, the choice lives in the address (so a reload keeps it), the paginator moves to
// page 2, and an empty result of a filter offers "Wyczyść filtry". On the phone the three fields
// stack. Every order and filter of the API is covered by the backend e2e tests, the fields'
// values and requests by the page's component tests.
const accounts = createE2eAccounts({ addressPrefix: 'e2e-browser-sort-filter-' });

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

// In Polish order; the code-point order would put "akordeon" after the capitals and "Ćwiczenia" and
// "Łódź" after every ASCII letter.
const POLISH_ORDER = ['akordeon', 'Czytnik', 'Ćwiczenia', 'Dysk', 'Lampa', 'Łódź'];
// 21 more rows after them by name ("Serwis 01" to "Serwis 21"), 27 in all: one full page of 25 and
// 2 rows on page 2.
const FILLERS = Array.from(
  { length: 21 },
  (_, index) => `Serwis ${String(index + 1).padStart(2, '0')}`,
);
const TRIALS = ['Dysk', 'Serwis 05', 'Serwis 10'];

// The data rows of the list (not the row of column names).
function rows(page: Page) {
  return page
    .getByRole('region', { name: 'Lista subskrypcji', exact: true })
    .getByRole('row')
    .filter({ has: page.getByRole('cell') });
}

// The name cell of a row also holds the category, so its text only starts with the name.
function nameCell(page: Page, index: number) {
  return rows(page).nth(index).getByRole('cell').first();
}

// Waits until the options are gone: a select clicked again while its panel is still closing opens
// and at once closes, so the next choice would find no option.
async function choose(page: Page, field: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: field }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
}

test('the list is sorted in Polish order, filtered and paged by the API, and the address keeps it', async ({
  context,
  page,
  request,
}) => {
  const account = await accounts.newAccount();
  const token = await accounts.sessionFor(account);
  const emptyCategory = `E2E pusta ${Date.now()}`;
  await createCategoryThroughApi(request, token, emptyCategory);
  // Created out of name order, with distinct amounts and one yearly row, so neither the order of
  // creation nor the amount gives the name order by chance.
  const names = [...FILLERS.slice(0, 10), ...[...POLISH_ORDER].reverse(), ...FILLERS.slice(10)];
  for (const [index, name] of names.entries()) {
    await createSubscriptionThroughApi(request, token, name, {
      amount: 10 + index,
      billingCycle: name === 'Lampa' ? 'yearly' : 'monthly',
      status: TRIALS.includes(name) ? 'trial' : 'active',
    });
  }

  await context.addCookies([sessionCookie(token)]);
  await page.goto('/subscriptions');
  await expect(rows(page)).toHaveCount(25);

  // 1. "Nazwa A–Ż": the API's Polish order, and the address names it.
  await choose(page, 'Sortuj', 'Nazwa A–Ż');
  await expect(page).toHaveURL(/\/subscriptions\?sort=name_asc$/);
  for (const [index, name] of POLISH_ORDER.entries()) {
    await expect(nameCell(page, index)).toHaveText(new RegExp(`^\\s*${name}\\s`));
  }

  // 2. The status filter narrows the list to the three trials, "Wszystkie" brings back all.
  await choose(page, 'Status', 'Trial');
  await expect(page).toHaveURL(/\?sort=name_asc&status=trial$/);
  await expect(rows(page)).toHaveCount(TRIALS.length);
  await choose(page, 'Status', 'Wszystkie');
  await expect(page).toHaveURL(/\?sort=name_asc$/);
  await expect(rows(page)).toHaveCount(25);

  // 3. Page 2 holds the last 2 rows by name, also after a reload.
  await page.getByRole('button', { name: 'Następna strona', exact: true }).click();
  await expect(page).toHaveURL(/\?sort=name_asc&page=2$/);
  await expect(rows(page)).toHaveCount(2);
  await expect(nameCell(page, 0)).toContainText('Serwis 20');
  await expect(nameCell(page, 1)).toContainText('Serwis 21');
  await page.reload();
  await expect(rows(page)).toHaveCount(2);
  await expect(nameCell(page, 0)).toContainText('Serwis 20');
  await expect(page.getByText('26–27 z 27', { exact: true })).toBeVisible();

  // 4. A category without subscriptions: the empty result of a filter, and "Wyczyść filtry" goes
  // back to page 1 of the same order.
  await choose(page, 'Kategoria', emptyCategory);
  await expect(page.getByText('Brak subskrypcji spełniających filtry.')).toBeVisible();
  await expect(page.getByText('Nie masz jeszcze żadnych subskrypcji.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Wyczyść filtry', exact: true }).click();
  await expect(page).toHaveURL(/\/subscriptions\?sort=name_asc$/);
  await expect(rows(page)).toHaveCount(25);
  await expect(nameCell(page, 0)).toHaveText(/^\s*akordeon\s/);

  // 5. On the phone the three fields stand one under another at the full width.
  await page.setViewportSize({ width: 390, height: 844 });
  const boxes: { x: number; y: number; width: number; height: number }[] = [];
  for (const field of ['Sortuj', 'Kategoria', 'Status']) {
    const combobox = page.getByRole('combobox', { name: field });
    await expect(combobox).toBeVisible();
    const box = await combobox.boundingBox();
    if (box === null) {
      throw new Error(`The field ${field} has no box`);
    }
    boxes.push(box);
  }
  const [sort, category, status] = boxes;
  expect(category.y).toBeGreaterThan(sort.y + sort.height);
  expect(status.y).toBeGreaterThan(category.y + category.height);
  for (const box of boxes) {
    expect(box.x).toBeCloseTo(sort.x, 0);
    expect(box.width).toBeGreaterThan(300);
  }
});
