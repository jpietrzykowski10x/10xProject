import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  Category,
  CostTotals,
  CreateCategoryRequest,
  CreateSubscriptionRequest,
  Subscription,
} from './subscription.types';

// credentialsInterceptor attaches the session cookie to every call under environment.apiUrl.
@Injectable({ providedIn: 'root' })
export class SubscriptionsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  // Already in display order (status group, then the nearest date, then the name).
  list(): Observable<Subscription[]> {
    return this.http.get<Subscription[]>(`${this.apiUrl}/subscriptions`);
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
}
