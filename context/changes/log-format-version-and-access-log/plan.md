# Format logu, wersja i access log — plan implementacji

## Overview

Logi API (NestJS) i serwera SSR (`frontend-subtracker/src/server.ts`) dostają jeden format tekstowy ze znacznikiem ISO w strefie Warszawy z offsetem. Kolory ANSI pojawiają się tylko wtedy, gdy wyjście jest terminalem; w terminalu wracają też wyróżnienia banera startowego i podsumowań jobów. Linia startowa obu procesów i `/health` API podają wdrożony SHA z `.deploy-info`. Każde żądanie w obu procesach zostawia jedną linię access logu. Linie i stosy w `err.log` przestają nieść treść komunikatu błędu bazy (zaległe z S-16).

Plan realizuje PRD v2 FR-022 i roadmapę S-14 (audyt P3, P4, P6). Ma iść bez nadzoru (`/goal` + `/10x-goal-implement`), więc wszystkie decyzje są tu rozstrzygnięte.

## Current State Analysis

Pełne kotwice: `context/changes/log-format-version-and-access-log/research.md`. Ścieżki API względne do `backend-subtracker/src/`.

- **Logger API nie jest skonfigurowany**: `main.ts:14` `NestFactory.create(AppModule)` bez opcji. Domyślny `ConsoleLogger` Nest 12.1.2: znacznik `Intl.DateTimeFormat(undefined, …)` bez strefy i ISO, kolory gdy brak `NO_COLOR` (bez sprawdzania TTY), format `[Nest] <pid>  - <ts> <LEVEL> [Context] <msg>`, stos jako osobna surowa linia stderr. `getTimestamp`, `formatPid`, `printStackTrace` są `protected` (`console-logger.service.d.ts:213, 262, 273`).
- **Linie poza loggerem**: baner `console.log` z ANSI po `listen` (`main.ts:24-28`), `installFatalHandlers((line) => console.error(line), …)` (`main.ts:31-34`; `fatalLine` w `shared/process/fatal-handlers.ts:7-14` zawiera `reason.message`). Wycofane w S-11 (`67145e7`) zielone tło `\x1b[30;42m` podsumowania przebiegu przypomnień.
- **Brak access logu** w obu procesach. `applyHttpSecurity` (`config/http-security.ts:12-19`) jest wspólne dla `main.ts:20` i e2e (`test/support/e2e-app.ts:249`); `describeRequest` (`shared/logging/request-context.ts:28-35`) daje `<METODA> <szablon|(unrouted)> user=<uuid|-> req=<uuid|->`.
- **Wersja**: `deploy/mydevil/deploy.sh:152` zapisuje `SHA=…` i `BACKUP=…` do `.deploy-info` w katalogu wydania przed startem; `start-app.sh` uruchamia `forever` z `--workingDir` = katalog wydania (`cd "$LIVE_REAL"`), dla obu aplikacji. Nikt pliku nie czyta w aplikacjach. `/health` (`health/health.controller.ts:9-15`) zwraca `{status, db, jobs?}`.
- **Treść błędu bazy w logach**: `jobs/job-run.service.ts` (`messageOf` przy zapisie skipped/startu/retencji/końca; stos zawsze przy `failed`), `mail/services/mail.service.ts:244-245` (`saveAudit`), `admin/services/admin-audit.service.ts:32-36` (stos), `health/health.controller.ts:37-40, 50-52`, `auth/services/auth.service.ts:393-395`, `auth/services/account-access.service.ts:203-205`, filtr `describeError` (`shared/filters/safe-logging-exception.filter.ts:40-50`), `fatalLine`.
- **Serwer SSR**: jedyna linia `console.log` startu (`server.ts:79`), brak loggera i handlera błędów; `express.static` (`:50-56`) przed handlerem Angulara (`:61-66`); `listen` tylko gdy `isMainModule(import.meta.url) || process.env['pm_id']` (`:72`).

## Desired End State

- **Format linii (oba procesy):** `[<app>] <pid>  - <ISO Warszawy z offsetem> <LEVEL> [<Context>] <wiadomość>`, np. `[subtracker-api] 4123  - 2026-11-25T02:00:03.412+01:00     LOG [JobRunService] Job trial-reminder (cron) for 2026-11-25: success in 152 ms, …`. `<app>` = `APPLICATION_NAME` w API, `subtracker-frontend` w SSR.
- **Kolory:** tylko gdy `process.stdout` i `process.stderr` są TTY i brak `NO_COLOR`; w `out.log`/`err.log` pod `forever` nie ma żadnego bajtu `\x1b`. W terminalu: kolory poziomów jak w Nest, baner startowy z tłem jak dziś (`44`/`46`), podsumowanie przebiegu joba z tłem: `success` zielone (`30;42`), `partial`/`failed` czerwone (`30;41`), `skipped` bez tła.
- **Linia startowa API** (po `listen`, kontekst `Bootstrap`): `Started <APPLICATION_NAME> version <sha> on port <PORT>, mode <MODE>, database <nazwa>, auto synchronization <YES|NO>, CORS origins <lista>` (jedna linia zamiast trzech `console.log`).
- **`/health` API:** `{ status, db, version, jobs? }`, `version` = pełny SHA albo `dev`; także w odpowiedzi 503. `BACKUP` nigdy w odpowiedzi.
- **Access log API:** jedna linia `log` w kontekście `Access` na każde żądanie, po zakończeniu odpowiedzi: `<METODA> <szablon|(unrouted)> <status> <ms> ms user=<uuid|-> req=<uuid>`; przerwane przez klienta: status `aborted`. Bez query, adresów, tokenów, ciasteczek, body.
- **Serwer SSR:** linia startowa `Started subtracker-frontend version <sha> on port <PORT>`; access log `log` w kontekście `Access` tylko dla żądań, które nie trafiły w plik statyczny: `<METODA> <ścieżka bez query> <status> <ms> ms`; ścieżka przycięta do 200 znaków, znaki sterujące zamienione na `?`.
- **Bez treści błędu bazy:** każde wywołanie loggera z sprawdzonej listy (Current State) podaje `(code: <failureCodeOf>)` zamiast `message`; stos `QueryFailedError` ma pierwszą linię `QueryFailedError: <message omitted>`; filtr 5xx dla `QueryFailedError` pisze `QueryFailedError (code: X)`. Komunikaty innych błędów (nasze `HttpException`, `TypeError`) zostają.
- **Testy:** czyste helpery formatu z testami jednostkowymi w obu aplikacjach; e2e access logu w API (bez query i adresu); kształt `/health` z `version`; istniejące e2e i specy zielone.
- **Dokumenty:** `backend-patterns.md`, `CLAUDE.md`, `deploy/mydevil/README.md` opisują format, access log i wersję.

### Key Discoveries:

- `ConsoleLogger` przyjmuje `prefix` i `colors`; `timestamp: true` to tylko `+Nms` (`console-logger.service.js:429-438`), więc znacznik daje nadpisany `getTimestamp()`.
- W chwili `res.on('finish')` `req.route` jest nadal ustawione (Express 5, `node_modules/router/index.js:171, 281`), więc `describeRequest` daje szablon trasy; `res.statusCode` jest końcowym statusem po filtrze.
- Access log na poziomie `log` nie zmienia liczby wywołań `warn`/`error`, na których opierają się `test/request-context.e2e-spec.ts:70`, `test/auth/unexpected-errors.e2e-spec.ts:49, 66`, `test/auth/denials.e2e-spec.ts:232, 241`.
- Kształt `/health` przypinają `toEqual` w `health/health.controller.spec.ts:50, 66, 80` i `test/jobs/health.e2e-spec.ts:38, 55`; watchdog ignoruje nowe pola (`watchdog/run-watchdog.ts:102-151`).
- `APP_TIME_ZONE = 'Europe/Warsaw'` (`shared/date/calendar-day.ts:5`); frontend nie dzieli kodu z API, więc ma własną stałą.
- Vitest może biec w terminalu (TTY), więc wyróżnienia w treści wiadomości zależne od TTY rozjechałyby asercje dokładnego tekstu — testy muszą działać z `NO_COLOR=1` (konfiguracja Vitest w obu aplikacjach).

## What We're NOT Doing

- JSON jako format logu (tekst bez kolorów; JSON można dodać później opcją loggera).
- Stos w jednej linii z prefiksem — stos zostaje kolejnymi liniami pod linią błędu, jak dziś (pod `LOG_ERROR_STACKS` w filtrze).
- Rotacja logów na MyDevil (otwarte pytanie właściciela, `roadmap.md` Open Question #3); zostaje cotygodniowy `truncate` z crontaba.
- Pomijanie w access logu `/health`, `GET /` watchdoga i health-checków deployu — logowane jak reszta (~288 linii na dobę na proces).
- Logowanie żądań plików statycznych w SSR.
- `/health` we frontendzie; wersja frontendu tylko w linii startowej.
- Zmiana pola `jobs` w publicznym `/health` (F5 z S-11 zostaje bez zmian).
- Format logów skryptów CLI (`src/cli/*`, `watchdog.sh`, `deploy.sh`) — osobne procesy z własnym prefiksem.
- Błędy SSR i guardów połykane bez logu (S-15).
- Limit liczby linii access logu.

## Implementation Approach

Fazy idą od wspólnego fundamentu: najpierw logger API (format, kolory, stosy, treść błędów), potem wersja i access log API, które z niego korzystają, potem serwer SSR z własnym małym modułem w tym samym formacie, na końcu dokumenty i weryfikacja na produkcji. Każda faza kończy się zielonymi testami i jest osobnym commitem. Kod ogólny trafia do `backend-subtracker/src/shared/logging/` i `src/shared/deploy/` z testami obok (`lessons.md`).

## Critical Implementation Details

- **Logger przed bootstrapem.** Logger musi być podany w `NestFactory.create(AppModule, { logger })`, inaczej linie `InstanceLoader`/`RouterExplorer` i przebiegi startowe jobów (biegną przed `listen`) pójdą starym formatem. `fatalLine` jest instalowany przed `create`, więc dostaje znacznik z tego samego czystego helpera, nie z instancji loggera.
- **Determinizm testów.** Kolory i wyróżnienia zależą od jednej funkcji (`colorsEnabled()`: `stdout` i `stderr` to TTY i brak `NO_COLOR`). Oba pliki konfiguracji Vitest w API (`vitest.config.ts`, `vitest.config.e2e.ts`) ustawiają `NO_COLOR=1` w `test.env`; testy helperów kolorów wstrzykują flagę zamiast czytać TTY.

## Phase 1: Format logu API

### Overview

Jeden format linii API ze znacznikiem ISO Warszawy, kolory tylko w terminalu, przywrócone wyróżnienia, stosy i linie bez treści błędu bazy.

### Changes Required:

#### 1. Czyste helpery formatu

**File**: `backend-subtracker/src/shared/logging/log-format.ts` (+ `log-format.spec.ts`)

**Intent**: Wspólne, testowalne części formatu: znacznik, decyzja o kolorach, wyróżnienie, oczyszczenie stosu.

**Contract**:
- `isoTimestampIn(timeZone: string, at: Date): string` → `YYYY-MM-DDTHH:mm:ss.SSS±HH:MM` w danej strefie (Intl); testy: zima `+01:00`, lato `+02:00`, oba wystąpienia 02:30 przy cofnięciu czasu (2026-10-25) dają różne offsety;
- `colorsEnabled(isTty = process.stdout.isTTY === true && process.stderr.isTTY === true, noColor = process.env.NO_COLOR): boolean` → `isTty && !noColor` (oba strumienie, bo `error` idzie do `stderr`: przy `2> plik` z terminalem na `stdout` kody nie mogą trafić do pliku);
- `highlight(text: string, style: 'success' | 'failure' | 'info' | 'notice', enabled = colorsEnabled()): string` → przy `enabled` owija tekst tłem (`30;42`, `30;41`, `44`, `46`) i `\x1b[0m`, inaczej zwraca tekst bez zmian;
- `safeStack(stack: string): string` → gdy pierwsza linia zaczyna się od `QueryFailedError:`, zastępuje ją `QueryFailedError: <message omitted>`; reszta bez zmian.

#### 2. Logger aplikacji

**File**: `backend-subtracker/src/shared/logging/app-logger.ts` (+ `app-logger.spec.ts`)

**Intent**: Podklasa `ConsoleLogger` dająca format z Desired End State bez zmiany wywołań `Logger` w kodzie.

**Contract**:
- `class AppLogger extends ConsoleLogger`, konstruktor `(appName: string)`: `super({ prefix: appName, colors: colorsEnabled() })`;
- nadpisane `getTimestamp()` → `isoTimestampIn(APP_TIME_ZONE, new Date())`, `printStackTrace(stack)` → `super.printStackTrace(safeStack(stack))`;
- spec: linia zapisana do strumienia (spy na `process.stdout.write`/`stderr.write`) ma prefiks aplikacji, znacznik ISO z offsetem, brak `\x1b` przy `colors: false`; stos `QueryFailedError` bez komunikatu.

#### 3. Bootstrap i linia startowa

**File**: `backend-subtracker/src/main.ts`, `backend-subtracker/src/shared/process/fatal-handlers.ts` (+ spec)

**Intent**: Logger od pierwszej linii, jedna linia startowa przez logger zamiast trzech `console.log`, linia `Fatal` w tym samym formacie i bez treści błędu bazy.

**Contract**:
- `NestFactory.create(AppModule, { logger: new AppLogger(<nazwa>) })`; nazwa z `process.env.APPLICATION_NAME` z fallbackiem `subtracker-api` (env jest walidowany dopiero przez `ConfigService`, więc tu tylko surowy odczyt);
- po `listen`: `new Logger('Bootstrap').log(highlight(<linia startowa z Desired End State bez wersji — wersja w fazie 2>, 'info'))`;
- `fatalLine` dla `QueryFailedError` → `Fatal <kind>: QueryFailedError (code: <failureCodeOf>)`; linia dostaje prefiks `[<app>] <pid>  - <isoTimestampIn(...)> FATAL ` przez funkcję przekazaną do `installFatalHandlers` w `main.ts` (helper w `log-format.ts`, np. `plainLine(app, level, context, message)`, z testem).

#### 4. Wyróżnienie podsumowania joba

**File**: `backend-subtracker/src/jobs/job-run.service.ts` (+ spec)

**Intent**: Przywrócone tło podsumowania przebiegu w terminalu dla wszystkich jobów.

**Contract**: linia podsumowania przechodzi przez `highlight(summary, outcome === 'success' ? 'success' : 'failure')` dla `success`/`partial`/`failed`; przy `NO_COLOR=1` tekst identyczny z dzisiejszym (istniejące asercje bez zmian).

#### 5. Bez treści błędu bazy

**File**: `backend-subtracker/src/jobs/job-run.service.ts`, `backend-subtracker/src/mail/services/mail.service.ts`, `backend-subtracker/src/admin/services/admin-audit.service.ts`, `backend-subtracker/src/health/health.controller.ts`, `backend-subtracker/src/auth/services/auth.service.ts`, `backend-subtracker/src/auth/services/account-access.service.ts`, `backend-subtracker/src/shared/filters/safe-logging-exception.filter.ts` (+ ich specy)

**Intent**: Domknąć regułę „tylko kod, nigdy komunikat” w `err.log` (F3 z S-16).

**Contract**:
- każde miejsce z listy Current State: `…failed: <message>` → `…failed (code: <failureCodeOf(error)>)`; przekazywane stosy przez `safeStack`;
- `describeError` w filtrze: dla `QueryFailedError` `QueryFailedError (code: X)` zamiast komunikatu; inne błędy jak dziś;
- specy przypinające dawny tekst (`job-run.service.spec.ts`, `health.controller.spec.ts`, filtr, mail) zaktualizowane do nowego tekstu; nowy test: `QueryFailedError` z adresem w komunikacie nie trafia do żadnego argumentu loggera.

#### 6. Konfiguracja testów

**File**: `backend-subtracker/vitest.config.ts`, `backend-subtracker/vitest.config.e2e.ts`

**Intent**: Testy nie zależą od tego, czy biegną w terminalu.

**Contract**: `test.env` zawiera `NO_COLOR: '1'` (w e2e dopisane do obiektu z `loadEnv`).

### Success Criteria:

#### Automated Verification:

- Testy logowania i jobów przechodzą: `npx vitest run src/shared src/jobs src/health src/mail src/admin src/auth`
- Celowe uszkodzenie: `colorsEnabled` zwracające `true` mimo braku TTY albo `safeStack` przepuszczający komunikat czerwieni test
- Pełne testy backendu: `npm test`
- Testy e2e backendu: `npm run test:e2e`
- Lint i build backendu: `npm run lint && npm run build`

#### Manual Verification:

- Lokalnie `npm run start:dev` w terminalu pokazuje kolory poziomów, tło linii startowej i zielone tło podsumowania przebiegu joba, a `npm run start:dev > out.txt` (przekierowanie, czyli bez TTY) daje plik bez `\x1b` ze znacznikiem `+01:00`; plik usunięty po sprawdzeniu

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 2.

---

## Phase 2: Wersja w API

### Overview

Linia startowa i `/health` podają wdrożony SHA.

### Changes Required:

#### 1. Odczyt `.deploy-info`

**File**: `backend-subtracker/src/shared/deploy/deploy-info.ts` (+ `deploy-info.spec.ts`)

**Intent**: Jedno miejsce czytające wersję wydania, odporne na brak pliku.

**Contract**:
- `readDeployedVersion(dir = process.cwd()): string` — czyta `<dir>/.deploy-info`, zwraca wartość linii `SHA=` (przycięta, tylko `[0-9a-f]{7,40}`), w każdym innym przypadku (brak pliku, brak linii, zły format) `dev`; nigdy nie czyta ani nie zwraca `BACKUP`;
- spec na katalogu tymczasowym testu (`os.tmpdir()` przez `mkdtemp`, usuwany w `afterEach`): pełny SHA, brak pliku, `BACKUP` bez `SHA`, śmieci w `SHA`.

#### 2. Wersja w linii startowej i `/health`

**File**: `backend-subtracker/src/main.ts`, `backend-subtracker/src/app.module.ts`, `backend-subtracker/src/health/health.controller.ts` (+ spec), `backend-subtracker/test/jobs/health.e2e-spec.ts`

**Intent**: Operator widzi wdrożoną wersję w logu i w odpowiedzi `/health`.

**Contract**:
- wersja czytana raz przy starcie: token `DEPLOYED_VERSION` (eksportowany z `shared/deploy/deploy-info.ts`) z `useFactory: () => readDeployedVersion()` w `providers` `AppModule` (moduł `health` nie istnieje — `HealthController` jest rejestrowany w `app.module.ts:43`); `HealthController` dostaje go przez `@Inject(DEPLOYED_VERSION)` w konstruktorze, `main.ts` przez `app.get(DEPLOYED_VERSION)`; spec kontrolera przekazuje wersję jako parametr konstruktora;
- linia startowa: `Started <APPLICATION_NAME> version <sha> on port …`;
- `HealthResponse` z polem `version: string` w 200 i 503;
- specy z `toEqual` dostają `version` (w e2e `dev`, bo cwd `backend-subtracker/` nie ma `.deploy-info`).

### Success Criteria:

#### Automated Verification:

- Testy wersji i `/health` przechodzą: `npx vitest run src/shared/deploy src/health`
- Celowe uszkodzenie: zwracanie `BACKUP` albo brak fallbacku `dev` czerwieni test
- Pełne testy backendu: `npm test`
- Testy e2e backendu: `npm run test:e2e`
- Lint i build backendu: `npm run lint && npm run build`

#### Manual Verification:

- Lokalnie `curl localhost:3000/health` przy `npm run start:dev` zwraca `"version":"dev"`

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 3.

---

## Phase 3: Access log API

### Overview

Jedna linia na każde żądanie API, z szablonem trasy, statusem i czasem.

### Changes Required:

#### 1. Middleware access logu

**File**: `backend-subtracker/src/shared/logging/access-log.ts` (+ `access-log.spec.ts`), `backend-subtracker/src/config/http-security.ts`

**Intent**: Widać liczbę żądań, statusy i czasy każdej trasy, łącznie z 404, odmowami guardów, CSRF i preflightami.

**Contract**:
- `accessLog(logger = new Logger('Access'))` zwraca middleware Express; mierzy `performance.now()` przy wejściu; na `res.once('finish')` loguje `log` linię `${describeRequest(req)}` przekształconą do `<METODA> <trasa> <status> <ms> ms user=… req=…` (status z `res.statusCode`, ms zaokrąglone do liczby całkowitej); na `res.once('close')` bez wcześniejszego `finish` jedna linia ze statusem `aborted`; nigdy dwie linie na żądanie;
- rejestrowany w `applyHttpSecurity` zaraz po `assignRequestId` (przed CORS i CSRF), więc działa w `main.ts` i e2e;
- spec z atrapą `req`/`res` (EventEmitter): szablon trasy, `(unrouted)`, `aborted`, jedna linia po `finish`+`close`.

#### 2. E2E

**File**: `backend-subtracker/test/access-log.e2e-spec.ts` (nowy, wzorzec `test/request-context.e2e-spec.ts`)

**Intent**: Przypiąć regułę danych osobowych dla nowej linii (`backend-patterns.md`, „Logi błędów i odmów”).

**Contract**: spy na `Logger.prototype.log`, filtr po kontekście `Access`:
- `GET /health` → linia `GET /health 200 … ms user=- req=<uuid>`;
- `GET /nie-istnieje?token=abc&email=anna@example.com` → `(unrouted) 404`, a w linii nie ma `?`, `token`, `abc`, `anna@example.com`;
- żądanie z sesją do trasy chronionej (np. `GET /subscriptions`) → `user=<uuid>` i szablon trasy;
- celowe uszkodzenie: `req.originalUrl` zamiast `describeRequest` czerwieni test „bez query”.

### Success Criteria:

#### Automated Verification:

- Testy access logu przechodzą: `npx vitest run src/shared/logging` oraz `npx vitest run --config ./vitest.config.e2e.ts test/access-log.e2e-spec.ts`
- Celowe uszkodzenie: `originalUrl` w linii albo druga linia po `close` czerwieni test
- Pełne testy backendu: `npm test`
- Testy e2e backendu: `npm run test:e2e`
- Lint i build backendu: `npm run lint && npm run build`

#### Manual Verification:

- Lokalnie przy `npm run start:dev` wejście na `/subscriptions` we froncie daje w konsoli API linie `Access` z szablonami tras i `user=<uuid>`, bez adresów

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 4.

---

## Phase 4: Serwer SSR

### Overview

Serwer SSR pisze w tym samym formacie: linia startowa z wersją i access log.

### Changes Required:

#### 1. Moduł logu serwera

**File**: `frontend-subtracker/src/server-log.ts` (+ `src/server-log.spec.ts`)

**Intent**: Mały, czysty moduł formatu dla procesu SSR (aplikacje nie dzielą kodu z API).

**Contract**:
- stała `SERVER_TIME_ZONE = 'Europe/Warsaw'`; `isoTimestampIn(timeZone, at)` jak w API (ta sama specyfikacja i przypadki testowe);
- `serverLine(level: 'LOG' | 'ERROR', context: string, message: string, at = new Date(), pid = process.pid): string` → `[subtracker-frontend] <pid>  - <ISO> <LEVEL wyrównany do 7> [<context>] <message>`; przy `colorsEnabled()` (TTY i brak `NO_COLOR`) poziom kolorowany, inaczej bez `\x1b`;
- `safePath(path: string): string` → maks. 200 znaków (z `…`), znaki `\x00-\x1f\x7f` zamienione na `?`;
- `deployedVersionFrom(text: string | null): string` — ta sama reguła co w API (tylko `SHA=` z `[0-9a-f]{7,40}`, w każdym innym przypadku `dev`); moduł jest **czysty**: bez importów `node:*` i bez odczytu plików, bo spec biegnie przez `@angular/build:unit-test`, który pakuje testy jak kod aplikacji;
- spec w `ng test` (Vitest) z wstrzykniętą flagą kolorów, czasem i pid; przypadki jak w API plus `safePath` i `deployedVersionFrom(null)`.

#### 2. `server.ts`

**File**: `frontend-subtracker/src/server.ts`

**Intent**: Linia startowa z wersją i jedna linia na żądanie Angulara bez plików statycznych.

**Contract**:
- odczyt pliku w `server.ts`: `readFileSync(join(process.cwd(), '.deploy-info'), 'utf8')` w `try`, przy błędzie `null`, wynik przez `deployedVersionFrom`; raz, przed `listen`;
- linia startowa w `listen`: `console.log(serverLine('LOG', 'Bootstrap', \`Started subtracker-frontend version ${version} on port ${port}\`))` zamiast dzisiejszej;
- middleware access logu zarejestrowany **po** `express.static` i **przed** handlerem Angulara, tylko gdy serwer nasłuchuje (ten sam warunek co `listen`, `isMainModule(import.meta.url) || process.env['pm_id']`), więc nie loguje w `ng serve` ani przy prerenderze; na `res.once('finish')` `console.log(serverLine('LOG', 'Access', \`${req.method} ${safePath(req.path)} ${res.statusCode} ${ms} ms\`))`, na `close` bez `finish` status `aborted`;
- nagłówki, treść i statusy odpowiedzi bez zmian.

### Success Criteria:

#### Automated Verification:

- Testy frontendu przechodzą: `cd frontend-subtracker && npm run test:ci`
- Celowe uszkodzenie: `req.originalUrl` zamiast `safePath(req.path)` albo brak przycięcia czerwieni test `server-log.spec.ts`
- Build produkcyjny bez linii access logu w wyjściu: `cd frontend-subtracker && npm run build 2>&1 | grep -c "\[Access\]"` daje `0`
- E2E przeglądarkowe i http przechodzą: `cd frontend-subtracker && npm run build:e2e && npm run e2e` (wymaga API z `cd backend-subtracker && npm run build`, jak w CLAUDE.md)

#### Manual Verification:

- Lokalnie `npm run serve:ssr:frontend-subtracker` po `npm run build`: wejście na `/` i `/admin/users?q=test` daje w konsoli linie `Access` bez query, a pliki `.js`/`.css` nie mają linii

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 5.

---

## Phase 5: Dokumenty i produkcja

### Overview

Dokumenty opisują nowy format, a zmiana jest sprawdzona na serwerze.

### Changes Required:

#### 1. Dokumenty

**File**: `context/foundation/backend-patterns.md`, `CLAUDE.md`, `deploy/mydevil/README.md`

**Intent**: Kolejne slice'y i operator znają format, access log i wersję.

**Contract**:
- `backend-patterns.md`, „Logi błędów i odmów”: format linii, kolory tylko w TTY (`NO_COLOR`), `AppLogger` w `NestFactory.create`, access log (kontekst `Access`, pola, `aborted`, bez query), punkt „Treść błędu bazy w `err.log` (stan po S-16)” zastąpiony stanem po S-14 (`safeStack`, `(code: …)`);
- `CLAUDE.md` (poza blokiem 10x): jedno zdanie o formacie logu i access logu obu procesów oraz o `version` w `/health`;
- `deploy/mydevil/README.md` (PL i EN): `/health.version` i linia `Started … version <sha>` jako sposób sprawdzenia wdrożonej wersji; access log w `out.log` obu aplikacji.

### Success Criteria:

#### Automated Verification:

- Pełne testy obu aplikacji: `cd backend-subtracker && npm test && npm run lint && npm run build` oraz `cd frontend-subtracker && npm run test:ci`
- CI zielone na PR (`backend`, `backend-e2e`, `frontend`, `browser-e2e`, `deploy-scripts`)

#### Manual Verification:

- Po deployu obu aplikacji `curl localhost:<PORT_API>/health` na serwerze zawiera `"version":"<SHA z merge'a>"`
- Na serwerze nowe linie `out.log` i `err.log` obu aplikacji nie mają kodów ANSI (`tail -n 50 out.log | grep -c $'\x1b'` daje `0`), mają znacznik z offsetem, a `out.log` ma linie `[Access]` i `Started … version <sha>`

**Implementation Note**: Po wdrożeniu i ręcznych testach na produkcji zatrzymaj się na potwierdzenie przed `/10x-impl-review` i `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- `log-format` (API): offset zimą i latem, podwójna 02:30, `colorsEnabled`, `highlight` z flagą, `safeStack`.
- `AppLogger`: prefiks, znacznik, brak `\x1b` bez TTY, stos `QueryFailedError` bez komunikatu.
- `fatalLine`: `QueryFailedError` bez komunikatu, linia z prefiksem i znacznikiem.
- `deploy-info` (API i frontend): SHA, brak pliku, `BACKUP` bez `SHA`, śmieci.
- `access-log`: szablon, `(unrouted)`, `aborted`, jedna linia.
- `server-log` (frontend): format, kolory z flagą, `safePath`.
- Zaktualizowane specy linii z treścią błędu: tylko `(code: …)`.

### Integration Tests:

- `test/access-log.e2e-spec.ts`: `/health`, 404 z query (bez query w linii), trasa chroniona z `user=`.
- `test/jobs/health.e2e-spec.ts`: `version: 'dev'`.
- Istniejące e2e liczące `warn`/`error` bez zmian.
- `frontend-subtracker` e2e http i chromium bez zmian zachowania.

### Manual Testing Steps:

1. Terminal: kolory poziomów, tło linii startowej i podsumowań jobów.
2. `/health` lokalnie z `version: dev`.
3. Linie `Access` API z szablonami i `user=`; SSR bez query i bez plików statycznych.
4. Produkcja: `version` z SHA, brak `\x1b` w nowych liniach, linie `[Access]`.

## Performance Considerations

- Access log dodaje jedną linię stdout na żądanie w obu procesach; przy skali `small` i sondach co 5 min to setki linii na dobę. Cotygodniowy `truncate` > 20 MB zostaje zabezpieczeniem (rotacja poza zakresem).
- Wersja czytana raz przy starcie, nie przy każdym `/health`.

## Migration Notes

- Bez zmian schematu bazy i bez migracji.
- Watchdog czyta tylko `jobs` z `/health`, więc nowe pole `version` go nie dotyka; `deploy.sh` patrzy tylko na kod HTTP.
- Wydania sprzed `.deploy-info` i środowiska lokalne podają `dev`.

## References

- Research: `context/changes/log-format-version-and-access-log/research.md`
- Audyt: `context/audits/observability/2026-11-22_sign-in-subscriptions-jobs-account-admin.md` (P3, P4, P6)
- Roadmapa: `context/foundation/roadmap.md`, S-14; PRD v2: FR-022
- Poprzednie slice'y: `context/archive/2026-11-23-request-context-and-denial-reasons/plan.md` (`describeRequest`, reguły danych w logu), `context/archive/2026-11-24-failure-causes-and-audit-trail/reviews/impl-review.md` (F3)
- Wycofane wyróżnienie: commit `67145e7` (`\x1b[30;42m` przypomnień)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Format logu API

#### Automated

- [x] 1.1 Testy logowania i jobów — 79acd8a
- [x] 1.2 Celowe uszkodzenie kolorów albo `safeStack` czerwieni test — 79acd8a
- [x] 1.3 Pełne testy backendu — 79acd8a
- [x] 1.4 Testy e2e backendu — 79acd8a
- [x] 1.5 Lint i build backendu — 79acd8a

#### Manual

- [ ] 1.6 Lokalnie w terminalu kolory i tła, a z przekierowaniem plik bez ANSI z offsetem

### Phase 2: Wersja w API

#### Automated

- [x] 2.1 Testy wersji i `/health` — 7cacfbf
- [x] 2.2 Celowe uszkodzenie `BACKUP` albo fallbacku czerwieni test — 7cacfbf
- [x] 2.3 Pełne testy backendu — 7cacfbf
- [x] 2.4 Testy e2e backendu — 7cacfbf
- [x] 2.5 Lint i build backendu — 7cacfbf

#### Manual

- [ ] 2.6 Lokalnie `/health` z `version: dev`

### Phase 3: Access log API

#### Automated

- [x] 3.1 Testy access logu — b0cf0fb
- [x] 3.2 Celowe uszkodzenie `originalUrl` albo podwójnej linii czerwieni test — b0cf0fb
- [x] 3.3 Pełne testy backendu — b0cf0fb
- [x] 3.4 Testy e2e backendu — b0cf0fb
- [x] 3.5 Lint i build backendu — b0cf0fb

#### Manual

- [ ] 3.6 Lokalnie linie `Access` z szablonami i `user=`, bez adresów

### Phase 4: Serwer SSR

#### Automated

- [x] 4.1 Testy frontendu
- [x] 4.2 Celowe uszkodzenie ścieżki albo przycięcia czerwieni test
- [x] 4.3 Build bez linii access logu
- [x] 4.4 E2E przeglądarkowe i http

#### Manual

- [ ] 4.5 Lokalnie linie `Access` SSR bez query i bez plików statycznych

### Phase 5: Dokumenty i produkcja

#### Automated

- [ ] 5.1 Pełne testy obu aplikacji
- [ ] 5.2 CI zielone na PR

#### Manual

- [ ] 5.3 Po deployu `/health` z SHA
- [ ] 5.4 Na serwerze nowe linie bez ANSI, z offsetem, z `[Access]` i wersją
