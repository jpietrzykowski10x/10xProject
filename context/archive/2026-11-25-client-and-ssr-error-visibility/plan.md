# Widoczność błędów przeglądarki i SSR oraz przeładowanie po wdrożeniu — plan implementacji

## Overview

S-15 (FR-023, audyt L4, L5, L6, S5, S6, S7, A9, P7, P8). Nieoczekiwany błąd w przeglądarce zostawia ślad w konsoli, a na serwerze SSR linię `ERROR` w formacie S-14. Błąd nawigacji przy renderowaniu na serwerze daje stronę `/unavailable` ze statusem 500 zamiast „Cannot GET” 404. Plik aplikacji, którego po wdrożeniu już nie ma, powoduje jedno przeładowanie strony zamiast cichego „klik nic nie robi”. Błędy nie trafiają do API (PRD OQ #2 nadal otwarte).

## Current State Analysis

Pełny opis: `research.md`. W skrócie:

- 25 gałęzi `error:` zamienia błąd na stan UI bez zapisu przyczyny. Jedyny `console.error` przeglądarki to `main.ts:6`. Brak helpera i własnego `ErrorHandler`; `app.config.ts:17` ma tylko `provideBrowserGlobalErrorListeners()`.
- `provideRouter(routes)` bez funkcji (`app.config.ts:19`). 12 tras `loadComponent` (`app.routes.ts:9-64`). Nieudany `import()` kończy się `console.error` domyślnego `ErrorHandler`, a link nic nie robi.
- `server.ts:94-99`: `null` z `handle()` → `next()` → Express 404 „Cannot GET”. `@angular/ssr` 22.2.0 zwraca `null` także po błędzie nawigacji (`ssr.mjs:1113-1114`). Odrzucenie → `next(err)` → `logerror` Expressa (surowy stos, bez metody i ścieżki; S-14 F8). Brak middleware błędów.
- `server-log.ts`: `serverLine` z poziomem `ERROR` (nieużywany), `safePath`. Plik jest czysty (bez `node:*`), więc może go importować kod aplikacji renderowany na serwerze.
- Na serwerze błąd nawigacji trafia dziś tylko `/` (`RenderMode.Server`). `guestGuard` (`auth.guard.ts:50`) połyka każdy błąd API (L5), `signedInGuard` (`:80-82`) zamienia każdy błąd na `/unavailable` (L4).
- Po wdrożeniu `deploy.sh:157-164` podmienia cały katalog, więc stare `chunk-*.js` dają prawdziwe 404. HTML tras Client nie ma `Cache-Control`, więc jedno przeładowanie wystarcza.

## Desired End State

- Każda gałąź „nieznany błąd” (lista w fazie 1) woła `ErrorReporter.report(context, error)`. W przeglądarce wynik to jedna linia `console.error` z kontekstem i opisem (status, ścieżka bez query, nazwa błędu). Na serwerze wynik to linia `serverLine('ERROR', context, …)` z metodą i ścieżką żądania. Rozpoznane odpowiedzi (400 walidacji, 404, 409, `account_blocked`, 401 obsłużone przez interceptor) nie dają linii.
- `GET /` (albo dowolna trasa renderowana na serwerze), którego nawigacja rzuca wyjątek, daje 500 z treścią strony `/unavailable` i jedną linię `ERROR [Navigation] GET / <opis>` w stdout SSR.
- Odrzucenie `handle()` daje 500 z tekstem `Internal server error.` i jedną linią `ERROR [Render] <METHOD> <ścieżka> <nazwa>: <komunikat>` ze stosem w kolejnych liniach. Przerwanie przez klienta (`AbortError`) nie daje linii, bo access log pokazuje już `aborted`. Surowego stosu Expressa nie ma.
- W przeglądarce błąd ładowania modułu przy nawigacji robi `location.assign(<adres docelowy>)` raz na 60 s dla danego adresu. Drugi błąd w tym oknie idzie do reportera i pokazuje `/unavailable` bez zmiany adresu.
- Weryfikacja: Vitest (`npm run test:ci`), build produkcyjny i e2e, Playwright `http` (trasa testowa z rzucającym guardem w buildzie e2e) i `chromium` (chunk 404).

### Key Discoveries:

- `withNavigationErrorHandler(handler)` działa w kontekście wstrzykiwania. `RedirectCommand` → `NavigationCancel` i przekierowanie, inna wartość → ponowne rzucenie (`@angular/router` 22.2.0 `router.d.ts:745`, `_router-chunk.mjs:4047-4068`). `NavigationError.url` to adres docelowy.
- `RESPONSE_INIT` (`@angular/core` `core.d.ts:3051`) to `ResponseInit | null`; na serwerze obiekt żądania, w buildzie prerenderu i w przeglądarce `null`.
- Wzorzec `RedirectCommand('/unavailable', { skipLocationChange: true })`: `auth.guard.ts:80-81`.
- Wzorzec platformy: `isPlatformServer(inject(PLATFORM_ID))` (`auth.guard.ts:21`), `inject(REQUEST)`.
- `app.config.server.ts` scala providery serwera (`mergeApplicationConfig`), więc podmiana providera tylko na serwerze trafia tam.
- Konfiguracja `e2e` w `angular.json:102-110` ma własne `fileReplacements`. Środowisko e2e może więc dołożyć trasę, której produkcja nie ma.
- Playwright `webServer` (`playwright.config.ts:68-76`) nie oddaje stdout testom. Test linii `ERROR` uruchamia więc własny proces `server.mjs` na innym porcie.

## What We're NOT Doing

- Wysyłki błędów przeglądarki do API (`POST /client-errors`): PRD OQ #2 otwarte.
- Zmian widocznych dla użytkownika poza `/unavailable` przy błędzie SSR i przeładowaniem po wdrożeniu. Osobny komunikat przy 400 przy tworzeniu kategorii (S5) i znak nieaktualnych sum (S6) idą do follow-upu (`follow-ups/s5-s6-messages.md`, faza 3). Teksty komunikatów i testy e2e komunikatów zostają bez zmian.
- Zapisu rozpoznanych odpowiedzi biznesowych (400, 404, 409, `account_blocked`) ani 401 z `session-expired.interceptor.ts`.
- Własnego globalnego `ErrorHandler`: nieprzechwycone błędy dalej idą do domyślnego (`console.error`).
- Treści odpowiedzi HTTP, query, adresów e-mail i danych formularza w liniach błędu.
- Częściowej strony 200 przy błędzie szablonu po wysłaniu nagłówków (`node.mjs:435-438`): research tego nie potwierdził w działaniu, poza zakresem.
- Zmian w backendzie, w `deploy.sh` (np. zachowania starych chunków) i w `Cache-Control`.

## Implementation Approach

Jeden injectable `ErrorReporter` z dwiema implementacjami. Domyślna działa w przeglądarce (`console.error`), a serwerowa jest podmieniana w `app.config.server.ts` i pisze `serverLine` z danymi z `REQUEST`. Dzięki temu `server-log.ts` nie trafia do bundla przeglądarki. Czyste funkcje formatujące są w `shared/` i mają testy Vitest. Jeden handler błędów nawigacji w `app.config.ts` rozgałęzia się po platformie. Na serwerze zapisuje błąd, ustawia 500 i robi `RedirectCommand` na `/unavailable`. W przeglądarce rozpoznaje błąd modułu i przeładowuje stronę raz. Middleware błędów w `server.ts` zamyka F8 z S-14. Dowody działania dają e2e: trasa testowa tylko w buildzie e2e i `page.route` z 404 dla chunków.

## Critical Implementation Details

- **Kolejność w `server.ts`**: middleware błędów (4 argumenty) idzie na samym końcu, po handlerze Angulara. Access log rejestruje się wcześniej, więc linia `Access … 500` nadal powstaje.
- **Ochrona przed pętlą**: zapis do `sessionStorage` musi nastąpić *przed* `location.assign`. Każdy dostęp do magazynu jest w `try/catch`. Gdy magazyn jest niedostępny, przeładowania nie ma: reporter zapisuje błąd i idzie przekierowanie na `/unavailable`. Brak przeładowania jest lepszy niż pętla.
- **`RESPONSE_INIT` w handlerze nawigacji**: to, że ustawiony tam status trafia do odpowiedzi, potwierdza dopiero test `http` z fazy 2. Gdy status nie przechodzi, fallbackiem jest ustawienie go w komponencie `ServiceUnavailable` na serwerze: flaga z handlera przez wstrzykiwany sygnał albo token. To wymaga dopisku w planie (ADAPT), nie nowej decyzji.

## Phase 1: Reporter błędów i nieoczekiwane gałęzie

### Overview

Wspólny zapis przyczyny w przeglądarce i na serwerze, wpięty w gałęzie „nieznany błąd” z pozycji L4, L5, L6, S5, S6, S7, A9 i w wylogowanie.

### Changes Required:

#### 1. Opis błędu (czysta funkcja)

**File**: `frontend-subtracker/src/app/shared/error-description.ts` (+ `error-description.spec.ts`)

**Intent**: Jednolinijkowy opis błędu, bez danych osobowych, wspólny dla obu platform.

**Contract**: `describeError(error: unknown): string`:
- `HttpErrorResponse` → `HTTP <status> <ścieżka URL bez query i fragmentu>`, a `HTTP 0 …` przy błędzie sieci. Bez treści odpowiedzi i bez `message` (zawiera pełny URL z query).
- `Error` → `<name>: <message>`, jedna linia, znaki sterujące zamienione na `?`, najwyżej 200 znaków (logika jak `safePath`, ale w `shared/`: aplikacja nie importuje `server-log.ts` w kodzie przeglądarki).
- Inna wartość → `Unknown error (<typeof>)`.

Testy: query i `#` wycięte, nowa linia w komunikacie zamieniona, długi komunikat ucięty, `TimeoutError` z rxjs, `ProgressEvent` jako `error` w `HttpErrorResponse` (status 0).

#### 2. Reporter

**File**: `frontend-subtracker/src/app/shared/error-reporter.ts` (+ spec)

**Intent**: Punkt, który wołają komponenty, guardy i store'y.

**Contract**: `@Injectable({ providedIn: 'root' }) class ErrorReporter { report(context: string, error: unknown): void }`. Domyślnie `console.error(\`[${context}] ${describeError(error)}\`, error)`. Surowy obiekt trafia tylko do lokalnej konsoli użytkownika. `context` to nazwa klasy albo funkcji (`SignIn`, `authGuard`, `CostTotalsStore`).

#### 3. Reporter serwerowy

**File**: `frontend-subtracker/src/app/server-error-reporter.ts` (+ spec); `frontend-subtracker/src/app/app.config.server.ts`

**Intent**: Na serwerze ten sam `report` pisze linię w formacie S-14 z metodą i ścieżką żądania.

**Contract**: `class ServerErrorReporter extends ErrorReporter`, podany w `app.config.server.ts` jako `{ provide: ErrorReporter, useClass: ServerErrorReporter }`. Pisze `console.error(serverLine('ERROR', context, \`${method} ${safePath(path)} ${describeError(error)}\`))`. Metodę i ścieżkę bierze z `inject(REQUEST, { optional: true })` (`new URL(request.url).pathname`). Bez żądania (prerender w buildzie) pisze `- -`. Spec: przykładowa linia z wstrzykniętym `REQUEST` i `NO_COLOR`; query nie trafia do linii.

#### 4. Wpięcie w gałęzie „nieznany błąd”

**Files** (lokalizacje z `research.md`, tabela §1):
- `auth/auth.guard.ts`: `guestGuard` `catchError` (L5) i `signedInGuard` `catchError` (L4). Zapis przed zwróceniem `true` albo `RedirectCommand`.
- `pages/sign-in/sign-in.ts`, `pages/register/register.ts`, `pages/verify-link/verify-link.ts` (L6): tylko gałąź „reszta” po rozpoznaniu 403 `account_blocked` i 400.
- `subscriptions/subscription-form/subscription-form.ts` (S5, S7), `pages/subscriptions/subscriptions.ts` (`load()`, `resume()`), `subscriptions/cancel-subscription-dialog/*.ts`, `subscriptions/delete-subscription-dialog/*.ts` (S7).
- `pages/budget/budget.ts`: zapis ustawień, tworzenie kategorii (S5), odświeżenie; dialogi `delete-category-dialog`, `rename-category-dialog` (S-17).
- `subscriptions/cost-totals.store.ts` (S6): każde nieudane odświeżenie.
- `pages/admin/admin-users/admin-users.ts`, `pages/admin/admin-user/admin-user.ts`, `pages/account/delete-account-dialog/*.ts`, `admin/admin-action-dialog/admin-action-dialog.ts` (A9).
- `layout/app-shell/app-shell.ts`: nieudane wylogowanie.

**Intent**: Przyczyna nieznanego błędu zostaje w konsoli albo w logu SSR. Rozpoznane statusy zachowują się jak dziś. Wszystkie komunikaty w UI zostają bez zmian.

**Contract**: W każdej gałęzi „nieznany błąd” jedno wywołanie `inject(ErrorReporter).report('<Kontekst>', error)`. Tam, gdzie gałąź rozróżnia statusy (np. `if (status === 409) … else …`), wywołanie jest tylko w `else`. Ścieżki i nazwy plików dialogów ustala implementujący według researchu (ADAPT przy innych nazwach).

#### 5. Testy wpiętych miejsc

**Files**: speki dotkniętych plików (`*.spec.ts` obok).

**Intent**: Każde wpięcie jest pokryte testem. Rozpoznany status nie loguje.

**Contract**: W istniejącym teście nieznanego błędu (5xx albo `ProgressEvent`) sprawdzamy `vi.spyOn(TestBed.inject(ErrorReporter), 'report')`: jedno wywołanie z kontekstem. W istniejącym teście rozpoznanego statusu (400, 404, 409, `account_blocked`) sprawdzamy brak wywołania. Gdzie takiego testu nie ma, dopisujemy jeden. Wzorzec spy: `session-expired.interceptor.spec.ts:38-39`.

### Success Criteria:

#### Automated Verification:

- Testy frontu w obu strefach: `cd frontend-subtracker && npm run test:ci`
- Build produkcyjny: `cd frontend-subtracker && npm run build`
- Bundel przeglądarki bez kodu logu serwera: `grep -l "subtracker-frontend" frontend-subtracker/dist/frontend-subtracker/browser/*.js` nic nie znajduje
- Kontrola uszkodzenia: usunięte wywołanie `report` w `sign-in.ts` daje czerwony test SignIn

#### Manual Verification:

- Lokalnie (`npm start` + zatrzymane API): logowanie i lista subskrypcji pokazują dotychczasowe komunikaty, a w konsoli przeglądarki jest po jednej linii `[SignIn] HTTP 0 /auth/…` itp.

**Implementation Note**: Po zielonych bramkach zatrzymaj się na ręczne potwierdzenie przed fazą 2.

---

## Phase 2: Błąd nawigacji SSR i middleware błędów

### Overview

Serwer odpowiada 500 ze stroną `/unavailable` i linią `ERROR`, gdy nawigacja się nie uda. Odrzucenie `handle()` daje linię w formacie S-14 zamiast surowego stosu Expressa.

### Changes Required:

#### 1. Handler błędów nawigacji (część serwerowa)

**File**: `frontend-subtracker/src/app/navigation-error-handler.ts` (+ spec); `frontend-subtracker/src/app/app.config.ts`

**Intent**: Jeden handler dla obu platform. Faza 2 dodaje gałąź serwerową, faza 3 przeglądarkową.

**Contract**: `export function handleNavigationError(error: NavigationError): RedirectCommand | void`, podany jako `provideRouter(routes, withNavigationErrorHandler(handleNavigationError))`. Na serwerze robi trzy rzeczy:
- `inject(ErrorReporter).report('Navigation', error.error)`;
- `inject(RESPONSE_INIT, { optional: true })`, a gdy nie jest `null`, ustawia `status = 500`;
- zwraca `new RedirectCommand(router.parseUrl('/unavailable'), { skipLocationChange: true })`.

W przeglądarce, do fazy 3, nic nie robi: błąd jest rzucany ponownie, jak dziś. Spec z `PLATFORM_ID: 'server'`: reporter wywołany, status 500, zwrócony `RedirectCommand`.

#### 2. Middleware błędów w `server.ts`

**File**: `frontend-subtracker/src/server.ts`; `frontend-subtracker/src/server-log.ts` (+ `server-log.spec.ts`)

**Intent**: Zamknąć S-14 F8. Każde odrzucenie renderu ma jedną linię w formacie S-14 z metodą i ścieżką, a klient dostaje krótkie 500.

**Contract**: W `server-log.ts` powstaje czysta funkcja `renderErrorLines(req: AccessLogRequest, error: unknown): string[] | null`. Pierwsza linia to `<METHOD> <safePath> <name>: <message jedna linia>`, kolejne to linie stosu (bez pierwszej, która powtarza komunikat). Dla `AbortError` zwraca `null`. W `server.ts`, po handlerze Angulara, dochodzi `app.use((err, req, res, next) => …)`, który:
- pisze `console.error(serverLine('ERROR', 'Render', first))`, a potem pozostałe linie bez prefiksu;
- gdy `res.headersSent`, kończy odpowiedź (`res.end()`);
- w przeciwnym razie odpowiada `500` z `text/plain` i treścią `Internal server error.`.

Middleware działa zawsze, także bez `listening`. Linie piszemy tylko przy `listening`, tak jak access log.

#### 3. Trasa testowa tylko w buildzie e2e

**Files**: `frontend-subtracker/src/environments/environment.e2e.ts` (nowy), `environment.ts`, `environment.development.ts`, `angular.json` (konfiguracja `e2e`), `src/app/app.routes.ts`, `src/app/app.routes.server.ts`, `src/app/e2e-routes.ts` (nowy)

**Intent**: Dać e2e prawdziwy błąd nawigacji na serwerze bez kodu testowego w produkcji.

**Contract**:
- `environment` dostaje pole `e2eRoutes: boolean`: `false` w `environment.ts` i `environment.development.ts`, `true` w `environment.e2e.ts` (z `apiUrl: 'http://localhost:3000'`).
- Konfiguracja `e2e` w `angular.json` podmienia `environment.ts` na `environment.e2e.ts`.
- `e2e-routes.ts` eksportuje trasę `e2e/navigation-error` z `canActivate: [() => { throw new Error('e2e navigation error'); }]` i dowolnym lekkim komponentem.
- `app.routes.ts` dokłada ją tylko przy `environment.e2eRoutes`. `app.routes.server.ts` dokłada wtedy wpis `RenderMode.Server` przed `'**'`, żeby prerender w buildzie jej nie renderował.

#### 4. Testy `http`

**Files**: `frontend-subtracker/e2e/http/ssr-errors.e2e-spec.ts` (nowy); `e2e/http/render-modes.e2e-spec.ts`

**Intent**: Dowód na zbudowanym serwerze: status, treść i linia logu. Dowód, że trasy nie ma w produkcji.

**Contract**:
- `ssr-errors.e2e-spec.ts` uruchamia `node dist/frontend-subtracker-e2e/server/server.mjs` jako proces potomny (`PORT=4100`, `NO_COLOR=1`) i zbiera stdout i stderr. Czeka na `/privacy-policy`.
- Sprawdza, że `GET /e2e/navigation-error?q=secret`:
  - daje 500;
  - zwraca HTML z tekstem strony `/unavailable`;
  - zostawia w stderr dokładnie jedną linię `ERROR [Navigation] GET /e2e/navigation-error Error: e2e navigation error`, bez `secret`;
  - zostawia linię access logu `GET /e2e/navigation-error 500`.
- Na koniec zatrzymuje proces.
- `render-modes.e2e-spec.ts` dostaje asercję, że `dist/frontend-subtracker/prerendered-routes.json` i `dist/frontend-subtracker/server` (build produkcyjny) nie zawierają `e2e/navigation-error`. Gdy w CI jest tylko build e2e, sprawdzamy źródło: `environment.ts` ma `e2eRoutes: false`. Implementujący wybiera wariant, który da się uruchomić w jobie `browser-e2e` (ADAPT).

### Success Criteria:

#### Automated Verification:

- Testy frontu: `cd frontend-subtracker && npm run test:ci`
- Build produkcyjny i e2e: `cd frontend-subtracker && npm run build && npm run build:e2e`
- Typy e2e: `cd frontend-subtracker && npm run typecheck:e2e`
- Playwright: `cd frontend-subtracker && npm run e2e`
- Kontrola uszkodzenia: bez `status = 500` w handlerze test `ssr-errors` jest czerwony

#### Manual Verification:

- Lokalnie na buildzie e2e: `curl -i localhost:4000/e2e/navigation-error` pokazuje 500 i stronę „niedostępne”, a w konsoli serwera jest jedna czerwona linia `ERROR [Navigation]`.
- Na buildzie produkcyjnym `/e2e/navigation-error` daje dotychczasowe 404.

**Implementation Note**: Po zielonych bramkach zatrzymaj się na ręczne potwierdzenie przed fazą 3.

---

## Phase 3: Przeładowanie po nieaktualnym pliku i dokumentacja

### Overview

Po wdrożeniu kliknięcie w trasę, której plik zniknął, przeładowuje stronę na adres docelowy. Najwyżej jedno przeładowanie na adres w ciągu 60 s, potem `/unavailable`.

### Changes Required:

#### 1. Rozpoznanie błędu modułu i ochrona przed pętlą

**File**: `frontend-subtracker/src/app/shared/chunk-reload.ts` (+ spec)

**Intent**: Czyste decyzje testowane Vitestem, bez dotykania `window` w logice.

**Contract**:
- `isChunkLoadError(error: unknown): boolean`: `TypeError` z komunikatem zawierającym `dynamically imported module` (Chrome, Edge, Firefox) albo `Importing a module script failed` (Safari).
- `shouldReload(storage: Pick<Storage, 'getItem' | 'setItem'> | null, url: string, now: number): boolean`. Klucz `subtracker.chunk-reload` z JSON `{ url, at }`. Zwraca `false`, gdy magazyn jest `null` albo rzuca wyjątek, gdy ten sam `url` przeładowano < 60 000 ms temu, lub gdy wpis jest uszkodzony i nie da się zapisać nowego. W przeciwnym razie zapisuje `{ url, at: now }` i zwraca `true`.
- Testy (`it.each`):
  - pierwszy raz daje `true`;
  - ten sam adres po 59 s daje `false`;
  - po 61 s daje `true`;
  - inny adres daje `true`;
  - `setItem` rzucający wyjątek daje `false`;
  - śmieci w kluczu dają `true` i nadpisanie wpisu;
  - komunikaty trzech przeglądarek są rozpoznane, a zwykły `TypeError` nie.

#### 2. Gałąź przeglądarkowa handlera

**File**: `frontend-subtracker/src/app/navigation-error-handler.ts` (+ spec)

**Intent**: Nieaktualny plik po wdrożeniu przeładowuje stronę. Drugi błąd w oknie 60 s nie wpada w pętlę, tylko trafia do reportera i pokazuje `/unavailable`.

**Contract**: W przeglądarce, gdy `isChunkLoadError(error.error)`:
- `shouldReload(sessionStorageOrNull(), error.url, Date.now())` daje `true` → `inject(DOCUMENT).location.assign(error.url)` i zwrócenie `false`;
- w przeciwnym razie `report('ChunkLoad', error.error)` i `RedirectCommand` na `/unavailable` ze `skipLocationChange`.

Inne błędy w przeglądarce: brak zmian, błąd jest rzucany ponownie i trafia do domyślnego `ErrorHandler`. `sessionStorageOrNull()` czyta `window.sessionStorage` w `try/catch`. Spec: `DOCUMENT` z fałszywym `location`, `PLATFORM_ID: 'browser'`.

#### 3. Test e2e w przeglądarce

**File**: `frontend-subtracker/e2e/browser/stale-chunk.e2e-spec.ts` (nowy)

**Intent**: Dowód na prawdziwej przeglądarce i buildzie produkcyjnym.

**Contract**: Strona publiczna (np. `/privacy-policy`) z linkiem do trasy leniwej (np. `/sign-in`). Najpierw ustalamy, które `chunk-*.js` strona już pobrała, potem `page.route(/\/chunk-[^/]+\.js$/, …)` odpowiada 404 dla nowych chunków.
- Test 1: 404 tylko przy pierwszym żądaniu, potem przepuszczamy. Klik w link daje jedno pełne załadowanie (`page.waitForEvent('load')`), adres trasy docelowej i działającą stronę.
- Test 2: 404 zawsze. Klik daje jedno przeładowanie, a potem tekst `/unavailable` przy adresie docelowym i brak drugiego `load` w ciągu kilku sekund.

Jeśli `/privacy-policy` nie ma linku do trasy leniwej, implementujący wybiera inną parę publicznych tras (ADAPT).

#### 4. Dokumentacja i follow-up

**Files**: `CLAUDE.md` (sekcja Architecture, frontend), `context/foundation/test-plan.md` (§6.2 albo §6.5), `context/changes/client-and-ssr-error-visibility/follow-ups/s5-s6-messages.md` (nowy)

**Intent**: Następny slice wie, jak zapisywać nieznane błędy i jak testować błędy SSR. Ulepszenia S5 i S6 są zapisane jako follow-up.

**Contract**:
- `CLAUDE.md`:
  - nieznany błąd w gałęzi `error:` woła `ErrorReporter.report`, a rozpoznane statusy nie;
  - na serwerze reporter pisze linię `ERROR` w formacie S-14;
  - błąd nawigacji SSR daje 500 i `/unavailable`;
  - nieaktualny plik po wdrożeniu przeładowuje stronę raz na 60 s;
  - błędy nie trafiają do API (OQ #2).
- `test-plan.md`: wzorzec spy na `ErrorReporter`, trasa testowa w `environment.e2e.ts` i własny proces `server.mjs` w teście, gdy test potrzebuje stdout.
- Follow-up: S5 (400 przy tworzeniu kategorii ma osobny komunikat) i S6 (znak nieaktualnych sum), z lokalizacjami z researchu.

### Success Criteria:

#### Automated Verification:

- Testy frontu: `cd frontend-subtracker && npm run test:ci`
- Build produkcyjny i e2e: `cd frontend-subtracker && npm run build && npm run build:e2e`
- Typy e2e: `cd frontend-subtracker && npm run typecheck:e2e`
- Playwright: `cd frontend-subtracker && npm run e2e`
- Kontrola uszkodzenia: `shouldReload` zawsze `true` → czerwony test 2 w `stale-chunk`

#### Manual Verification:

- Po wdrożeniu na produkcję: karta otwarta przed deployem, po deployu klik w inną stronę → jedno przeładowanie i strona działa; w `out.log` frontu `GET /chunk-… 404`.
- W konsoli przeglądarki brak pętli przeładowań przy wyłączonym serwerze frontu.

---

## Odstępstwa po impl-review

Kontrakty faz 2 i 3 powyżej opisują pierwotny projekt. Po przeglądzie (`reviews/impl-review.md`; pierwszy raport z F1–F7 w historii git tego pliku) kod różni się w tych miejscach, a CLAUDE.md i `test-plan.md` opisują stan obecny:

- **F1 (c8e7687)** — middleware błędów przy wysłanych nagłówkach woła `res.destroy()`, nie `res.end()`: ucięta strona nie wygląda jak kompletna. Access log pokazuje wtedy `aborted`.
- **F2 (c8e7687)** — linie `ERROR [Render]` są pisane zawsze, także bez `listening`; warunkowy zostaje tylko access log.
- **F3 (c8e7687 i drugi przegląd)** — `renderErrorLines` zawsze bierze stos od pierwszej ramki `    at `, więc komunikat (także zmieniony po utworzeniu błędu) nie wraca do logu w całości.
- **F4 (c8e7687 i drugi przegląd)** — `shouldReload` trzyma w kluczu `subtracker.chunk-reload` mapę ścieżka → czas (najwyżej 10 wpisów, starsze niż 60 s usuwane), nie jeden wpis `{ url, at }`: każdy adres ma własne okno, także przy przekierowaniu A → B → A. Kluczem jest sama ścieżka, bez query i fragmentu.
- **F5–F6 (c8e7687 i drugi przegląd)** — `ssr-errors.e2e-spec.ts` daje procesowi potomnemu tylko potrzebne zmienne środowiska i czeka na linię `Started … on port 4100`, a nie na `/privacy-policy`; linie stdout i stderr sprawdza przez `expect.poll`.
- **F7 (c8e7687 i drugi przegląd)** — nie ma flagi `e2eRoutes`. Trasa testowa jest w `src/app/e2e-routes.e2e.ts`, a konfiguracja `e2e` w `angular.json` podmienia nim pusty `e2e-routes.ts` (`fileReplacements`); `environment.development.ts` się nie zmienia. `render-modes.e2e-spec.ts` sprawdza, że `e2e-routes.ts` jest pusty i że żadna inna konfiguracja go nie podmienia.

## Testing Strategy

### Unit Tests:

- `describeError`: statusy, wycięte query, znaki sterujące, ucięcie, nietypowe wartości.
- `ServerErrorReporter`: format linii S-14 z `REQUEST` i bez żądania.
- `renderErrorLines`: pierwsza linia, stos, `AbortError` → `null`, ścieżka bez query.
- `handleNavigationError`: serwer (500 + przekierowanie + raport) i przeglądarka (przeładowanie, druga próba → `/unavailable`, inny błąd → ponowne rzucenie).
- `shouldReload` i `isChunkLoadError`: tabela przypadków.
- Każde wpięte miejsce: raport przy nieznanym błędzie, cisza przy rozpoznanym statusie.

### Integration Tests:

- `http`: `ssr-errors.e2e-spec.ts` (status, treść, linia `ERROR` i access log, bez query).
- `http`: trasa testowa nieobecna w produkcji (`render-modes`).
- `chromium`: `stale-chunk.e2e-spec.ts` (jedno przeładowanie, brak pętli).
- Istniejące e2e komunikatów zostają zielone bez zmian.

### Manual Testing Steps:

1. `npm start` z zatrzymanym API: komunikaty jak dawniej, w konsoli linie `[Kontekst] HTTP 0 …`.
2. Build e2e: `curl -i localhost:4000/e2e/navigation-error` daje 500, stronę „niedostępne” i linię `ERROR`.
3. Produkcja po wdrożeniu: stara karta, klik → jedno przeładowanie.

## Performance Considerations

Reporter działa tylko w gałęziach błędu. `sessionStorage` jest czytany tylko przy błędzie nawigacji. Nie ma wpływu na zwykłe żądania.

## Migration Notes

Bez migracji danych. Po wdrożeniu pierwsza zmiana z przeładowaniem działa dopiero od następnego deployu: przy wdrożeniu S-15 karty otwarte wcześniej mają stary kod bez handlera.

## References

- Research: `context/changes/client-and-ssr-error-visibility/research.md`
- Audyt: `context/audits/observability/2026-11-22_sign-in-subscriptions-jobs-account-admin.md` (L4–A9, P7, P8)
- S-14 F8: `context/archive/2026-11-24-log-format-version-and-access-log/reviews/impl-review.md:114-122`
- Wzorzec przekierowania: `frontend-subtracker/src/app/auth/auth.guard.ts:80-81`
- Format logu: `frontend-subtracker/src/server-log.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Reporter błędów i nieoczekiwane gałęzie

#### Automated

- [x] 1.1 Testy frontu w obu strefach — 5c2de6e
- [x] 1.2 Build produkcyjny — 5c2de6e
- [x] 1.3 Bundel przeglądarki bez kodu logu serwera — 5c2de6e
- [x] 1.4 Kontrola uszkodzenia: usunięte wywołanie report w sign-in.ts daje czerwony test SignIn — 5c2de6e

#### Manual

- [x] 1.5 Lokalnie z zatrzymanym API: dotychczasowe komunikaty i po jednej linii w konsoli przeglądarki — 5c2de6e

### Phase 2: Błąd nawigacji SSR i middleware błędów

#### Automated

- [x] 2.1 Testy frontu — 2d2b96d
- [x] 2.2 Build produkcyjny i e2e — 2d2b96d
- [x] 2.3 Typy e2e — 2d2b96d
- [x] 2.4 Playwright — 2d2b96d
- [x] 2.5 Kontrola uszkodzenia: bez status = 500 w handlerze test ssr-errors jest czerwony — 2d2b96d

#### Manual

- [x] 2.6 Lokalnie na buildzie e2e: 500, strona „niedostępne” i jedna linia ERROR [Navigation] — 2d2b96d
- [x] 2.7 Na buildzie produkcyjnym /e2e/navigation-error daje dotychczasowe 404 — 2d2b96d

### Phase 3: Przeładowanie po nieaktualnym pliku i dokumentacja

#### Automated

- [x] 3.1 Testy frontu — a7dc64b
- [x] 3.2 Build produkcyjny i e2e — a7dc64b
- [x] 3.3 Typy e2e — a7dc64b
- [x] 3.4 Playwright — a7dc64b
- [x] 3.5 Kontrola uszkodzenia: shouldReload zawsze true daje czerwony test 2 w stale-chunk — a7dc64b

#### Manual

- [x] 3.6 Po wdrożeniu na produkcję: stara karta, klik w inną stronę, jedno przeładowanie i działająca strona — a7dc64b
- [x] 3.7 Brak pętli przeładowań przy wyłączonym serwerze frontu — a7dc64b
