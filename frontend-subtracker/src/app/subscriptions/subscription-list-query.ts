import type { ParamMap } from '@angular/router';
import { isUuid } from '../shared/uuid';
import {
  DEFAULT_SUBSCRIPTION_SORT,
  SUBSCRIPTION_PAGE_MAX,
  SUBSCRIPTION_SORTS,
  type SubscriptionListQuery,
  type SubscriptionSort,
  type SubscriptionStatus,
} from './subscription.types';

// The list's state lives in the address of /subscriptions (?sort=&category=&status=&page=), with
// the same names and values as the parameters of GET /subscriptions. These functions are the only
// place that reads and writes them.

export const DEFAULT_SUBSCRIPTION_LIST_QUERY: SubscriptionListQuery = {
  sort: DEFAULT_SUBSCRIPTION_SORT,
  category: null,
  status: null,
  page: 1,
};

// Every status, so a new one cannot be left out of the filter's check.
const STATUSES: Record<SubscriptionStatus, true> = {
  trial: true,
  active: true,
  cancelled_pending: true,
  cancelled: true,
};

// A value the API would refuse with a 400 (an unknown sort or status, a page that is not a whole
// number from 1, a category that is not a UUID) gives the default instead, so an edited or old
// link still shows a list. A category of another account is left to the API, which finds nothing.
export function queryFromParams(params: ParamMap): SubscriptionListQuery {
  return {
    sort: toSort(params.get('sort')),
    category: toCategory(params.get('category')),
    status: toStatus(params.get('status')),
    page: toPage(params.get('page')),
  };
}

// Only the values that differ from the default, so the plain view has the address /subscriptions
// without parameters.
export function paramsFromQuery(query: SubscriptionListQuery): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.sort !== DEFAULT_SUBSCRIPTION_LIST_QUERY.sort) {
    params['sort'] = query.sort;
  }
  if (query.category !== null) {
    params['category'] = query.category;
  }
  if (query.status !== null) {
    params['status'] = query.status;
  }
  if (query.page !== DEFAULT_SUBSCRIPTION_LIST_QUERY.page) {
    params['page'] = String(query.page);
  }
  return params;
}

// Whether the list is narrowed by a category or a status; the order and the page do not count.
export function hasFilters(query: SubscriptionListQuery): boolean {
  return query.category !== null || query.status !== null;
}

export function sameQuery(a: SubscriptionListQuery, b: SubscriptionListQuery): boolean {
  return (
    a.sort === b.sort && a.category === b.category && a.status === b.status && a.page === b.page
  );
}

function toSort(value: string | null): SubscriptionSort {
  return SUBSCRIPTION_SORTS.find((sort) => sort === value) ?? DEFAULT_SUBSCRIPTION_LIST_QUERY.sort;
}

function toStatus(value: string | null): SubscriptionStatus | null {
  return value !== null && Object.hasOwn(STATUSES, value) ? (value as SubscriptionStatus) : null;
}

function toCategory(value: string | null): string | null {
  return value !== null && isUuid(value) ? value : null;
}

// Digits only (no sign, no fraction, no leading zero), up to the API's highest page.
function toPage(value: string | null): number {
  if (value === null || !/^[1-9]\d*$/.test(value)) {
    return DEFAULT_SUBSCRIPTION_LIST_QUERY.page;
  }
  const page = Number(value);
  return page <= SUBSCRIPTION_PAGE_MAX ? page : DEFAULT_SUBSCRIPTION_LIST_QUERY.page;
}
