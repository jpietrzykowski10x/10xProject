# Produkcyjna baza i połączenie frontend → API — Implementation Plan

## Overview

Fundament F-01 z `context/foundation/roadmap.md`: backend NestJS dostaje TypeORM + PostgreSQL (lokalnie i na MyDevil), konfigurację z `.env`, migracje uruchamiane w deployu po kopii bazy, endpoint `/health` sprawdzający bazę oraz CORS sterowany przez `CORS_ORIGINS` z obsługą ciasteczek. Frontend pokazuje status API pobrany z przeglądarki — to dowód, że wywołanie między subdomenami działa na produkcji. Bez tabel domenowych: pierwsze dochodzą w S-01 (`magic-link-sign-in`).

Model baz przejęty z innych projektów użytkownika (`fyi/app.module.ts`, `fyi/main.ts`, `fyi/db-scripts.txt`):

- **Lokalnie dwie bazy o tym samym właścicielu** (`subtracker-adm`):
  - `subtracker-db-dev`: robocza baza aplikacji przy `MODE=DEV`. Przy `DATABASE_AUTO_SYNCHRONIZATION=true` TypeORM sam przebudowuje schemat z encji (`synchronize`).
  - `subtracker-db`: baza referencyjna. Nikt jej nie synchronizuje, zmieniają ją tylko migracje. Odzwierciedla schemat po ostatniej migracji, więc `migration:generate` porównuje z nią encje i generuje różnicę.
- **Migracje generuje się na koniec funkcji lub etapu**, nie po każdej zmianie encji. Wygenerowany plik trafia do repo i jest wgrywany na referencyjną `subtracker-db` (`migration:run`), a potem przez deploy na produkcję.
- **Na MyDevil jest tylko jedna baza** (`MODE=PROD`, bez wersji `-dev`). Nie ma tam `synchronize`, schemat zmieniają tylko migracje z `deploy.sh`.

## Current State Analysis

- Backend to szkielet NestJS 12 „Hello World” (`backend-subtracker/src/app.module.ts`, `src/main.ts`) — brak ORM, sterownika bazy, konfiguracji env i CORS.
- Deploy działa na produkcji (`context/deployment/deploy-plan.md`, status `done`): GitHub Actions buduje paczkę `.mydevil/` i wysyła ją `tar | ssh` do `ci-gate.sh` → `deploy.sh`, który instaluje wersję obok działającej, przełącza `mv` i robi health-check z automatycznym przywróceniem.
- `deploy/mydevil/deploy.sh:46-47` ma zarezerwowane miejsce: „pg_dump to ~/backups, then run migrations. A failure must stop the deploy before the swap below.”
- Health-check jest wspólny dla obu aplikacji i woła `GET /` (`deploy/mydevil/deploy.sh:23-34`).
- `backend-subtracker/scripts/prepare-mydevil.mjs` kopiuje całe `dist/` do korzenia paczki (z `main.js` → `app.js`), więc wszystko, co kompiluje `nest build`, trafia na serwer.
- `start-app.sh` eksportuje zmienne z `public_nodejs/.env` (kopia `shared/.env`) przed `forever start`.
- Frontend: Angular 22 SSR, `app.config.ts` bez `HttpClient`, brak plików `environment`, wszystkie trasy prerenderowane (`app.routes.server.ts`).
- Lokalnie: Node 24.21, brak PostgreSQL i Dockera — użytkownik instaluje PostgreSQL lokalnie (bramka ręczna).
- `.gitignore` ignoruje `.env` i `.env.*` poza `.env.example` — `.env.mydevil` nie trafi do gita.
- CI backendu uruchamia `npm run lint` i `npm test` (tylko `src/**/*.spec.ts`), nie e2e.

## Desired End State

- `https://apisubtracker.jakubpietrzykowski.pl/health` zwraca `200` z informacją, że aplikacja i baza działają; przy niedostępnej bazie zwraca `503`.
- `https://subtracker.jakubpietrzykowski.pl` pokazuje w przeglądarce status API (OK / błąd) pobrany bezpośrednio z API z innej subdomeny, z włączonymi credentials.
- Deploy API to świadomy, jawny krok z krótką przerwą w działaniu. Kolejność: nowa wersja instalowana obok starej, zatrzymanie API, kopia bazy (`pg_dump -Fc`), migracje z nowej paczki, zamiana wersji, health-check na `/health`.
  - Błąd kopii albo migracji: start starej wersji i koniec deployu. Nieudaną migrację PostgreSQL sam wycofuje, bo cała partia idzie w jednej transakcji.
  - Nieudany health-check po udanej migracji: baza przywracana z kopii, wraca stara wersja.
  - Przez cały czas między kopią a przywróceniem nikt nie zapisuje danych, więc przywrócenie niczego nie gubi.
  - Produkcja nigdy nie używa `synchronize` ani `migrationsRun`.
- Lokalnie: `npm run start:dev` (`MODE=DEV`) łączy się z `subtracker-db-dev` z `synchronize` sterowanym flagą; `npm run migration:generate|run|revert|show` zawsze działa na referencyjnej `subtracker-db`.
- Przy starcie API wypisuje baner: nazwa aplikacji, `MODE`, bieżąca baza, czy działa auto-synchronizacja, port (jak w `fyi/main.ts`).
- Konfiguracja: `backend-subtracker/.env.example` (w repo) opisuje klucze; `.env` (dev) i `.env.mydevil` (prod) leżą tylko u użytkownika, `.env.mydevil` jest wgrywany ręcznie do `shared/.env`.

### Key Discoveries:

- Zarezerwowany krok bazy w `deploy/mydevil/deploy.sh:46-47`, przed `mv` — kolejność już zaprojektowana pod migracje.
- Spłaszczanie `dist/` w `backend-subtracker/scripts/prepare-mydevil.mjs:13-15` — ścieżki do migracji muszą być liczone względem pliku źródła danych, nie `cwd`/`dist`.
- `deploy.sh` nie jest wdrażany przez CI (`deploy/mydevil/README.md`, „Updating the scripts on the server”) — zmiana wymaga ręcznego `scp`.
- `infrastructure.md` (Unknown Unknowns): mała pula połączeń do współdzielonego Postgresa (`max: 5`).
- `context/foundation/lessons.md`: unikać typu `any` w obu projektach.

## What We're NOT Doing

- Żadnych encji ani tabel domenowych (użytkownicy, subskrypcje) — zaczynają się w S-01/S-02.
- Ciasteczko sesji i jego domena (`.jakubpietrzykowski.pl`) — S-01; tu tylko polityka CORS z credentials.
- `migration:revert` (metody `down()`) na produkcji — z doświadczenia użytkownika bywa zawodne; zamiast tego przywrócenie z kopii. `rollback.sh` uruchamiany ręcznie później dalej cofa tylko kod, a przywrócenie bazy po fakcie robi się ręcznie przez `restore-db.sh` i traci dane zapisane od deployu.
- Deploy bez przestoju (blue-green, migracje zgodne wstecz) — świadomie odrzucony na rzecz pewności spójności danych.
- Przesyłanie `.env.mydevil` przez CI lub sekrety GitHuba — plik wgrywa użytkownik ręcznie.
- Uruchamianie e2e w CI (wymagałoby bazy w Actions).
- Monitoring/alerty poza health-checkiem w deployu (Parked w roadmapie).
- Docker / docker-compose.

## Implementation Approach

Najpierw backend lokalnie (z lokalną bazą), bo to on definiuje kontrakt `/health` i zmienne env. Potem frontend korzystający z tego kontraktu. Na końcu deploy: zmiana `deploy.sh`, bramki ręczne na MyDevil i weryfikacja produkcyjna — w tej kolejności, żeby skrypt na serwerze był gotowy, zanim push uruchomi nowy workflow.

Jedno źródło opcji połączenia jest współdzielone przez moduł Nesta i przez `DataSource` dla TypeORM CLI, żeby migracje w deployu łączyły się dokładnie tak jak aplikacja.

## Critical Implementation Details

**Timing & lifecycle** — deploy API świadomie zatrzymuje usługę na czas kopii, migracji i health-checku (ok. 30–60 s). Stara wersja nie pracuje więc na nowym schemacie, a między `pg_dump` a ewentualnym przywróceniem nic nie zapisuje do bazy. Skutki:

- Migracje nie muszą być zgodne wstecz. Zgodność wstecz zostaje dobrą praktyką, bo ułatwia ręczny `rollback.sh` kodu później.
- Zadania cykliczne (`@nestjs/schedule`, od S-06) stoją podczas deployu. Muszą nadrabiać pominięte uruchomienia, np. „wyślij wszystkie zaległe przypomnienia”, zamiast liczyć na start o konkretnej minucie.
- Frontend w tym czasie pokazuje „API niedostępne”.
- `migration:run` biegnie z `transaction: 'all'` (domyślne w TypeORM). PostgreSQL wycofuje zmiany struktury w transakcji, więc nieudana partia nie zostawia śladów. Wyjątek stanowią polecenia, które nie mogą działać w transakcji (np. `CREATE INDEX CONCURRENTLY`). Takich nie używamy.

**Przywracanie z kopii** — `pg_restore --clean` usuwa tylko obiekty obecne w kopii, więc tabele dodane przez migrację by zostały. Dlatego `restore-db.sh` najpierw czyści schemat (`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`), a potem robi `pg_restore --no-owner --single-transaction`. Na MyDevil użytkownik nie jest superuserem, więc nie może zakładać rozszerzeń. Klucze `uuid` korzystają z wbudowanej w PostgreSQL 13+ funkcji `gen_random_uuid()` (`uuidExtension: 'pgcrypto'` w opcjach TypeORM) zamiast `uuid-ossp`. Dzięki temu przywrócenie nie potrzebuje żadnego rozszerzenia. Do sprawdzenia w bramce 3.3: wersja PostgreSQL ≥ 13 i to, że użytkownik bazy jest właścicielem schematu `public`.

**Dwie bazy lokalnie** — aplikacja (`TypeOrmModule`) i CLI (`data-source.ts`) korzystają z jednej funkcji opcji, ale wybierają bazę inaczej. Aplikacja: `MODE=DEV` → `POSTGRES_DATABASE_DEV`, inaczej `POSTGRES_DATABASE`. CLI zawsze bierze `POSTGRES_DATABASE` z `synchronize: false`. Dzięki temu `migration:generate` lokalnie porównuje encje z referencyjną `subtracker-db`, a w deployu `migration:run` trafia w jedyną bazę produkcyjną. `synchronize` jest włączane tylko przy `MODE=DEV` i `DATABASE_AUTO_SYNCHRONIZATION=true`. Przy `MODE=PROD` z flagą `true` walidacja env kończy start błędem, żeby pomyłka w `shared/.env` nie przeszła po cichu.

**Generowanie migracji** — encje mają dekoratory, a natywne usuwanie typów w Node 24 ich nie obsługuje. Dlatego CLI pracuje na skompilowanym `dist/database/data-source.js`, który ładuje encje z `dist/**/*.entity.js` (konwencja nazw: `*.entity.ts`; `autoLoadEntities` działa tylko w Nest). `migration:generate` buduje projekt i zapisuje nowy plik `.ts` w `src/database/migrations/`. Jeśli schemat się nie zmienił, TypeORM kończy się kodem 1 i komunikatem „No changes in database schema were found”. W tym kroku to oczekiwany wynik. Przed buildem `dist/` musi być czyszczone (`deleteOutDir` w `nest-cli.json`), bo inaczej w `dist/` zostałyby skompilowane migracje lub encje usunięte ze `src/`.

**Debug & observability** — TypeORM CLI w trybie ESM (`"type": "module"`) musi załadować skompilowany `database/data-source.js` z paczki; zweryfikować to lokalnie na zbudowanym `.mydevil/` w Fazie 1, zanim krok trafi do `deploy.sh`. Jeżeli CLI nie załaduje ESM, zastąpić je małym skryptem Node, który importuje `DataSource`, wywołuje `initialize()` + `runMigrations()` i kończy się kodem ≠ 0 przy błędzie.

## Phase 1: Backend — TypeORM, konfiguracja, `/health`, CORS

### Overview

Backend łączy się z PostgreSQL wg zmiennych środowiskowych, ma infrastrukturę migracji (bez migracji domenowych), endpoint `/health` sprawdzający bazę i CORS z listy `CORS_ORIGINS` z credentials. Weryfikacja na lokalnym PostgreSQL.

### Changes Required:

#### 1. Zależności

**File**: `backend-subtracker/package.json`

**Intent**: Dodać TypeORM z integracją Nesta, sterownik PostgreSQL i moduł konfiguracji Nesta jako zależności produkcyjne (CLI TypeORM musi być dostępne na serwerze po `npm ci --omit=dev`).

**Contract**: `dependencies`: `typeorm`, `@nestjs/typeorm`, `pg`, `@nestjs/config`. Skrypty (wszystkie na referencyjnej bazie `POSTGRES_DATABASE`):

- `migration:run`, `migration:revert`, `migration:show` działają na zbudowanym `dist/database/data-source.js` i są poprzedzone `nest build`.
- `migration:generate -- <Nazwa>` buduje projekt, porównuje encje z bazą referencyjną i zapisuje `src/database/migrations/<timestamp>-<Nazwa>.ts`. Robi to mały skrypt `scripts/migration-generate.mjs`, który sprawdza, czy podano nazwę, i woła CLI TypeORM.
- `migration:create -- <Nazwa>` tworzy pusty plik migracji w tym samym katalogu.

Wygenerowany plik przechodzi przez `prettier`.

#### 2. Konfiguracja i walidacja env

**File**: `backend-subtracker/src/config/env.ts` (nowy), `backend-subtracker/src/app.module.ts`

**Intent**: Wczytać `.env` (lokalnie) przez moduł konfiguracji Nesta i zwalidować zmienne przy starcie — brak lub zła wartość kończy start czytelnym błędem. Typowany obiekt konfiguracji, bez `any`.

**Contract**: Klucze (nazwy jak w `fyi/app.module.ts`):

- `APPLICATION_NAME`: opcjonalny, domyślnie `subtracker-api`.
- `MODE`: `DEV` albo `PROD`, wymagany.
- `PORT`: opcjonalny, domyślnie 3000.
- `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`: wymagane.
- `POSTGRES_PORT`: domyślnie 5432.
- `POSTGRES_DATABASE_DEV`: wymagany przy `MODE=DEV`, ignorowany przy `PROD`.
- `DATABASE_AUTO_SYNCHRONIZATION`: `true` lub `false`, domyślnie `false`. Wartość `true` przy `MODE=PROD` to błąd.
- `POSTGRES_POOL_MAX`: opcjonalny, domyślnie 5.
- `CORS_ORIGINS`: wymagany, lista originów po przecinku. Pusta lista i `*` są odrzucane, bo `*` z `credentials` przeglądarka i tak odrzuci. To różnica względem `fyi/main.ts`.

Funkcja `validate` przekazana do `ConfigModule.forRoot` zwraca typowany obiekt. Na produkcji zmienne są już w środowisku procesu (eksportuje je `start-app.sh`), a `.env` w katalogu wydania jest ich kopią — oba źródła dają to samo.

#### 3. Opcje połączenia i źródło danych dla CLI

**File**: `backend-subtracker/src/database/database.options.ts` (nowy), `backend-subtracker/src/database/data-source.ts` (nowy), `backend-subtracker/src/database/migrations/` (nowy, pusty katalog z `.gitkeep`)

**Intent**: Jedna funkcja budująca opcje PostgreSQL z env, używana przez moduł Nesta i przez `DataSource` dla CLI. Ścieżki migracji i encji są liczone względem pliku (`import.meta.dirname`), żeby działały w `dist/` i w spłaszczonej paczce `.mydevil/`. Szczegóły w Critical Implementation Details, „Dwie bazy lokalnie”.

**Contract**: `buildDatabaseOptions(env, target: 'app' | 'cli')`:

- Wspólne opcje:
  - `type: 'postgres'`, `migrationsRun: false`, `migrationsTransactionMode: 'all'`;
  - migracje `<dir>/migrations/*.js`, tabela historii `migrationsTableName: 'migration_history'` (jak w projektach użytkownika);
  - `uuidExtension: 'pgcrypto'`, czyli `gen_random_uuid()` bez rozszerzenia `uuid-ossp`;
  - `extra.max = POSTGRES_POOL_MAX`.
- `app`: baza `POSTGRES_DATABASE_DEV` przy `MODE=DEV`, inaczej `POSTGRES_DATABASE`. `synchronize = MODE==='DEV' && DATABASE_AUTO_SYNCHRONIZATION`.
- `cli`: zawsze `POSTGRES_DATABASE`, `synchronize: false`, encje `<dir>/../**/*.entity.js`.

`data-source.ts` eksportuje jako `default` instancję `DataSource` (wymóg TypeORM CLI). Czyta `process.env` bezpośrednio, bo CLI nie uruchamia Nesta. Wcześniej ładuje `.env` przez `process.loadEnvFile()` (Node 24, bez `dotenv`), o ile plik istnieje, i przechodzi tę samą walidację co w punkcie 2.

#### 4. Moduł bazy w aplikacji

**File**: `backend-subtracker/src/app.module.ts`

**Intent**: Podłączyć `TypeOrmModule.forRootAsync` z opcjami z punktu 3 (`target: 'app'`) i `autoLoadEntities: true` (encje będą dochodzić w slice'ach). Ograniczyć ponawianie połączenia przy starcie, żeby awaria bazy szybko kończyła proces, a health-check w deployu to wykrył.

**Contract**: `retryAttempts: 3`, `retryDelay: 3000`.

#### 5. Endpoint `/health`

**File**: `backend-subtracker/src/health/health.controller.ts` (nowy), `backend-subtracker/src/health/health.controller.spec.ts` (nowy), `backend-subtracker/src/app.module.ts`

**Intent**: Endpoint dla health-checku w deployu i dla statusu na froncie — sprawdza bazę prostym zapytaniem. `GET /` (Hello World) zostaje bez zmian.

**Contract**: `GET /health` → `200 { "status": "ok", "db": "ok" }`; gdy zapytanie `SELECT 1` przez `DataSource` rzuci błąd → `503 { "status": "error", "db": "error" }` (bez szczegółów błędu w odpowiedzi; szczegóły do logu).

#### 6. CORS

**File**: `backend-subtracker/src/main.ts`, `backend-subtracker/src/config/cors.ts` (nowy), `backend-subtracker/src/config/cors.spec.ts` (nowy)

**Intent**: Włączyć CORS dla originów z `CORS_ORIGINS` z obsługą ciasteczek, żeby S-01 mógł użyć sesji między subdomenami.

**Contract**: `parseCorsOrigins(value: string): string[]` — dzieli po przecinku, przycina spacje, usuwa końcowe `/`, odrzuca puste wpisy i `*` (rzuca błąd). `app.enableCors({ origin: <lista>, credentials: true })` przed `listen`. Po `listen` dwie linie logu jak w `fyi/main.ts`: `CORS ORIGINS: …` oraz `APP NAME / APP MODE / CURRENT DATABASE / AUTO SYNCHRONIZATION / PORT`. Kolory ANSI można zostawić, ale bez haseł w logu. Bez HTTPS w Nest, bo TLS kończy proxy MyDevil.

#### 7. Przykład konfiguracji

**File**: `backend-subtracker/.env.example` (nowy)

**Intent**: Udokumentować klucze z punktu 2 z wartościami lokalnymi; komentarz, że `.env` = dev, `.env.mydevil` = wzór `shared/.env` na serwerze (oba poza gitem).

**Contract**: Lokalnie `MODE=DEV`, `POSTGRES_DATABASE=subtracker-db`, `POSTGRES_DATABASE_DEV=subtracker-db-dev`, `POSTGRES_USER=subtracker-adm`, `DATABASE_AUTO_SYNCHRONIZATION=true` i `CORS_ORIGINS=http://localhost:4200`. W komentarzu wartości dla `.env.mydevil`: `MODE=PROD`, brak `POSTGRES_DATABASE_DEV`, `DATABASE_AUTO_SYNCHRONIZATION=false`, `CORS_ORIGINS=https://subtracker.jakubpietrzykowski.pl` oraz przypomnienie o `PORT` i `NODE_ENV`.

#### 8a. Skrypt SQL baz lokalnych

**File**: `backend-subtracker/database/create-local-databases.sql` (nowy; na podstawie `fyi/db-scripts.txt`)

**Intent**: Powtarzalne założenie roli i obu baz lokalnych. Względem `fyi/db-scripts.txt` skrypt nie zakłada `uuid-ossp`, bo klucze używają wbudowanego `gen_random_uuid()`. W tamtej wersji `CREATE EXTENSION` i tak trafiało do bazy, z którą sesja była połączona, a nie do nowych baz. Rola lokalna nie jest `SUPERUSER`, tylko zwykłym właścicielem baz, tak jak na MyDevil. Dzięki temu migracja, która wymaga uprawnień niedostępnych na produkcji, wyłoży się już lokalnie. Skrypt jest dla `psql` i nie trafia do paczki.

**Contract**: `psql -U postgres -f database/create-local-databases.sql` tworzy rolę `subtracker-adm` z `LOGIN` oraz bazy `subtracker-db` i `subtracker-db-dev`, których właścicielem jest ta rola. Hasło w skrypcie to lokalna wartość deweloperska. Na produkcji bazę i użytkownika zakłada `devil pgsql`.

#### 8. Test e2e

**File**: `backend-subtracker/test/app.e2e-spec.ts`

**Intent**: E2E podnosi pełny `AppModule`, więc teraz wymaga lokalnej bazy z `.env`. Dodać przypadek `GET /health` → 200 i nagłówek CORS dla dozwolonego originu; zostawić `GET /`.

**Contract**: Uruchamiane tylko lokalnie (`npm run test:e2e`), nie w CI.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `cd backend-subtracker && npm run lint`
- Testy jednostkowe przechodzą (w tym `/health` z zamockowanym `DataSource` i parser `CORS_ORIGINS`): `cd backend-subtracker && npm test`
- Build przechodzi, a w `dist/database/` są `data-source.js` i katalog `migrations/`: `cd backend-subtracker && npm run build`
- `npm run prepare-mydevil` tworzy paczkę z `database/data-source.js` w korzeniu `.mydevil/`

#### Manual Verification:

- Lokalny PostgreSQL zainstalowany, bazy `subtracker-db` i `subtracker-db-dev` utworzone skryptem `database/create-local-databases.sql`, `backend-subtracker/.env` wypełniony wg `.env.example`
- `npm run migration:run` lokalnie kończy się sukcesem i tworzy tabelę `migration_history` w `subtracker-db` (nie w `-dev`); `npm run migration:generate -- Probe` bez encji kończy się komunikatem „No changes in database schema were found” i nie tworzy pliku
- W zbudowanej paczce: `cd .mydevil && npm ci --omit=dev` i uruchomienie TypeORM CLI `migration:run -d database/data-source.js` z env z `.env` kończy się sukcesem (potwierdza ładowanie ESM — patrz Critical Implementation Details)
- `npm run start:dev`: baner pokazuje `APP MODE: DEV, CURRENT DATABASE: subtracker-db-dev, AUTO SYNCHRONIZATION: YES`; `curl localhost:3000/health` → `200 {"status":"ok","db":"ok"}`; po zatrzymaniu usługi PostgreSQL → `503`
- `curl -i -H "Origin: http://localhost:4200" localhost:3000/health` zwraca `Access-Control-Allow-Origin: http://localhost:4200` i `Access-Control-Allow-Credentials: true`; obcy `Origin` nie dostaje tych nagłówków
- `npm run test:e2e` przechodzi z lokalną bazą

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Frontend — adres API i status na stronie

### Overview

Frontend zna adres API (dev / prod) i na stronie głównej pokazuje status API pobrany w przeglądarce, z credentials — to samo wywołanie, którego użyje S-01.

### Changes Required:

#### 1. Adres API per środowisko

**File**: `frontend-subtracker/src/environments/environment.ts` (nowy), `frontend-subtracker/src/environments/environment.development.ts` (nowy), `frontend-subtracker/angular.json`

**Intent**: Standardowy mechanizm Angulara z podmianą plików przy buildzie development.

**Contract**: `environment.apiUrl` — prod `https://apisubtracker.jakubpietrzykowski.pl`, dev `http://localhost:3000`. `fileReplacements` w konfiguracji `development` buildu.

#### 2. HttpClient

**File**: `frontend-subtracker/src/app/app.config.ts`

**Intent**: Udostępnić `HttpClient` aplikacji (z `withFetch()`, zalecanym przy SSR).

**Contract**: `provideHttpClient(withFetch())` w `providers`.

#### 3. Status API na stronie głównej

**File**: `frontend-subtracker/src/app/api-status/api-status.ts` (nowy, + szablon/style wg konwencji projektu), `frontend-subtracker/src/app/app.html`, `frontend-subtracker/src/app/app.ts`

**Intent**: Komponent pobiera `GET {apiUrl}/health` z `withCredentials: true` dopiero w przeglądarce (po renderze), żeby prerender w CI nie wołał API, a wywołanie przeszło przez CORS. Pokazuje stan: „sprawdzam…”, „API i baza działają”, „API niedostępne” / „baza niedostępna”. Zastępuje domyślną treść szablonu startowego w `app.html` (zostaje `router-outlet`).

**Contract**: Stan jako sygnał z unią typów (`'checking' | 'ok' | 'db-error' | 'unreachable'`), bez `any`; odpowiedź typowana interfejsem `{ status: 'ok' | 'error'; db: 'ok' | 'error' }`. Wywołanie w `afterNextRender`. Komponent jest tymczasowy — S-01 zastąpi stronę główną ekranem logowania.

### Success Criteria:

#### Automated Verification:

- Build produkcyjny przechodzi (w tym prerender): `cd frontend-subtracker && npm run build`
- Wyrenderowany `dist/frontend-subtracker/browser/index.html` zawiera stan „sprawdzam…” (prerender nie wywołał API)
- `npm run prepare-mydevil` przechodzi

#### Manual Verification:

- `npm start` + backend z Fazy 1: strona pokazuje „API i baza działają”; w DevTools żądanie do `localhost:3000/health` ma `credentials: include` i brak błędu CORS
- Po zatrzymaniu backendu: „API niedostępne”; po zatrzymaniu bazy: „baza niedostępna”

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Deploy — przestój, kopia, migracje, przywracanie i health-check w `deploy.sh`

### Overview

Deploy API zatrzymuje usługę i robi kopię bazy. Potem uruchamia migracje jako jawny krok i podmienia wersję. Gdy nowa wersja nie przejdzie health-checku na `/health`, baza wraca z kopii, a do pracy wraca stara wersja. Użytkownik zakłada bazę na MyDevil, wgrywa `.env.mydevil` i skrypty, ćwiczy przywracanie, a potem push uruchamia oba workflowy. Frontend deployuje się bez zmian.

### Changes Required:

#### 1. Krok bazy w deployu (tylko `api`)

**File**: `deploy/mydevil/deploy.sh`

**Intent**: Zastąpić zarezerwowany komentarz sekwencją z przestojem (patrz Critical Implementation Details, „Timing & lifecycle”):

1. Po `npm ci` w `$NEW`, przy działającej starej wersji: `forever stop subtracker-api`. Od tej chwili nikt nie pisze do bazy.
2. Wczytać `$NEW/.env` i zrobić `pg_dump -Fc` do `~/apps/subtracker/backups/<YYYYmmdd-HHMMSS>_<sha7>.dump`. Przy błędzie: start starej wersji (`start-app.sh api`), log i `exit 1`.
3. `migration:run` z `$NEW` na Node 24 jako jawny, logowany krok. Przy błędzie transakcja wycofuje zmiany, więc baza zostaje taka jak przed krokiem. Wtedy start starej wersji, log ze ścieżką kopii i `exit 1`.
4. Zamiana wersji (`mv`), start nowej, health-check.
5. Nieudany health-check: stop nowej wersji, `restore-db.sh <kopia z kroku 2>`, potem dotychczasowe przywrócenie poprzedniego wydania i jego start. Gdy przywrócenie bazy się nie uda, deploy kończy się głośnym błędem i stara wersja nie wstaje. Działanie na niezgodnym schemacie jest gorsze niż przestój.

We wszystkich ścieżkach `public_nodejs_new` zostaje do diagnozy. Trzymamy 10 najnowszych kopii.

**Contract**:
- Hasło idzie przez `PGPASSWORD` w środowisku polecenia, nie w argumentach.
- Migracje: `/usr/local/bin/node24` + TypeORM CLI z `$NEW/node_modules`, `migration:run -d database/data-source.js`. Jeśli CLI nie załaduje ESM, wchodzi skrypt zastępczy z Fazy 1.
- `set -eu`. Każdy krok bazy w jawnym `if ! …; then …; fi`, bo POSIX `sh` nie ma `pipefail`, a `pg_dump -Fc` pisze wprost do pliku bez potoku.
- Pierwszy deploy z `had_live=0`, czyli bez starej wersji: kroki 1 i 5 pomijają start i stop starej wersji, ale kopia i migracje zostają.

#### 2. Skrypt przywracania bazy

**File**: `deploy/mydevil/restore-db.sh` (nowy)

**Intent**: Jedno narzędzie do przywracania z kopii, używane automatycznie przez `deploy.sh` i ręcznie po fakcie, np. gdy błąd wyjdzie po kilku godzinach. Czyści schemat, żeby nie zostały obiekty dodane przez migrację, i odtwarza kopię.

**Contract**: `restore-db.sh <plik.dump>`:
- Wczytuje `~/apps/subtracker/api/shared/.env`.
- W jednym wywołaniu `psql` robi `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`, potem `pg_restore --no-owner --single-transaction -d "$POSTGRES_DATABASE" <plik>`.
- Kod wyjścia ≠ 0 przy każdym błędzie.
- Nie zatrzymuje ani nie startuje API, robi to wywołujący. Ręczne użycie opisane w README: najpierw `forever stop subtracker-api`, potem restore, potem start.
- POSIX `sh`, `chmod 700`. Wgrywany na serwer ręcznie jak pozostałe skrypty.

#### 3. Health-check per aplikacja

**File**: `deploy/mydevil/deploy.sh`

**Intent**: API sprawdzane na `/health`, więc brak połączenia z bazą cofa deploy. Frontend dalej na `/`.

**Contract**: Ścieżka zależna od `$APP`: `api` → `/health`, `frontend` → `/`.

#### 4. Dokumentacja serwera

**File**: `deploy/mydevil/README.md`

**Intent**: Opisać:
- `backups/` w układzie katalogów;
- nowe klucze `shared/.env` dla API (`MODE=PROD`, `POSTGRES_*`, `DATABASE_AUTO_SYNCHRONIZATION=false`, `CORS_ORIGINS`);
- przebieg deployu API z przestojem i trzy ścieżki błędu;
- ręczne przywracanie przez `restore-db.sh` i jego koszt: dane zapisane od deployu przepadają;
- to, że `rollback.sh` cofa tylko kod;
- zakaz `migration:revert` na produkcji.

**Contract**: Sekcje „Server layout”, „Scripts” (opis `deploy.sh` i `restore-db.sh`) oraz nowa sekcja „Database”.

#### 5. Komendy w CLAUDE.md

**File**: `CLAUDE.md` (sekcja „Repository notes” → „Commands”, poza blokiem synchronizowanym)

**Intent**: Dopisać:
- komendy migracji;
- model dwóch baz lokalnych (`-dev` z `synchronize` i referencyjna dla `migration:generate`);
- deploy API z przestojem, kopią i przywróceniem;
- wymóg lokalnego PostgreSQL dla `start:dev` i `test:e2e`;
- rolę `.env` i `.env.mydevil`.

Usunąć z „Architecture” zdanie, że TypeORM/PostgreSQL nie są zainstalowane.

**Contract**: Tylko sekcja „Repository notes”.

### Success Criteria:

#### Automated Verification:

- Składnia skryptów: `sh -n deploy/mydevil/deploy.sh && sh -n deploy/mydevil/restore-db.sh`
- Lint i testy backendu oraz build frontendu nadal przechodzą: `cd backend-subtracker && npm run lint && npm test`, `cd frontend-subtracker && npm run build`

#### Manual Verification:

- MyDevil: baza PostgreSQL utworzona (`devil pgsql db add …`), `pg_dump`, `pg_restore` i `psql` dostępne (`which pg_dump pg_restore psql`), PostgreSQL ≥ 13 (`SELECT version()`), użytkownik bazy jest właścicielem schematu `public` (`\dn+`), katalog `~/apps/subtracker/backups` istnieje
- `shared/.env` API uzupełniony z `.env.mydevil` (`MODE=PROD`, `POSTGRES_*` bez `_DEV`, `DATABASE_AUTO_SYNCHRONIZATION=false`, `CORS_ORIGINS=https://subtracker.jakubpietrzykowski.pl`, `PORT`, `NODE_ENV`), `chmod 600`
- `deploy.sh` i `restore-db.sh` wgrane na serwer wg README (rozmiar zgodny z lokalnym, `-rwx------`)
- Push na `main` (wykonuje użytkownik): oba workflowy zielone, w logu API widać stop, kopię bazy, migracje, start i `health-check OK` na `/health`
- `curl -s https://apisubtracker.jakubpietrzykowski.pl/health` → `{"status":"ok","db":"ok"}`
- `https://subtracker.jakubpietrzykowski.pl` w przeglądarce pokazuje „API i baza działają”, bez błędów CORS w konsoli
- `curl -i -H "Origin: https://example.com" https://apisubtracker.jakubpietrzykowski.pl/health` nie zwraca `Access-Control-Allow-Origin`
- W `~/apps/subtracker/backups/` jest plik `.dump` z tego deployu; w bazie istnieje tabela `migration_history`
- Ćwiczenie przywracania na jeszcze pustej bazie produkcyjnej:
  1. Założyć tabelę próbną (`CREATE TABLE restore_probe(id int)`).
  2. `forever stop subtracker-api` → `restore-db.sh <kopia z deployu>` → start.
  3. Sprawdzić: `restore_probe` zniknęła, `migration_history` jest, `/health` OK.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- `HealthController`: `SELECT 1` udane → 200 `ok/ok`; rzucony błąd → 503 `error/error`.
- `parseCorsOrigins`: pojedynczy origin, lista z odstępami, końcowy `/`, pusty string → błąd, `*` → błąd.
- Walidacja env: brak `POSTGRES_HOST` lub `CORS_ORIGINS` → błąd; `MODE=DEV` bez `POSTGRES_DATABASE_DEV` → błąd; `MODE=PROD` + `DATABASE_AUTO_SYNCHRONIZATION=true` → błąd; domyślne `POSTGRES_PORT`/`POSTGRES_POOL_MAX`.
- `buildDatabaseOptions`: `app` + `DEV` → baza `-dev`, `synchronize` wg flagi; `app` + `PROD` → `POSTGRES_DATABASE`, `synchronize: false`; `cli` → zawsze `POSTGRES_DATABASE`, `synchronize: false`, glob encji.

### Integration Tests:

- `test/app.e2e-spec.ts` z lokalną bazą: `GET /health` → 200 i nagłówki CORS dla dozwolonego originu (lokalnie, nie w CI).

### Manual Testing Steps:

1. Lokalnie: backend + frontend, strona pokazuje „API i baza działają”; zatrzymanie bazy → „baza niedostępna”.
2. Paczka `.mydevil/` backendu: migracje przez CLI z paczki.
3. Produkcja: workflowy zielone, `/health` OK, status na stronie OK, obcy origin bez nagłówków CORS, kopia bazy w `backups/`.
4. Produkcja, pusta baza: ćwiczenie `restore-db.sh` (tabela próbna znika po przywróceniu).

## Performance Considerations

Pula połączeń ograniczona do `POSTGRES_POOL_MAX` (domyślnie 5) ze względu na współdzielony serwer PostgreSQL MyDevil. `/health` wykonuje jedno lekkie zapytanie.

## Migration Notes

Pierwszy deploy z tą zmianą tworzy tylko tabelę `migration_history` (brak migracji domenowych). Cykl dla kolejnych slice'ów:

1. Encje rozwijane na `subtracker-db-dev` z `synchronize`.
2. Na koniec funkcji: `migration:generate -- <Nazwa>` względem `subtracker-db`.
3. Przegląd wygenerowanego pliku.
4. `migration:run` na `subtracker-db`.
5. Commit migracji razem z kodem.
6. Deploy uruchamia ją na produkcji w oknie przestoju, po `pg_dump`.

Dane startowe (np. słowniki) idą jako osobne migracje z `queryRunner.manager.insert`, jak `AddBaseUserRoles` w projektach użytkownika. Rollback kodu (`rollback.sh`) nie cofa schematu. Przywrócenie bazy po fakcie robi `restore-db.sh` i traci dane od deployu.

## References

- Roadmapa: `context/foundation/roadmap.md` (F-01 `production-database-wiring`)
- Plan wdrożenia: `context/deployment/deploy-plan.md`
- Infrastruktura i ryzyka: `context/foundation/infrastructure.md` (Unknown Unknowns: pula połączeń, strefa czasowa)
- Zarezerwowany krok bazy: `deploy/mydevil/deploy.sh:46`
- Spłaszczanie paczki: `backend-subtracker/scripts/prepare-mydevil.mjs:13`
- Health-check: `deploy/mydevil/deploy.sh:23`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — TypeORM, konfiguracja, `/health`, CORS

#### Automated

- [ ] 1.1 Lint przechodzi: `cd backend-subtracker && npm run lint`
- [ ] 1.2 Testy jednostkowe przechodzą (w tym `/health` z zamockowanym `DataSource` i parser `CORS_ORIGINS`): `cd backend-subtracker && npm test`
- [ ] 1.3 Build przechodzi, a w `dist/database/` są `data-source.js` i katalog `migrations/`: `cd backend-subtracker && npm run build`
- [ ] 1.4 `npm run prepare-mydevil` tworzy paczkę z `database/data-source.js` w korzeniu `.mydevil/`

#### Manual

- [ ] 1.5 Lokalny PostgreSQL zainstalowany, bazy `subtracker-db` i `subtracker-db-dev` utworzone skryptem `database/create-local-databases.sql`, `backend-subtracker/.env` wypełniony wg `.env.example`
- [ ] 1.6 `npm run migration:run` lokalnie kończy się sukcesem i tworzy tabelę `migration_history` w `subtracker-db` (nie w `-dev`); `npm run migration:generate -- Probe` bez encji kończy się komunikatem „No changes in database schema were found” i nie tworzy pliku
- [ ] 1.7 W zbudowanej paczce: `cd .mydevil && npm ci --omit=dev` i uruchomienie TypeORM CLI `migration:run -d database/data-source.js` z env z `.env` kończy się sukcesem (potwierdza ładowanie ESM — patrz Critical Implementation Details)
- [ ] 1.8 `npm run start:dev`: baner pokazuje `APP MODE: DEV, CURRENT DATABASE: subtracker-db-dev, AUTO SYNCHRONIZATION: YES`; `curl localhost:3000/health` → `200 {"status":"ok","db":"ok"}`; po zatrzymaniu usługi PostgreSQL → `503`
- [ ] 1.9 `curl -i -H "Origin: http://localhost:4200" localhost:3000/health` zwraca `Access-Control-Allow-Origin: http://localhost:4200` i `Access-Control-Allow-Credentials: true`; obcy `Origin` nie dostaje tych nagłówków
- [ ] 1.10 `npm run test:e2e` przechodzi z lokalną bazą

### Phase 2: Frontend — adres API i status na stronie

#### Automated

- [ ] 2.1 Build produkcyjny przechodzi (w tym prerender): `cd frontend-subtracker && npm run build`
- [ ] 2.2 Wyrenderowany `dist/frontend-subtracker/browser/index.html` zawiera stan „sprawdzam…” (prerender nie wywołał API)
- [ ] 2.3 `npm run prepare-mydevil` przechodzi

#### Manual

- [ ] 2.4 `npm start` + backend z Fazy 1: strona pokazuje „API i baza działają”; w DevTools żądanie do `localhost:3000/health` ma `credentials: include` i brak błędu CORS
- [ ] 2.5 Po zatrzymaniu backendu: „API niedostępne”; po zatrzymaniu bazy: „baza niedostępna”

### Phase 3: Deploy — przestój, kopia, migracje, przywracanie i health-check w `deploy.sh`

#### Automated

- [ ] 3.1 Składnia skryptów: `sh -n deploy/mydevil/deploy.sh && sh -n deploy/mydevil/restore-db.sh`
- [ ] 3.2 Lint i testy backendu oraz build frontendu nadal przechodzą: `cd backend-subtracker && npm run lint && npm test`, `cd frontend-subtracker && npm run build`

#### Manual

- [ ] 3.3 MyDevil: baza PostgreSQL utworzona (`devil pgsql db add …`), `pg_dump`, `pg_restore` i `psql` dostępne, PostgreSQL ≥ 13, użytkownik bazy jest właścicielem schematu `public`, katalog `~/apps/subtracker/backups` istnieje
- [ ] 3.4 `shared/.env` API uzupełniony z `.env.mydevil` (`MODE=PROD`, `POSTGRES_*` bez `_DEV`, `DATABASE_AUTO_SYNCHRONIZATION=false`, `CORS_ORIGINS=https://subtracker.jakubpietrzykowski.pl`, `PORT`, `NODE_ENV`), `chmod 600`
- [ ] 3.5 `deploy.sh` i `restore-db.sh` wgrane na serwer wg README (rozmiar zgodny z lokalnym, `-rwx------`)
- [ ] 3.6 Push na `main` (wykonuje użytkownik): oba workflowy zielone, w logu API widać stop, kopię bazy, migracje, start i `health-check OK` na `/health`
- [ ] 3.7 `curl -s https://apisubtracker.jakubpietrzykowski.pl/health` → `{"status":"ok","db":"ok"}`
- [ ] 3.8 `https://subtracker.jakubpietrzykowski.pl` w przeglądarce pokazuje „API i baza działają”, bez błędów CORS w konsoli
- [ ] 3.9 `curl -i -H "Origin: https://example.com" https://apisubtracker.jakubpietrzykowski.pl/health` nie zwraca `Access-Control-Allow-Origin`
- [ ] 3.10 W `~/apps/subtracker/backups/` jest plik `.dump` z tego deployu; w bazie istnieje tabela `migration_history`
- [ ] 3.11 Ćwiczenie przywracania na pustej bazie produkcyjnej: tabela `restore_probe` → stop API → `restore-db.sh <kopia>` → start; `restore_probe` zniknęła, `migration_history` jest, `/health` OK
