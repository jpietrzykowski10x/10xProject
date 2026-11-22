# Test stack

How to add and run each kind of test, with the reasoning: `context/foundation/test-plan.md` §6 (browser e2e: §6.5).

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
