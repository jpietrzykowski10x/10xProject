# frontend-subtracker

[Polski](#polski) · [English](#english)

Back to the main README / powrót do głównego README: [`../README.md`](../README.md)

---

## Polski

Frontend SubTrackera: Angular 22 (komponenty standalone), SSR przez `@angular/ssr`, Angular Material 22, style SCSS. Pierwsze uruchomienie, wymagania (Node 24) i współpraca z API: [główne README](../README.md#pierwsze-uruchomienie-lokalnie).

### Polecenia

Wszystkie z tego katalogu (`cd frontend-subtracker`):

| Polecenie | Co robi |
|---|---|
| `npm start` | serwer deweloperski `ng serve` na http://localhost:4200 |
| `npm run build` | build produkcyjny do `dist/frontend-subtracker/` (bundle przeglądarki i serwera) |
| `npm run serve:ssr:frontend-subtracker` | uruchamia zbudowany serwer SSR (port `PORT`, domyślnie 4000) |
| `npm test` | testy jednostkowe i komponentów (Vitest przez `@angular/build:unit-test`, `src/**/*.spec.ts`) |
| `npm run test:ci` | cały zestaw raz na strefę czasową (Warszawa, Nowy Jork), jak w CI |
| `npm run build:e2e` | build w konfiguracji `e2e` (optymalizacja produkcyjna, API lokalne na :3000) do `dist/frontend-subtracker-e2e/` |
| `npm run e2e` | Playwright (`e2e/**/*.e2e-spec.ts`, projekty `http` i `chromium`) na buildzie e2e (:4000) i prawdziwym API; po zmianie kodu najpierw znowu `build:e2e` |
| `npm run typecheck:e2e` | kontrola typów testów e2e |
| `npm run prepare-mydevil` | paczka do deployu na MyDevil (używa jej CI) |

### Układ

- `src/app/` — `app.routes.ts` (trasy), `app.routes.server.ts` (tryb renderowania każdej trasy), katalogi funkcji: `auth/`, `subscriptions/`, `budget/`, `pages/`, wspólne `layout/` (układ publiczny i app-shell) oraz `shared/`.
- `src/styles/` — motyw (`_theme.scss`, zmienne `--st-*`) i wspólne części SCSS.
- `src/server.ts` — serwer Express dla SSR.
- `e2e/` — testy Playwright: `http/`, `browser/`, `support/` (konta i sesje testowe).
- `scripts/` — `prepare-mydevil.mjs`, `test-time-zones.mjs`.

### Ważne zasady

- Każda trasa jest domyślnie prerenderowana przy buildzie; trasy zależne od zalogowanego użytkownika potrzebują jawnego `RenderMode.Client` albo `RenderMode.Server` w `app.routes.server.ts` (szczegóły w [`CLAUDE.md`](../CLAUDE.md)).
- Nic nie jest pobierane z Google: czcionka IBM Plex Sans z `@fontsource`, ikony jako inline SVG.
- Jak dodać test: [`context/foundation/test-plan.md`](../context/foundation/test-plan.md) §6.1–6.2 (jednostkowe i komponentów), §6.5 (e2e przeglądarki).

---

## English

The SubTracker frontend: Angular 22 (standalone components), SSR through `@angular/ssr`, Angular Material 22, SCSS styles. First run, requirements (Node 24) and working with the API: [main README](../README.md#first-local-run).

### Commands

All from this folder (`cd frontend-subtracker`):

| Command | What it does |
|---|---|
| `npm start` | dev server `ng serve` on http://localhost:4200 |
| `npm run build` | production build to `dist/frontend-subtracker/` (browser and server bundles) |
| `npm run serve:ssr:frontend-subtracker` | runs the built SSR server (port `PORT`, default 4000) |
| `npm test` | unit and component tests (Vitest via `@angular/build:unit-test`, `src/**/*.spec.ts`) |
| `npm run test:ci` | the whole suite once per time zone (Warsaw, New York), as in CI |
| `npm run build:e2e` | build in the `e2e` configuration (production optimisation, local API on :3000) to `dist/frontend-subtracker-e2e/` |
| `npm run e2e` | Playwright (`e2e/**/*.e2e-spec.ts`, projects `http` and `chromium`) on the e2e build (:4000) and the real API; re-run `build:e2e` after changing code |
| `npm run typecheck:e2e` | type check of the e2e tests |
| `npm run prepare-mydevil` | MyDevil deploy package (used by CI) |

### Layout

- `src/app/` — `app.routes.ts` (routes), `app.routes.server.ts` (render mode of each route), feature folders `auth/`, `subscriptions/`, `budget/`, `pages/`, shared `layout/` (public layout and app shell) and `shared/`.
- `src/styles/` — the theme (`_theme.scss`, `--st-*` variables) and shared SCSS partials.
- `src/server.ts` — the Express server for SSR.
- `e2e/` — Playwright tests: `http/`, `browser/`, `support/` (test accounts and sessions).
- `scripts/` — `prepare-mydevil.mjs`, `test-time-zones.mjs`.

### Key rules

- Every route is prerendered at build time by default; routes that depend on the signed-in user need an explicit `RenderMode.Client` or `RenderMode.Server` in `app.routes.server.ts` (details in [`CLAUDE.md`](../CLAUDE.md)).
- Nothing is loaded from Google: IBM Plex Sans comes from `@fontsource`, icons are inline SVG.
- How to add a test: [`context/foundation/test-plan.md`](../context/foundation/test-plan.md) §6.1–6.2 (unit and component), §6.5 (browser e2e).
