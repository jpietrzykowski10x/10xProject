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
  monthlyLimit: null,
  budgetAlert: 'none',
  categories: [
    {
      category: { id: 'category-streaming', name: 'Streaming', isDefault: true },
      monthly: '43.00',
      yearly: '516.00',
      subscriptionCount: 1,
      duplicateThreshold: 3,
      duplicateWarning: 'none',
      monthlyLimit: null,
      budgetAlert: 'none',
    },
    {
      category: { id: 'category-praca', name: 'Praca', isDefault: true },
      monthly: '35.83',
      yearly: '429.99',
      subscriptionCount: 1,
      duplicateThreshold: 3,
      duplicateWarning: 'none',
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

const EMPTY: CostTotalsResponse = {
  monthly: '0.00',
  yearly: '0.00',
  monthlyLimit: null,
  budgetAlert: 'none',
  categories: [],
};

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
    // Both with a stored threshold of 2.
    const REACHED = {
      ...streaming,
      subscriptionCount: 2,
      duplicateThreshold: 2,
      duplicateWarning: 'reached' as const,
    };
    const EXCEEDED = {
      ...muzyka,
      subscriptionCount: 3,
      duplicateThreshold: 2,
      duplicateWarning: 'exceeded' as const,
    };

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

  // S-08 (FR-010, FR-011): the limits must show exactly as the API reports them. The oracle is the
  // API contract (backend budget-alert.ts) and the plan of S-08: the share rounded down, the bar
  // full at most, the state in words next to the colour.
  describe('budget limits', () => {
    const [streaming, praca] = EXAMPLE.categories;
    // 10282 gr of 20000 gr = 51.41% → 51%
    const WITH_LIMIT: CostTotalsResponse = { ...EXAMPLE, monthlyLimit: '200.00' };

    async function flush(totals: CostTotalsResponse, variant: 'column' | 'bar' = 'column') {
      const { httpTesting, fixture, host } = await createTotals(variant);
      httpTesting.expectOne({ method: 'GET', url: TOTALS_URL }).flush(totals);
      await fixture.whenStable();
      return host;
    }

    it('shows no bar, no usage and no limit line without limits', async () => {
      const host = await flush(EXAMPLE);

      expect(host.querySelector('[role="progressbar"]')).toBeNull();
      expect(host.querySelector('.totals__budget')).toBeNull();
      expect(host.querySelectorAll('.totals__category-limit')).toHaveLength(0);
      expect(text(host)).not.toContain('Limit');
    });

    it.each(['column', 'bar'] as const)(
      'shows the bar of the overall limit under the monthly sum in the %s',
      async (variant) => {
        const host = await flush(WITH_LIMIT, variant);

        expect(host.querySelector('.totals__monthly + .totals__budget')).not.toBeNull();
        const bar = host.querySelector('[role="progressbar"]');
        expect(bar?.getAttribute('aria-label')).toBe('Wykorzystanie limitu miesięcznego');
        expect(bar?.getAttribute('aria-valuemin')).toBe('0');
        expect(bar?.getAttribute('aria-valuemax')).toBe('100');
        expect(bar?.getAttribute('aria-valuenow')).toBe('51');
        expect(bar?.getAttribute('aria-valuetext')).toBe('102,82 z 200,00 zł (51%)');
        expect(text(host.querySelector('.totals__budget-usage'))).toBe('102,82 z 200,00 zł (51%)');
        // Below 80%: the lime bar, no alert and no icon.
        expect(host.querySelector('.totals__budget')?.hasAttribute('data-alert')).toBe(false);
        expect(host.querySelectorAll('.totals__budget app-duplicate-warning-icon')).toHaveLength(0);
      },
    );

    it('rounds the share down, so just under the limit never shows 100%', async () => {
      const host = await flush({
        ...EXAMPLE,
        monthly: '199.99',
        monthlyLimit: '200.00',
        budgetAlert: 'near',
      });

      expect(text(host.querySelector('.totals__budget-usage'))).toBe('199,99 z 200,00 zł (99%)');
      expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('99');
    });

    it.each([
      // 17000 of 20000 gr = 85%
      ['near', '170.00', 'reached', 'Zbliżasz się do limitu', '85', '170,00 z 200,00 zł (85%)'],
      ['reached', '200.00', 'exceeded', 'Wykorzystano limit', '100', '200,00 z 200,00 zł (100%)'],
      // 25000 of 20000 gr = 125%, the bar stays full
      ['exceeded', '250.00', 'exceeded', 'Przekroczono limit', '100', '250,00 z 200,00 zł (125%)'],
    ] as const)(
      'marks an overall limit in the %j state',
      async (alert, monthly, level, note, valueNow, usage) => {
        const host = await flush({
          ...EXAMPLE,
          monthly,
          monthlyLimit: '200.00',
          budgetAlert: alert,
        });

        const budget = host.querySelector('.totals__budget');
        expect(budget?.getAttribute('data-alert')).toBe(alert);
        expect(budget?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
          valueNow,
        );
        expect(text(budget?.querySelector('.totals__budget-usage'))).toBe(usage);
        expect(text(budget?.querySelector('.totals__budget-note'))).toBe(note);
        expect(
          budget?.querySelector('app-duplicate-warning-icon')?.getAttribute('data-warning'),
        ).toBe(level);
      },
    );

    it('shows the limit of a category and its alert in words', async () => {
      const host = await flush({
        ...EXAMPLE,
        categories: [
          { ...streaming, monthly: '90.00', monthlyLimit: '80.00', budgetAlert: 'exceeded' },
          { ...praca, monthlyLimit: '100.00' },
        ],
      });

      const rows = [...host.querySelectorAll('.totals__category')];
      expect(rows.map((row) => text(row.querySelector('.totals__category-limit')))).toEqual([
        'Limit: 90,00 z 80,00 zł',
        'Limit: 35,83 z 100,00 zł',
      ]);
      expect(rows.map((row) => row.getAttribute('data-warning'))).toEqual(['exceeded', null]);
      const [warning] = rows[0].querySelectorAll('.totals__category-warning');
      expect(text(warning)).toBe('Przekroczono limit');
      expect(warning.getAttribute('data-alert')).toBe('exceeded');
      expect(rows[1].querySelectorAll('.totals__category-warning')).toHaveLength(0);
    });

    it('marks a category close to its limit in orange', async () => {
      const host = await flush({
        ...EXAMPLE,
        categories: [{ ...streaming, monthlyLimit: '50.00', budgetAlert: 'near' }],
      });

      const row = host.querySelector('.totals__category');
      expect(row?.getAttribute('data-warning')).toBe('reached');
      expect(text(row?.querySelector('.totals__category-warning'))).toBe('Zbliżasz się do limitu');
      expect(host.querySelector('summary')?.getAttribute('data-warning')).toBe('reached');
    });

    it('marks the summary with the most severe state of duplicates and limits together', async () => {
      const host = await flush({
        ...EXAMPLE,
        categories: [
          {
            ...streaming,
            subscriptionCount: 2,
            duplicateThreshold: 2,
            duplicateWarning: 'reached',
          },
          { ...praca, monthlyLimit: '35.83', budgetAlert: 'reached' },
        ],
      });

      const summary = host.querySelector('summary');
      expect(summary?.getAttribute('data-warning')).toBe('exceeded');
      const icon = summary?.querySelector('app-duplicate-warning-icon');
      expect(icon?.getAttribute('data-warning')).toBe('exceeded');
      expect(icon?.querySelector('svg')?.getAttribute('aria-label')).toBe(
        '1 kategoria osiągnęła próg, 1 kategoria wykorzystała limit',
      );
    });

    it('gives a row with both alerts one outline and two descriptions', async () => {
      const host = await flush({
        ...EXAMPLE,
        categories: [
          {
            ...streaming,
            subscriptionCount: 2,
            duplicateThreshold: 2,
            duplicateWarning: 'reached',
            monthlyLimit: '40.00',
            budgetAlert: 'exceeded',
          },
        ],
      });

      const rows = host.querySelectorAll('.totals__category');
      expect(rows).toHaveLength(1);
      expect(rows[0].getAttribute('data-warning')).toBe('exceeded');
      expect(rows[0].querySelectorAll('app-duplicate-warning-icon')).toHaveLength(1);
      const warnings = [...rows[0].querySelectorAll('.totals__category-warning')];
      expect(warnings.map((dd) => text(dd))).toEqual([
        'Osiągnięto próg: 2 z 2',
        'Przekroczono limit',
      ]);
      // Each description keeps the colour of its own state.
      expect(warnings.map((dd) => dd.getAttribute('data-warning'))).toEqual([
        'reached',
        'exceeded',
      ]);
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
