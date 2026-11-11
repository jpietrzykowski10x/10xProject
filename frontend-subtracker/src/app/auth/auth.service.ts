import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { map, Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AuthUser {
  id: string;
  email: string;
  roles: string[];
}

export interface RegisterRequest {
  email: string;
  confirmedAdult: boolean;
  acceptedPrivacyPolicy: boolean;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/auth`;
  private readonly user = signal<AuthUser | null>(null);

  // Set by session(), so a page behind authGuard can read the user the guard has just fetched.
  readonly currentUser = this.user.asReadonly();

  register(request: RegisterRequest): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/register`, request);
  }

  requestLink(email: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/request-link`, { email });
  }

  verify(token: string): Observable<AuthUser> {
    return this.http.post<AuthUser>(`${this.apiUrl}/verify`, { token });
  }

  // Not /auth/me: its 401 for a signed-out visitor would show as an error in the browser console.
  // `cookie` is passed only during server-side rendering, where the browser does not attach the
  // session cookie itself; the response is kept out of the transfer cache (app.config.ts).
  session(cookie?: string): Observable<AuthUser | null> {
    const headers = cookie ? new HttpHeaders({ Cookie: cookie }) : undefined;
    return this.http.get<{ user: AuthUser | null }>(`${this.apiUrl}/session`, { headers }).pipe(
      map(({ user }) => user),
      tap((user) => this.user.set(user)),
    );
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/logout`, null).pipe(tap(() => this.user.set(null)));
  }
}
