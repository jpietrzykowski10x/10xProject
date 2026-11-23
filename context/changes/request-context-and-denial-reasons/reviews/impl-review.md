<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Kontekst żądania i przyczyny odmów w logu API

- **Plan**: `context/changes/request-context-and-denial-reasons/plan.md`
- **Scope**: Full plan (CI review on PR #72)
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-23
- **CI run**: https://github.com/jpietrzykowski10x/10xProject/actions/runs/45241479139
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Test Coverage       | PASS    |
| Success Criteria    | PASS    |

## Podsumowanie

Wszystkie zmiany z faz 1–4 są w diffie. Niczego z planu nie brakuje i żadne wyłączenie z „What We're NOT Doing” nie zostało naruszone: nie ma logowania 404/409, przychodzący `X-Request-Id` jest ignorowany, a jedyna zmiana odpowiedzi HTTP to P5.

Kontrole uruchomione w CI (`backend-subtracker/`, `unset MODE`):

| Polecenie                   | Wynik                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `npx vitest run src/shared` | ✅ 17 plików, 204 testy                                                                          |
| `npm test`                  | ✅ 47 plików, 632 testy                                                                          |
| `npm run test:e2e`          | ✅ 26 plików, 220 testów                                                                         |
| `npm run lint`              | ✅ exit 0; 11 ostrzeżeń `unbound-method` w niezmienionych wierszach specyfikacji (stan z `main`) |
| `npm run build`             | ✅ exit 0                                                                                        |
| `prettier --check src test` | ✅                                                                                               |
| `npm run migration:show`    | ✅ wszystkie migracje zastosowane; plan nie przewiduje nowej migracji, w diffie żadnej nie ma    |

Sprawdzone celowe uszkodzenia:

- `describeRequest` z `originalUrl` czerwieni 10 testów.
- Pominięcie sprawdzenia `revoked` czerwieni test kolejności w `check`.
- „Limit 10 → 11” i „`Date.now()` w `issueLink`” oceniono z treści asercji: test oczekuje dokładnie 10 linii, a `issueLink` ma dawać wyrażenie SQL i dokładnie 900 s w e2e.

Browser e2e (`npm run build:e2e && npm run e2e`) sprawdza wymagany check `browser-e2e` w `ci.yml` na tym PR.

Ręczne kroki fazy 4 czekają na człowieka, co jest zgodne z planem:

- 4.1: CI na PR;
- 4.2: nagłówek na produkcji;
- 4.3: `curl` CSRF na serwerze;
- 4.4: logowanie linkiem i `link_used`;
- 4.5: `watchdog.log`.

Uwaga dla właściciela: w kopii roboczej runnera `CLAUDE.md` miał niezacommitowaną zmianę, która cofała zdanie dodane w tym PR. Ta zmiana nie trafiła do commita przeglądu. Wersja w gałęzi jest poprawna, a dodane zdanie stoi poza blokiem synchronizowanym przez `10x`.

## Findings

### F1 — Przyczyny `verify` odbiegają od kontraktu planu (klucz `account`, dodatkowy `link_race`, znak `_`)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja, poprawka oczywista i wąska
- **Dimension**: Plan Adherence
- **Location**: backend-subtracker/src/auth/services/auth.service.ts:150
- **Detail**: Kod różni się od planu w trzech miejscach.
  - **Klucz `account` zamiast `user`.** Plan (faza 3 #1): „`link_user_missing` (`token`, `user`); … `link_account_blocked` (`token`, `user`); … `link_race` (`token`, `user`)”. W kodzie jest `const ids = { token: unused.id, account: unused.userId }`, więc linia ma `account=<uuid>`. To rozsądne, bo `user=` jest już polem kontekstu żądania z innym znaczeniem. Decyzja jest opisana w `backend-patterns.md`, ale plan jej nie zawiera.
  - **Dodatkowy przypadek `link_race`.** `refusedLink` (`:229`) zwraca `link_race` także wtedy, gdy przy ponownym odczycie wiersz jest niezużyty i ważny. Plan zarezerwował ten kod dla `consumed.affected !== 1`.
  - **Znak `_` w wartościach `ids`.** `denial.ts:45` dopuszcza `_`, czego nie ma w planie (`[0-9a-z.:/-]+`). Bez tego `action=reset_sessions` wyszłoby jako `reset?sessions`.
- **Fix**: Przyjąć wszystkie trzy odstępstwa jako zamierzone. Dopisać je w `plan.md` albo w `change.md` (Notes), żeby `/10x-archive` przeniosło spójny kontrakt. Kod zostaje bez zmian.
- **Decision**: FIXED (odstępstwa przyjęte, opisane w `change.md`, Notes)

### F2 — Klucz spoza DTO w kształcie identyfikatora może przenieść do logu imię albo login

- **Severity**: 👁 OBSERVATION
- **Impact**: 🔎 MEDIUM — realny kompromis, wart zastanowienia
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/shared/validation/validation-pipe.ts:14
- **Detail**: `IDENTIFIER_SHAPE = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/` odcina adresy, tokeny i hashe. Przepuszcza jednak dowolny tekst, który klient wybrał jako klucz JSON. Na przykład body `{"janKowalski": 1}` daje w linii `fields=janKowalski`. Plan świadomie to dopuścił (faza 2 #4), więc to nie jest odstępstwo. Zostaje jednak jedyny, poza `Origin`, kanał, którym tekst klienta trafia do pliku logu.
- **Fix**: Zostawić jak jest i dopisać przyjęte ryzyko w sekcji „Logi błędów i odmów” w `backend-patterns.md`.
  - Strength: Nazwa nieznanego pola w kształcie identyfikatora (np. literówka `emial`) najszybciej wskazuje rozjazd frontu i DTO, a to jest główny cel linii `validation`.
  - Tradeoff: Złośliwy albo nieostrożny klient może wpisać do logu krótki ciąg alfanumeryczny. Adresu, kropek ani `@` wpisać nie może.
  - Confidence: MEDIUM — zależy od tego, jak ściśle właściciel traktuje „bez danych osobowych w pliku”.
  - Blind spot: Nie sprawdzono, czy front kiedykolwiek wysyła klucze spoza DTO. Jeśli nie, tę informację da się bez straty zastąpić licznikiem `unknown=N`.
- **Decision**: FIXED (przyjęte ryzyko dopisane w `backend-patterns.md`, „Logi błędów i odmów”)

### F3 — Globalny filtr zakłada kontekst HTTP

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja, poprawka oczywista i wąska
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/shared/filters/safe-logging-exception.filter.ts:107
- **Detail**: `catch()` zawsze woła `host.switchToHttp().getRequest()`, a `describeRequest` czyta `req.method` bez sprawdzenia, czy żądanie istnieje. Dziś aplikacja ma tylko HTTP, a joby nie przechodzą przez filtry, więc nic się nie psuje. Gdyby jednak kiedyś do `@Catch()` trafił kontekst nie-HTTP, filtr rzuciłby `TypeError` i zasłonił pierwotny błąd.
- **Fix**: Brać request tylko przy `host.getType() === 'http'`. W pozostałych przypadkach `describeRequest` daje `-`.
- **Decision**: FIXED (`host.getType()`; `describeRequest(undefined)` daje `(no http request)`, test w spec filtra)

### F4 — Nowa gałąź `link_race` w `refusedLink` bez testu

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja, poprawka oczywista i wąska
- **Dimension**: Test Coverage
- **Location**: backend-subtracker/src/auth/services/auth.service.ts:229
- **Detail**: `auth.service.spec.ts` sprawdza „zużyty i wygasły → `link_used`”, `link_user_missing` i `link_race` dla `consumed.affected !== 1`. Nie ma testu przypadku, w którym ponowny odczyt w `refusedLink` widzi wiersz niezużyty i ważny, a wynikiem jest `link_race`.
- **Fix**: Dodać przypadek do `auth.service.spec.ts`: mock drugiego zapytania z `usedAt: null` i `valid: true`, oczekiwany kod `link_race`.
- **Decision**: FIXED (test `link_race` dla drugiego odczytu w `auth.service.spec.ts`)

### F5 — Brak testu, że `POST /auth/logout` z nieważnym ciasteczkiem nie loguje odmowy

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja, poprawka oczywista i wąska
- **Dimension**: Test Coverage
- **Location**: backend-subtracker/test/auth/denials.e2e-spec.ts:225
- **Detail**: Plan wyłącza logowanie odrzuceń sesji na `GET /auth/session` i `POST /auth/logout`. Test e2e potwierdza brak linii `warn` tylko dla `/auth/session`. Dla wylogowania z nieznanym albo unieważnionym ciasteczkiem takiej asercji nie ma. Dziś to działa, bo `logout` nie używa guarda, ale nic tego nie pilnuje.
- **Fix**: Dodać obok jedną asercję: `POST /auth/logout` z losowym ciasteczkiem daje zero linii `Denials`.
- **Decision**: FIXED (e2e: `POST /auth/logout` z nieznanym ciasteczkiem bez linii `warn`)

### F6 — Kody odmów deklarowane na cztery sposoby

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja, poprawka oczywista i wąska
- **Dimension**: Pattern Consistency
- **Location**: backend-subtracker/src/shared/guards/roles.guard.ts:32
- **Detail**: Każde miejsce deklaruje kody inaczej:
  - `auth/auth-denials.ts`: obiekt `LinkDenial` z typem oraz unia `SessionRejection`;
  - `admin-users.service.ts:39`: eksportowana stała `CANNOT_MANAGE_DENIAL`;
  - `roles.guard.ts:32` i `validation-pipe.ts:45`: literały `'role_missing'` i `'validation'`.

  Testy i ktoś szukający kodu w logach nie mają jednego miejsca, w którym znajdą listę kodów.

- **Fix**: Wyciągnąć `'role_missing'` i `'validation'` do eksportowanych stałych obok ich wyjątków, na wzór `CANNOT_MANAGE_DENIAL`.
- **Decision**: FIXED (`ROLE_MISSING_DENIAL`, `VALIDATION_DENIAL`; zasada w `backend-patterns.md`)

<!-- End of report -->

