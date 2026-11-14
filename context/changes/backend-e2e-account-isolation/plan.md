# Izolacja kont i e2e backendu w CI — plan implementacji

## Overview

Etap 3 planu testów (`context/foundation/test-plan.md` §3, „Account isolation and backend e2e in CI”).
Istniejące e2e backendu zaczynają biec w CI jako osobny check `backend-e2e` na jednorazowym
Postgresie 16 z locale `C.UTF-8` (jak produkcja), ze schematem i seedami z migracji. Wspólny pomocnik
e2e w `test/support/` i strażnik listy tras dają wzorzec dla przyszłych tras po id (S-03, S-10), żeby
ryzyko #1 (IDOR) było pilnowane, zanim takie trasy powstaną. 711-liniowy `auth.e2e-spec.ts` zostaje
podzielony na pliki tematyczne na tym samym pomocniku. Na koniec §6.4 planu testów staje się przepisem
„jak dodać test API dla nowej trasy”.

Ryzyka: #1 (IDOR), #5 (sortowanie i unikalność na `C.UTF-8`), #6 (link i sesja; limit wysyłki maili
jest w §7, poza zakresem).

## Current State Analysis

- Job `backend` w `.github/workflows/ci.yml:24-41` uruchamia `npm ci`, `lint`, `npm test`,
  `prepare-mydevil`. Nie ma usługi Postgresa ani `test:e2e`. Komentarz w `test/app.e2e-spec.ts:10`
  mówi wprost „not run in CI”.
- Trzy pliki e2e (`test/app.e2e-spec.ts`, `test/auth.e2e-spec.ts` 711 linii / 37 wywołań `it`/`it.each`,
  `test/subscriptions.e2e-spec.ts` 482 linie) pokrywają prawie wszystko z ryzyk #1, #5, #6 — inwentarz
  w `research.md` („Istniejące e2e — inwentarz pokrycia”). Niepokryte: wygasła/wylogowana sesja na
  trasie domenowej (ten sam globalny guard jest pokryty na `/auth/me`).
- Pomocniki (`newAddress`, `signIn`, `latestToken`, `cookiePairOf`, sprzątanie po prefiksie, przechwycenie
  maili przez `overrideProvider(MAIL_TRANSPORT)`, start `AppModule` z `applyHttpSecurity`) są skopiowane
  w `subscriptions.e2e-spec.ts:40-186` i `auth.e2e-spec.ts:34-165`.
- Konfiguracja: `vitest.config.e2e.ts:13` bierze zmienne przez `loadEnv('', process.cwd(), '')` (czyli
  z `.env`), a `src/database/data-source.ts:9-11` (CLI migracji) ładuje `.env`, gdy plik istnieje.
  `validateEnv` w DEV wymaga `POSTGRES_DATABASE_DEV` (`src/config/env.ts:139-143`); nic nie zabrania,
  by był równy `POSTGRES_DATABASE`.
- Przy `DATABASE_AUTO_SYNCHRONIZATION=false` seedery nic nie robią (`roles-seeder.ts:22`,
  `categories-seeder.ts:29`). Role, kategorie domyślne i ręczny indeks `UQ_category_owner_name_key`
  przychodzą wtedy z migracji `SeedRoles`, `SeedDefaultCategories`, `CategoryNameKey`.
- Od locale bazy zależy tylko sortowanie listy subskrypcji (`subscription-order.ts:42`, jedyne
  `COLLATE "pl-PL-x-icu"`); test `subscriptions.e2e-spec.ts:447-456` lokalnie przechodzi także bez
  `COLLATE`.
- Trasy: 5 kontrolerów (`app`, `auth`, `health`, `categories`, `subscriptions`), bez globalnego
  prefiksu. `@Public()` to `Reflector.createDecorator` (`src/shared/decorators/public.decorator.ts:6`),
  czytany przez `reflector.getAllAndOverride(Public, [handler, class])` w `session-auth.guard.ts:21`.
  Żadna trasa nie ma parametru w ścieżce.
- Ruleset `protect-main` wymaga status checków po nazwie joba (stan z 2026-11-04 w `fyi/todo-next.txt`).

## Desired End State

- Każdy push na gałąź inną niż `main` i każdy PR do `main` uruchamia job `backend-e2e`: Postgres 16 z
  `C.UTF-8`, sprawdzenie locale i kolacji `pl-PL-x-icu`, `migration:run` na czystej bazie, cały zestaw
  e2e. Job jest wymaganym checkiem w rulesecie.
- Usunięcie `COLLATE` w `subscription-order.ts` daje czerwony `backend-e2e` w CI (sprawdzone sabotażem),
  choć lokalnie zestaw zostaje zielony.
- `test/support/` ma wspólny pomocnik: start aplikacji z przechwyconymi mailami, nowe konto, dwa konta,
  sprzątanie po prefiksie. Używają go `subscriptions.e2e-spec.ts` i pliki auth.
- `test/routes.e2e-spec.ts` odpada, gdy w aplikacji pojawi się trasa spoza jawnej listy, gdy trasa
  zmieni dostęp (publiczna ↔ z sesją) albo gdy trasa z parametrem w ścieżce nie wskazuje testu dwóch kont.
- `auth.e2e-spec.ts` jest podzielony na pliki tematyczne; liczba testów zgłaszana przez Vitest jest
  taka sama jak przed podziałem, asercje bez zmian.
- §6.4 i §6.6 w `test-plan.md` opisują wzorzec; §4 i §5 mówią, że e2e biegną w CI i są wymagane.

### Key Discoveries:

- `vitest.config.e2e.ts:13` i `data-source.ts:9-11` czytają `.env` — zapisanie `.env` w kroku joba
  obsługuje oba bez rozstrzygania precedencji `process.env` (otwarte pytanie 4 z researchu).
- `job.services.<id>.id` pozwala wykonać `psql` w kontenerze usługi (`docker exec`), bez polegania na
  kliencie Postgresa w obrazie runnera.
- `@Public()` jest czytelny publicznym API Nesta (`Reflector`), a kontrolery i handlery da się wyliczyć
  przez `DiscoveryService` + `MetadataScanner` (`@nestjs/core`) oraz `PATH_METADATA` / `METHOD_METADATA`
  (`@nestjs/common/constants`) — bez sięgania do routera Expressa.
- `vitest.config.e2e.ts:10` — `include: ['**/*.e2e-spec.ts']` obejmuje podkatalogi `test/`, więc
  podział auth nie wymaga zmiany configu.

## What We're NOT Doing

- Testów tras po id — takich tras nie ma; wzorzec (pomocnik, strażnik, §6.4) czeka na S-03/S-10.
- Limitu wysyłki maili i jego testu — decyzja MVP, wpisane w §7 planu testów.
- Testu polskiej kolejności własnych kategorii — sortowanie w JS, niezależne od bazy, niski sygnał.
- Bazy testowej na MyDevil i jakiegokolwiek połączenia CI z serwerem.
- Zmian w kodzie aplikacji (`src/`), poza ewentualnym wyniesieniem czegoś do `test/support/`.
- Sprawdzania w CI rozjazdu encji i migracji (`migration:generate` „No changes”) — wartościowe, ale
  poza ryzykami tego etapu; kandydat na osobną zmianę.
- Przepinania `app.e2e-spec.ts` na pomocnik — nie loguje nikogo i nie wysyła maili; zmienia się tylko
  jego komentarz.
- Zmian w `deploy-*.yml` i w jobach `backend` / `frontend`.

## Implementation Approach

Najpierw CI, bo tam są jedyne niewiadome (ICU w obrazie, initdb z `C.UTF-8`, czas przechwycenia maila
na runnerze) i bo to główna wartość etapu. Job od razu staje się bramką, więc dwa refaktory testów
(faza 2 i 3) przechodzą przez nią. Refaktory nie zmieniają asercji; jedyne nowe testy to sesja na
trasie domenowej i strażnik tras. Dokumentacja na końcu opisuje to, co faktycznie powstało.

## Critical Implementation Details

- **Brak hasła w repo.** Usługa Postgresa działa z `POSTGRES_HOST_AUTH_METHOD: trust` (dostęp tylko z
  runnera, kontener znika po jobie), więc w `ci.yml` nie ma żadnego hasła. `validateEnv` wymaga
  niepustego `POSTGRES_PASSWORD` — w `.env` idzie wartość opisowa w rodzaju `unused-trust-auth`,
  z komentarzem, że serwer jej nie sprawdza (reguła: żadnych haseł w commitowanych plikach).
- **Reguła z `lessons.md` o CLI migracji.** Lokalnie `migration:*` nigdy nie celuje w bazę `-dev`.
  W CI jest jedna jednorazowa baza i `POSTGRES_DATABASE_DEV = POSTGRES_DATABASE`; plan robi to celowo
  i komentarz w `ci.yml` ma to nazwać, żeby nikt nie przeniósł tego wzorca na lokalne `.env`.
- **Kolejność w jobie:** sprawdzenie locale i kolacji → zapis `.env` → `migration:run` → `test:e2e`.
  Sprawdzenie ma odpaść (exit ≠ 0) przy innym locale, bez kolacji albo gdy `'Ślub' < 'Zoo'` w tej
  kolacji nie jest prawdą — wtedy czerwony test sortowania nie zostanie pomylony z błędem bazy.

## Faza 1: Job `backend-e2e` w CI

### Overview

Nowy job w `ci.yml` uruchamia istniejące e2e na Postgresie `C.UTF-8` ze schematem z migracji. Pierwszy
przebieg potwierdza niewiadome z researchu, sabotaż na tymczasowej gałęzi potwierdza sygnał #5, a job
trafia do required checks rulesetu.

### Changes Required:

#### 1. Job `backend-e2e`

**File**: `.github/workflows/ci.yml`

**Intent**: Dodać job, który na jednorazowej bazie `C.UTF-8` sprawdza locale, zakłada schemat
migracjami i uruchamia `npm run test:e2e`. Job biegnie równolegle do `backend` i `frontend`, więc
czerwony e2e jest osobnym, nazwanym checkiem.

**Contract**:
- Nazwa joba: `backend-e2e` (to ją wpisuje się do rulesetu), `runs-on: ubuntu-latest`,
  `timeout-minutes` z zapasem (ok. 15), `working-directory: backend-subtracker`, Node 24 i cache npm
  jak w jobie `backend`.
- `services.postgres`: obraz `postgres:16`, `POSTGRES_USER` / `POSTGRES_DB` o nazwach dla CI,
  `POSTGRES_HOST_AUTH_METHOD: trust`, `POSTGRES_INITDB_ARGS: --locale=C.UTF-8 --encoding=UTF8`,
  port 5432, health check `pg_isready`.
- Krok „sprawdzenie bazy” (`docker exec ${{ job.services.postgres.id }} psql …`): `datcollate` i
  `datctype` bieżącej bazy = `C.UTF-8`; `pl-PL-x-icu` obecne w `pg_collation`; `'Ślub' < 'Zoo' COLLATE
  "pl-PL-x-icu"` daje prawdę. Wynik wypisany w logu, każdy inny wynik kończy job.
- Krok „`.env` dla CI”: heredoc z kluczami wymaganymi przez `validateEnv` w DEV — `MODE=DEV`,
  `POSTGRES_HOST=localhost`, port, użytkownik, `POSTGRES_PASSWORD` opisowy (patrz Critical Details),
  `POSTGRES_DATABASE` = `POSTGRES_DATABASE_DEV` = baza usługi, `DATABASE_AUTO_SYNCHRONIZATION=false`,
  `CORS_ORIGINS` i `FRONTEND_URL` = `http://localhost:4200`, puste `SMTP_HOST`. Bez `secrets.*`.
  Pełną listę wymaganych kluczy sprawdzić z `src/config/env.ts`.
- Kroki: `npm ci` → `npm run migration:run` → `npm run test:e2e`.
- Komentarz nad jobem: dlaczego `C.UTF-8` (produkcja, sortowanie), dlaczego migracje (ścieżka
  produkcyjna, seedy z migracji) i dlaczego jedna baza dla CLI i aplikacji jest tu dozwolona.

#### 2. Sabotaż `COLLATE` (bez commita na gałęzi zmiany)

**File**: `backend-subtracker/src/subscriptions/subscription-order.ts` (tylko na tymczasowej gałęzi)

**Intent**: Udowodnić, że job łapie brak `COLLATE`, którego lokalna baza nie łapie.

**Contract**: Z gałęzi zmiany powstaje lokalnie `sabotage/collate-ci` z jednym commitem usuwającym
`COLLATE` w `subscription-order.ts:42`. Najpierw lokalnie: `npm run test:e2e` zostaje zielony
(dowód, że lokalnie brak sygnału). Użytkownik pushuje gałąź; oczekiwany wynik: `backend-e2e` czerwony
tylko na teście „breaks a tie on the date by the name in Polish order”. Potem gałąź jest usuwana
lokalnie i zdalnie (zdalnie usuwa użytkownik).

#### 3. Required check w rulesecie (ręcznie, użytkownik)

**File**: brak (ustawienia GitHuba)

**Intent**: Bez wpisu w rulesecie PR z czerwonym e2e da się zmergować.

**Contract**: Po pierwszym zielonym przebiegu użytkownik dodaje `backend-e2e` do required status
checks rulesetu `protect-main`. Weryfikacja odczytem przez `gh api` (token tylko do odczytu).

### Success Criteria:

#### Automated Verification:

- Lint backendu przechodzi: `cd backend-subtracker && npm run lint`
- Lokalnie cały zestaw e2e przechodzi bez zmian: `cd backend-subtracker && npm run test:e2e`
- Lokalnie sabotaż `COLLATE` zostawia zestaw e2e zielonym (dowód braku sygnału lokalnie)

#### Manual Verification:

- Po pushu gałęzi zmiany job `backend-e2e` jest zielony, a log kroku sprawdzenia bazy pokazuje `C.UTF-8` / `C.UTF-8` i obecne `pl-PL-x-icu`
- Push `sabotage/collate-ci` daje czerwony `backend-e2e` tylko na teście polskiej kolejności; gałąź usunięta lokalnie i zdalnie
- `backend-e2e` jest w required status checks rulesetu `protect-main` (odczyt przez `gh api`)

**Implementation Note**: Po fazie zatrzymaj się na potwierdzenie przez człowieka. Push robi użytkownik;
wyniki CI odczytuję przez `gh run list` / `gh run view`. Jeśli przechwycenie maila (`vi.waitFor`,
domyślnie 1 s) okaże się niestabilne na runnerze, zapisz to w planie jako wejście do fazy 2 (limit
czasu w pomocniku), zamiast łatać specy w tej fazie.

---

## Faza 2: Wspólny pomocnik e2e i strażnik tras

### Overview

Pomocnik w `test/support/` zastępuje kopie w specach, `subscriptions.e2e-spec.ts` przechodzi na niego,
dochodzi test sesji na trasach domenowych i strażnik listy tras.

### Changes Required:

#### 1. Pomocnik e2e

**File**: `backend-subtracker/test/support/e2e-app.ts` (nazwa do potwierdzenia przy implementacji;
ewentualnie kilka plików w `test/support/`)

**Intent**: Jedno miejsce na start aplikacji jak w `main.ts`, przechwycenie maili, zakładanie kont i
sprzątanie, żeby każdy nowy plik e2e (w tym testy dwóch kont dla tras po id) zaczynał się od kilku linii.

**Contract**:
- Fabryka przyjmuje prefiks adresów (każdy plik ma własny, np. `e2e-subscriptions-`) i zwraca: `http()`,
  `dataSource` / `repository()`, `env`, tablicę przechwyconych maili, `newAddress()`, `latestToken()`,
  `cookiePairOf()`, `signIn()` → `{ address, cookie }`, `twoAccounts()` → `{ owner, other }`,
  `removeTestData()` i zamknięcie (`close()`: czekanie, aż wiersze audytu maili zrównają się z liczbą
  przechwyconych, potem sprzątanie i `app.close()`).
- Start: `Test.createTestingModule({ imports: [AppModule] })` z `overrideProvider(MAIL_TRANSPORT)`,
  `applyHttpSecurity(app, env.CORS_ORIGINS)`, sprzątanie resztek przed testami — jak dziś.
- Sprzątanie to nadzbiór obu obecnych wersji: subskrypcje, kategorie, sesje, tokeny, role, użytkownicy
  (w tej kolejności, ON DELETE NO ACTION), potem maile po wzorcu adresu.
- Pomocnik nie ma asercji domenowych; ciała żądań i skróty tras (`postSubscription`, `getCategories`…)
  zostają w specach.
- Opcjonalna możliwość dołożenia modułu do testu (np. `DiscoveryModule` dla strażnika tras), jeśli
  strażnik ma korzystać z tej samej fabryki.

#### 2. `subscriptions.e2e-spec.ts` na pomocniku + sesja na trasach domenowych

**File**: `backend-subtracker/test/subscriptions.e2e-spec.ts`

**Intent**: Usunąć lokalne kopie pomocników; test izolacji kont używa `twoAccounts()` i jest wzorcem
dla §6.4. Dopisać test, że wygasła i wylogowana sesja dostaje 401 na trasach domenowych (dziś tylko
`/auth/me`).

**Contract**:
- Wszystkie dotychczasowe `it` bez zmian w asercjach; liczba testów zgłaszana przez Vitest rośnie
  tylko o nowe przypadki sesji.
- Nowy test: dla stanów {sesja wygasła (`expiresAt` w przeszłości), sesja po `POST /auth/logout`} każda
  z czterech tras (`GET/POST /categories`, `GET/POST /subscriptions`) daje 401. Postać `it.each` po
  stanach.

#### 3. Strażnik listy tras

**File**: `backend-subtracker/test/routes.e2e-spec.ts`

**Intent**: Ryzyko #1 dotyczy tras, których jeszcze nie ma. Test wymusza, żeby każda nowa trasa
została świadomie wpisana na listę, a trasa z parametrem w ścieżce wskazała swój test dwóch kont.

**Contract**:
- Jawna lista oczekiwanych tras: `{ method, path, access: 'public' | 'session', twoAccountTest?: string }`
  (dziś 12: `GET /`, `GET /health`, 6 tras `/auth/*` — z sesją tylko `GET /auth/me` —, 2× `/categories`,
  2× `/subscriptions`).
- Trasy aplikacji wyliczone przez `DiscoveryService` + `MetadataScanner` i metadane ścieżki/metody
  Nesta; dostęp czytany tak jak w `SessionAuthGuard` (`getAllAndOverride(Public, [handler, class])`).
- Asercje: (a) zbiór tras aplikacji równy liście (`toEqual` na posortowanych wpisach, żeby różnica była
  czytelna w raporcie); (b) każda trasa z `:` w ścieżce ma niepuste `twoAccountTest` (dziś pusty zbiór —
  asercja ma sens od S-03); (c) każda trasa `session` bez ciasteczka daje 401.
- Komentarz nad listą: co zrobić przy nowej trasie (dopisać, a przy `:id` napisać test dwóch kont wg
  §6.4 i wpisać jego nazwę).

### Success Criteria:

#### Automated Verification:

- Lint backendu przechodzi: `cd backend-subtracker && npm run lint`
- Cały zestaw e2e przechodzi lokalnie: `cd backend-subtracker && npm run test:e2e`
- Job `backend-e2e` jest zielony po pushu gałęzi
- Sabotaż: tymczasowa trasa `GET /subscriptions/:id` w kontrolerze daje czerwony `routes.e2e-spec.ts` (nieznana trasa i brak testu dwóch kont); cofnięta
- Sabotaż: usunięcie `@Public()` z `GET /health` daje czerwony `routes.e2e-spec.ts`; cofnięte
- Sabotaż: usunięcie filtra `userId` z listy subskrypcji daje czerwony test izolacji kont na pomocniku; cofnięte

#### Manual Verification:

- Przegląd: `subscriptions.e2e-spec.ts` nie ma już własnych kopii startu aplikacji, `signIn` ani sprzątania, a test izolacji czyta się jako wzorzec dwóch kont

**Implementation Note**: Po fazie zatrzymaj się na potwierdzenie przez człowieka.

---

## Faza 3: Podział `auth.e2e-spec.ts`

### Overview

711-liniowy plik zostaje podzielony na pliki tematyczne na wspólnym pomocniku, bez zmiany asercji.

### Changes Required:

#### 1. Pliki tematyczne auth

**File**: `backend-subtracker/test/auth/*.e2e-spec.ts` (nowe), `backend-subtracker/test/auth.e2e-spec.ts` (usunięty)

**Intent**: Krótsze pliki o jednym temacie łatwiej czytać i rozwijać (S-09 dołoży dezaktywację konta).

**Contract**:
- Podział wg obecnych bloków `describe` (nazwy plików do potwierdzenia przy implementacji):
  - rejestracja i logowanie — `sign-in`, `repeated registration`, `shows ADMIN after grantAdmin`,
    `keeps the token out of the mail audit row`;
  - zasady tokenu — `token rules`;
  - prywatność i walidacja — `account privacy`, `validation`;
  - sesja — `GET /auth/session`, `session lifetime`;
  - nieoczekiwane błędy — `unexpected errors`.
- Każdy plik ma własny prefiks adresów (`e2e-auth-<temat>-`), żeby sprzątanie jednego pliku nie
  dotykało danych innego.
- Pomocniki specyficzne dla auth używane w kilku plikach (`postRegister`, `postRequestLink`,
  `postVerify`, `getMe`, `mailsTo(address, count)`, `tokenIn`, `setCookieOf`, `neutralShape`,
  `findUser`) idą do jednego modułu obok, np. `test/auth/auth-e2e.ts`; używane w jednym pliku zostają
  w nim.
- Asercje i nazwy testów bez zmian. Liczba testów zgłaszana przez Vitest dla auth przed podziałem
  zapisana w opisie commita i równa sumie po podziale.

### Success Criteria:

#### Automated Verification:

- Lint backendu przechodzi: `cd backend-subtracker && npm run lint`
- Cały zestaw e2e przechodzi lokalnie: `cd backend-subtracker && npm run test:e2e`
- Liczba testów auth zgłaszana przez Vitest po podziale równa liczbie sprzed podziału
- Żaden plik w `test/` nie przekracza ok. 300 linii (`wc -l`)
- Job `backend-e2e` jest zielony po pushu gałęzi

#### Manual Verification:

- Przegląd diffu: przeniesione testy mają te same asercje (diff po przeniesieniu pokazuje tylko importy, pomocniki i prefiksy)

**Implementation Note**: Po fazie zatrzymaj się na potwierdzenie przez człowieka.

---

## Faza 4: Dokumentacja

### Overview

Cookbook i bramki w planie testów opisują to, co powstało; reszta dokumentacji przestaje mówić, że e2e
nie chodzą w CI.

### Changes Required:

#### 1. Plan testów

**File**: `context/foundation/test-plan.md`

**Intent**: §6.4 staje się przepisem „jak dodać test API dla nowej trasy”; §4/§5 odzwierciedlają CI.

**Contract**:
- §6.4: lokalizacja (`test/<obszar>.e2e-spec.ts` lub `test/<obszar>/`), start z pomocnika i własny
  prefiks adresów, wzorzec dwóch kont dla każdej trasy po id (konto B dostaje 404/403 na odczyt, zmianę
  i usunięcie zasobu A, a zasób A jest nienaruszony; lista B bez danych A), wpis na liście w
  `routes.e2e-spec.ts`, testy referencyjne, uruchamianie (cały zestaw, jeden plik:
  `npx vitest run --config ./vitest.config.e2e.ts test/<plik>`), sabotaż (usunięcie filtra po
  właścicielu), uwaga, że sortowanie tekstu sprawdza tylko CI (`C.UTF-8`).
- §6.6: 2–3 linie o tym, czego etap nauczył (wynik pierwszego przebiegu CI, sabotaż `COLLATE`).
- §4: wiersz „integration / API e2e (backend)” — w CI (job `backend-e2e`, Postgres 16 `C.UTF-8`,
  schemat z migracji), liczba plików; profil bazy testów zaktualizowany.
- §5: bramka „API e2e backendu na Postgresie `C.UTF-8`” = required (bez „after §3 Phase 3”).
- Status §3 zmienia orkiestrator `/10x-test-plan`, nie ta faza.

#### 2. Pozostała dokumentacja

**File**: `backend-subtracker/test/app.e2e-spec.ts`, `CLAUDE.md`, `context/foundation/backend-patterns.md` (jeśli mówi o e2e tylko lokalnie)

**Intent**: Usunąć nieaktualne „not run in CI”; w `CLAUDE.md` (sekcja Commands, backend) dopisać, że
e2e biegną w CI na `C.UTF-8` i że sortowanie tekstu łapie tylko CI; wskazać `test/support/`.

**Contract**: Tylko zdania, które dziś są nieprawdziwe lub brakuje w nich CI; bez nowych sekcji.

### Success Criteria:

#### Automated Verification:

- `test-plan.md` §6.4 nie zawiera już „TBD”, a §5 nie zawiera „required after §3 Phase 3”
- Lint backendu przechodzi: `cd backend-subtracker && npm run lint`

#### Manual Verification:

- §6.4 da się wykonać bez czytania tego planu: przegląd z perspektywy autora S-03

**Implementation Note**: Po fazie zatrzymaj się na potwierdzenie przez człowieka.

---

## Testing Strategy

### Integration Tests:

- Istniejące e2e w CI na `C.UTF-8` — główny sygnał etapu (#1, #5, #6).
- Nowy: sesja wygasła i wylogowana → 401 na czterech trasach domenowych (#6).
- Nowy: strażnik listy tras (#1 dla przyszłych tras po id).

### Manual Testing Steps:

1. Push gałęzi zmiany → `backend-e2e` zielony, log sprawdzenia bazy z `C.UTF-8` i `pl-PL-x-icu`.
2. Push `sabotage/collate-ci` → czerwony tylko test polskiej kolejności; usunięcie gałęzi.
3. Dodanie `backend-e2e` do rulesetu i odczyt przez `gh api`.

## Performance Considerations

Job e2e trwa dłużej niż unit (start Postgresa, `nest build` w `migration:run`, szeregowe pliki). Biegnie
równolegle do `backend` i `frontend`, więc czas całego CI wydłuża się tylko o różnicę. Podział auth
dokłada kilka startów `AppModule` (po jednym na plik) — akceptowalne.

## Migration Notes

Brak zmian schematu. Migracje są tylko uruchamiane w CI na czystej bazie.

## References

- Research: `context/changes/backend-e2e-account-isolation/research.md`
- Plan testów: `context/foundation/test-plan.md` §2 (#1, #5, #6), §3 Phase 3, §5, §6.4, §7
- Wzorzec izolacji: `backend-subtracker/test/subscriptions.e2e-spec.ts:245-285`
- Polska kolejność: `backend-subtracker/test/subscriptions.e2e-spec.ts:447-456`, `src/subscriptions/subscription-order.ts:42`
- Guard i `@Public()`: `src/auth/guards/session-auth.guard.ts:21`, `src/shared/decorators/public.decorator.ts:6`
- CI: `.github/workflows/ci.yml:24-41`
- Lekcje: `context/foundation/lessons.md` (schemat tylko migracjami)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Job `backend-e2e` w CI

#### Automated

- [x] 1.1 Lint backendu przechodzi — f9b5c69
- [x] 1.2 Lokalnie cały zestaw e2e przechodzi bez zmian — f9b5c69
- [x] 1.3 Lokalnie sabotaż `COLLATE` zostawia zestaw e2e zielonym — f9b5c69

#### Manual

- [x] 1.4 Po pushu `backend-e2e` zielony, log pokazuje `C.UTF-8` i `pl-PL-x-icu`
- [x] 1.5 Push `sabotage/collate-ci` daje czerwony tylko test polskiej kolejności; gałąź usunięta
- [x] 1.6 `backend-e2e` w required status checks rulesetu `protect-main`

### Phase 2: Wspólny pomocnik e2e i strażnik tras

#### Automated

- [x] 2.1 Lint backendu przechodzi
- [x] 2.2 Cały zestaw e2e przechodzi lokalnie
- [ ] 2.3 Job `backend-e2e` zielony po pushu
- [x] 2.4 Sabotaż: tymczasowa trasa `GET /subscriptions/:id` daje czerwony strażnik tras
- [x] 2.5 Sabotaż: usunięcie `@Public()` z `GET /health` daje czerwony strażnik tras
- [x] 2.6 Sabotaż: usunięcie filtra `userId` z listy daje czerwony test izolacji kont

#### Manual

- [ ] 2.7 Przegląd: `subscriptions.e2e-spec.ts` bez własnych kopii pomocników, test izolacji jako wzorzec

### Phase 3: Podział `auth.e2e-spec.ts`

#### Automated

- [ ] 3.1 Lint backendu przechodzi
- [ ] 3.2 Cały zestaw e2e przechodzi lokalnie
- [ ] 3.3 Liczba testów auth po podziale równa liczbie sprzed podziału
- [ ] 3.4 Żaden plik w `test/` nie przekracza ok. 300 linii
- [ ] 3.5 Job `backend-e2e` zielony po pushu

#### Manual

- [ ] 3.6 Przegląd diffu: przeniesione testy mają te same asercje

### Phase 4: Dokumentacja

#### Automated

- [ ] 4.1 `test-plan.md` §6.4 bez „TBD”, §5 bez „required after §3 Phase 3”
- [ ] 4.2 Lint backendu przechodzi

#### Manual

- [ ] 4.3 §6.4 wykonalne bez czytania planu (przegląd z perspektywy autora S-03)
