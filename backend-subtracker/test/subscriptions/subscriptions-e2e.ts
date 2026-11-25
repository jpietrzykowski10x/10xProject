import type { Test } from 'supertest';
import { DEFAULT_CATEGORIES } from '../../src/subscriptions/default-categories.js';
import type {
  BudgetResponse,
  CategoryResponse,
  CostTotalsResponse,
  SubscriptionPageResponse,
  SubscriptionResponse,
} from '../../src/subscriptions/subscription.types.js';
import type { E2eApp } from '../support/e2e-app.js';

export const OTHER_CATEGORY_ID =
  DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1].id;

// A valid active subscription; a test overrides only the fields it is about. Loosely typed on
// purpose: tests also send fields the API must refuse (e.g. `userId`).
export const subscriptionBody = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  name: 'Netflix',
  categoryId: OTHER_CATEGORY_ID,
  amount: 43,
  billingCycle: 'monthly',
  paymentMethod: 'credit_card',
  status: 'active',
  nextBillingDate: '2026-11-15',
  ...overrides,
});

// Requests shared by the subscription e2e files. The list and totals requests expect 200 without
// caching.
export interface SubscriptionRequests {
  postSubscription: (cookie: string, body: Record<string, unknown>) => Test;
  putSubscription: (
    cookie: string,
    id: string,
    body: Record<string, unknown>,
  ) => Test;
  deleteSubscription: (cookie: string, id: string) => Test;
  cancelSubscription: (cookie: string, id: string) => Test;
  resumeSubscription: (cookie: string, id: string) => Test;
  postCategory: (cookie: string, name: string) => Test;
  patchCategory: (cookie: string, id: string, name: string) => Test;
  deleteCategory: (cookie: string, id: string) => Test;
  listSubscriptions: (cookie: string, query?: Record<string, string>) => Test;
  getSubscriptionPage: (
    cookie: string,
    query?: Record<string, string>,
  ) => Promise<SubscriptionPageResponse>;
  // The rows of the first page in the default order (up to 25).
  getSubscriptions: (cookie: string) => Promise<SubscriptionResponse[]>;
  getCategories: (cookie: string) => Promise<CategoryResponse[]>;
  getTotals: (cookie: string) => Promise<CostTotalsResponse>;
  getBudget: (cookie: string) => Promise<BudgetResponse>;
  putBudget: (cookie: string, body: Record<string, unknown>) => Test;
}

export function subscriptionRequests(e2e: E2eApp): SubscriptionRequests {
  const { http } = e2e;

  const postSubscription = (cookie: string, body: Record<string, unknown>) =>
    http().post('/subscriptions').set('Cookie', cookie).send(body);

  const putSubscription = (
    cookie: string,
    id: string,
    body: Record<string, unknown>,
  ) => http().put(`/subscriptions/${id}`).set('Cookie', cookie).send(body);

  const deleteSubscription = (cookie: string, id: string) =>
    http().delete(`/subscriptions/${id}`).set('Cookie', cookie);

  const cancelSubscription = (cookie: string, id: string) =>
    http().post(`/subscriptions/${id}/cancel`).set('Cookie', cookie);

  const resumeSubscription = (cookie: string, id: string) =>
    http().post(`/subscriptions/${id}/resume`).set('Cookie', cookie);

  const postCategory = (cookie: string, name: string) =>
    http().post('/categories').set('Cookie', cookie).send({ name });

  const patchCategory = (cookie: string, id: string, name: string) =>
    http().patch(`/categories/${id}`).set('Cookie', cookie).send({ name });

  const deleteCategory = (cookie: string, id: string) =>
    http().delete(`/categories/${id}`).set('Cookie', cookie);

  const listSubscriptions = (
    cookie: string,
    query: Record<string, string> = {},
  ) => http().get('/subscriptions').query(query).set('Cookie', cookie);

  const getSubscriptionPage = async (
    cookie: string,
    query: Record<string, string> = {},
  ) =>
    (
      await listSubscriptions(cookie, query)
        .expect(200)
        .expect('Cache-Control', 'no-store')
    ).body as SubscriptionPageResponse;

  const getSubscriptions = async (cookie: string) =>
    (await getSubscriptionPage(cookie)).items;

  const getCategories = async (cookie: string) =>
    (
      await http()
        .get('/categories')
        .set('Cookie', cookie)
        .expect(200)
        .expect('Cache-Control', 'no-store')
    ).body as CategoryResponse[];

  const getTotals = async (cookie: string) =>
    (
      await http()
        .get('/subscriptions/totals')
        .set('Cookie', cookie)
        .expect(200)
        .expect('Cache-Control', 'no-store')
    ).body as CostTotalsResponse;

  const getBudget = async (cookie: string) =>
    (
      await http()
        .get('/budget')
        .set('Cookie', cookie)
        .expect(200)
        .expect('Cache-Control', 'no-store')
    ).body as BudgetResponse;

  const putBudget = (cookie: string, body: Record<string, unknown>) =>
    http().put('/budget').set('Cookie', cookie).send(body);

  return {
    postSubscription,
    putSubscription,
    deleteSubscription,
    cancelSubscription,
    resumeSubscription,
    postCategory,
    patchCategory,
    deleteCategory,
    listSubscriptions,
    getSubscriptionPage,
    getSubscriptions,
    getCategories,
    getTotals,
    getBudget,
    putBudget,
  };
}
