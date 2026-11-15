import type { CreateSubscriptionRequest, Subscription } from './subscription.types';
import {
  SubscriptionFormValue,
  toCreateSubscriptionRequest,
  toSubscriptionFormValue,
} from './subscription-request';

// The oracle is the API contract (backend create-subscription DTO): the amount is a number, the
// dates are calendar days as YYYY-MM-DD, the name is trimmed, and the end of the trial goes only
// with a trial. The whole body is compared, so an extra field fails too.
const FORM: SubscriptionFormValue = {
  name: 'Netflix',
  categoryId: 'category-1',
  amount: '43,00',
  billingCycle: 'monthly',
  paymentMethod: 'blik',
  status: 'active',
  trialEndDate: null,
  nextBillingDate: new Date(2027, 0, 5),
};

const BODY: CreateSubscriptionRequest = {
  name: 'Netflix',
  categoryId: 'category-1',
  amount: 43,
  billingCycle: 'monthly',
  paymentMethod: 'blik',
  status: 'active',
  nextBillingDate: '2027-01-05',
};

describe('toCreateSubscriptionRequest', () => {
  it.each<[string, Partial<SubscriptionFormValue>, Partial<CreateSubscriptionRequest>]>([
    ['a plain subscription', {}, {}],
    ['an amount with spaces between thousands', { amount: '1 299,00' }, { amount: 1299 }],
    ['an amount with a no-break space', { amount: '1\u00A0299,00' }, { amount: 1299 }],
    ['an amount with a decimal comma', { amount: '12,99' }, { amount: 12.99 }],
    ['an amount with a decimal dot', { amount: '12.99' }, { amount: 12.99 }],
    ['a zero amount', { amount: '0' }, { amount: 0 }],
    ['the largest amount', { amount: '99 999,99' }, { amount: 99999.99 }],
    ['a name with spaces around it', { name: '  Netflix  ' }, { name: 'Netflix' }],
    [
      'the end of February',
      { nextBillingDate: new Date(2027, 1, 28) },
      { nextBillingDate: '2027-02-28' },
    ],
    [
      'a billing day picked late in the evening',
      { nextBillingDate: new Date(2026, 11, 31, 23, 30) },
      { nextBillingDate: '2026-12-31' },
    ],
    [
      'a yearly bank transfer',
      { billingCycle: 'yearly', paymentMethod: 'bank_transfer' },
      { billingCycle: 'yearly', paymentMethod: 'bank_transfer' },
    ],
    [
      'a trial with its end',
      {
        status: 'trial',
        trialEndDate: new Date(2027, 1, 28),
        nextBillingDate: new Date(2027, 2, 1),
      },
      { status: 'trial', trialEndDate: '2027-02-28', nextBillingDate: '2027-03-01' },
    ],
    // The disabled trial field keeps its last day; the API refuses it for any other status.
    [
      'an active subscription with a leftover trial end',
      { trialEndDate: new Date(2027, 1, 28) },
      {},
    ],
    [
      'a pending cancellation with a leftover trial end',
      { status: 'cancelled_pending', trialEndDate: new Date(2027, 1, 28) },
      { status: 'cancelled_pending' },
    ],
  ])('sends %s', (_, form, body) => {
    expect(toCreateSubscriptionRequest({ ...FORM, ...form })).toStrictEqual({ ...BODY, ...body });
  });

  it.each<[string, Partial<SubscriptionFormValue>]>([
    ['an amount that is not a number', { amount: 'abc' }],
    ['an amount with three decimals', { amount: '12,999' }],
    ['an amount over the limit', { amount: '100 000' }],
    ['an empty amount', { amount: '' }],
    ['no payment method', { paymentMethod: '' }],
    ['no billing day', { nextBillingDate: null }],
    ['a trial without its end', { status: 'trial', trialEndDate: null }],
  ])('sends nothing for %s', (_, form) => {
    expect(toCreateSubscriptionRequest({ ...FORM, ...form })).toBeNull();
  });
});

// The oracle is the API contract (subscription.types.ts, Subscription): the amount comes as a
// string with two decimals and a dot, the dates as calendar days YYYY-MM-DD, `trialEndDate` only for
// a trial. The form shows the amount the Polish way and each day as the same calendar day in any
// time zone (the suite runs in Warsaw and New York).
const SUBSCRIPTION: Subscription = {
  id: 'subscription-1',
  name: 'Netflix',
  category: { id: 'category-1', name: 'Rozrywka', isDefault: true },
  amount: '43.00',
  billingCycle: 'monthly',
  paymentMethod: 'blik',
  status: 'active',
  trialEndDate: null,
  nextBillingDate: '2027-01-05',
  createdAt: '2026-11-13T12:00:00.000Z',
};

// A Date as the calendar day the datepicker shows, not as an instant.
function calendarDay(date: Date | null): [number, number, number] | null {
  return date === null ? null : [date.getFullYear(), date.getMonth() + 1, date.getDate()];
}

describe('toSubscriptionFormValue', () => {
  it.each<[string, string]>([
    ['43.00', '43,00'],
    ['0.00', '0,00'],
    ['1234.50', '1234,50'],
    ['99999.99', '99999,99'],
  ])('shows the amount %j as %j', (amount, shown) => {
    expect(toSubscriptionFormValue({ ...SUBSCRIPTION, amount }).amount).toBe(shown);
  });

  it.each<[string, [number, number, number]]>([
    ['2027-01-05', [2027, 1, 5]],
    ['2028-02-29', [2028, 2, 29]],
    ['2026-12-31', [2026, 12, 31]],
    // The last Sunday of March: Warsaw moves its clocks that night.
    ['2027-03-28', [2027, 3, 28]],
    // The second Sunday of March: New York moves its clocks that night.
    ['2027-03-14', [2027, 3, 14]],
  ])('shows the billing day %j as that calendar day', (day, expected) => {
    const value = toSubscriptionFormValue({ ...SUBSCRIPTION, nextBillingDate: day });

    expect(calendarDay(value.nextBillingDate)).toEqual(expected);
  });

  it('fills the whole form of an active subscription, without a trial end', () => {
    expect(toSubscriptionFormValue(SUBSCRIPTION)).toEqual({
      name: 'Netflix',
      categoryId: 'category-1',
      amount: '43,00',
      billingCycle: 'monthly',
      paymentMethod: 'blik',
      status: 'active',
      trialEndDate: null,
      nextBillingDate: new Date(2027, 0, 5),
    });
  });

  it('fills the end of a trial', () => {
    const value = toSubscriptionFormValue({
      ...SUBSCRIPTION,
      status: 'trial',
      trialEndDate: '2027-02-28',
      nextBillingDate: '2027-03-01',
    });

    expect(value.status).toBe('trial');
    expect(calendarDay(value.trialEndDate)).toEqual([2027, 2, 28]);
    expect(calendarDay(value.nextBillingDate)).toEqual([2027, 3, 1]);
  });

  it('leaves the end of a trial empty when the trial has none', () => {
    const value = toSubscriptionFormValue({ ...SUBSCRIPTION, status: 'trial', trialEndDate: null });

    expect(value.trialEndDate).toBeNull();
  });

  // Saving an untouched form sends back what the API gave: the amount as a number, the same
  // calendar days, the end of the trial only with a trial.
  it.each<[string, Partial<Subscription>, CreateSubscriptionRequest]>([
    ['an active subscription', {}, BODY],
    [
      'a yearly amount with a fraction',
      { amount: '1234.50', billingCycle: 'yearly', paymentMethod: 'bank_transfer' },
      { ...BODY, amount: 1234.5, billingCycle: 'yearly', paymentMethod: 'bank_transfer' },
    ],
    ['a zero amount', { amount: '0.00' }, { ...BODY, amount: 0 }],
    ['the largest amount', { amount: '99999.99' }, { ...BODY, amount: 99999.99 }],
    [
      'a trial with its end',
      { status: 'trial', trialEndDate: '2027-02-28', nextBillingDate: '2027-03-01' },
      { ...BODY, status: 'trial', trialEndDate: '2027-02-28', nextBillingDate: '2027-03-01' },
    ],
    [
      'a pending cancellation',
      { status: 'cancelled_pending' },
      { ...BODY, status: 'cancelled_pending' },
    ],
  ])('turns %s back into the API data', (_, subscription, body) => {
    const value = toSubscriptionFormValue({ ...SUBSCRIPTION, ...subscription });

    expect(toCreateSubscriptionRequest(value)).toStrictEqual(body);
  });
});
