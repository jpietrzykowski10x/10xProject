import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { credentialsInterceptor } from './credentials.interceptor';

// The oracle is "the session cookie goes to our API and nowhere else": requests to the API origin
// carry credentials, requests to any other host, including one whose name merely starts with the
// API host, do not.

const API = environment.apiUrl;

let http: HttpClient;
let httpTesting: HttpTestingController;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([credentialsInterceptor])),
      provideHttpClientTesting(),
    ],
  });
  http = TestBed.inject(HttpClient);
  httpTesting = TestBed.inject(HttpTestingController);
});

afterEach(() => {
  httpTesting.verify();
});

function sentWithCredentials(url: string): boolean {
  http.get(url).subscribe();
  const request = httpTesting.expectOne(url);
  request.flush({});
  return request.request.withCredentials;
}

it.each([
  ['the API root', API],
  ['an API route', `${API}/x`],
])('sends the cookie to %s', (_case, url) => {
  expect(sentWithCredentials(url)).toBe(true);
});

it.each([
  ['a host that only starts with the API host', `${API}.example.com/x`],
  ['another host', 'https://other.example.com/x'],
])('does not send the cookie to %s', (_case, url) => {
  expect(sentWithCredentials(url)).toBe(false);
});
