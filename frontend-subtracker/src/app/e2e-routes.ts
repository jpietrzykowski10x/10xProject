import { Routes } from '@angular/router';

// Routes that exist only for the e2e tests: none here. The `e2e` configuration in angular.json
// (npm run build:e2e) swaps this file for e2e-routes.e2e.ts, so no test code reaches any other
// build. app.routes.ts adds E2E_ROUTES and app.routes.server.ts renders E2E_SERVER_PATHS per
// request; render-modes.e2e-spec.ts checks that this file stays empty.

export const E2E_ROUTES: Routes = [];

export const E2E_SERVER_PATHS: readonly string[] = [];
