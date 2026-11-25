<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Widoczność błędów przeglądarki i SSR oraz przeładowanie po wdrożeniu

- **Plan**: context/changes/client-and-ssr-error-visibility/plan.md
- **Scope**: Full plan (3.6 — kontrola ręczna po wdrożeniu — oczekuje)
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-25
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated: `npm run test:ci` (723 × 2 strefy), `npm run build`, `npm run build:e2e`, `npm run typecheck:e2e`, `npm run e2e` (23) — zielone na kodzie a7dc64b; epilog zmienił tylko plan i change.md. Manual: 1.5, 2.6, 2.7, 3.7 potwierdzone przez użytkownika; 3.6 oczekuje na wdrożenie.

## Findings

### F1 — Ucięta strona po wysłaniu nagłówków kończy się jak kompletna

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/server.ts:118-120
- **Detail**: Przy `res.headersSent` middleware woła `res.end()`, co poprawnie zamyka odpowiedź chunked — klient i ewentualny proxy uznają uciętą stronę za pełną. Finalhandler Expressa w tym przypadku niszczy gniazdo.
- **Fix**: `res.destroy()` zamiast `res.end()` przy wysłanych nagłówkach (+ test jednostkowy, jeśli middleware da się wydzielić, inaczej komentarz).
- **Decision**: FIXED

### F2 — Brak linii błędu renderu pod `ng serve`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/server.ts:110
- **Detail**: Linie `ERROR [Render]` są pisane tylko przy `listening`. Pod `ng serve` (reqHandler bez nasłuchu) odrzucony render daje dziś samo „Internal server error.” bez śladu — wcześniej finalhandler wypisywał stos. Plan kazał pisać linie tylko przy `listening` (jak access log), ale access log to szum, a błąd nie.
- **Fix**: pisać linie błędu zawsze; tylko access log zostaje warunkowy (build/prerender i tak rzadko odrzuca, a wtedy linia też jest przydatna).
- **Decision**: FIXED

### F3 — Zapasowa ścieżka stosu nie ucina komunikatu

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/server-log.ts (`renderErrorLines`)
- **Detail**: Gdy `error.stack` nie zaczyna się od nagłówka `name: message` (komunikat zmieniony po utworzeniu błędu), zostaje cały stos razem z komunikatem — bez limitu 200 znaków.
- **Fix**: w tej ścieżce pomijać linie przed pierwszą ramką `    at ` (komunikat jest już w pierwszej linii).
- **Decision**: FIXED

### F4 — Pętla między dwoma adresami nie jest zablokowana

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/shared/chunk-reload.ts (`shouldReload`)
- **Detail**: Znacznik pamięta jeden adres. Gdyby A po przeładowaniu przekierowywało na B, a B na A, każde przeładowanie nadpisuje wpis i ochrona nie działa. Żadna trasa dziś tak nie robi.
- **Fix**: pamiętać mapę adres → czas (z kilkoma ostatnimi wpisami) zamiast jednego wpisu, tak by każdy adres miał własne okno 60 s.
- **Decision**: FIXED

### F5 — Proces SSR w teście dostaje cały .env API

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/e2e/http/ssr-errors.e2e-spec.ts:56
- **Detail**: `env: { ...process.env, … }` przekazuje dziecku wszystko, co `playwright.config.ts` wczytał z `backend-subtracker/.env` (dane SMTP i bazy). Zostaje lokalnie, ale SSR tego nie potrzebuje.
- **Fix**: przekazać tylko potrzebne zmienne (`PATH`, `SystemRoot` na Windows, `PORT`, `NO_COLOR`).
- **Decision**: FIXED

### F6 — Stały port 4100 może zmylić test

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/e2e/http/ssr-errors.e2e-spec.ts:10,19-36
- **Detail**: Gdy na 4100 już coś słucha, sondowanie `/privacy-policy` może trafić w obcy proces, a dziecko padnie na `EADDRINUSE`.
- **Fix**: czekać na linię `Started … on port 4100` w stdout dziecka zamiast sondować HTTP.
- **Decision**: FIXED

### F7 — Kod trasy e2e w bundlu produkcyjnym

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: frontend-subtracker/src/app/app.routes.ts, app.routes.server.ts, e2e-routes.ts
- **Detail**: esbuild nie usuwa gałęzi `environment.e2eRoutes ? E2E_ROUTES : []`, więc martwy kod trasy (rzucający guard, pusty komponent) jest w bundlu produkcyjnym; trasa nie jest zarejestrowana (2.7: 404). Plan mówił „bez kodu testowego w produkcji”. Zapisane w follow-up.
- **Fix**: `fileReplacements` w konfiguracji `e2e`: `e2e-routes.ts` (pusta tablica) → `e2e-routes.e2e.ts` (z trasą); flaga `e2eRoutes` i test źródła zostają albo test sprawdza brak tekstu w `dist/frontend-subtracker-e2e` vs produkcji.
- **Decision**: FIXED
