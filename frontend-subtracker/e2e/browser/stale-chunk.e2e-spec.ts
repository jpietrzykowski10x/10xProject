import { expect, type Page, test } from '@playwright/test';

// Risk: none of §2: roadmap S-15 (after a deploy a click on a lazy route did nothing) — context/foundation/test-plan.md §2.
// A tab opened before a deploy asks for a chunk-*.js the deploy removed (404). The router's
// navigation error handler reloads the target address once per 60 s (shared/chunk-reload.ts); a second failure
// within that window shows /unavailable instead of looping. The decisions are covered by unit
// tests; here the real browser proves the failed import() is recognized and the reload happens.
//
// The deploy is simulated with page.route: chunks fetched while /sign-in loaded stay (they are in
// the "old" tab already), every other chunk answers 404 like a removed file. /register has its own
// lazy chunk that /sign-in never fetched, so the click on "Zarejestruj się" needs a new one.
const CHUNK = /\/chunk-[^/]+\.js$/;

interface StaleTab {
  loads: () => number;
  // 404 answers before the first reload and after it (the new page asked again).
  missingChunks: () => { before: number; after: number };
}

async function openSignInAfterDeploy(page: Page, missing: 'once' | 'always'): Promise<StaleTab> {
  const fetched = new Set<string>();
  const collect = (url: string): void => {
    if (CHUNK.test(new URL(url).pathname)) {
      fetched.add(url);
    }
  };
  page.on('request', (request) => collect(request.url()));
  await page.goto('/sign-in', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Logowanie', exact: true })).toBeVisible();
  page.removeAllListeners('request');

  let loads = 0;
  const missingChunks = { before: 0, after: 0 };
  await page.route(CHUNK, async (route) => {
    const url = route.request().url();
    if (fetched.has(url) || (missing === 'once' && missingChunks.before > 0)) {
      await route.continue();
      return;
    }
    if (loads === 0) {
      missingChunks.before += 1;
    } else {
      missingChunks.after += 1;
    }
    // What the SSR server answers for a file that is gone (server.ts: Express "Cannot GET").
    await route.fulfill({ status: 404, contentType: 'text/html', body: 'Cannot GET' });
  });

  page.on('load', () => {
    loads += 1;
  });
  return { loads: () => loads, missingChunks: () => ({ ...missingChunks }) };
}

test('a removed chunk reloads the target address once and the page works', async ({ page }) => {
  const tab = await openSignInAfterDeploy(page, 'once');

  const reloaded = page.waitForEvent('load');
  await page.getByRole('link', { name: 'Zarejestruj się' }).click();
  await reloaded;

  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole('heading', { name: 'Rejestracja', exact: true })).toBeVisible();
  expect(tab.missingChunks().before).toBeGreaterThan(0);
  expect(tab.missingChunks().after).toBe(0);
  expect(tab.loads()).toBe(1);
});

test('a chunk still missing after the reload shows the unavailable page without a loop', async ({
  page,
}) => {
  const tab = await openSignInAfterDeploy(page, 'always');

  const reloaded = page.waitForEvent('load');
  await page.getByRole('link', { name: 'Zarejestruj się' }).click();
  await reloaded;

  await expect(
    page.getByRole('heading', { name: 'Serwis chwilowo niedostępny', exact: true }),
  ).toBeVisible();
  // skipLocationChange: the address stays the target, so a later refresh tries it again.
  await expect(page).toHaveURL(/\/register$/);
  // No second reload: a loop would load the page again right away.
  await expect(page.waitForEvent('load', { timeout: 3_000 })).rejects.toThrow();
  expect(tab.loads()).toBe(1);
  // The reloaded page asked for the missing file again and got 404 again.
  expect(tab.missingChunks().before).toBeGreaterThan(0);
  expect(tab.missingChunks().after).toBeGreaterThan(0);
});
