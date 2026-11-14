<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Krytyczne ścieżki w przeglądarce (etap 4 planu testów)

- **Plan**: context/changes/browser-critical-paths/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5, 6
- **Date**: 2026-11-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

Weryfikacja na HEAD (`7a9e9fb`): `build:e2e` OK, build e2e bez produkcyjnego API, `typecheck:e2e` OK, `playwright test --repeat-each=3` 36/36, `npm test` 23 pliki (bez `e2e/`), grepy fazy 6 OK. CI na `a7d3989`: 5/5 jobów zielonych, `browser-e2e` wymagany dla `main` (potwierdzone przez API). Wszystkie pozycje Manual w Progress mają dowody (sabotaże uruchomione lokalnie i w CI, ślad Playwrighta obejrzany przez użytkownika).

Uwagi bez ustaleń: daty w §8 `test-plan.md` podbite na prośbę użytkownika; kontrola prefiksu `e2e-browser-` w `createE2eAccounts` to nieszkodliwy dodatek; ślady i raport w artefakcie CI zawierają ciasteczka sesji z jednorazowej bazy CI (bez realnego ryzyka); `reuseExistingServer` lokalnie używa działających serwerów (opisane w CLAUDE.md i §6.5).

## Findings

### F1 — `typecheck:e2e` nie biegnie w CI

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: .github/workflows/ci.yml:57-59 (job `frontend`), :215-233 (job `browser-e2e`)
- **Detail**: Plan wymaga `npm run typecheck:e2e` w kryteriach faz 1–4, ale żaden job CI go nie uruchamia. Playwright usuwa typy bez sprawdzania, więc błąd typów w specach albo `playwright.config.ts` przejdzie przez CI niezauważony.
- **Fix**: Dodać krok `npm run typecheck:e2e` w jobie `browser-e2e` przed `npm run e2e` (frontend jest już zainstalowany w tym jobie).
- **Decision**: FIXED

### F2 — Ochrona bazy tylko w `playwright.config.ts`, pomocnik kont bez własnej kontroli

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/e2e/support/accounts.ts:76-96, frontend-subtracker/playwright.config.ts:21-47
- **Detail**: `createE2eAccounts` łączy się z `POSTGRES_DATABASE_DEV` i usuwa wiersze po prefiksie bez sprawdzenia `MODE=DEV` i lokalnego hosta — robi to tylko config Playwrighta. Zaimportowany z innego skryptu (albo z innym configiem) pomocnik zadziała na dowolnej bazie z env. Dodatkowo, w odróżnieniu od `dev-local/local-only.mjs`, lokalnie nie jest odrzucane `POSTGRES_DATABASE_DEV == POSTGRES_DATABASE` (źle ustawiony `.env` zapisywałby do referencyjnej `subtracker-db`, która ma się zmieniać tylko migracjami), a prefiks nie jest walidowany pod kątem znaków `%`/`_` (symbole wieloznaczne `LIKE`).
- **Fix**: Wspólna funkcja `assertLocalDevSetup()` w `e2e/support/` (MODE=DEV, lokalny host, CORS z :4000, a poza CI także `POSTGRES_DATABASE_DEV !== POSTGRES_DATABASE`), wołana z `playwright.config.ts` i z `db()` w pomocniku przed `connect()`; prefiks walidowany regexem `/^e2e-browser-[a-z0-9-]+-$/`.
  - Strength: Ten sam wzorzec co `dev-local/local-only.mjs` — każdy punkt wejścia sam pilnuje bazy; zamyka też lukę z bazą referencyjną.
  - Tradeoff: Mała refaktoryzacja configu i pomocnika; config dalej musi działać w CI, gdzie obie bazy są celowo tą samą bazą.
  - Confidence: HIGH — kontrola już istnieje, zmienia się tylko jej miejsce i dochodzi jeden warunek.
  - Blind spot: Nie sprawdzono, czy Playwright ładuje config przed importem specy w każdym trybie (np. rozszerzenie VS Code).
- **Decision**: FIXED

### F3 — Wersja polityki prywatności skopiowana ręcznie z backendu

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/e2e/support/accounts.ts:17
- **Detail**: `PRIVACY_POLICY_VERSION = '0-placeholder'` to kopia `backend-subtracker/src/auth/auth.constants.ts:8`. Plan na to pozwalał, ale po zmianie wersji w backendzie konta z pomocnika będą miały starą wersję zgód, bez żadnego sygnału.
- **Fix**: Odczytać stałą z pliku backendu w `accounts.ts` (regex na `export const PRIVACY_POLICY_VERSION = '...'`) i rzucić błąd, gdy jej nie ma.
- **Decision**: FIXED

### F4 — Pusta lista kategorii daje niejasny `TypeError` w teście przepływu

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/e2e/browser/subscriptions-flow.e2e-spec.ts:48
- **Detail**: `const [category] = ...` i potem `category.id` — przy bazie bez kategorii domyślnych (np. bez migracji danych startowych) test pada na `Cannot read properties of undefined` zamiast na czytelnej przyczynie.
- **Fix**: Przed destrukturyzacją `expect(list.length, 'brak kategorii domyślnych (migracje nie uruchomione?)').toBeGreaterThan(0)`.
- **Decision**: FIXED

### F5 — W planie zginął zapis `\u002F`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/browser-critical-paths/plan.md:248
- **Detail**: Kontrakt fazy 2 mówi, że URL w stanie transferu jest „zapisany z `/`” — przy edycji zgubiono `\u002F` (ten sam problem poprawiony już w §6.5 `test-plan.md`). Zdanie jest przez to sprzeczne z samym sobą.
- **Fix**: Wpisać dosłownie `\u002F` (przez Node, nie przez Edit/sed, które zjadają `\u`).
- **Decision**: FIXED

### F6 — `close()` rzuca drugi raz po nieudanym połączeniu

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/e2e/support/accounts.ts:85-96, 150-157
- **Detail**: Gdy `connect()` się nie uda, `connected` trzyma odrzuconą obietnicę; `close()` w `finally` czeka na nią i rzuca ten sam błąd jeszcze raz — raport pokazuje błąd podwójnie. Nic nie wycieka.
- **Fix**: W `db()` wyzerować `connected`, gdy połączenie się nie uda (`.catch` → `connected = undefined; throw`).
- **Decision**: FIXED
