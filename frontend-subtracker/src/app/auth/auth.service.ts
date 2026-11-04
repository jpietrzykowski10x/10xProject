import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { catchError, Observable, of, tap, throwError } from 'rxjs';
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

  // Set by me(), so a page behind authGuard can read the user the guard has just fetched.
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

  me(): Observable<AuthUser> {
    return this.http.get<AuthUser>(`${this.apiUrl}/me`).pipe(tap((user) => this.user.set(user)));
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/logout`, null).pipe(
      // 401 means the session is already gone, which is what logging out asks for.
      catchError((error: HttpErrorResponse) =>
        error.status === 401 ? of(undefined) : throwError(() => error),
      ),
      tap(() => this.user.set(null)),
    );
  }
}
