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
  categories: [
    {
      category: { id: 'category-streaming', name: 'Streaming', isDefault: true },
      monthly: '73.00',
      yearly: '876.00',
      subscriptionCount: 3,
      duplicateThreshold: 2,
      duplicateWarning: 'exceeded',
    },
    {
      category: { id: 'category-muzyka', name: 'Muzyka', isDefault: true },
      monthly: '23.99',
      yearly: '287.88',
      subscriptionCount: 1,
      duplicateThreshold: 3,
      duplicateWarning: 'none',
    },
  ],
};
const NO_TOTALS: CostTotals = { monthly: '0.00', yearly: '0.00', categories: [] };

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

  it('shows the empty state instead of the table without counted subscriptions', async () => {
    const { host } = await createPage(NO_TOTALS);

    expect(text(host.querySelector('.dashboard__panel'))).toContain(
      'Nie masz jeszcze żadnych aktywnych subskrypcji.',
    );
    expect(host.querySelector('.dashboard__table')).toBeNull();
  });

  it('links to the budget page', async () => {
    const { host } = await createPage(WARNED);

    const link = Array.from(host.querySelectorAll('a')).find(
      (anchor) => text(anchor) === 'Zmień progi',
    );
    expect(link?.getAttribute('href')).toBe('/budget');
  });
});
