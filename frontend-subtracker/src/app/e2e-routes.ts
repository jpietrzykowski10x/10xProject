import { Component } from '@angular/core';
import { Routes } from '@angular/router';

// Routes that exist only in the `e2e` build (environment.e2e.ts, e2eRoutes: true): app.routes.ts
// adds them and app.routes.server.ts renders them on the server per request. Never in production.

// Never shown: the guard of its only route throws first.
@Component({
  selector: 'app-e2e-never-shown',
  template: '',
})
class E2eNeverShown {}

export const E2E_ROUTES: Routes = [
  {
    // A navigation that throws on the server (e2e/http/ssr-errors.e2e-spec.ts): 500 with the
    // /unavailable page and one ERROR [Navigation] line (navigation-error-handler.ts).
    path: 'e2e/navigation-error',
    canActivate: [
      () => {
        throw new Error('e2e navigation error');
      },
    ],
    component: E2eNeverShown,
  },
];

export const E2E_SERVER_PATHS: readonly string[] = E2E_ROUTES.flatMap((route) =>
  route.path === undefined ? [] : [route.path],
);
