import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';

interface HealthResponse {
  status: 'ok' | 'error';
  db: 'ok' | 'error';
}

type ApiStatusState = 'checking' | 'ok' | 'db-error' | 'unreachable';

// Temporary: proves the cross-subdomain call with credentials works. S-01 replaces the home
// page with the sign-in screen.
@Component({
  selector: 'app-api-status',
  templateUrl: './api-status.html',
  styleUrl: './api-status.scss',
})
export class ApiStatus {
  private readonly http = inject(HttpClient);
  protected readonly state = signal<ApiStatusState>('checking');

  constructor() {
    // Browser only: prerendering at build time must not call the API.
    afterNextRender(() => this.check());
  }

  private check(): void {
    this.http
      .get<HealthResponse>(`${environment.apiUrl}/health`, { withCredentials: true })
      .subscribe({
        next: (health) => this.state.set(health.db === 'ok' ? 'ok' : 'db-error'),
        error: (error: HttpErrorResponse) => {
          // /health answers 503 with a JSON body when the API runs but the database is down.
          const body = error.error as Partial<HealthResponse> | null;
          this.state.set(error.status === 503 && body?.db === 'error' ? 'db-error' : 'unreachable');
        },
      });
  }
}
