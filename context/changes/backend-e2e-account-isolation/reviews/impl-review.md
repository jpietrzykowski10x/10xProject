<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Izolacja kont i e2e backendu w CI — plan implementacji

- **Plan**: context/changes/backend-e2e-account-isolation/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 5 observations

Zakres: commity f9b5c69, d898656, 632c5b7, f4e7f99, f61180c, a878d43 (diff e0e77e2..HEAD, 23 pliki). Przegląd przez dwóch subagentów (zgodność z planem; bezpieczeństwo i wzorce) oraz powtórzenie kryteriów automatycznych na HEAD.

Zgodność z planem: brak DRIFT i MISSING. Zmiany EXTRA zatwierdzone przez użytkownika w trakcie: podział `test/subscriptions.e2e-spec.ts` na `test/subscriptions/` (kryterium 3.4), jawne interfejsy `E2eApp` / `AuthRequests` / `SubscriptionRequests` zamiast `ReturnType`, poprawka Commands → Frontend w `CLAUDE.md`, nawias w §2 #6 `test-plan.md`, ścieżka testu CSRF w `backend-patterns.md`. Drobne EXTRA bez zastrzeżeń: `start()` i getter `app` w `E2eApp` (potrzebne do `beforeAll`, odkrywania tras i `vi.spyOn`). `src/` bez zmian, `deploy-*.yml` i joby `backend`/`frontend` bez zmian.

Kryteria automatyczne na HEAD: lint exit 0; `test:e2e` 11 plików / 79 testów; auth 39 testów (przed podziałem 39); najdłuższy plik w `test/` 233 linie; §6.4 bez „TBD”, §5 bez „required after §3 Phase 3”; 0 otwartych pozycji Progress. CI zielone na a878d43 (run 43585359438). `backend-e2e` jest w required checks rulesetu `protect-main` (odczyt `gh api`). Ręczne 1.4–1.6, 2.7, 3.6, 4.3 potwierdzone przez użytkownika; 1.5 (sabotaż `COLLATE`) z dowodem w run 43579527028.

Uwaga poza ustaleniami: wiersz etapu 3 w §3 `test-plan.md` ma jeszcze status `researched`. Zgodnie z planem zmienia go orkiestrator `/10x-test-plan`, nie ta zmiana.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Pomocnik e2e nie odmawia pracy poza `MODE=DEV`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/test/support/e2e-app.ts:164-187
- **Detail**: `start()` łączy się z bazą wybraną przez `appDatabaseName(env)`, zakłada w niej konta i sprząta po prefiksie. Gdy lokalny `.env` ma `MODE=PROD` (np. skopiowany `.env.mydevil`), testy działają na `POSTGRES_DATABASE`, a nie na bazie dev. Skrypty `dev-local/` odmawiają poza `MODE=DEV` (`local-only.mjs`); stare pliki e2e też tego nie sprawdzały, więc to nie regresja, ale teraz jest jedno miejsce, w którym da się to dodać dla 10 plików.
- **Fix**: W `start()` zaraz po `envFromConfig` rzucić błąd, gdy `env.MODE !== 'DEV'`, zanim powstanie aplikacja i ruszy sprzątanie.
- **Decision**: FIXED — `start()` odmawia poza `MODE=DEV` (sprawdzone z tymczasowym `MODE=PROD`: błąd przed dotknięciem danych)

### F2 — Zdublowane pomocniki tokenu i ciasteczka, dwa różne `latestToken`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: backend-subtracker/test/support/e2e-app.ts (`cookiePairOf`, `latestToken`), backend-subtracker/test/auth/auth-e2e.ts (`setCookieOf`, `tokenIn`, `latestToken`)
- **Detail**: Nagłówek `Set-Cookie` jest parsowany w dwóch miejscach, regex tokenu występuje dwa razy, a pod nazwą `latestToken` są dwie funkcje o innej semantyce: `e2e.latestToken(address)` czeka na dowolny mail, `authRequests().latestToken(address, count)` na dokładnie `count` maili. W `sign-in.e2e-spec.ts` łatwo je pomylić. §6.4 kieruje autorów nowych testów do pomocnika, więc dublowanie będzie się kopiować.
- **Fix**: Przenieść `tokenIn` i `setCookieOf` do `test/support/e2e-app.ts`, zbudować na nich `latestToken` i `cookiePairOf` pomocnika, a wersję auth przemianować na `tokenFromMail(address, nth)`.
  - Strength: jedno źródło parsowania; nazwy mówią, na co funkcja czeka.
  - Tradeoff: zmiana importów w 5 plikach auth; asercje bez zmian.
  - Confidence: HIGH — czysto mechaniczne przeniesienie, pokryte pełnym zestawem e2e.
  - Blind spot: None significant.
- **Decision**: FIXED — `tokenIn` i `setCookieOf` w `test/support/e2e-app.ts`, na nich `latestToken` i `cookiePairOf`; wersja auth to `tokenFromMail(address, nth)`

### F3 — Nieaktualne zdania po przejściu e2e do CI

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: backend-subtracker/test/support/e2e-app.ts:79 i komentarz „Runs against the local dev database” w 10 plikach `test/`; context/foundation/backend-patterns.md:57 („oba zestawy e2e”); context/foundation/test-plan.md:128 („Nie mockuj serwisów” wobec `vi.spyOn` w `auth/unexpected-errors.e2e-spec.ts`)
- **Detail**: Komentarze mówią tylko o lokalnej bazie dev, choć te same pliki biegną w CI na bazie `C.UTF-8`; „oba zestawy” nie odpowiada 11 plikom; §6.4 nie wspomina o jedynym dozwolonym wyjątku (spy na serwisie dla ścieżki 500).
- **Fix**: Zmienić komentarze na „the database from .env (locally the dev database, in CI the backend-e2e one)”, w CSRF napisać „wszystkie testy e2e (przez `applyHttpSecurity`)”, w §6.4 dopisać wyjątek dla wymuszenia nieoczekiwanego błędu.
- **Decision**: FIXED — komentarze o bazie z `.env` (lokalnie dev, w CI `backend-e2e`), CSRF „wszystkie testy e2e”, wyjątek `vi.spyOn` w §6.4

### F4 — Nieudany `start()` zostawia otwartą aplikację

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/test/support/e2e-app.ts:164-191
- **Detail**: Gdy `app.init()` albo sprzątanie na starcie rzuci, `started` zostaje puste, aplikacja nie jest zamykana, a `close()` dokłada drugi błąd „not started”, który zasłania pierwszy. Skutek mały: każdy plik ma osobny worker.
- **Fix**: W `start()` zamknąć aplikację w `catch` i rzucić dalej; `close()` bez uruchomionej aplikacji ma nic nie robić.
- **Decision**: FIXED — `start()` zamyka aplikację przy błędzie i rzuca pierwotny błąd; `close()` bez startu nic nie robi

### F5 — Strażnik tras po cichu pomija kontroler bez instancji, a (b) nie sprawdza istnienia testu

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/test/routes.e2e-spec.ts:88, :144
- **Detail**: `continue` przy `instance === undefined` ukrywa kontroler zamiast odpaść, a wtedy asercja (a) przejdzie bez jego tras. Asercja (b) przyjmuje każdy niepusty `twoAccountTest`, więc literówka albo placeholder przejdą.
- **Fix**: Czytać metody z `metatype.prototype` i rzucać przy nieoczekiwanym kształcie; w (b) sprawdzić, że nazwa testu występuje w źródle `test/**/*.e2e-spec.ts`.
- **Decision**: FIXED — metody z `metatype.prototype`, błąd przy nieoczekiwanym kształcie; (b) wymaga nazwy testu w źródłach (sabotaż: literówka → czerwony, istniejąca nazwa → zielony)

### F6 — Wszystkie pliki auth i subskrypcji mają ten sam `describe`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend-subtracker/test/auth/*.e2e-spec.ts, backend-subtracker/test/subscriptions/*.e2e-spec.ts
- **Detail**: Zewnętrzny `describe('Auth flow (e2e)')` i `describe('Subscriptions (e2e)')` zostały we wszystkich plikach, żeby po podziale dało się porównać pełne nazwy testów. Porównanie jest zrobione (commit 632c5b7), a w raportach nazwy z różnych plików wyglądają tak samo.
- **Fix**: Dodać temat do zewnętrznego `describe`, np. `'Auth flow — token rules (e2e)'`.
- **Decision**: FIXED — tematy w zewnętrznych `describe` (np. `Auth flow — token rules (e2e)`)

### F7 — Drobne powtórzenia stałych i pomocników

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend-subtracker/test/subscriptions/access.e2e-spec.ts:5 (`PAST`), backend-subtracker/test/routes.e2e-spec.ts (`ANY_ID`) i account-isolation.e2e-spec.ts (zerowy UUID), subscriptions-e2e.ts (`userIdOf`) wobec auth-e2e.ts (`findUser`), subscriptions-e2e.ts:7 (kolejność importów); access.e2e-spec.ts:19-24 powtarza asercję (c) strażnika tras
- **Detail**: Kilka małych duplikatów, które przy kolejnych plikach będą się kopiować. Test „answers 401 on every route without a session” to przeniesiony test sprzed zmiany (plan kazał zachować asercje), teraz pokrywa go też (c) w `routes.e2e-spec.ts`.
- **Fix**: Przenieść `PAST`, zerowy UUID i `userIdOf` do `test/support/`, poprawić kolejność importów; test 401 bez sesji zostawić albo usunąć na rzecz (c).
- **Decision**: FIXED — `PAST`, `UNKNOWN_ID`, `userIdOf` w `test/support/`, kolejność importów; test „401 bez sesji” zostaje (przeniesiony test z poprawnymi ciałami POST)
