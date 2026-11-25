import { type APIRequestContext, expect } from '@playwright/test';
import { API_ORIGIN, SESSION_COOKIE } from './accounts';

// Test data made straight through the API, for browser tests that need a subscription on screen
// before the flow they check. The rows hang off an account from accounts.ts, so that file's
// removeTestData() takes them away.

interface CategoryResponse {
  id: string;
}

// What a test may set on a subscription made through the API; the rest stays as the defaults of
// createSubscriptionThroughApi.
export interface SubscriptionOptions {
  // An own category's id (createCategoryThroughApi); else the account's first category.
  categoryId?: string;
  // In PLN per billing cycle, e.g. 25 or 12.5.
  amount?: number;
  billingCycle?: 'monthly' | 'yearly';
  // A trial ends in 14 days and is billed in 30; every status gets its billing date in 30 days.
  status?: 'trial' | 'active' | 'cancelled_pending' | 'cancelled';
}

// A day `days` ahead (30 by default) in local time, as the API ("YYYY-MM-DD") and the form
// ("dd.mm.rrrr") take it. Never a past day: the lifecycle job on the API's start would move it on.
export function futureDay(days = 30): { iso: string; polish: string } {
  const day = new Date();
  day.setDate(day.getDate() + days);
  const yyyy = String(day.getFullYear());
  const mm = String(day.getMonth() + 1).padStart(2, '0');
  const dd = String(day.getDate()).padStart(2, '0');
  return { iso: `${yyyy}-${mm}-${dd}`, polish: `${dd}.${mm}.${yyyy}` };
}

// An own category of the account, through the API with its cookie; returns the category's id.
export async function createCategoryThroughApi(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const created = await request.post(`${API_ORIGIN}/categories`, {
    headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    data: { name },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as CategoryResponse).id;
}

// A subscription through the API with the account's cookie: by default active, monthly, 25 zł, in
// the account's first category; `options` change any of these. A client without browser headers
// passes the CSRF check, so no Origin header is needed.
export async function createSubscriptionThroughApi(
  request: APIRequestContext,
  token: string,
  name: string,
  {
    categoryId,
    amount = 25,
    billingCycle = 'monthly',
    status = 'active',
  }: SubscriptionOptions = {},
): Promise<void> {
  const headers = { Cookie: `${SESSION_COOKIE}=${token}` };
  const created = await request.post(`${API_ORIGIN}/subscriptions`, {
    headers,
    data: {
      name,
      categoryId: categoryId ?? (await firstCategoryId(request, headers)),
      amount,
      billingCycle,
      paymentMethod: 'blik',
      status,
      ...(status === 'trial' ? { trialEndDate: futureDay(14).iso } : {}),
      nextBillingDate: futureDay().iso,
    },
  });
  expect(created.status()).toBe(201);
}

async function firstCategoryId(
  request: APIRequestContext,
  headers: Record<string, string>,
): Promise<string> {
  const categories = await request.get(`${API_ORIGIN}/categories`, { headers });
  expect(categories.status()).toBe(200);
  const [category] = (await categories.json()) as CategoryResponse[];
  expect(category, 'no default categories (were the migrations run?)').toBeDefined();
  return category.id;
}
