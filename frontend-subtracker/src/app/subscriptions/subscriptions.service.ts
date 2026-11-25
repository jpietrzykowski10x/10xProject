import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  Category,
  CostTotals,
  CreateCategoryRequest,
  CreateSubscriptionRequest,
  Subscription,
  SubscriptionListQuery,
  SubscriptionPage,
} from './subscription.types';
import { paramsFromQuery } from './subscription-list-query';

// credentialsInterceptor attaches the session cookie to every call under environment.apiUrl.
@Injectable({ providedIn: 'root' })
export class SubscriptionsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  // One page of the list, already in the requested order (by default the status group, then the
  // nearest date, then the name) and filtered by the API. Only the values that differ from the
  // default are sent, as in the address; the page size stays the API's default.
  list(query: SubscriptionListQuery): Observable<SubscriptionPage> {
    return this.http.get<SubscriptionPage>(`${this.apiUrl}/subscriptions`, {
      params: new HttpParams({ fromObject: paramsFromQuery(query) }),
    });
  }

  // The account's cost totals; the categories come already in display order.
  totals(): Observable<CostTotals> {
    return this.http.get<CostTotals>(`${this.apiUrl}/subscriptions/totals`);
  }

  create(request: CreateSubscriptionRequest): Observable<Subscription> {
    return this.http.post<Subscription>(`${this.apiUrl}/subscriptions`, request);
  }

  // The whole subscription is replaced; 404 when it is gone (or belongs to another account).
  update(id: string, request: CreateSubscriptionRequest): Observable<Subscription> {
    return this.http.put<Subscription>(`${this.apiUrl}/subscriptions/${id}`, request);
  }

  // 204 when deleted; 404 when it is already gone (or belongs to another account).
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/subscriptions/${id}`);
  }

  // active or trial → cancelled_pending (a trial's billing date becomes its end, the trial date
  // null); 409 from any other status, 404 when it is gone (or belongs to another account).
  cancel(id: string): Observable<Subscription> {
    return this.http.post<Subscription>(`${this.apiUrl}/subscriptions/${id}/cancel`, null);
  }

  // cancelled_pending → active, dates unchanged; 409 from any other status, 404 like cancel.
  resume(id: string): Observable<Subscription> {
    return this.http.post<Subscription>(`${this.apiUrl}/subscriptions/${id}/resume`, null);
  }

  // Defaults first in their fixed order, then the user's own alphabetically.
  categories(): Observable<Category[]> {
    return this.http.get<Category[]>(`${this.apiUrl}/categories`);
  }

  createCategory(request: CreateCategoryRequest): Observable<Category> {
    return this.http.post<Category>(`${this.apiUrl}/categories`, request);
  }

  // Only an own category, the name trimmed: 409 when it is taken (case-insensitively) by another
  // own or a default category; 404 when the category is gone, a default or another account's.
  renameCategory(id: string, name: string): Observable<Category> {
    return this.http.patch<Category>(`${this.apiUrl}/categories/${id}`, { name });
  }

  // 204 when deleted together with its threshold and limit; 409 while it has subscriptions, 404
  // like renameCategory.
  deleteCategory(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/categories/${id}`);
  }
}
