import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { environment } from '../../environments/environment';
import type { MockInstance } from 'vitest';
import { sessionExpiredInterceptor } from './session-expired.interceptor';

// The oracle is the rule "a 401 from the API outside /auth/ means the session ended while the page
// was open, so the visitor goes to /sign-in". Under /auth/ a 401 is an expected answer (e.g. an
// invalid sign-in link), other statuses are not a lost session, and other hosts are not our API.
// In every case the error still reaches the caller, so the page can reset its own state.

const API = environment.apiUrl;

let http: HttpClient;
let httpTesting: HttpTestingController;
let navigateByUrl: MockInstance<Router['navigateByUrl']>;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([sessionExpiredInterceptor])),
      provideHttpClientTesting(),
      provideRouter([]),
    ],
  });
  http = TestBed.inject(HttpClient);
  httpTesting = TestBed.inject(HttpTestingController);
  // Observed on the real Router; resolved so no real navigation runs against an empty route table.
  navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
});

afterEach(() => {
  httpTesting.verify();
});

// Sends a GET, answers it with the given status and returns the error the caller received.
function failRequest(url: string, status: number): HttpErrorResponse | undefined {
  let received: HttpErrorResponse | undefined;
  http.get(url).subscribe({
    error: (error: HttpErrorResponse) => (received = error),
  });
  httpTesting.expectOne(url).flush('error', { status, statusText: 'Error' });
  return received;
}

it('sends the visitor to /sign-in on a 401 from an API route and still passes the error on', () => {
  const error = failRequest(`${API}/subscriptions`, 401);

  expect(navigateByUrl).toHaveBeenCalledTimes(1);
  expect(navigateByUrl).toHaveBeenCalledWith('/sign-in');
  expect(error).toBeInstanceOf(HttpErrorResponse);
  expect(error?.status).toBe(401);
});

it.each([
  ['a 401 from /auth/session', `${API}/auth/session`, 401],
  ['a 401 from /auth/verify', `${API}/auth/verify`, 401],
  ['a 500 from an API route', `${API}/subscriptions`, 500],
  ['a 401 from another host', 'https://other.example.com/subscriptions', 401],
])('does not navigate on %s and passes the error on', (_case, url, status) => {
  const error = failRequest(url, status);

  expect(navigateByUrl).not.toHaveBeenCalled();
  expect(error?.status).toBe(status);
});

it('does not navigate when the request succeeds', () => {
  let body: unknown;
  http.get(`${API}/subscriptions`).subscribe((value) => (body = value));

  httpTesting.expectOne(`${API}/subscriptions`).flush([]);

  expect(body).toEqual([]);
  expect(navigateByUrl).not.toHaveBeenCalled();
});
