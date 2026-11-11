import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  Category,
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

  create(request: CreateSubscriptionRequest): Observable<Subscription> {
    return this.http.post<Subscription>(`${this.apiUrl}/subscriptions`, request);
  }

  // Defaults first in their fixed order, then the user's own alphabetically.
  categories(): Observable<Category[]> {
    return this.http.get<Category[]>(`${this.apiUrl}/categories`);
  }

  createCategory(request: CreateCategoryRequest): Observable<Category> {
    return this.http.post<Category>(`${this.apiUrl}/categories`, request);
  }
}
