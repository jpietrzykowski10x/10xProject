---
date: 2026-11-24T19:55:34Z
researcher: Claude (Opus 5.5) z trzema sub-agentami badawczymi
git_commit: 7589765
branch: change/log-format-version-and-access-log
repository: 10xProject (SubTracker)
topic: "S-14 (FR-022): jednolity format logów obu procesów, wdrożona wersja w linii startowej i /health, access log; ujednolicenie linii err.log z treścią błędu bazy (z S-16)"
tags: [research, logging, access-log, health, deploy, backend-subtracker, frontend-subtracker]
status: complete
last_updated: 2026-11-24
last_updated_by: Claude (Opus 5.5)
---

# Research: S-14 — format logu, wersja i access log

**Date**: 2026-11-24T19:55:34Z
**Researcher**: Claude (Opus 5.5) z trzema sub-agentami (API, serwer SSR, decyzje historyczne)
**Git Commit**: 7589765
**Branch**: change/log-format-version-and-access-log
**Repository**: 10xProject (SubTracker)

## Research Question

Co trzeba zmienić, żeby logi API (NestJS) i serwera SSR (Express w `frontend-subtracker/src/server.ts`) miały jeden format bez kodów ANSI, ze znacznikiem czasu ISO ze strefą; żeby linia startowa i `/health` podawały wdrożoną wersję; żeby każde żądanie zostawiało jedną linię access logu (metoda, trasa, status, czas); oraz które linie `err.log` nadal niosą treść błędu bazy (zalegle z S-16). Zmiana ma pójść jako `/goal` + `/10x-goal-implement`.

## Summary

- **Logger API nie jest skonfigurowany**: `NestFactory.create(AppModule)` bez opcji (`backend-subtracker/src/main.ts:14`), więc każda klasa używa domyślnego `ConsoleLogger` Nest 12.1.2. Jego znacznik czasu to `Intl.DateTimeFormat(undefined, …)` bez strefy i bez ISO (`node_modules/@nestjs/common/services/console-logger.service.js:29-36`), a kolory zależą tylko od braku `NO_COLOR` (`utils/cli-colors.util.js:1`), nie od TTY — w repo nic nie ustawia `NO_COLOR`, więc `out.log`/`err.log` na serwerze najpewniej mają kody ANSI (wniosek, niesprawdzony na serwerze). Metody formatu (`getTimestamp`, `formatPid`, `colorize`, `getJsonLogObject`) są `protected` (`console-logger.service.d.ts:213` i okolice), więc podklasa `ConsoleLogger` z `colors: false` i własnym znacznikiem jest najmniej inwazyjną drogą. `timestamp: true` w opcjach to tylko różnica `+Nms` (`.js:429-438`), nie czas.
- **Linie poza loggerem**: baner startowy z kodami ANSI (`main.ts:24-28`), linia fatal handlera `console.error` bez czasu (`main.ts:31-34`, treść z `shared/process/fatal-handlers.ts:7-14`), w frontendzie jedyna linia `console.log` startu (`frontend-subtracker/src/server.ts:79`). Skrypty CLI (`src/cli/*`) to osobne procesy z własnym prefiksem ISO — poza zakresem formatu procesu API.
- **Access log w API**: najlepsze miejsce to middleware zaraz po `assignRequestId` w `applyHttpSecurity` (`backend-subtracker/src/config/http-security.ts:12`), logujące na `res.on('finish')`. W chwili `finish` `req.route` jest nadal ustawione dla trasy dopasowanej (Express 5 / `router` 2.2.0: `node_modules/router/index.js:281`, `restore()` nie czyści `route`, `:171`), więc istniejący `describeRequest` (`shared/logging/request-context.ts:28-35`) daje szablon trasy albo `(unrouted)`, a `res.statusCode` jest końcowym statusem po filtrze. Interceptor nie widziałby odmów guardów, 404, CSRF ani preflightów. `applyHttpSecurity` jest wspólne dla `main.ts:20` i e2e (`test/support/e2e-app.ts:249`).
- **Access log w SSR**: `server.ts` nie ma żadnego loggera ani handlera błędów (`:27-66`); trasy Angulara nie mają szablonu jak w Nest, więc praktycznym „route” jest `req.path` bez query. Query niesie dane osobowe: `/admin/users?q=…` (`src/app/pages/admin/admin-users/admin-users.ts:80-94, 134-143`). Middleware po `express.static` (`:50-56`) pomija pliki statyczne (wiele na jedno wejście na stronę).
- **Wersja**: `deploy.sh:152` zapisuje `SHA=<pełny GITHUB_SHA>` i `BACKUP=<ścieżka dumpu|pusty>` do `.deploy-info` w katalogu wydania (obu aplikacji) przed startem; plik leży obok `app.js` (API, `scripts/prepare-mydevil.mjs:13-14`, start w `start-app.sh:29-42` z `--workingDir` wydania) i `app.mjs` (frontend). Lokalnie, w e2e i w wydaniach sprzed `.deploy-info` pliku nie ma — potrzebny fallback. `BACKUP` nie może trafić do publicznego `/health`.
- **`/health`**: `{status, db, jobs?}` (`backend-subtracker/src/health/health.controller.ts:9-15`), `@Public()`, 503 tylko przy bazie. Kształt przypinają `toEqual` w `src/health/health.controller.spec.ts:50,66,80` i `test/jobs/health.e2e-spec.ts:38,55`. Watchdog ignoruje nieznane pola (`src/watchdog/run-watchdog.ts:102-151`). Frontend nie ma `/health`; deploy i watchdog sprawdzają `GET /` (`deploy.sh:36-37`, `run-watchdog.ts:143-144`).
- **Treść błędu w logach (z S-16)**: w sprawdzonych plikach API linie z `message`/stosem to: `job-run.service.ts` (`messageOf` przy skipped/start/retencji/końcu, `:177-178, 220-221, 231-232, 257-258`; stos zawsze w `:117`), `mail.service.ts:244-245` (`saveAudit` catch), `admin-audit.service.ts:32-36` (stos bezwarunkowo), `health.controller.ts:37-40, 50-52`, `auth.service.ts:393-395` i `account-access.service.ts:203-205` (`Mail sending failed: <message>`), filtr `describeError` z `exception.message` dla każdego 5xx (`safe-logging-exception.filter.ts:40-50`, stos pod `LOG_ERROR_STACKS`, `:150-151`), `fatal-handlers.ts:13`. Helper: `failureCodeOf` (`shared/database/failure-code.ts:6-18`).
- **Testy**: spy na `Logger.prototype` (lista w Code References) nie zależą od formatu `ConsoleLogger`; łamią się przy zmianie argumentów wywołań (usunięcie stosu, zmiana tekstu `messageOf`: `job-run.service.spec.ts:245-248, 279-282, 340, 370, 373, 408`, `health.controller.spec.ts:85-87`). Access log przez `Logger` na poziomie `warn`/`error` zderzy się z e2e liczącymi wywołania: `test/request-context.e2e-spec.ts:70`, `test/auth/unexpected-errors.e2e-spec.ts:49, 66`, `test/auth/denials.e2e-spec.ts:232, 241`. Na poziomie `log` dla każdego statusu te testy przetrwają.

## Detailed Findings

### Logger API (Nest 12.1.2)

- Opcje `ConsoleLogger` (`console-logger.service.d.ts:6-119`): `logLevels`, `timestamp`, `prefix` (domyślnie `'Nest'`, `.js:75`), `json`, `colors` (domyślnie `json ? false : isColorAllowed()`, `.js:74`), `context`, `forceConsole`, `compact`, `structuredParams`, `flattenParams`, `redact`.
- Format tekstowy (`.js:355-370`): `[Nest] <pid>  - <ts> <LEVEL> [Context] <msg>`; stos w trybie tekstowym jako osobna surowa linia stderr (`printStackTrace`, `.js:417-426`).
- JSON (`json: true`, `.js:255-283`): `{level, pid, timestamp: Date.now(), message, context?, stack?}` — znacznik w milisekundach epoki, nie ISO; ISO wymaga nadpisania `getJsonLogObject`. Stos idzie do obiektu (`.js:411-415`).
- Kanały (`.js:96-141`): `log`/`warn`/`debug`/`verbose` → stdout (`out.log`), `error`/`fatal` → stderr (`err.log`). To dlatego S-16 podniósł `partial`/`skipped` do `error`.
- Logi bootstrapu (`InstanceLoader`, `RouterExplorer`, przebiegi startowe jobów przed `listen`) pójdą starym formatem, jeśli logger nie zostanie podany w `NestFactory.create` (`logger:`) albo z `bufferLogs: true` + `useLogger`. Pomocnik e2e tworzy aplikację osobno (`e2e-app.ts:247-249`), więc konfiguracja tylko w `main.ts` nie zadziała w e2e (dla formatu to bez znaczenia; dla access logu — tak, dlatego middleware w `applyHttpSecurity`).

### Access log API

- Kolejność middleware: `assignRequestId` (`http-security.ts:12`) → `applyCors` (`:13`) → CSRF (`:18`) → nagłówki (`:19`).
- `cors` z listą originów niczego nie odrzuca po stronie serwera (pomija tylko nagłówek); odmowa CSRF to `ForbiddenException` przez filtr (`filter.ts:25-37, 70-83`).
- Dzisiejsze linie: 5xx `ExceptionsHandler` `error`: `<METODA> <trasa> user=<uuid|-> req=<uuid>: <message> (code: X)` (`filter.ts:143-155`); `Denials` `warn` z limitem 10/kod/min (`denial.ts:232-251`, `filter.ts:157-178`).
- `user=` jest znany dopiero po guardzie sesji (`req.user`), więc w access logu dla tras chronionych będzie, a dla odmów przed guardem `-`.
- Ruch stały: watchdog `GET /health` API i `GET /` frontendu co 5 min (`run-watchdog.ts:143-144`, crontab `deploy/mydevil/README.md:261`) plus health-checki deployu.

### Serwer SSR

- `server.ts`: `x-powered-by` off (`:27`), nagłówki (`:28-33`), `express.static(browserDistFolder, { maxAge: '1y', index: false, redirect: false })` (`:50-56`), handler SSR `angularApp.handle(req)…catch(next)` (`:61-66`), `listen` tylko przy `isMainModule(import.meta.url) || process.env['pm_id']` (`:72`), port `PORT || 4000` (`:73`). Błędy lecą do domyślnego handlera Express (stos na stderr).
- `reqHandler = createNodeRequestHandler(app)` (`:86`) działa też w `ng serve`; komentarz (`:84`) mówi o użyciu „during build” — czy middleware loguje przy prerenderze w `ng build`, niesprawdzone (do sprawdzenia jednym buildem).
- Ścieżka jest kontrolowana przez klienta — długość i znaki sterujące trzeba ograniczyć (wstrzykiwanie do logu).
- Frontend nie ma helperów logowania; aplikacje nie dzielą kodu (brak monorepo), więc formatter frontendu to osobny mały moduł obok `server.ts`. Testów jednostkowych `server.ts` nie ma; pokrycie przez wydzielony czysty helper ze specem (`src/**/*.spec.ts`).
- Playwright (`playwright.config.ts`): `webServer` uruchamia `node dist/frontend-subtracker-e2e/server/server.mjs`; domyślnie stdout `ignore`, stderr `pipe` — linie na stdout nie zaśmiecą wyniku e2e. Specy http (`e2e/http/*.e2e-spec.ts`) sprawdzają status, nagłówki i treść; middleware słuchający tylko `finish` ich nie zmienia.
- Guardy SSR połykają błędy bez logu (`src/app/auth/auth.guard.ts:50, 80-81`) — to temat S-15, nie S-14.

### Wersja

- `.deploy-info`: linie `KEY=value`, czytane już przez `rollback.sh:60-63` i `deploy.sh:98` (`sed -n 's/^SHA=//p'`); wędruje z wydaniem przy rollbacku.
- API: `join(dirname(fileURLToPath(import.meta.url)), '.deploy-info')` (obok `app.js`) albo `process.cwd()` (forever `--workingDir` wydania). Frontend: `join(import.meta.dirname, '.deploy-info')` obok `app.mjs`.
- CI przekazuje SHA tylko jako argument SSH (`deploy-backend.yml:61`, `deploy-frontend.yml`), nie do buildu; `angular.json` nie ma `define`. Odczyt pliku w runtime jest prostszy niż wstrzykiwanie przy buildzie.

### Linie z treścią błędu

Wymienione w Summary. Już tylko kod: `subscription-lifecycle.service.ts:124-126`, `trial-reminder.service.ts:219-221, 241-243`, `mail.service.ts:91-92, 223-224`. `mail.service.ts:152` celowo zapisuje treść SMTP w wierszu audytu (miejsce na pełny tekst) — nie log. TypeORM nie ma włączonego `logging`.

## Code References

- `backend-subtracker/src/main.ts:14` — `NestFactory.create` bez loggera; `:20` `applyHttpSecurity`; `:24-28` baner ANSI; `:31-34` fatal handlers
- `backend-subtracker/src/config/http-security.ts:12-19` — kolejność middleware
- `backend-subtracker/src/shared/logging/request-context.ts:14-23, 28-35` — `assignRequestId`, `describeRequest`
- `backend-subtracker/src/shared/filters/safe-logging-exception.filter.ts:40-50, 143-178` — `describeError`, linie 5xx i `Denials`
- `backend-subtracker/src/health/health.controller.ts:9-15, 34-52` — kształt `/health`, logi błędów
- `backend-subtracker/src/jobs/job-run.service.ts:30-32, 45-48, 117, 177-258` — `messageOf`, `stackOf`
- `backend-subtracker/src/mail/services/mail.service.ts:56-58, 244-245` — `errorMessageOf`, `saveAudit`
- `backend-subtracker/src/admin/services/admin-audit.service.ts:32-36` — `recordOutside` ze stosem
- `backend-subtracker/src/shared/process/fatal-handlers.ts:7-14` — linia `Fatal …`
- `backend-subtracker/src/shared/database/failure-code.ts:6-18` — `failureCodeOf`
- `backend-subtracker/test/support/e2e-app.ts:247-249` — tworzenie aplikacji w e2e
- `frontend-subtracker/src/server.ts:27-86` — cały serwer SSR
- `deploy/mydevil/deploy.sh:36-37, 59-65, 98, 152, 157-165` — health-check, `.deploy-info`
- `deploy/mydevil/start-app.sh:29-42` — start przez `forever`, `out.log`/`err.log`
- Testy przypinające kształt `/health`: `src/health/health.controller.spec.ts:50,66,80`, `test/jobs/health.e2e-spec.ts:38,55`
- Testy liczące wywołania loggera: `test/request-context.e2e-spec.ts:70`, `test/auth/unexpected-errors.e2e-spec.ts:49,66`, `test/auth/denials.e2e-spec.ts:232,241`

## Architecture Insights

- Linie logu pisze wyłącznie filtr (S-13); access log to nowy, drugi świadomy pisarz — middleware w `applyHttpSecurity`, żeby działał w produkcji i e2e tak samo.
- Reguły danych osobowych (`context/foundation/backend-patterns.md:118`) obowiązują access log: bez `originalUrl`/query, body, nagłówków poza `Origin`, adresów, tokenów. Trasa = szablon (`req.route.path`) albo `(unrouted)`; wzorzec testu: celowe uszkodzenie z `originalUrl` musi czerwienić test „bez query” (`context/archive/2026-11-23-request-context-and-denial-reasons/plan.md:152,160`), a każda nowa linia ma e2e ze spy, że nie ma adresu, tokenu, ciasteczka ani query (`backend-patterns.md:126`).
- Kod ogólny (formatter linii, odczyt `.deploy-info`) do `src/shared/<obszar>/` z testem (`lessons.md`); frontend nie dzieli kodu z API, więc ma własny mały moduł.

## Historical Context (from prior changes)

- `context/foundation/roadmap.md:121-131` — S-14: zależy od S-13 (id żądania), kandydat na `/goal`; S-15 po S-14, bo obie zmieniają `server.ts` (`:139,144`).
- `context/audits/observability/2026-11-22_sign-in-subscriptions-jobs-account-admin.md:154-157, 171` — P3 (access log: metoda, szablon trasy, status, czas, bez query), P4 (ANSI, czas bez strefy, stosy w osobnych liniach, `warn` w `out.log`; kierunek: `json: true` albo `colors: false`, ISO), P6 (SHA z `.deploy-info` w linii startowej i `/health`).
- `context/archive/2026-11-23-request-context-and-denial-reasons/plan.md:21,42,69` — S-13 zakładał dla S-14 „access log, format (JSON, bez kolorów, ISO), wersja w logu i `/health`”; JSON zasugerowany, nie zdecydowany.
- `context/archive/2026-11-22-operator-liveness-alerts/plan.md:46` — kolory ANSI w liniach schedulerów zostawione dla S-14; przegląd S-11 (F5, commit `1add78c`): publiczny `/health` pokazuje nazwy i stan jobów — decyzja (np. `jobs` tylko dla loopback) odłożona do S-14, wciąż otwarta.
- `context/archive/2026-11-24-failure-causes-and-audit-trail/` — `follow-ups/review-fixes.md:8` i `reviews/impl-review.md` F3: ujednolicenie linii `err.log` z treścią błędu bazy należy do S-14; `backend-patterns.md:119` opisuje stan po S-16.
- `context/foundation/infrastructure.md:66,71,101` i `deploy/mydevil/README.md:259` — brak potwierdzonej rotacji logów na MyDevil (`forever` nie rotuje, wcześniej logi zapełniły dysk); dziś tylko cotygodniowy `truncate` plików > 20 MB w crontabie. Roadmapa: Open Question #3 (`roadmap.md:204`) i niewiadoma S-14 (`:131`) — bez odpowiedzi.

## Related Research

- `context/archive/2026-11-23-request-context-and-denial-reasons/research.md` — S-13, kontekst żądania i odmowy
- `context/archive/2026-11-22-operator-liveness-alerts/research.md` — S-11, `/health.jobs` i watchdog
- `context/archive/2026-11-24-failure-causes-and-audit-trail/research.md` — S-16, poziomy logów `partial`/`skipped`

## Open Questions

Decyzje dla `/10x-plan` (żadna nie blokuje researchu):

1. **JSON czy tekst bez kolorów.** Tekst: czytelny w `tail`, mniejsza zmiana testów; JSON: jedna linia ze stosem w środku (rozwiązuje „stosy w osobnych liniach” z P4), ale `timestamp` wymaga nadpisania na ISO.
2. **Strefa znacznika**: UTC `Z` (`toISOString`, audyt P4 mówi „ISO UTC”) czy offset Warszawy (`APP_TIME_ZONE`, `src/shared/date/`; FR-022 mówi tylko „ze strefą”).
3. **Stosy**: zostają w `err.log` (pod `LOG_ERROR_STACKS`) czy znikają tam, gdzie pierwsza linia stosu cytuje komunikat bazy (`QueryFailedError: <message>`).
4. **Poziom i kanał access logu**: `log` (stdout) dla każdego statusu — nie łamie testów liczących `warn`/`error` — czy 5xx jako `error`.
5. **Ruch stały**: logować czy pomijać `GET /health` i `GET /` watchdoga oraz health-checki (co 5 min, ~288 linii/dobę na proces).
6. **SSR**: `req.path` bez query z limitem długości i bez znaków sterujących; czy logować pliki statyczne (proponowane: nie, middleware po `express.static`).
7. **Wersja we frontendzie**: tylko linia startowa (brak `/health`) czy nowy endpoint; w API pełny SHA czy skrócony, i co z `jobs` w publicznym `/health` (F5 z S-11).
8. **Rotacja logów na MyDevil** (właściciel: użytkownik, nieblokujące): access log zwiększy objętość; dziś tylko `truncate` > 20 MB co tydzień.
9. **Bootstrap**: logger podany w `NestFactory.create`, żeby linie `InstanceLoader`/`RouterExplorer` i przebiegi startowe miały nowy format.
10. **Niesprawdzone**: czy `out.log` na serwerze naprawdę ma kody ANSI (`grep $'\x1b' out.log`) i czy middleware `server.ts` loguje przy prerenderze w `ng build`.
