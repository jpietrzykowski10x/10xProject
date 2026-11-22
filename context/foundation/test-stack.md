# Test stack

How to add and run each kind of test, with the reasoning: `context/foundation/test-plan.md` §6 (browser e2e: §6.5).
Read by `/10x-tdd` (runner, single-file command, placement) and `/10x-e2e`. No root `package.json`: every
command runs inside its app's directory. Commands checked 2026-11-22.

## Frontend unit and component tests

- runner: Vitest through Angular's `@angular/build:unit-test` builder (`ng test`), jsdom; component tests with TestBed
- location: `*.spec.ts` next to the tested file in `frontend-subtracker/src/` (cookbook §6.1 units, §6.2 components)
- single-file command: cd frontend-subtracker && npx ng test --include src/app/subscriptions/subscription-amounts.spec.ts --watch=false
- full-suite command: cd frontend-subtracker && npm test -- --watch=false (machine time zone); as CI runs it, in Europe/Warsaw and America/New_York: npm run test:ci
- time zones: a test that depends on the zone passes in both; `TZ=...` before `ng test` does not work on Windows, use `test:ci`
- CI: job `frontend` (`npm run test:ci`)

## Backend unit tests

- runner: Vitest (`backend-subtracker/vitest.config.ts`, `**/*.spec.ts`, globals on; `*.e2e-spec.ts` is not matched)
- location: `*.spec.ts` next to the tested file in `backend-subtracker/src/`; helpers in `src/shared/<area>/` always with a test next to them (cookbook §6.3)
- single-file command: cd backend-subtracker && npx vitest run src/shared/database/like-pattern.spec.ts
- full-suite command: cd backend-subtracker && npm test
- CI: job `backend` (`npm run lint`, `npm test`)

## Backend API tests (e2e against PostgreSQL)

- runner: Vitest with `backend-subtracker/vitest.config.e2e.ts` (`test/**/*.e2e-spec.ts`, files one after another on one database); helper `test/support/e2e-app.ts`
- location: `backend-subtracker/test/<area>.e2e-spec.ts` or `test/<area>/<topic>.e2e-spec.ts`; shared requests of an area in a helper without `.e2e-spec` (cookbook §6.4)
- single-file command: cd backend-subtracker && npx vitest run --config ./vitest.config.e2e.ts test/subscriptions/account-isolation.e2e-spec.ts
- full-suite command: cd backend-subtracker && npm run test:e2e
- needs: local PostgreSQL and `backend-subtracker/.env` (`subtracker-db-dev`); sorting of Polish text is proven only in CI (Postgres 16, `C.UTF-8`)
- CI: job `backend-e2e`

## E2E

<!-- Written by /10x-e2e-setup. Re-run it to change this section; other skills only read it. -->

- runner: Playwright Test, @playwright/test 1.65.1
- config: frontend-subtracker/playwright.config.ts (projects `http` = `e2e/http/`, request fixture only, and `chromium` = `e2e/browser/`; files match `**/*.e2e-spec.ts`, never `*.spec.ts`, which `ng test` collects; `workers: 1`, `retries: 0`)
- single-spec command: cd frontend-subtracker && npm run build:e2e && npx playwright test e2e/browser/<name>.e2e-spec.ts (the build only after a change of app code)
- full-suite command: cd frontend-subtracker && npm run build:e2e && npm run e2e
- base URL: http://localhost:4000
- port: 4000 (detected from frontend-subtracker/playwright.config.ts: `SSR_ORIGIN` and the SSR entry's `PORT`); no E2E_PORT override: the port is tied to `CORS_ORIGINS` in backend-subtracker/.env and to the API address of the `e2e` build configuration
- web server command: npm run build:e2e (a separate step, not part of the entry) + node dist/frontend-subtracker-e2e/server/server.mjs with PORT=4000; a second entry starts the API (`npm run start:prod` in backend-subtracker, health on http://localhost:3000/health); reuseExistingServer outside CI
- auth setup project: none — sign-in is a magic link by e-mail, so no test signs in through the UI; accounts and sessions are created in the local DEV database by frontend-subtracker/e2e/support/accounts.ts (`createE2eAccounts`, `sessionCookie`), configured from backend-subtracker/.env (`MODE=DEV` required)
- storageState: none
- seed: frontend-subtracker/e2e/browser/guards.e2e-spec.ts — protects #2 (a guard lets a signed-out visitor into a signed-in page or traps a signed-in user on a public one; the API unreachable keeps the address)
- browser CLI: npx -y @playwright/cli (0.1.25 checked 2026-11-22; no global install, no command skill: --help only)
- updated: 2026-11-22
