# Produkcyjna baza i połączenie frontend → API — Implementation Plan

## Overview

Fundament F-01 z `context/foundation/roadmap.md`: backend NestJS dostaje TypeORM + PostgreSQL (lokalnie i na MyDevil), konfigurację z `.env`, migracje uruchamiane w deployu po kopii bazy, endpoint `/health` sprawdzający bazę oraz CORS sterowany przez `CORS_ORIGINS` z obsługą ciasteczek. Frontend pokazuje status API pobrany z przeglądarki — to dowód, że wywołanie między subdomenami działa na produkcji. Bez tabel domenowych: pierwsze dochodzą w S-01 (`magic-link-sign-in`).

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
- Deploy API: kopia bazy (`pg_dump`) → migracje z nowej paczki → zamiana wersji → health-check na `/health`. Błąd kopii lub migracji kończy deploy przed zamianą; działająca wersja zostaje nietknięta.
- Lokalnie: `npm run start:dev` łączy się z lokalnym PostgreSQL wg `.env`; `npm run migration:run` działa lokalnie.
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
- Automatyczne cofanie migracji przy rollbacku — `rollback.sh` dalej cofa tylko kod; przywrócenie bazy to ręczne odtworzenie z kopii.
- Przesyłanie `.env.mydevil` przez CI lub sekrety GitHuba — plik wgrywa użytkownik ręcznie.
- Uruchamianie e2e w CI (wymagałoby bazy w Actions).
- Monitoring/alerty poza health-checkiem w deployu (Parked w roadmapie).
- Docker / docker-compose.

## Implementation Approach

Najpierw backend lokalnie (z lokalną bazą), bo to on definiuje kontrakt `/health` i zmienne env. Potem frontend korzystający z tego kontraktu. Na końcu deploy: zmiana `deploy.sh`, bramki ręczne na MyDevil i weryfikacja produkcyjna — w tej kolejności, żeby skrypt na serwerze był gotowy, zanim push uruchomi nowy workflow.

Jedno źródło opcji połączenia jest współdzielone przez moduł Nesta i przez `DataSource` dla TypeORM CLI, żeby migracje w deployu łączyły się dokładnie tak jak aplikacja.

## Critical Implementation Details

**Timing & lifecycle** — migracje biegną, gdy stara wersja API nadal działa na tej samej bazie, więc od tej zmiany obowiązuje reguła: migracje muszą być addytywne (stary kod musi przeżyć nowy schemat przez kilka sekund do zamiany). Zapisać ją w `deploy/mydevil/README.md`.

**Debug & observability** — TypeORM CLI w trybie ESM (`"type": "module"`) musi załadować skompilowany `database/data-source.js` z paczki; zweryfikować to lokalnie na zbudowanym `.mydevil/` w Fazie 1, zanim krok trafi do `deploy.sh`. Jeżeli CLI nie załaduje ESM, zastąpić je małym skryptem Node, który importuje `DataSource`, wywołuje `initialize()` + `runMigrations()` i kończy się kodem ≠ 0 przy błędzie.

## Phase 1: Backend — TypeORM, konfiguracja, `/health`, CORS

### Overview

Backend łączy się z PostgreSQL wg zmiennych środowiskowych, ma infrastrukturę migracji (bez migracji domenowych), endpoint `/health` sprawdzający bazę i CORS z listy `CORS_ORIGINS` z credentials. Weryfikacja na lokalnym PostgreSQL.

### Changes Required:

#### 1. Zależności

**File**: `backend-subtracker/package.json`

**Intent**: Dodać TypeORM z integracją Nesta, sterownik PostgreSQL i moduł konfiguracji Nesta jako zależności produkcyjne (CLI TypeORM musi być dostępne na serwerze po `npm ci --omit=dev`).

**Contract**: `dependencies`: `typeorm`, `@nestjs/typeorm`, `pg`, `@nestjs/config`. Skrypty: `migration:run`, `migration:revert`, `migration:show` (na zbudowanym `dist/database/data-source.js`, poprzedzone `nest build`) oraz `migration:generate` / `migration:create` przyjmujące nazwę i zapisujące do `src/database/migrations/`.

#### 2. Konfiguracja i walidacja env

**File**: `backend-subtracker/src/config/env.ts` (nowy), `backend-subtracker/src/app.module.ts`

**Intent**: Wczytać `.env` (lokalnie) przez moduł konfiguracji Nesta i zwalidować zmienne przy starcie — brak lub zła wartość kończy start czytelnym błędem. Typowany obiekt konfiguracji, bez `any`.

**Contract**: Klucze: `PORT` (opcjonalny, domyślnie 3000), `DB_HOST`, `DB_PORT` (domyślnie 5432), `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_POOL_MAX` (opcjonalny, domyślnie 5), `CORS_ORIGINS` (wymagany, lista originów po przecinku; odrzucić pustą listę i `*`). Funkcja `validate` przekazana do `ConfigModule.forRoot` zwraca typowany obiekt. Na produkcji zmienne są już w środowisku procesu (eksportuje je `start-app.sh`), a `.env` w katalogu wydania jest ich kopią — oba źródła dają to samo.

#### 3. Opcje połączenia i źródło danych dla CLI

**File**: `backend-subtracker/src/database/database.options.ts` (nowy), `backend-subtracker/src/database/data-source.ts` (nowy), `backend-subtracker/src/database/migrations/` (nowy, pusty katalog z `.gitkeep`)

**Intent**: Jedna funkcja budująca opcje PostgreSQL z env, używana przez moduł Nesta i przez `DataSource` dla CLI. Ścieżka migracji liczona względem pliku (`import.meta.dirname`), żeby działała w `dist/` i w spłaszczonej paczce `.mydevil/`.

**Contract**: `type: 'postgres'`, `synchronize: false`, `migrationsRun: false`, migracje `<dir>/migrations/*.js`, tabela `migrations` (domyślna), `extra.max = DB_POOL_MAX`. `data-source.ts` eksportuje `default` instancję `DataSource` (wymóg TypeORM CLI); czyta `process.env` bezpośrednio (CLI nie uruchamia Nesta), z tą samą walidacją co punkt 2.

#### 4. Moduł bazy w aplikacji

**File**: `backend-subtracker/src/app.module.ts`

**Intent**: Podłączyć `TypeOrmModule.forRootAsync` z opcjami z punktu 3 i `autoLoadEntities: true` (encje będą dochodzić w slice'ach). Ograniczyć ponawianie połączenia przy starcie, żeby awaria bazy szybko kończyła proces, a health-check w deployu to wykrył.

**Contract**: `retryAttempts: 3`, `retryDelay: 3000`.

#### 5. Endpoint `/health`

**File**: `backend-subtracker/src/health/health.controller.ts` (nowy), `backend-subtracker/src/health/health.controller.spec.ts` (nowy), `backend-subtracker/src/app.module.ts`

**Intent**: Endpoint dla health-checku w deployu i dla statusu na froncie — sprawdza bazę prostym zapytaniem. `GET /` (Hello World) zostaje bez zmian.

**Contract**: `GET /health` → `200 { "status": "ok", "db": "ok" }`; gdy zapytanie `SELECT 1` przez `DataSource` rzuci błąd → `503 { "status": "error", "db": "error" }` (bez szczegółów błędu w odpowiedzi; szczegóły do logu).

#### 6. CORS

**File**: `backend-subtracker/src/main.ts`, `backend-subtracker/src/config/cors.ts` (nowy), `backend-subtracker/src/config/cors.spec.ts` (nowy)

**Intent**: Włączyć CORS dla originów z `CORS_ORIGINS` z obsługą ciasteczek, żeby S-01 mógł użyć sesji między subdomenami.

**Contract**: `parseCorsOrigins(value: string): string[]` — dzieli po przecinku, przycina spacje, usuwa końcowe `/`, odrzuca puste wpisy i `*` (rzuca błąd). `app.enableCors({ origin: <lista>, credentials: true })` przed `listen`.

#### 7. Przykład konfiguracji

**File**: `backend-subtracker/.env.example` (nowy)

**Intent**: Udokumentować klucze z punktu 2 z wartościami lokalnymi; komentarz, że `.env` = dev, `.env.mydevil` = wzór `shared/.env` na serwerze (oba poza gitem).

**Contract**: Lokalnie `CORS_ORIGINS=http://localhost:4200`; komentarz z wartością produkcyjną `https://subtracker.jakubpietrzykowski.pl` i przypomnieniem o `PORT`/`NODE_ENV` w `.env.mydevil`.

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

- Lokalny PostgreSQL zainstalowany, baza `subtracker` utworzona, `backend-subtracker/.env` wypełniony wg `.env.example`
- `npm run migration:run` lokalnie kończy się sukcesem i tworzy tabelę `migrations`
- W zbudowanej paczce: `cd .mydevil && npm ci --omit=dev` i uruchomienie TypeORM CLI `migration:run -d database/data-source.js` z env z `.env` kończy się sukcesem (potwierdza ładowanie ESM — patrz Critical Implementation Details)
- `npm run start:dev`: `curl localhost:3000/health` → `200 {"status":"ok","db":"ok"}`; po zatrzymaniu usługi PostgreSQL → `503`
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

## Phase 3: Deploy — kopia, migracje i health-check w `deploy.sh`

### Overview

Deploy API robi kopię bazy i migracje przed zamianą wersji, a health-check API sprawdza `/health`. Użytkownik zakłada bazę na MyDevil, wgrywa `.env.mydevil` i skrypty, potem push uruchamia oba workflowy.

### Changes Required:

#### 1. Krok bazy w deployu

**File**: `deploy/mydevil/deploy.sh`

**Intent**: W zarezerwowanym miejscu (po `npm ci`, przed `mv`), tylko dla `api`: wczytać `$NEW/.env`, zrobić `pg_dump` do `~/apps/subtracker/backups/<YYYYmmdd-HHMMSS>_<sha7>.sql.gz`, potem uruchomić migracje z `$NEW` na Node 24. Błąd któregokolwiek kroku → log + `exit 1` przed zamianą (działająca wersja nietknięta, `public_nodejs_new` zostaje do diagnozy). Zostawić 5 najnowszych kopii.

**Contract**: Hasło przekazywane przez `PGPASSWORD` w środowisku polecenia (nie w argumentach). Migracje: `/usr/local/bin/node24` + TypeORM CLI z `$NEW/node_modules` z `-d database/data-source.js` (albo skrypt zastępczy z Fazy 1, jeśli CLI nie załadował ESM). `set -eu` + jawne sprawdzenie kodu wyjścia potoku `pg_dump | gzip` (POSIX `sh` nie ma `pipefail` — sprawdzić wynik `pg_dump` osobno, np. zapis do pliku, potem `gzip`).

#### 2. Health-check per aplikacja

**File**: `deploy/mydevil/deploy.sh`

**Intent**: API sprawdzane na `/health` (więc brak połączenia z bazą cofa deploy), frontend dalej na `/`.

**Contract**: Ścieżka zależna od `$APP`: `api` → `/health`, `frontend` → `/`.

#### 3. Dokumentacja serwera

**File**: `deploy/mydevil/README.md`

**Intent**: Opisać `backups/` w układzie katalogów, nowe klucze `shared/.env` dla API (`DB_*`, `CORS_ORIGINS`), regułę addytywnych migracji, ręczne odtworzenie bazy z kopii (`gunzip -c … | psql`) i to, że `rollback.sh` nie cofa schematu.

**Contract**: Sekcje „Server layout”, „Scripts” (opis `deploy.sh`), nowa sekcja „Database”.

#### 4. Komendy w CLAUDE.md

**File**: `CLAUDE.md` (sekcja „Repository notes” → „Commands”, poza blokiem synchronizowanym)

**Intent**: Dopisać komendy migracji, wymóg lokalnego PostgreSQL dla `start:dev`/`test:e2e` i rolę `.env` / `.env.mydevil`; usunąć z „Architecture” zdanie, że TypeORM/PostgreSQL nie są zainstalowane.

**Contract**: Tylko sekcja „Repository notes”.

### Success Criteria:

#### Automated Verification:

- Składnia skryptu: `sh -n deploy/mydevil/deploy.sh`
- Lint i testy backendu oraz build frontendu nadal przechodzą: `cd backend-subtracker && npm run lint && npm test`, `cd frontend-subtracker && npm run build`

#### Manual Verification:

- MyDevil: baza PostgreSQL utworzona (`devil pgsql db add …`), `pg_dump` i `psql` dostępne (`which pg_dump psql`), katalog `~/apps/subtracker/backups` istnieje
- `shared/.env` API uzupełniony z `.env.mydevil` (`DB_*`, `CORS_ORIGINS=https://subtracker.jakubpietrzykowski.pl`, `PORT`, `NODE_ENV`), `chmod 600`
- `deploy.sh` wgrany na serwer wg README (rozmiar zgodny z lokalnym, `-rwx------`)
- Push na `main` (wykonuje użytkownik): oba workflowy zielone, w logu API widać kopię bazy, migracje i `health-check OK` na `/health`
- `curl -s https://apisubtracker.jakubpietrzykowski.pl/health` → `{"status":"ok","db":"ok"}`
- `https://subtracker.jakubpietrzykowski.pl` w przeglądarce pokazuje „API i baza działają”, bez błędów CORS w konsoli
- `curl -i -H "Origin: https://example.com" https://apisubtracker.jakubpietrzykowski.pl/health` nie zwraca `Access-Control-Allow-Origin`
- W `~/apps/subtracker/backups/` jest plik kopii z tego deployu; w bazie istnieje tabela `migrations`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- `HealthController`: `SELECT 1` udane → 200 `ok/ok`; rzucony błąd → 503 `error/error`.
- `parseCorsOrigins`: pojedynczy origin, lista z odstępami, końcowy `/`, pusty string → błąd, `*` → błąd.
- Walidacja env: brak `DB_HOST` lub `CORS_ORIGINS` → błąd; domyślne `DB_PORT`/`DB_POOL_MAX`.

### Integration Tests:

- `test/app.e2e-spec.ts` z lokalną bazą: `GET /health` → 200 i nagłówki CORS dla dozwolonego originu (lokalnie, nie w CI).

### Manual Testing Steps:

1. Lokalnie: backend + frontend, strona pokazuje „API i baza działają”; zatrzymanie bazy → „baza niedostępna”.
2. Paczka `.mydevil/` backendu: migracje przez CLI z paczki.
3. Produkcja: workflowy zielone, `/health` OK, status na stronie OK, obcy origin bez nagłówków CORS, kopia bazy w `backups/`.

## Performance Considerations

Pula połączeń ograniczona do `DB_POOL_MAX` (domyślnie 5) ze względu na współdzielony serwer PostgreSQL MyDevil. `/health` wykonuje jedno lekkie zapytanie.

## Migration Notes

Pierwszy deploy z tą zmianą tworzy tylko tabelę `migrations` (brak migracji domenowych). Od tej zmiany migracje muszą być addytywne, bo biegną przed zamianą, gdy stara wersja dalej działa. Rollback kodu (`rollback.sh`) nie cofa schematu — przywrócenie bazy to ręczne odtworzenie z `backups/`.

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

- [ ] 1.5 Lokalny PostgreSQL zainstalowany, baza `subtracker` utworzona, `backend-subtracker/.env` wypełniony wg `.env.example`
- [ ] 1.6 `npm run migration:run` lokalnie kończy się sukcesem i tworzy tabelę `migrations`
- [ ] 1.7 W zbudowanej paczce: `cd .mydevil && npm ci --omit=dev` i uruchomienie TypeORM CLI `migration:run -d database/data-source.js` z env z `.env` kończy się sukcesem (potwierdza ładowanie ESM — patrz Critical Implementation Details)
- [ ] 1.8 `npm run start:dev`: `curl localhost:3000/health` → `200 {"status":"ok","db":"ok"}`; po zatrzymaniu usługi PostgreSQL → `503`
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

### Phase 3: Deploy — kopia, migracje i health-check w `deploy.sh`

#### Automated

- [ ] 3.1 Składnia skryptu: `sh -n deploy/mydevil/deploy.sh`
- [ ] 3.2 Lint i testy backendu oraz build frontendu nadal przechodzą: `cd backend-subtracker && npm run lint && npm test`, `cd frontend-subtracker && npm run build`

#### Manual

- [ ] 3.3 MyDevil: baza PostgreSQL utworzona (`devil pgsql db add …`), `pg_dump` i `psql` dostępne (`which pg_dump psql`), katalog `~/apps/subtracker/backups` istnieje
- [ ] 3.4 `shared/.env` API uzupełniony z `.env.mydevil` (`DB_*`, `CORS_ORIGINS=https://subtracker.jakubpietrzykowski.pl`, `PORT`, `NODE_ENV`), `chmod 600`
- [ ] 3.5 `deploy.sh` wgrany na serwer wg README (rozmiar zgodny z lokalnym, `-rwx------`)
- [ ] 3.6 Push na `main` (wykonuje użytkownik): oba workflowy zielone, w logu API widać kopię bazy, migracje i `health-check OK` na `/health`
- [ ] 3.7 `curl -s https://apisubtracker.jakubpietrzykowski.pl/health` → `{"status":"ok","db":"ok"}`
- [ ] 3.8 `https://subtracker.jakubpietrzykowski.pl` w przeglądarce pokazuje „API i baza działają”, bez błędów CORS w konsoli
- [ ] 3.9 `curl -i -H "Origin: https://example.com" https://apisubtracker.jakubpietrzykowski.pl/health` nie zwraca `Access-Control-Allow-Origin`
- [ ] 3.10 W `~/apps/subtracker/backups/` jest plik kopii z tego deployu; w bazie istnieje tabela `migrations`
