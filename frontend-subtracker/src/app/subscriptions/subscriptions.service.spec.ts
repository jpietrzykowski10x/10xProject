import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { DEFAULT_SUBSCRIPTION_LIST_QUERY } from './subscription-list-query';
import type { Category, SubscriptionPage } from './subscription.types';
import { SubscriptionsService } from './subscriptions.service';

const CATEGORY_URL = `${environment.apiUrl}/categories/category-1`;
const SUBSCRIPTIONS_URL = `${environment.apiUrl}/subscriptions`;
const CATEGORY_ID = '3f2b8c1e-9d4a-4f6b-8a2c-1e5d7f9b0c3a';

function setUp() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    service: TestBed.inject(SubscriptionsService),
    httpTesting: TestBed.inject(HttpTestingController),
  };
}

// The oracle is the API contract (backend categories.controller.ts): PATCH and DELETE
// /categories/:id.
describe('SubscriptionsService categories', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('renames a category with PATCH /categories/:id and answers with the category', async () => {
    const { service, httpTesting } = setUp();
    const renamed: Category = { id: 'category-1', name: 'Siłownia', isDefault: false };

    const answer = firstValueFrom(service.renameCategory('category-1', 'Siłownia'));
    const request = httpTesting.expectOne({ method: 'PATCH', url: CATEGORY_URL });
    expect(request.request.body).toStrictEqual({ name: 'Siłownia' });
    request.flush(renamed);

    expect(await answer).toStrictEqual(renamed);
  });

  it('deletes a category with DELETE /categories/:id', () => {
    const { service, httpTesting } = setUp();
    let done = false;

    service.deleteCategory('category-1').subscribe({ complete: () => (done = true) });
    const request = httpTesting.expectOne({ method: 'DELETE', url: CATEGORY_URL });
    expect(request.request.body).toBeNull();
    request.flush(null, { status: 204, statusText: 'No Content' });

    expect(done).toBe(true);
  });
});

// The oracle is the API contract (backend dtos/list-subscriptions.dto.ts): GET /subscriptions with
// sort, category, status and page, each optional with its default, answered with one page.
describe('SubscriptionsService list', () => {
  afterEach(() => {
    try {
      TestBed.inject(HttpTestingController).verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('sends no parameters for the default query and answers with the page', async () => {
    const { service, httpTesting } = setUp();
    const page: SubscriptionPage = { items: [], total: 0, page: 1, pageSize: 25 };

    const answer = firstValueFrom(service.list(DEFAULT_SUBSCRIPTION_LIST_QUERY));
    const request = httpTesting.expectOne({ method: 'GET', url: SUBSCRIPTIONS_URL });
    expect(request.request.params.keys()).toStrictEqual([]);
    request.flush(page);

    expect(await answer).toStrictEqual(page);
  });

  it('sends every value that differs from the default', () => {
    const { service, httpTesting } = setUp();

    service
      .list({ sort: 'amount_desc', category: CATEGORY_ID, status: 'trial', page: 3 })
      .subscribe();
    const request = httpTesting.expectOne(
      (candidate) => candidate.method === 'GET' && candidate.url === SUBSCRIPTIONS_URL,
    );
    const params = request.request.params;
    expect(Object.fromEntries(params.keys().map((key) => [key, params.getAll(key)]))).toStrictEqual(
      {
        sort: ['amount_desc'],
        category: [CATEGORY_ID],
        status: ['trial'],
        page: ['3'],
      },
    );
    request.flush({ items: [], total: 0, page: 3, pageSize: 25 });
  });
});
