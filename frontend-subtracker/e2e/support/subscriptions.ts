import { type APIRequestContext, expect } from '@playwright/test';
import { API_ORIGIN, SESSION_COOKIE } from './accounts';

// Test data made straight through the API, for browser tests that need a subscription on screen
// before the flow they check. The rows hang off an account from accounts.ts, so that file's
// removeTestData() takes them away.

interface CategoryResponse {
  id: string;
}

// A day 30 days ahead in local time, as the API ("YYYY-MM-DD") and the form ("dd.mm.rrrr") take
// it. Never a past day: the lifecycle job on the API's start would move it on.
export function futureDay(): { iso: string; polish: string } {
  const day = new Date();
  day.setDate(day.getDate() + 30);
  const yyyy = String(day.getFullYear());
  const mm = String(day.getMonth() + 1).padStart(2, '0');
  const dd = String(day.getDate()).padStart(2, '0');
  return { iso: `${yyyy}-${mm}-${dd}`, polish: `${dd}.${mm}.${yyyy}` };
}

// An active monthly subscription of 25 zł in the account's first category, through the API with
// the account's cookie. A client without browser headers passes the CSRF check, so no Origin
// header is needed.
export async function createSubscriptionThroughApi(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<void> {
  const headers = { Cookie: `${SESSION_COOKIE}=${token}` };
  const categories = await request.get(`${API_ORIGIN}/categories`, { headers });
  expect(categories.status()).toBe(200);
  const [category] = (await categories.json()) as CategoryResponse[];
  expect(category, 'no default categories (were the migrations run?)').toBeDefined();
  const created = await request.post(`${API_ORIGIN}/subscriptions`, {
    headers,
    data: {
      name,
      categoryId: category.id,
      amount: 25,
      billingCycle: 'monthly',
      paymentMethod: 'blik',
      status: 'active',
      nextBillingDate: futureDay().iso,
    },
  });
  expect(created.status()).toBe(201);
}
