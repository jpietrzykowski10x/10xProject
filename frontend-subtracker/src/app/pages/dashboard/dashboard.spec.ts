import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import type { CostTotals } from '../../subscriptions/subscription.types';
import { Dashboard } from './dashboard';

const TOTALS_URL = `${environment.apiUrl}/subscriptions/totals`;

// GET /subscriptions/totals with a warning (backend duplicate-warning.ts): Streaming has 3 counted
// subscriptions over its stored threshold 2 (exceeded), Muzyka 1 under the default 3 (none).
const WARNED: CostTotals = {
  monthly: '96.99',
  yearly: '1163.88',
  monthlyLimit: null,
  budgetAlert: 'none',
  categories: [
    {
      category: { id: 'category-streaming', name: 'Streaming', isDefault: true },
      monthly: '73.00',
      yearly: '876.00',
      subscriptionCount: 3,
      duplicateThreshold: 2,
      duplicateWarning: 'exceeded',
      monthlyLimit: null,
      budgetAlert: 'none',
    },
    {
      category: { id: 'category-muzyka', name: 'Muzyka', isDefault: true },
      monthly: '23.99',
      yearly: '287.88',
      subscriptionCount: 1,
      duplicateThreshold: 3,
      duplicateWarning: 'none',
      monthlyLimit: null,
      budgetAlert: 'none',
    },
  ],
};
// GET /subscriptions/totals with limits (backend budget-alert.ts): 116,99 of the overall 120,00 zł
// is 97% (near); Streaming 73,00 over its 60,00 (exceeded), Muzyka 23,99 within its 30,00 (none),
// Zdrowie without a limit.
const LIMITED: CostTotals = {
  monthly: '116.99',
  yearly: '1403.88',
  monthlyLimit: '120.00',
  budgetAlert: 'near',
  categories: [
    { ...WARNED.categories[0], monthlyLimit: '60.00', budgetAlert: 'exceeded' },
    { ...WARNED.categories[1], monthlyLimit: '30.00', budgetAlert: 'none' },
    {
      category: { id: 'category-zdrowie', name: 'Zdrowie', isDefault: true },
      monthly: '20.00',
      yearly: '240.00',
      subscriptionCount: 1,
      duplicateThreshold: 3,
      duplicateWarning: 'none',
      monthlyLimit: null,
      budgetAlert: 'none',
    },
  ],
};
const NO_TOTALS: CostTotals = {
  monthly: '0.00',
  yearly: '0.00',
  monthlyLimit: null,
  budgetAlert: 'none',
  categories: [],
};

function text(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

// The page shows the store its shell loads: the only request is the shell's read of the totals.
async function createPage(totals: CostTotals) {
  TestBed.configureTestingModule({
    imports: [Dashboard],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  const httpTesting = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(Dashboard);
  await fixture.whenStable();
  httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(totals);
  await fixture.whenStable();
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

describe('Dashboard', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('should create', async () => {
    const { fixture } = await createPage(NO_TOTALS);

    expect(fixture.componentInstance).toBeTruthy();
  });

  // The oracle is the API's warning of each row (S-07): exceeded gets the red icon and the words,
  // none only "W normie". Colour is never the only information.
  it('marks the exceeded category with the icon and the words, the others as "W normie"', async () => {
    const { host } = await createPage(WARNED);

    const rows = host.querySelectorAll('.dashboard__table tbody tr');
    expect(Array.from(rows, (row) => text(row.querySelector('th')))).toEqual([
      'Streaming',
      'Muzyka',
    ]);

    const streaming = rows[0];
    expect(
      streaming.querySelector('app-duplicate-warning-icon')?.getAttribute('data-warning'),
    ).toBe('exceeded');
    expect(text(streaming.querySelector('.dashboard__status'))).toBe('Przekroczono próg: 3 z 2');

    const muzyka = rows[1];
    expect(muzyka.querySelector('app-duplicate-warning-icon')).toBeNull();
    expect(text(muzyka.querySelector('.dashboard__status'))).toBe('W normie');
  });

  // The oracle is the API's limit alert of each row (S-08): exceeded gets the red icon and the
  // words, a limit without an alert "W normie", no limit leaves both limit columns empty.
  it('marks the category over its limit with the icon and the words in the limit columns', async () => {
    const { host } = await createPage(LIMITED);

    const rows = host.querySelectorAll('.dashboard__table tbody tr');
    const streaming = rows[0];
    const limitStatus = streaming.querySelector('.dashboard__limit-status');
    expect(limitStatus?.getAttribute('data-alert')).toBe('exceeded');
    expect(
      limitStatus?.querySelector('app-duplicate-warning-icon')?.getAttribute('data-warning'),
    ).toBe('exceeded');
    expect(text(limitStatus)).toBe('Przekroczono limit');
    expect(text(streaming.querySelector('.dashboard__limit-amount'))).toBe('60,00 zł');

    const muzyka = rows[1];
    expect(text(muzyka.querySelector('.dashboard__limit-status'))).toBe('W normie');
    expect(muzyka.querySelector('.dashboard__limit-status app-duplicate-warning-icon')).toBeNull();

    const zdrowie = rows[2];
    expect(text(zdrowie.querySelector('.dashboard__limit-amount'))).toBe('');
    expect(zdrowie.querySelector('.dashboard__limit-status')).toBeNull();
  });

  // Like the table's empty cells: a card without a limit has no limit line and no limit state.
  it('shows the limit and its state on a phone card only for a category with a limit', async () => {
    const { host } = await createPage(LIMITED);

    const cards = host.querySelectorAll('.dashboard__card');
    expect(text(cards[0].querySelector('.dashboard__limit-status'))).toBe('Przekroczono limit');
    expect(text(cards[0].querySelector('.dashboard__limit-amount'))).toBe(
      'Limit: 73,00 z 60,00 zł',
    );
    expect(cards[2].querySelector('.dashboard__limit-amount')).toBeNull();
    expect(cards[2].querySelector('.dashboard__limit-status')).toBeNull();
  });

  // The oracle is the plan: the overall limit next to the sums, a bar as in the column.
  it('shows the bar of the overall limit with the usage and the state in words', async () => {
    const { host } = await createPage(LIMITED);

    const bar = host.querySelector('.dashboard__limit [role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('97');
    expect(text(host.querySelector('.dashboard__budget-usage'))).toBe('116,99 z 120,00 zł (97%)');
    expect(text(host.querySelector('.dashboard__budget-note'))).toBe('Zbliżasz się do limitu');
    expect(host.querySelector('.dashboard__no-limit')).toBeNull();
  });

  it('shows "Brak limitu" with a link to the budget page instead of a bar without a limit', async () => {
    const { host } = await createPage(WARNED);

    expect(host.querySelector('.dashboard__limit [role="progressbar"]')).toBeNull();
    const noLimit = host.querySelector('.dashboard__no-limit');
    expect(text(noLimit)).toBe('Brak limitu. Ustaw limit');
    expect(noLimit?.querySelector('a')?.getAttribute('href')).toBe('/budget');
  });

  it('shows the empty state instead of the table without counted subscriptions', async () => {
    const { host } = await createPage(NO_TOTALS);

    expect(text(host.querySelector('.dashboard__panel'))).toContain(
      'Nie masz jeszcze żadnych aktywnych subskrypcji.',
    );
    expect(host.querySelector('.dashboard__table')).toBeNull();
  });

  // The limit stays next to the empty state: a bar at 0 zł (no alert) or "Brak limitu".
  it('shows the overall limit next to the empty state without counted subscriptions', async () => {
    const { host } = await createPage({ ...NO_TOTALS, monthlyLimit: '120.00' });

    expect(text(host.querySelector('.dashboard__panel'))).toContain(
      'Nie masz jeszcze żadnych aktywnych subskrypcji.',
    );
    const bar = host.querySelector('.dashboard__limit [role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('0');
    expect(text(host.querySelector('.dashboard__budget-usage'))).toBe('0,00 z 120,00 zł (0%)');
    expect(host.querySelector('.dashboard__budget-note')).toBeNull();
    expect(text(host.querySelector('.dashboard__sums'))).not.toContain('Miesięcznie');
  });

  it('shows "Brak limitu" next to the empty state without a limit', async () => {
    const { host } = await createPage(NO_TOTALS);

    expect(text(host.querySelector('.dashboard__no-limit'))).toBe('Brak limitu. Ustaw limit');
    expect(host.querySelector('.dashboard__panel')).not.toBeNull();
  });

  it('links to the budget page', async () => {
    const { host } = await createPage(WARNED);

    const link = Array.from(host.querySelectorAll('a')).find(
      (anchor) => text(anchor) === 'Zmień progi i limity',
    );
    expect(link?.getAttribute('href')).toBe('/budget');
  });
});
