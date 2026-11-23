<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Kontekst żądania i przyczyny odmów w logu API

- **Plan**: `context/changes/request-context-and-denial-reasons/plan.md`
- **Scope**: Full plan (CI review on PR #72)
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-23
- **CI run**: https://github.com/jpietrzykowski10x/10xProject/actions/runs/45246545824
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Test Coverage       | PASS    |
| Success Criteria    | PASS    |

## Podsumowanie

To drugi przegląd CI, po commicie `52031c3` z poprawkami F1–F6 poprzedniego przeglądu. Wszystkie zmiany z faz 1–4 są w diffie i zgadzają się z kontraktem planu. Odstępstwa opisane w `change.md` (Notes) przyjęto jako zamierzone i nie zgłaszano ich ponownie. Wszystkie poprawki z poprzedniego przeglądu są w kodzie i mają testy.

Doszły dwa nieszkodliwe dodatki spoza planu:

- `describeRequest(undefined)` daje `(no http request)`;
- `csrfDenial` wymaga statusu 403, czyli działa ostrzej niż plan.

Niczego z „What We're NOT Doing” nie naruszono.

Kontrole uruchomione w CI (`backend-subtracker/`, `unset MODE`):

| Polecenie                   | Wynik                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `npx vitest run src/shared` | ✅ 17 plików, 205 testów                                                                        |
| `npm test`                  | ✅ 47 plików, 634 testy                                                                         |
| `npm run test:e2e`          | ✅ 26 plików, 221 testów                                                                        |
| `npm run lint`              | ✅ exit 0; 11 ostrzeżeń `unbound-method` w specyfikacjach guardów (bez błędów)                  |
| `npm run build`             | ✅ exit 0                                                                                       |
| `prettier --check src test` | ✅                                                                                              |
| `npm run migration:show`    | ✅ 17 zastosowanych, 0 oczekujących; plan nie przewiduje nowej migracji, w diffie żadnej nie ma |

Sprawdzone celowe uszkodzenia (każde cofnięte po próbie):

- `DENIAL_LOG_LIMIT` 10 → 11: czerwienieje test limitu w spec filtra.
- Wygaśnięcie sprawdzane przed unieważnieniem w `check`: czerwienieje test kolejności w spec guarda.
- `Date.now()` z powrotem w `issueLink`: czerwienieje test w `auth.service.spec.ts`.

Browser e2e (`npm run build:e2e && npm run e2e`) sprawdza wymagany check `browser-e2e` w `ci.yml` na tym PR.

Ręczne kroki fazy 4 czekają na człowieka, co jest zgodne z planem:

- 4.1: CI na PR;
- 4.2: nagłówek na produkcji;
- 4.3: `curl` CSRF na serwerze;
- 4.4: logowanie linkiem i `link_used`;
- 4.5: `watchdog.log`.

Uwaga dla właściciela: w kopii roboczej runnera `CLAUDE.md` znowu miał niezacommitowaną zmianę, która cofała zdanie dodane w tym PR. Ta zmiana nie trafiła do commita przeglądu, a wersja w gałęzi (`HEAD`) jest poprawna.

## Findings

### F1 — Linia `validation` nie ma limitu długości

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja, poprawka oczywista i wąska
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/shared/validation/validation-pipe.ts:49
- **Detail**: Każdy klucz spoza DTO w kształcie identyfikatora (`^[a-zA-Z][a-zA-Z0-9]{0,39}$`) trafia do `fields`, i nic nie ogranicza ich liczby. `formatDenial` łączy je w jedną linię bez przycięcia.
  - **Skala:** limit body JSON to domyślne 100 kB, więc jedno anonimowe `POST` z kluczami `{"a1":1,"a2":1,…}` (ok. 12 tys. kluczy) daje linię `warn` o długości kilkudziesięciu kB.
  - **Dlaczego limiter nie pomaga:** ogranicza liczbę linii na kod (10 na minutę), a nie ich rozmiar. Jeden klient może więc dopisywać ok. 0,5–1 MB logu na minutę.
  - **Co się zmieniło:** przed tym PR odrzucony 400 niczego nie zapisywał.

  Plan nie określał limitu, więc to nie jest odstępstwo, tylko luka w niezawodności (dysk na MyDevil jest ograniczony).

- **Fix**: Ograniczyć `fields` w `validationDenial` do pierwszych 20 po posortowaniu, a resztę zgłaszać licznikiem (np. `ids.more=<n>`). Opcjonalnie dodać też ogólny limit długości linii w `formatDenial` dla przyszłych odmów.
- **Decision**: PENDING

### F2 — `SessionService.check` testowane tylko przez guarda

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja, poprawka oczywista i wąska
- **Dimension**: Test Coverage
- **Location**: backend-subtracker/src/auth/services/session.service.ts:98
- **Detail**: Testy sprawdzają pięć przyczyn i ich kolejność, ale tylko w `session-auth.guard.spec.ts:116-195`. Osobnego `session.service.spec.ts` nie ma. Pokrycie jest dziś pełne. Gdyby jednak guard przestał wołać `check`, albo `/auth/session` zaczęło używać innej ścieżki, kolejności nie pilnowałby żaden test.
- **Fix**: Zostawić. Ewentualnie przenieść testy kolejności do `session.service.spec.ts` przy najbliższej zmianie sesji.
- **Decision**: PENDING

### F3 — `link_race` powstaje w dwóch miejscach z różnym zestawem `ids`

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja, poprawka oczywista i wąska
- **Dimension**: Pattern Consistency
- **Location**: backend-subtracker/src/auth/services/auth.service.ts:229
- **Detail**: `link_race` pochodzi z dwóch miejsc:
  - z `consumed.affected !== 1` (`:182`), z `token` i `account`;
  - z ponownego odczytu w `refusedLink`, gdy wiersz jest niezużyty i ważny (`:229`), tylko z `token`.

  Znaczenie jest opisane w `change.md` i działa poprawnie: w jednej transakcji `now()` jest stałe, a `token_hash` jest unikalny. Przy czytaniu logu nie widać jednak, z którego miejsca pochodzi linia, poza obecnością `account=`.

- **Fix**: Dopisać w komentarzu `LinkDenial.RACE` (`src/auth/auth-denials.ts:14`), że kod powstaje w obu miejscach i różni się kluczem `account`.
- **Decision**: PENDING

<!-- End of report -->
