<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Widoczność błędów przeglądarki i SSR oraz przeładowanie po wdrożeniu

- **Plan**: context/changes/client-and-ssr-error-visibility/plan.md
- **Scope**: Full plan (3.6 — kontrola ręczna po wdrożeniu — oczekuje)
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-25
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

Drugi przegląd, po poprawkach z pierwszego (F1–F7, wszystkie FIXED w `c8e7687`; poprzedni raport w historii git tego pliku). Nacisk na `c8e7687`.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated (na `c8e7687`): `npm run test:ci` (727 × 2 strefy), `npm run build`, `npm run build:e2e`, `npm run typecheck:e2e`, `npm run e2e` (23/23) — zielone; `grep e2e/navigation-error` w `dist/frontend-subtracker/` nic nie znajduje, w `dist/frontend-subtracker-e2e/` tak. Manual: 1.5, 2.6, 2.7, 3.7 potwierdzone; 3.6 oczekuje na wdrożenie.

## Findings

### F1 — Pełny adres z query w sessionStorage

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/shared/chunk-reload.ts:71, navigation-error-handler.ts:39
- **Detail**: Kluczem mapy przeładowań jest `error.url` z query i fragmentem, np. `/auth/verify?token=…` albo `/admin/users?q=<e-mail>`. Wpis zostaje w `sessionStorage` do końca karty (stare wpisy znikają dopiero przy kolejnym zapisie). Reszta zmiany konsekwentnie nie zapisuje query.
- **Fix**: kluczem mapy sama ścieżka (`url.split(/[?#]/, 1)[0]`), do `location.assign()` dalej pełny `error.url`; test, że query nie trafia do magazynu.
- **Decision**: FIXED

### F2 — Kontrakty w plan.md opisują rozwiązanie sprzed poprawek

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/client-and-ssr-error-visibility/plan.md:162, 165, 169, 174-177, 186, 193, 230
- **Detail**: Kod, CLAUDE.md i test-plan.md opisują nowe rozwiązanie, ale plan wciąż mówi: `res.end()` (jest `res.destroy()`), linie błędu tylko przy `listening` (są zawsze), flaga `e2eRoutes` i jedna podmiana środowiska (jest `fileReplacements` `e2e-routes.ts` → `e2e-routes.e2e.ts`), czekanie na `/privacy-policy` (jest linia `Started`), sprawdzenie `e2eRoutes: false` (jest pusty `e2e-routes.ts`), wpis `{ url, at }` (jest mapa adres → czas, max 10). Archiwum dostanie plan niezgodny z kodem.
- **Fix**: dopisać w planie notę „Odstępstwa po impl-review (c8e7687)” z listą F1–F7 i odesłaniem do historii tego raportu, bez przepisywania kontraktów.
- **Decision**: FIXED

### F3 — Skrócony komunikat może wrócić do logu jako „ramka”

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/server-log.ts:152
- **Detail**: Gdy komunikat skrócono po utworzeniu błędu do prefiksu oryginału (`"abc secret"` → `"abc"`), `stack.startsWith(heading)` jest prawdą, a reszta starej pierwszej linii (` secret`) trafia do logu jako osobna linia.
- **Fix**: zawsze `fromFirstFrame(stack)` (komunikat i tak jest w pierwszej linii); gałąź `startsWith` znika; test na skrócony komunikat.
- **Decision**: FIXED

### F4 — Asercja stderr w ssr-errors bez czekania

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/e2e/http/ssr-errors.e2e-spec.ts:109-116
- **Detail**: Linia access logu jest sprawdzana przez `expect.poll`, a linia `ERROR` w stderr od razu. stdout i stderr to osobne potoki (na Windows asynchroniczne), więc test może być niestabilny.
- **Fix**: asercje `errors` i `not.toContain('secret')` też w `expect.poll`.
- **Decision**: FIXED

### F5 — Ucięta odpowiedź ma w access logu `aborted`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/server.ts:84-86
- **Detail**: Po F1 `res.destroy()` daje `close` bez `finish`, więc linia `Access` mówi `aborted`, a komentarz wymienia tylko klienta i `requestTimeout`. Linia `ERROR [Render]` obok wskazuje przyczynę, więc to kwestia opisu.
- **Fix**: dopisać w komentarzu trzeci przypadek: odpowiedź ucięta po błędzie renderu (middleware błędów).
- **Decision**: FIXED

### F6 — Kontrola „brak trasy e2e w produkcji” sprawdza tylko źródło

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/e2e/http/render-modes.e2e-spec.ts:96-102
- **Detail**: Test sprawdza, że `e2e-routes.ts` jest pusty. Nie złapie dopisania podmiany `e2e-routes` do konfiguracji `production` w `angular.json` (CI nie buduje bundla produkcyjnego).
- **Fix**: dodać asercję, że `configurations.production.fileReplacements` w `angular.json` nie zawiera `e2e-routes`.
- **Decision**: FIXED
