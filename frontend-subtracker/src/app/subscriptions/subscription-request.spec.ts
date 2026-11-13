import type { CreateSubscriptionRequest } from './subscription.types';
import { SubscriptionFormValue, toCreateSubscriptionRequest } from './subscription-request';

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
    expect(toCreateSubscriptionRequest({ ...FORM, ...form })).toEqual({ ...BODY, ...body });
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
