import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { BudgetResponse, UpdateBudgetRequest } from './budget.types';

// credentialsInterceptor attaches the session cookie to every call under environment.apiUrl.
@Injectable({ providedIn: 'root' })
export class BudgetService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  // Every category of the account with its settings, in the order of GET /categories.
  get(): Observable<BudgetResponse> {
    return this.http.get<BudgetResponse>(`${this.apiUrl}/budget`);
  }

  // The body names only what changes; answers with the whole budget after the save, 400 when a
  // category is unknown (e.g. gone).
  update(body: UpdateBudgetRequest): Observable<BudgetResponse> {
    return this.http.put<BudgetResponse>(`${this.apiUrl}/budget`, body);
  }
}
