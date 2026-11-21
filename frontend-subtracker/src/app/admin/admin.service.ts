import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { AdminStatusFilter, AdminUserDetail, AdminUserSummary } from './admin.types';

// S-09: other accounts, for administrators. 403 for anyone else (and for an action on an account
// the administrator does not outrank), 404 for an unknown id, 409 when the account's state does
// not allow the action.
@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/admin/users`;

  // At most 20 accounts. `q` may be empty only with status `blocked`; a shorter one than 3 is a 400.
  search(q: string, status: AdminStatusFilter): Observable<AdminUserSummary[]> {
    let params = new HttpParams();
    if (q !== '') {
      params = params.set('q', q);
    }
    if (status !== 'all') {
      params = params.set('status', status);
    }
    return this.http.get<AdminUserSummary[]>(this.apiUrl, { params });
  }

  user(id: string): Observable<AdminUserDetail> {
    return this.http.get<AdminUserDetail>(`${this.apiUrl}/${encodeURIComponent(id)}`);
  }

  block(id: string): Observable<AdminUserSummary> {
    return this.action(id, 'block');
  }

  unblock(id: string): Observable<AdminUserSummary> {
    return this.action(id, 'unblock');
  }

  resetSessions(id: string): Observable<AdminUserSummary> {
    return this.action(id, 'reset-sessions');
  }

  private action(id: string, name: string): Observable<AdminUserSummary> {
    return this.http.post<AdminUserSummary>(
      `${this.apiUrl}/${encodeURIComponent(id)}/${name}`,
      null,
    );
  }
}
