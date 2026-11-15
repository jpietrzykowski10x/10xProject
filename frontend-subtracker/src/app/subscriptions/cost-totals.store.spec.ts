import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { CostTotalsStore } from './cost-totals.store';
import type { CostTotals } from './subscription.types';

const TOTALS_URL = `${environment.apiUrl}/subscriptions/totals`;

const BEFORE: CostTotals = { monthly: '43.00', yearly: '516.00', categories: [] };
const AFTER: CostTotals = { monthly: '0.00', yearly: '0.00', categories: [] };

function setUp() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    httpTesting: TestBed.inject(HttpTestingController),
    store: TestBed.inject(CostTotalsStore),
  };
}

function failTotals(httpTesting: HttpTestingController): void {
  httpTesting
    .expectOne({ method: 'GET', url: TOTALS_URL })
    .flush(null, { status: 500, statusText: 'Internal Server Error' });
}

// The quiet refresh after a save, from the plan: the totals on screen stay until the answer, and a
// failure keeps them; only with nothing shown is a failure an error. The component spec covers
// load(), clear() and what reaches the screen.
describe('CostTotalsStore', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('keeps the current totals while a refresh is on its way, then shows the new ones', () => {
    const { httpTesting, store } = setUp();
    store.load();
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(BEFORE);

    store.refresh();
    expect(store.state()).toEqual({ kind: 'ready', totals: BEFORE });

    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(AFTER);
    expect(store.state()).toEqual({ kind: 'ready', totals: AFTER });
  });

  it('keeps the current totals when a refresh fails', () => {
    const { httpTesting, store } = setUp();
    store.load();
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(BEFORE);

    store.refresh();
    failTotals(httpTesting);

    expect(store.state()).toEqual({ kind: 'ready', totals: BEFORE });
  });

  it('is an error when a refresh fails with no totals shown', () => {
    const { httpTesting, store } = setUp();
    store.load();
    failTotals(httpTesting);
    expect(store.state()).toEqual({ kind: 'error' });

    store.refresh();
    failTotals(httpTesting);

    expect(store.state()).toEqual({ kind: 'error' });
  });

  it('cancels an older request, so its answer never overwrites a newer one', () => {
    const { httpTesting, store } = setUp();
    store.load();
    const older = httpTesting.expectOne({ method: 'GET', url: TOTALS_URL });

    store.refresh();

    expect(older.cancelled).toBe(true);
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(AFTER);
    expect(store.state()).toEqual({ kind: 'ready', totals: AFTER });
  });

  it('drops the totals and cancels a request on clear()', () => {
    const { httpTesting, store } = setUp();
    store.load();
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(BEFORE);
    store.refresh();
    const pending = httpTesting.expectOne({ method: 'GET', url: TOTALS_URL });

    store.clear();

    expect(pending.cancelled).toBe(true);
    expect(store.state()).toEqual({ kind: 'loading' });
  });
});
