import { DEFAULT_CATEGORIES } from '../../src/subscriptions/default-categories.js';
import type {
  CategoryResponse,
  SubscriptionResponse,
} from '../../src/subscriptions/subscription.types.js';
import { User } from '../../src/users/entities/user.entity.js';
import type { Test } from 'supertest';
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

// Requests shared by the subscription e2e files. The list requests expect 200 without caching.
export interface SubscriptionRequests {
  userIdOf: (address: string) => Promise<string>;
  postSubscription: (cookie: string, body: Record<string, unknown>) => Test;
  postCategory: (cookie: string, name: string) => Test;
  getSubscriptions: (cookie: string) => Promise<SubscriptionResponse[]>;
  getCategories: (cookie: string) => Promise<CategoryResponse[]>;
}

export function subscriptionRequests(e2e: E2eApp): SubscriptionRequests {
  const { http, repository } = e2e;

  const userIdOf = async (address: string) =>
    (await repository(User).findOneByOrFail({ email: address })).id;

  const postSubscription = (cookie: string, body: Record<string, unknown>) =>
    http().post('/subscriptions').set('Cookie', cookie).send(body);

  const postCategory = (cookie: string, name: string) =>
    http().post('/categories').set('Cookie', cookie).send({ name });

  const getSubscriptions = async (cookie: string) =>
    (
      await http()
        .get('/subscriptions')
        .set('Cookie', cookie)
        .expect(200)
        .expect('Cache-Control', 'no-store')
    ).body as SubscriptionResponse[];

  const getCategories = async (cookie: string) =>
    (
      await http()
        .get('/categories')
        .set('Cookie', cookie)
        .expect(200)
        .expect('Cache-Control', 'no-store')
    ).body as CategoryResponse[];

  return {
    userIdOf,
    postSubscription,
    postCategory,
    getSubscriptions,
    getCategories,
  };
}
