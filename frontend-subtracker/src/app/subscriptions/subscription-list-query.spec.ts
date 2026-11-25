import { convertToParamMap } from '@angular/router';
import {
  DEFAULT_SUBSCRIPTION_LIST_QUERY,
  hasFilters,
  paramsFromQuery,
  queryFromParams,
  sameQuery,
} from './subscription-list-query';
import type { SubscriptionListQuery } from './subscription.types';

const CATEGORY = '3f2b8c1e-9d4a-4f6b-8a2c-1e5d7f9b0c3a';
const DEFAULTS = DEFAULT_SUBSCRIPTION_LIST_QUERY;

// The oracle is the API contract (backend dtos/list-subscriptions.dto.ts): sort and status are
// enums with the default `status_then_date` and none, page an integer from 1 with the default 1,
// category a UUID. A value the API would refuse falls back to the default.
describe('queryFromParams', () => {
  it.each<[string, Record<string, string>, SubscriptionListQuery]>([
    ['no parameters', {}, DEFAULTS],
    [
      'every parameter',
      { sort: 'name_asc', category: CATEGORY, status: 'trial', page: '3' },
      { sort: 'name_asc', category: CATEGORY, status: 'trial', page: 3 },
    ],
    ['the default sort', { sort: 'status_then_date' }, DEFAULTS],
    ['each other sort', { sort: 'date_desc' }, { ...DEFAULTS, sort: 'date_desc' }],
    ['an unknown sort', { sort: 'price' }, DEFAULTS],
    ['a sort in upper case', { sort: 'NAME_ASC' }, DEFAULTS],
    ['an unknown status', { status: 'paused' }, DEFAULTS],
    ['a status from the prototype', { status: 'toString' }, DEFAULTS],
    ['an empty status', { status: '' }, DEFAULTS],
    [
      'cancelled_pending',
      { status: 'cancelled_pending' },
      { ...DEFAULTS, status: 'cancelled_pending' },
    ],
    ['a category that is not a UUID', { category: 'rozrywka' }, DEFAULTS],
    ['an empty category', { category: '' }, DEFAULTS],
    ['page 0', { page: '0' }, DEFAULTS],
    ['a negative page', { page: '-2' }, DEFAULTS],
    ['a fractional page', { page: '1.5' }, DEFAULTS],
    ['a page with a leading zero', { page: '02' }, DEFAULTS],
    ['a page with a space', { page: ' 2' }, DEFAULTS],
    ['a page in words', { page: 'two' }, DEFAULTS],
    ['a page past the safe integers', { page: '9007199254740993' }, DEFAULTS],
    ['a page above the highest page', { page: '1000001' }, DEFAULTS],
    ['the highest page', { page: '1000000' }, { ...DEFAULTS, page: 1_000_000 }],
    ['an unknown parameter', { q: 'netflix' }, DEFAULTS],
  ])('reads %s', (_case, params, query) => {
    expect(queryFromParams(convertToParamMap(params))).toStrictEqual(query);
  });
});

// The plain view has the address /subscriptions without parameters, so the defaults are left out.
describe('paramsFromQuery', () => {
  it.each<[string, SubscriptionListQuery, Record<string, string>]>([
    ['the default query', DEFAULTS, {}],
    [
      'every value',
      { sort: 'amount_desc', category: CATEGORY, status: 'active', page: 2 },
      { sort: 'amount_desc', category: CATEGORY, status: 'active', page: '2' },
    ],
    ['only a sort', { ...DEFAULTS, sort: 'name_desc' }, { sort: 'name_desc' }],
    ['only a category', { ...DEFAULTS, category: CATEGORY }, { category: CATEGORY }],
    ['only a status', { ...DEFAULTS, status: 'cancelled' }, { status: 'cancelled' }],
    ['only a page', { ...DEFAULTS, page: 4 }, { page: '4' }],
  ])('writes %s', (_case, query, params) => {
    expect(paramsFromQuery(query)).toStrictEqual(params);
  });

  it.each<SubscriptionListQuery>([
    DEFAULTS,
    { sort: 'date_asc', category: CATEGORY, status: 'trial', page: 7 },
    { ...DEFAULTS, status: 'cancelled_pending', page: 2 },
  ])('reads back what it wrote for %j', (query) => {
    expect(queryFromParams(convertToParamMap(paramsFromQuery(query)))).toStrictEqual(query);
  });
});

describe('hasFilters', () => {
  it.each<[string, SubscriptionListQuery, boolean]>([
    ['the default query', DEFAULTS, false],
    ['a sort and a page only', { ...DEFAULTS, sort: 'name_asc', page: 3 }, false],
    ['a category', { ...DEFAULTS, category: CATEGORY }, true],
    ['a status', { ...DEFAULTS, status: 'trial' }, true],
    ['both', { ...DEFAULTS, category: CATEGORY, status: 'trial' }, true],
  ])('answers for %s', (_case, query, filtered) => {
    expect(hasFilters(query)).toBe(filtered);
  });
});

describe('sameQuery', () => {
  it.each<[string, Partial<SubscriptionListQuery>, boolean]>([
    ['an equal copy', {}, true],
    ['another sort', { sort: 'name_asc' }, false],
    ['another category', { category: CATEGORY }, false],
    ['another status', { status: 'active' }, false],
    ['another page', { page: 2 }, false],
  ])('compares %s', (_case, patch, same) => {
    expect(sameQuery(DEFAULTS, { ...DEFAULTS, ...patch })).toBe(same);
  });
});
