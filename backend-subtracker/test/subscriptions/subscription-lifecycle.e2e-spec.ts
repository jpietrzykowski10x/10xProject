import {
  addMonthsClamped,
  APP_TIME_ZONE,
  calendarDayIn,
} from '../../src/shared/date/calendar-day.js';
import { Subscription } from '../../src/subscriptions/entities/subscription.entity.js';
import {
  type LifecycleRunResult,
  SubscriptionLifecycleService,
} from '../../src/subscriptions/services/subscription-lifecycle.service.js';
import { rolledBillingDate } from '../../src/subscriptions/subscription-lifecycle.js';
import {
  BillingCycle,
  type SubscriptionResponse,
} from '../../src/subscriptions/subscription.types.js';
import { User } from '../../src/users/entities/user.entity.js';
import { createE2eApp } from '../support/e2e-app.js';
import { subscriptionBody, subscriptionRequests } from './subscriptions-e2e.js';

// The day before a YYYY-MM-DD day, by the calendar.
function dayBefore(day: string): string {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, dayOfMonth - 1))
    .toISOString()
    .slice(0, 10);
}

describe('Subscriptions — lifecycle job (e2e)', () => {
  // Runs against the database from .env (locally the dev database, in CI the C.UTF-8 database of
  // the backend-e2e job). The job sees every account, so "today" is the real day in Warsaw and the
  // dates are relative to it (a far "today" would move the rows of manual testing too), and the
  // assertions look only at the rows of this file's accounts.
  const e2e = createE2eApp({ addressPrefix: 'e2e-subscriptions-lifecycle-' });
  const { repository, signIn, userIdOf } = e2e;
  const { postSubscription, getTotals } = subscriptionRequests(e2e);

  const today = calendarDayIn(APP_TIME_ZONE, new Date());
  const yesterday = dayBefore(today);
  const yearAgo = addMonthsClamped(today, -12);

  let totalsCookie: string;
  let trialEnded: SubscriptionResponse;
  let trialEndsToday: SubscriptionResponse;
  let cancellationDue: SubscriptionResponse;
  let cancellationToday: SubscriptionResponse;
  let yearlyOverdue: SubscriptionResponse;
  let blockedUserId: string;
  let blockedTrialEnded: SubscriptionResponse;
  let firstRun: LifecycleRunResult;

  const create = async (
    cookie: string,
    overrides: Record<string, unknown>,
  ): Promise<SubscriptionResponse> =>
    (await postSubscription(cookie, subscriptionBody(overrides)).expect(201))
      .body as SubscriptionResponse;

  const stored = (subscription: SubscriptionResponse) =>
    repository(Subscription).findOneByOrFail({ id: subscription.id });

  const advance = () =>
    e2e.app.get(SubscriptionLifecycleService).advance(today);

  beforeAll(async () => {
    // The startup run of the job has already finished inside start().
    await e2e.start();

    const { cookie } = await signIn();
    trialEnded = await create(cookie, {
      name: 'Trial ended',
      status: 'trial',
      trialEndDate: yesterday,
      nextBillingDate: yesterday,
    });
    trialEndsToday = await create(cookie, {
      name: 'Trial ends today',
      status: 'trial',
      trialEndDate: today,
      nextBillingDate: today,
    });
    yearlyOverdue = await create(cookie, {
      name: 'Yearly overdue',
      billingCycle: 'yearly',
      nextBillingDate: yearAgo,
    });

    // A blocked account's overdue trial, left alone until the account is unblocked.
    const blocked = await signIn();
    blockedUserId = await userIdOf(blocked.address);
    blockedTrialEnded = await create(blocked.cookie, {
      name: 'Blocked trial ended',
      status: 'trial',
      trialEndDate: yesterday,
      nextBillingDate: yesterday,
    });
    await repository(User).update({ id: blockedUserId }, { isActive: false });

    // The pending cancellations on an account of their own, so its totals hold only them.
    totalsCookie = (await signIn()).cookie;
    cancellationDue = await create(totalsCookie, {
      name: 'Cancellation due',
      status: 'cancelled_pending',
      amount: 43,
      nextBillingDate: yesterday,
    });
    cancellationToday = await create(totalsCookie, {
      name: 'Cancellation today',
      status: 'cancelled_pending',
      amount: 20,
      nextBillingDate: today,
    });
    expect((await getTotals(totalsCookie)).monthly).toBe('63.00');

    firstRun = await advance();
  });

  afterAll(() => e2e.close());

  it('counts at least the transitions of this file (other accounts may add to them)', () => {
    expect(firstRun.trialsActivated).toBeGreaterThanOrEqual(1);
    expect(firstRun.cancellationsCompleted).toBeGreaterThanOrEqual(1);
    // The activated trial and the yearly subscription.
    expect(firstRun.billingDatesRolled).toBeGreaterThanOrEqual(2);
  });

  it('activates a trial that ended yesterday and moves its billing date to today or later', async () => {
    const row = await stored(trialEnded);

    expect(row.status).toBe('active');
    expect(row.trialEndDate).toBeNull();
    expect(row.nextBillingDate).toBe(
      rolledBillingDate(yesterday, BillingCycle.MONTHLY, today),
    );
    expect(row.nextBillingDate >= today).toBe(true);
  });

  it('leaves a trial that ends today as it is', async () => {
    const row = await stored(trialEndsToday);

    expect(row.status).toBe('trial');
    expect(row.trialEndDate).toBe(today);
    expect(row.nextBillingDate).toBe(today);
  });

  it('completes a cancellation billed yesterday and takes it out of the totals', async () => {
    expect((await stored(cancellationDue)).status).toBe('cancelled');
    // Only the cancellation billed today is still counted.
    expect((await getTotals(totalsCookie)).monthly).toBe('20.00');
  });

  it('leaves a cancellation billed today as it is', async () => {
    const row = await stored(cancellationToday);

    expect(row.status).toBe('cancelled_pending');
    expect(row.nextBillingDate).toBe(today);
  });

  it('moves a yearly billing date from a year ago to today or later', async () => {
    const row = await stored(yearlyOverdue);

    expect(row.status).toBe('active');
    expect(row.nextBillingDate).toBe(
      rolledBillingDate(yearAgo, BillingCycle.YEARLY, today),
    );
    expect(row.nextBillingDate >= today).toBe(true);
  });

  // The counts of the second run cover the whole database, so the check is on this file's rows:
  // a second run on the same day must leave every one of them exactly as the first run did.
  it('changes none of these rows in a second run on the same day', async () => {
    const subscriptions = [
      trialEnded,
      trialEndsToday,
      cancellationDue,
      cancellationToday,
      yearlyOverdue,
    ];
    const afterFirst = await Promise.all(subscriptions.map(stored));

    await advance();

    expect(await Promise.all(subscriptions.map(stored))).toEqual(afterFirst);
  });

  // Runs after the second run above, so two runs have passed the blocked account by.
  it('leaves a blocked account as it is and catches up once it is unblocked', async () => {
    const whileBlocked = await stored(blockedTrialEnded);
    expect(whileBlocked.status).toBe('trial');
    expect(whileBlocked.trialEndDate).toBe(yesterday);
    expect(whileBlocked.nextBillingDate).toBe(yesterday);

    await repository(User).update({ id: blockedUserId }, { isActive: true });
    await advance();

    const row = await stored(blockedTrialEnded);
    expect(row.status).toBe('active');
    expect(row.trialEndDate).toBeNull();
    expect(row.nextBillingDate).toBe(
      rolledBillingDate(yesterday, BillingCycle.MONTHLY, today),
    );
  });
});
