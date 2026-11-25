import {
  addDays,
  APP_TIME_ZONE,
  calendarDayIn,
} from '../../src/shared/date/calendar-day.js';
import { DEFAULT_CATEGORIES } from '../../src/subscriptions/default-categories.js';
import { Subscription } from '../../src/subscriptions/entities/subscription.entity.js';
import {
  BillingCycle,
  type CategoryResponse,
  PaymentMethod,
  type SubscriptionResponse,
  SubscriptionStatus,
} from '../../src/subscriptions/subscription.types.js';
import { createE2eApp } from '../support/e2e-app.js';
import {
  OTHER_CATEGORY_ID,
  subscriptionBody,
  subscriptionRequests,
} from './subscriptions-e2e.js';

// GET /subscriptions with sort, filters and pages (S-18). The order is checked on a real Postgres:
// in CI the C.UTF-8 database of the backend-e2e job, where only the ICU collation gives the Polish
// order.
describe('Subscriptions — sort, filters and pages (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job) with a fake mail transport. Every row these tests create hangs off a
  // recognisable address and is removed at the end.
  const e2e = createE2eApp({ addressPrefix: 'e2e-subscriptions-page-' });
  const { repository, signIn, userIdOf } = e2e;
  const {
    postSubscription,
    postCategory,
    listSubscriptions,
    getSubscriptionPage,
  } = subscriptionRequests(e2e);

  beforeAll(() => e2e.start());

  afterAll(() => e2e.close());

  // Every date lies ahead of today, so a run of the lifecycle job during the tests (trial ends,
  // billing dates rolled forward) never changes a row.
  const today = calendarDayIn(APP_TIME_ZONE, new Date());
  const BILLING_DATE = addDays(today, 15);

  const add = async (cookie: string, overrides: Record<string, unknown>) =>
    (
      await postSubscription(
        cookie,
        subscriptionBody({ nextBillingDate: BILLING_DATE, ...overrides }),
      ).expect(201)
    ).body as SubscriptionResponse;

  const names = async (cookie: string, query: Record<string, string>) =>
    (await getSubscriptionPage(cookie, query)).items.map((row) => row.name);

  it('sorts by the name without case in Polish order, both ways', async () => {
    const { cookie } = await signIn();
    // Code-point order (a C.UTF-8 database) would put "Ślub" after "Zoo"; "żagiel" in lower case
    // still goes after "Zoo". Dates differ so the default order would not give the same answer.
    await add(cookie, { name: 'żagiel', nextBillingDate: addDays(today, 10) });
    await add(cookie, { name: 'Zoo', nextBillingDate: addDays(today, 11) });
    await add(cookie, { name: 'Ślub', nextBillingDate: addDays(today, 12) });

    expect(await names(cookie, { sort: 'name_asc' })).toEqual([
      'Ślub',
      'Zoo',
      'żagiel',
    ]);
    expect(await names(cookie, { sort: 'name_desc' })).toEqual([
      'żagiel',
      'Zoo',
      'Ślub',
    ]);
  });

  it('sorts by the monthly cost, a yearly price counted as a twelfth', async () => {
    const { cookie } = await signIn();
    await add(cookie, { name: 'Dziesięć', amount: 10 });
    await add(cookie, { name: 'Roczna', amount: 240, billingCycle: 'yearly' });
    await add(cookie, { name: 'Dwadzieścia pięć', amount: 25 });

    expect(await names(cookie, { sort: 'amount_desc' })).toEqual([
      'Dwadzieścia pięć',
      'Roczna',
      'Dziesięć',
    ]);
    expect(await names(cookie, { sort: 'amount_asc' })).toEqual([
      'Dziesięć',
      'Roczna',
      'Dwadzieścia pięć',
    ]);
  });

  it('sorts by the date that matters next without the status groups', async () => {
    const { cookie } = await signIn();
    // The default order would put the cancelled one last whatever its date.
    await add(cookie, {
      name: 'Anulowana',
      status: 'cancelled',
      nextBillingDate: addDays(today, 1),
    });
    await add(cookie, {
      name: 'Grudzień',
      nextBillingDate: addDays(today, 30),
    });
    // A trial counts by its end, not by the payment after it.
    await add(cookie, {
      name: 'Próbna',
      status: 'trial',
      trialEndDate: addDays(today, 20),
      nextBillingDate: addDays(today, 60),
    });

    expect(await names(cookie, {})).toEqual([
      'Próbna',
      'Grudzień',
      'Anulowana',
    ]);
    expect(await names(cookie, { sort: 'date_asc' })).toEqual([
      'Anulowana',
      'Próbna',
      'Grudzień',
    ]);
    expect(await names(cookie, { sort: 'date_desc' })).toEqual([
      'Grudzień',
      'Próbna',
      'Anulowana',
    ]);
  });

  it('filters by the category, the status and both at once', async () => {
    const { cookie } = await signIn();
    const work = (await postCategory(cookie, 'Praca').expect(201))
      .body as CategoryResponse;
    await add(cookie, { name: 'Praca aktywna', categoryId: work.id });
    await add(cookie, {
      name: 'Praca próbna',
      categoryId: work.id,
      status: 'trial',
      trialEndDate: addDays(today, 20),
      nextBillingDate: addDays(today, 20),
    });
    await add(cookie, {
      name: 'Inne próbna',
      status: 'trial',
      trialEndDate: addDays(today, 21),
      nextBillingDate: addDays(today, 21),
    });

    const byCategory = await getSubscriptionPage(cookie, {
      category: work.id,
    });
    expect(byCategory.items.map((row) => row.name)).toEqual([
      'Praca aktywna',
      'Praca próbna',
    ]);
    expect(byCategory.total).toBe(2);
    expect(await names(cookie, { status: 'trial' })).toEqual([
      'Praca próbna',
      'Inne próbna',
    ]);
    const both = await getSubscriptionPage(cookie, {
      category: work.id,
      status: 'trial',
    });
    expect(both.items.map((row) => row.name)).toEqual(['Praca próbna']);
    expect(both.total).toBe(1);
    // A default category of the account filters the same way.
    expect(await names(cookie, { category: DEFAULT_CATEGORIES[0].id })).toEqual(
      [],
    );
  });

  it('splits the list into pages without repeating a row, past the end with the real total', async () => {
    const { address, cookie } = await signIn();
    const userId = await userIdOf(address);
    // One INSERT: every row gets the same creation time, and name and date tie too, so only the
    // id at the end of the order keeps the pages apart.
    await repository(Subscription).insert(
      Array.from({ length: 30 }, () => ({
        userId,
        categoryId: OTHER_CATEGORY_ID,
        name: 'Netflix',
        amount: '43.00',
        billingCycle: BillingCycle.MONTHLY,
        paymentMethod: PaymentMethod.CREDIT_CARD,
        status: SubscriptionStatus.ACTIVE,
        nextBillingDate: BILLING_DATE,
      })),
    );

    const first = await getSubscriptionPage(cookie, { pageSize: '25' });
    const second = await getSubscriptionPage(cookie, {
      page: '2',
      pageSize: '25',
    });
    const third = await getSubscriptionPage(cookie, {
      page: '3',
      pageSize: '25',
    });

    expect(first).toMatchObject({ total: 30, page: 1, pageSize: 25 });
    expect(first.items).toHaveLength(25);
    expect(second).toMatchObject({ total: 30, page: 2, pageSize: 25 });
    expect(second.items).toHaveLength(5);
    const ids = [...first.items, ...second.items].map((row) => row.id);
    expect(new Set(ids).size).toBe(30);
    expect(ids).toEqual([...ids].sort());
    expect(third).toEqual({ items: [], total: 30, page: 3, pageSize: 25 });
  });

  it('pages 25 rows by default', async () => {
    const { address, cookie } = await signIn();
    const userId = await userIdOf(address);
    await repository(Subscription).insert(
      Array.from({ length: 26 }, (_, index) => ({
        userId,
        categoryId: OTHER_CATEGORY_ID,
        name: `Subskrypcja ${index}`,
        amount: '10.00',
        billingCycle: BillingCycle.MONTHLY,
        paymentMethod: PaymentMethod.BLIK,
        status: SubscriptionStatus.ACTIVE,
        nextBillingDate: BILLING_DATE,
      })),
    );

    const page = await getSubscriptionPage(cookie);

    expect(page).toMatchObject({ total: 26, page: 1, pageSize: 25 });
    expect(page.items).toHaveLength(25);
  });

  it.each([
    ['an unknown sort', { sort: 'x' }],
    ['page 0', { page: '0' }],
    ['a page above 1 000 000', { page: '1000001' }],
    // Past the highest page, so the offset never reaches SQL ("bigint out of range", a 500).
    ['a page in exponent notation', { page: '1e20' }],
    ['a page size above 100', { pageSize: '101' }],
    ['a category that is not a UUID', { category: 'nie-uuid' }],
    ['an unknown status', { status: 'x' }],
    ['an unknown parameter', { q: 'netflix' }],
  ])('answers 400 for %s', async (_case, query) => {
    const { cookie } = await signIn();

    await listSubscriptions(cookie, query).expect(400);
  });

  // Another account's category: account-isolation.e2e-spec.ts.
});
