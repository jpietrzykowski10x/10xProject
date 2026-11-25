import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type { Category } from './subscription.types';
import { SubscriptionsService } from './subscriptions.service';

const CATEGORY_URL = `${environment.apiUrl}/categories/category-1`;

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
