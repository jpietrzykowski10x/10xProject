import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { CostTotalsStore } from '../cost-totals.store';
import type { CostTotals as CostTotalsResponse } from '../subscription.types';
import { CostTotals } from './cost-totals';

const TOTALS_URL = `${environment.apiUrl}/subscriptions/totals`;

// The oracle is the worked example of the plan (backend cost-totals.spec.ts, phase 1): active
// 43,00 zł/month (Streaming), trial 23,99 zł/month (Muzyka), cancelled_pending 429,99 zł/year
// (Praca), cancelled 50,00 zł/month (Streaming, not counted). Monthly 43,00 + 23,99 + 35,83 =
// 102,82 zł; yearly (43,00 + 23,99) × 12 + 429,99 = 1 233,87 zł. Categories in the API's order.
const EXAMPLE: CostTotalsResponse = {
  monthly: '102.82',
  yearly: '1233.87',
  categories: [
    {
      category: { id: 'category-streaming', name: 'Streaming', isDefault: true },
      monthly: '43.00',
      yearly: '516.00',
      subscriptionCount: 1,
      duplicateThreshold: 2,
      duplicateWarning: 'none',
    },
    {
      category: { id: 'category-praca', name: 'Praca', isDefault: true },
      monthly: '35.83',
      yearly: '429.99',
      subscriptionCount: 1,
      duplicateThreshold: 2,
      duplicateWarning: 'none',
    },
    {
      category: { id: 'category-muzyka', name: 'Muzyka', isDefault: true },
      monthly: '23.99',
      yearly: '287.88',
      subscriptionCount: 1,
      duplicateThreshold: 2,
      duplicateWarning: 'none',
    },
  ],
};

const EMPTY: CostTotalsResponse = { monthly: '0.00', yearly: '0.00', categories: [] };

// pl-PL prints no-break spaces ("1 233,87 zł"); the assertions compare plain spaces.
function text(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

// The shell's part: the component on the page and the store loaded, as AppShell does on init.
async function createTotals(variant: 'column' | 'bar' = 'column') {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const httpTesting = TestBed.inject(HttpTestingController);
  const store = TestBed.inject(CostTotalsStore);
  const fixture: ComponentFixture<CostTotals> = TestBed.createComponent(CostTotals);
  fixture.componentRef.setInput('variant', variant);
  store.load();
  await fixture.whenStable();
  return { httpTesting, store, fixture, host: fixture.nativeElement as HTMLElement };
}

describe('CostTotals', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('should create', async () => {
    const { httpTesting, fixture } = await createTotals();
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(EMPTY);
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
  });

  it.each(['column', 'bar'] as const)(
    'shows the sums and the categories of the API answer in the %s',
    async (variant) => {
      const { httpTesting, fixture, host } = await createTotals(variant);
      expect(text(host)).toBe('Wczytywanie sum…');

      httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(EXAMPLE);
      await fixture.whenStable();

      expect(text(host.querySelector('.totals__monthly .st-amount'))).toBe('102,82 zł');
      expect(text(host.querySelector('.totals__yearly .st-amount'))).toBe('1 233,87 zł');
      expect([...host.querySelectorAll('.totals__label')].map((label) => text(label))).toEqual([
        'Miesięcznie',
        'Rocznie',
      ]);
      expect(text(host.querySelector('summary'))).toBe('Kategorie');
      const rows = [...host.querySelectorAll('.totals__category')].map((row) => [
        text(row.querySelector('dt')),
        ...[...row.querySelectorAll('dd')].map((dd) => text(dd)),
      ]);
      expect(rows).toEqual([
        ['Streaming', '43,00 zł', '516,00 zł rocznie · 1 subskrypcja'],
        ['Praca', '35,83 zł', '429,99 zł rocznie · 1 subskrypcja'],
        ['Muzyka', '23,99 zł', '287,88 zł rocznie · 1 subskrypcja'],
      ]);
    },
  );

  it('shows the count of subscriptions in a category in its Polish form', async () => {
    const { httpTesting, fixture, host } = await createTotals();
    const [streaming] = EXAMPLE.categories;
    httpTesting
      .expectOne({ method: 'GET', url: TOTALS_URL })
      .flush({ ...EXAMPLE, categories: [{ ...streaming, subscriptionCount: 3 }] });
    await fixture.whenStable();

    expect(text(host.querySelector('.totals__category-note'))).toBe(
      '516,00 zł rocznie · 3 subskrypcje',
    );
  });

  it('shows zero sums and no categories for an account without counted subscriptions', async () => {
    const { httpTesting, fixture, host } = await createTotals();
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(EMPTY);
    await fixture.whenStable();

    expect(text(host.querySelector('.totals__monthly .st-amount'))).toBe('0,00 zł');
    expect(text(host.querySelector('.totals__yearly .st-amount'))).toBe('0,00 zł');
    expect(host.querySelector('details')).toBeNull();
  });

  // Risk #7 (S-07): the duplicate warning must show exactly when the API reports one. The oracle is
  // the API contract (backend duplicate-warning.ts): reached at the threshold, exceeded above it.
  describe('duplicate warnings', () => {
    const [streaming, praca, muzyka] = EXAMPLE.categories;
    const REACHED = { ...streaming, subscriptionCount: 2, duplicateWarning: 'reached' as const };
    const EXCEEDED = { ...muzyka, subscriptionCount: 3, duplicateWarning: 'exceeded' as const };

    it('shows no icon and no outline when no category warns', async () => {
      const { httpTesting, fixture, host } = await createTotals();
      httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(EXAMPLE);
      await fixture.whenStable();

      expect(host.querySelectorAll('app-duplicate-warning-icon')).toHaveLength(0);
      expect(host.querySelectorAll('[data-warning]')).toHaveLength(0);
      expect(host.querySelectorAll('.totals__category-warning')).toHaveLength(0);
    });

    it.each(['column', 'bar'] as const)(
      'marks the summary and the row of a category at its threshold in the %s',
      async (variant) => {
        const { httpTesting, fixture, host } = await createTotals(variant);
        httpTesting
          .expectOne({ method: 'GET', url: TOTALS_URL })
          .flush({ ...EXAMPLE, categories: [REACHED, praca] });
        await fixture.whenStable();

        const summary = host.querySelector('summary');
        expect(summary?.getAttribute('data-warning')).toBe('reached');
        const summaryIcon = summary?.querySelector('app-duplicate-warning-icon');
        expect(summaryIcon?.getAttribute('data-warning')).toBe('reached');
        expect(summaryIcon?.querySelector('svg')?.getAttribute('role')).toBe('img');
        expect(summaryIcon?.querySelector('svg')?.getAttribute('aria-label')).toBeTruthy();

        const rows = [...host.querySelectorAll('.totals__category')];
        expect(rows.map((row) => row.getAttribute('data-warning'))).toEqual(['reached', null]);
        expect(
          rows.map((row) => row.querySelectorAll('app-duplicate-warning-icon').length),
        ).toEqual([1, 0]);
        expect(rows.map((row) => row.querySelectorAll('.totals__category-warning').length)).toEqual(
          [1, 0],
        );
      },
    );

    it('marks the summary with the most severe warning of the categories', async () => {
      const { httpTesting, fixture, host } = await createTotals();
      httpTesting
        .expectOne({ method: 'GET', url: TOTALS_URL })
        .flush({ ...EXAMPLE, categories: [REACHED, praca, EXCEEDED] });
      await fixture.whenStable();

      const summary = host.querySelector('summary');
      expect(summary?.getAttribute('data-warning')).toBe('exceeded');
      expect(
        summary?.querySelector('app-duplicate-warning-icon')?.getAttribute('data-warning'),
      ).toBe('exceeded');
      expect(
        [...host.querySelectorAll('.totals__category')].map((row) =>
          row.getAttribute('data-warning'),
        ),
      ).toEqual(['reached', null, 'exceeded']);
    });

    it('describes the warning of a row in words', async () => {
      const { httpTesting, fixture, host } = await createTotals();
      httpTesting
        .expectOne({ method: 'GET', url: TOTALS_URL })
        .flush({ ...EXAMPLE, categories: [REACHED, EXCEEDED] });
      await fixture.whenStable();

      expect([...host.querySelectorAll('.totals__category-warning')].map((dd) => text(dd))).toEqual(
        ['Osiągnięto próg: 2 z 2', 'Przekroczono próg: 3 z 2'],
      );
    });
  });

  it('shows a muted message when the totals cannot be read', async () => {
    const { httpTesting, fixture, host } = await createTotals();
    httpTesting
      .expectOne({ method: 'GET', url: TOTALS_URL })
      .flush(null, { status: 500, statusText: 'Internal Server Error' });
    await fixture.whenStable();

    expect(text(host)).toBe('Nie udało się wczytać sum.');
  });

  // Risk #1 on the front: the store outlives the shell, so after a sign-out (clear) and the next
  // shell's load the previous account's amounts must not show while the new answer is on its way.
  it('shows no amounts of the previous load after clear() and a new load()', async () => {
    const { httpTesting, store, fixture, host } = await createTotals();
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(EXAMPLE);
    await fixture.whenStable();
    expect(text(host)).toContain('102,82 zł');

    store.clear();
    store.load();
    await fixture.whenStable();

    expect(text(host)).toBe('Wczytywanie sum…');
    httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(EMPTY);
    await fixture.whenStable();
    expect(text(host.querySelector('.totals__monthly .st-amount'))).toBe('0,00 zł');
  });
});
