# Krytyczne ścieżki w przeglądarce (etap 4 planu testów) — plan implementacji

## Overview

Etap 4 z `context/foundation/test-plan.md` dla ryzyk #2 (guard SSR/przeglądarka: przekierowania,
cache HTML zależnego od ciasteczka, prerender trasy z guardem) i #1 (dane jednego konta widoczne
dla drugiego w przeglądarce). Dodajemy Playwright w `frontend-subtracker/e2e/` z dwoma projektami:
`http` (żądania do zbudowanego serwera SSR, bez przeglądarki) i `chromium` (3 przejścia guardów
i jeden przepływ dodania ze zmianą konta). Testy biegną na buildzie w nowej konfiguracji `e2e`
(optymalizacja jak w produkcji, API lokalne) i na prawdziwym API z bazą. Nowy job CI `browser-e2e`
wiąże bramkę „required after §3 Phase 4” z §5.

## Current State Analysis

- Na froncie nie ma runnera e2e ani sterownika bazy (`frontend-subtracker/package.json`).
  Testy unit i komponentów biegną przez `ng test` (Vitest, `src/**/*.spec.ts`).
- Render mode: tylko `/` jest `RenderMode.Server` z `Cache-Control: private, no-store`
  (`frontend-subtracker/src/app/app.routes.server.ts:9-11`); `register`, `sign-in`, `auth/verify`,
  `subscriptions` są `Client` (`:16-29`), reszta `Prerender` (`:31-33`). Ostatni build prerenderował
  dokładnie `/privacy-policy` i `/unavailable` (`dist/frontend-subtracker/prerendered-routes.json`).
- Build: `production` (domyślny) woła produkcyjne API (`src/environments/environment.ts:3`);
  `development` podmienia środowisko na `http://localhost:3000`, ale wyłącza optymalizację
  (`angular.json:91-101`). `prepare-mydevil` buduje `production` (`package.json`).
- Macierz decyzji guardów pokrywają unity (`src/app/auth/auth.guard.spec.ts:126-281`), łącznie
  z „API nie odpowiada” po stronie serwera (`:235`). Izolację kont w API pokrywa
  `backend-subtracker/test/subscriptions/account-isolation.e2e-spec.ts:22,44` (job `backend-e2e`).
- Sesja bez maila: wzór `INSERT INTO session` z sha256 tokenu w `dev-local/test-session.mjs:52-62`.
  Skrypty `dev-local/` celowo odmawiają działania, gdy `POSTGRES_DATABASE_DEV == POSTGRES_DATABASE`
  (`dev-local/local-only.mjs:9-10`), czyli w CI — nie da się ich użyć w e2e.
- Rejestracja przez API (`backend-subtracker/src/auth/services/auth.service.ts:47-68`) zawsze
  wysyła link mailem; lokalny `.env` może mieć prawdziwy SMTP, więc e2e nie zakłada kont tą drogą.
  Konto = wiersz `user` + `user_role` z rolą `USER` (`auth.service.ts:145-153`,
  `src/shared/types/role-code.ts:2`).
- CI: `backend-e2e` (`.github/workflows/ci.yml:70-151`) ma Postgresa 16 `C.UTF-8`, migracje i `.env`
  z `CORS_ORIGINS=http://localhost:4200`. API wymaga, by `CORS_ORIGINS` zawierało `FRONTEND_URL`
  (`backend-subtracker/src/config/env.ts:116`). Lokalny `.env` ma dziś `CORS_ORIGINS=http://localhost:4200`.

## Desired End State

- `cd frontend-subtracker && npm run build:e2e && npm run e2e` uruchamia (albo używa już
  działających) serwer SSR na :4000 i API na :3000 i przechodzi oba projekty Playwrighta.
- Projekt `http` dowodzi kontraktu render mode i cache na zbudowanym serwerze; projekt `chromium`
  dowodzi 3 przejść guardów po stronie klienta i przepływu „dodaj → lista z API → inne konto
  w tej samej karcie jej nie widzi”.
- Job `browser-e2e` w `ci.yml` uruchamia to samo na Postgresie `C.UTF-8` ze schematem z migracji.
- `prepare-mydevil` dalej buduje paczkę z produkcyjnym API (build e2e idzie do osobnego katalogu).
- `test-plan.md` §4, §5, §6.5 i §6.6 opisują narzędzie, bramkę i wzorzec dodania testu e2e.

Weryfikacja: polecenia z kryteriów każdej fazy oraz sabotaże opisane przy fazach 2–4.

### Key Discoveries:

- Silnik SSR zamienia `UrlTree` guarda na 302 z nagłówkami trasy, więc przekierowanie zalogowanego
  z `/` też ma `private, no-store` (`node_modules/@angular/ssr/fesm2022/ssr.mjs:1082-1089,1112-1113`).
- Trasy `Client` dostają wspólną powłokę `index.csr.html` bez `ng-server-context` i bez
  uruchamiania guarda (`ssr.mjs:1098-1101`); prerender dzieje się tylko w buildzie
  (`allowStaticRouteRender` domyślnie `false`, `ssr.mjs:977,1065`).
- `/auth/session` jest wyłączone z transfer cache (`src/app/app.config.ts:22`).
- Ciasteczko w DEV: host-only, `secure: false`, `sameSite: lax`
  (`backend-subtracker/src/auth/services/session.service.ts:52-57`); ciasteczka nie zależą od portu,
  więc jedno ciasteczko dla `localhost` trafia do SSR (:4000) i API (:3000).
- Uchwyty widoczne dla użytkownika: nagłówki „Logowanie”, „Twoje subskrypcje”, „Serwis chwilowo
  niedostępny”; przyciski „Dodaj subskrypcję”, „Wyloguj” (dwa w DOM — kolumna i menu telefonu,
  `src/app/layout/app-shell/app-shell.html`); pola formularza po etykietach (`Nazwa`, `Kategoria`,
  `Kwota w PLN`, `Forma płatności`, `Status`, `Następne rozliczenie`).
- Sprzątanie danych testowych po prefiksie adresu i w kolejności z
  `backend-subtracker/test/support/e2e-app.ts:135-147`; domena testowa `@subtracker.test` (`:26`).

## What We're NOT Doing

- Nie powtarzamy macierzy guardów z unitów: „API nie odpowiada” po stronie serwera, „wygasła sesja”
  w przeglądarce i limity czasu zostają w `auth.guard.spec.ts`.
- Nie sprawdzamy pól, walidacji ani komunikatów formularza w e2e (test komponentu, etap 2).
- Nie testujemy izolacji API w przeglądarce w osobnych kontekstach (robi to `backend-e2e`).
- Nie mockujemy `AuthService`, guardów ani serwisów w buildzie; jedyna podmiana to sieć
  (`page.route`) w teście „API niedostępne”.
- Nie dodajemy przeglądarek innych niż Chromium, testów wizualnych, snapshotów ani testów
  mobilnego układu (§7 planu testów).
- Nie sprawdzamy atrybutów `domain` i `secure` ciasteczka (działają tylko w `PROD`).
- Nie zakładamy kont przez `POST /auth/register` (wysyła maila) ani nie ruszamy `dev-local/`.
- Nie ustawiamy branch protection — job ma być „required”, ale oznaczenie w GitHub robi właściciel.
- Brak warstwy AI-native w tym etapie: deterministyczne asercje HTTP i DOM łapią te regresje taniej.

## Implementation Approach

Najpierw szkielet, który daje jedno polecenie do lokalnego i CI biegu (faza 1). Potem testy
w kolejności koszt × sygnał: najtańsze i najsilniejsze dla #2 (HTTP, faza 2), przejścia w
przeglądarce dla #2 (faza 3), przepływ dla #1 (faza 4). Dopiero z zielonym zestawem lokalnie
dodajemy job CI (faza 5) i na końcu dokumentację wzorca (faza 6). Każda faza testowa kończy się
sabotażem w working tree, który musi dać czerwony test.

Wyrocznie pochodzą z kontraktów, nie z kodu: render mode i nagłówki — z §2 planu testów i
decyzji z archiwum `2026-11-10-ui-foundation` (strona startowa `Server` + `no-store`, trasy
zalogowanego klientowe); lista tras prerenderowanych — z §7 planu testów (strony statyczne);
widoczność danych — z PRD (izolacja kont).

## Critical Implementation Details

- **Build e2e nie może nadpisać produkcyjnego `dist/frontend-subtracker/`.** Konfiguracja `e2e`
  ustawia własny `outputPath`, inaczej lokalny `prepare-mydevil` po `build:e2e` mógłby (przy
  kolejności poleceń bez `ng build`) spakować front z `localhost:3000`, a `serve:ssr` wołałby
  lokalne API. Wszystkie ścieżki w testach i `webServer` wskazują katalog e2e.
- **Lokalny `.env` musi wpuszczać origin SSR.** Przeglądarka na :4000 woła API na :3000; bez
  `http://localhost:4000` w `CORS_ORIGINS` CORS i ochrona CSRF odrzucą żądania. Konfiguracja
  Playwrighta sprawdza to na starcie i kończy się czytelnym błędem zamiast 20 czerwonych testów.
- **Asercja „nie widać” potrzebuje kotwicy.** Drugie konto ma własną subskrypcję; test najpierw
  czeka, aż ona jest na liście, dopiero potem sprawdza brak pozycji pierwszego konta — inaczej
  test przejdzie na pustym lub jeszcze ładującym się ekranie.

## Faza 1: Szkielet e2e — Playwright, build e2e, serwery, pomocnik kont

### Overview

Jedno polecenie (`npm run e2e`) uruchamia oba projekty na zbudowanym SSR i prawdziwym API, z
kontami i sesjami tworzonymi w bazie i sprzątanymi po prefiksie. Bez testów ryzyk — tylko
dowód, że infrastruktura działa.

### Changes Required:

#### 1. Zależności i skrypty

**File**: `frontend-subtracker/package.json`, `frontend-subtracker/package-lock.json`

**Intent**: Dodać runner i sterownik bazy jako zależności deweloperskie oraz skrypty budowania
i uruchamiania e2e.

**Contract**: devDependencies `@playwright/test` `~1.65.1` (checked: 2026-11-14, wydany
2026-11-13; 1.65.0 z 2026-11-05) i `pg` `^8.23.1` + `@types/pg`. Skrypty:
`build:e2e` = `ng build --configuration production,e2e`, `e2e` = `playwright test`,
`typecheck:e2e` = `tsc -p tsconfig.e2e.json --noEmit`. `dependencies` bez zmian (paczka MyDevil
instaluje `--omit=dev`).

#### 2. Konfiguracja builda `e2e`

**File**: `frontend-subtracker/angular.json`, `frontend-subtracker/src/environments/environment.ts`

**Intent**: Build „jak produkcja”, ale z lokalnym API i w osobnym katalogu.

**Contract**: `configurations.e2e` zawiera tylko `fileReplacements` (`environment.ts` →
`environment.development.ts`) i `outputPath` `dist/frontend-subtracker-e2e`; łączona z
`production` przez `--configuration production,e2e`. Komentarz w `environment.ts` wymienia oba
buildy, które podmieniają plik. `defaultConfiguration` zostaje `production`.

#### 3. Konfiguracja Playwrighta

**File**: `frontend-subtracker/playwright.config.ts`, `frontend-subtracker/tsconfig.e2e.json`,
`frontend-subtracker/.gitignore`

**Intent**: Dwa projekty na jednym serwerze SSR i jednym API, kolejne pliki po kolei (jedna baza),
ślady przy błędzie.

**Contract**:
- Ładuje `../backend-subtracker/.env` przez `process.loadEnvFile`, gdy plik istnieje (w CI tworzy
  go job). Odmawia startu z czytelnym komunikatem, gdy `MODE !== 'DEV'`, gdy `POSTGRES_HOST` nie
  jest lokalny albo gdy `CORS_ORIGINS` nie zawiera `http://localhost:4000`.
- `testDir: 'e2e'`, `testMatch: '**/*.e2e-spec.ts'` (rozszerzenie inne niż `*.spec.ts`, które
  zbiera `ng test`), `workers: 1`, `fullyParallel: false`, `forbidOnly` w CI, `retries: 0`
  (flaky ma być widoczny), `trace: 'retain-on-failure'`, reporter `list` + `html` (`open: 'never'`).
- `use.baseURL` = `http://localhost:4000`.
- Projekty: `http` (`testDir: 'e2e/http'`, bez `devices`, testy używają tylko fixture `request`)
  i `chromium` (`testDir: 'e2e/browser'`, `devices['Desktop Chrome']`).
- `webServer`: (a) SSR — `node dist/frontend-subtracker-e2e/server/server.mjs`, `PORT=4000`,
  gotowość `http://localhost:4000/privacy-policy`; (b) API — `npm run start:prod` w
  `../backend-subtracker`, gotowość `http://localhost:3000/health`. Oba
  `reuseExistingServer: !process.env.CI` (lokalnie działa też z `start:dev`), timeout 120 s.
- `tsconfig.e2e.json`: obejmuje `e2e/**/*.ts` i `playwright.config.ts`, `strict`, typy `node`.
- `.gitignore`: `/playwright-report`, `/test-results`.

#### 4. Pomocnik kont, sesji i sprzątania

**File**: `frontend-subtracker/e2e/support/accounts.ts`

**Intent**: Konto i sesja bez maila, wygasła sesja dla testu HTTP, sprzątanie wszystkiego, co
zostawił plik testowy. Odpowiednik `test/support/e2e-app.ts` dla testów przeglądarki.

**Contract**:
- `createE2eAccounts({ addressPrefix })` → obiekt z `newAccount()`, `sessionFor(account,
  { expired?: boolean })`, `removeTestData()`, `close()`. Klient `pg` łączy się z bazą aplikacji
  w `MODE=DEV`, czyli `POSTGRES_DATABASE_DEV` (lokalnie `subtracker-db-dev`, w CI jedyna baza).
- `newAccount()` wstawia `user` (adres `<prefiks><czas>-<licznik>@subtracker.test`,
  `email_verified_at` i zgody ustawione, `privacy_policy_version` = bieżąca wersja z backendu —
  odczytać przy implementacji) i `user_role` z rolą `USER` wyszukaną po kodzie; zwraca `{ id, email }`.
- `sessionFor()` wstawia wiersz `session` jak `dev-local/test-session.mjs:52-62` (losowy token
  base64url, w bazie sha256, `user_agent` `e2e-browser`), `expires_at` = `now() + 1 day` albo
  `now() - 1 hour` dla `expired`; zwraca surowy token.
- Stała nazwy ciasteczka `subtracker_session` i pomoc `sessionCookie(token)` w formacie dla
  `context.addCookies` (`domain: 'localhost'`, `path: '/'`, `httpOnly`, `sameSite: 'Lax'`).
- `removeTestData()` usuwa po wzorcu `<prefiks>%@subtracker.test` w kolejności z
  `e2e-app.ts:135-147`: subskrypcje, kategorie, sesje, tokeny linków, role użytkownika,
  użytkownicy. Prefiksy plików zaczynają się od `e2e-browser-` (nie koliduje z prefiksami
  `e2e-<obszar>-` backendu).

#### 5. Test dymny szkieletu

**File**: `frontend-subtracker/e2e/http/smoke.e2e-spec.ts`

**Intent**: Dowód, że serwery wstały z właściwego buildu i że sesja z pomocnika jest ważna dla
API. Zostaje jako szybka diagnoza „to infrastruktura, nie guard”.

**Contract**: `GET /privacy-policy` → 200; `GET http://localhost:3000/auth/session` z ciasteczkiem
z `sessionFor()` → 200 z adresem konta; z wygasłym tokenem → 200 z `user: null`. Sprzątanie w
`afterAll`.

### Success Criteria:

#### Automated Verification:

- `cd frontend-subtracker && npm run build:e2e` kończy się sukcesem i tworzy `dist/frontend-subtracker-e2e/`
- `grep -r "apisubtracker" dist/frontend-subtracker-e2e/browser` nie znajduje adresu produkcyjnego API
- `npm run typecheck:e2e` przechodzi
- `npm run e2e` przechodzi (test dymny w projekcie `http`)
- `npm test -- --watch=false` nie zbiera plików z `e2e/` (liczba testów bez zmian)
- `npm run prepare-mydevil` dalej tworzy `.mydevil/` z produkcyjnym API (`grep -r "apisubtracker" .mydevil/public` znajduje adres)

#### Manual Verification:

- Po teście dymnym w `subtracker-db-dev` nie zostaje żaden użytkownik `e2e-browser-%`
- Lokalny `backend-subtracker/.env` ma `CORS_ORIGINS` z `http://localhost:4000`; bez niego `npm run e2e` kończy się czytelnym komunikatem, a nie serią czerwonych testów

**Implementation Note**: Po fazie i zielonej automatycznej weryfikacji zatrzymaj się na ręczne
potwierdzenie przed kolejną fazą.

---

## Faza 2: Testy HTTP zbudowanego SSR (ryzyko #2)

### Overview

Kontrakt serwera dla HTML zależnego od ciasteczka i dla tras z guardami, sprawdzany zwykłymi
żądaniami do zbudowanego serwera z prawdziwym API.

### Changes Required:

#### 1. Strona startowa per stan sesji

**File**: `frontend-subtracker/e2e/http/start-page.e2e-spec.ts`

**Intent**: Dowód, że `/` jest renderowane per żądanie, nie trafia do cache i że serwer przekazuje
ciasteczko do API.

**Contract** (fixture `request`, `maxRedirects: 0`):
- brak ciasteczka → 200, `Cache-Control` zawiera `private` i `no-store`, HTML zawiera
  `ng-server-context="ssr"`;
- ważna sesja → 302, `Location` kończy się na `/subscriptions`, `Cache-Control` zawiera `private`
  i `no-store`;
- wygasła sesja → 200, `no-store`, HTML zawiera `ng-server-context="ssr"` i nie zawiera ciągu
  `/auth/session` (odpowiedź sesji nie trafiła do stanu transferu).

- **Behavior asserted**: status, przekierowanie i nagłówek cache strony startowej dla trzech stanów ciasteczka.
- **Regression caught**: `/` przeniesione do `Prerender`/`Client` (brak `ng-server-context` albo brak 302), zgubione nagłówki trasy, serwerowy `guestGuard` przestaje przekazywać ciasteczko (ważna sesja daje 200), usunięte wyłączenie `/auth/session` z transfer cache.
- **Research source**: research Summary 1–3, tabela „Macierz serwera”; `app.routes.server.ts:9-11`, `ssr.mjs:1082-1089,1112-1113`, `app.config.ts:22`.
- **Edge/error/boundary**: wygasła sesja (API zwraca `user: null`, nie 401) — granica między „gość” a „zalogowany”; 302 musi mieć ten sam `no-store` co 200.
- **Anti-pattern avoided**: przeglądarka tam, gdzie wystarczy żądanie; „API nie odpowiada” po stronie serwera nie jest powtarzane (unit, `auth.guard.spec.ts:235`).

#### 2. Trasy z guardami jako wspólna powłoka CSR i strażnik prerenderu

**File**: `frontend-subtracker/e2e/http/render-modes.e2e-spec.ts`

**Intent**: Dowód, że żadna trasa z guardem nie ma HTML z serwera ani z prerenderu, a lista tras
prerenderowanych to tylko strony statyczne.

**Contract**:
- Tabela tras `/subscriptions`, `/sign-in`, `/register`, `/auth/verify` × {bez ciasteczka, z ważną
  sesją}: 200, HTML bez `ng-server-context`; wszystkie odpowiedzi mają identyczne ciało (jedna
  powłoka dla każdego).
- `dist/frontend-subtracker-e2e/prerendered-routes.json`: klucze `routes` to dokładnie
  `['/privacy-policy', '/unavailable']` (wyrocznia: §7 planu testów, strony statyczne). Komentarz
  w teście: nowa strona statyczna = świadomy dopisek do tej listy.

- **Behavior asserted**: trasy z guardami zawsze oddają jedną powłokę CSR niezależnie od sesji; prerender obejmuje tylko strony statyczne.
- **Regression caught**: nowa lub istniejąca trasa z guardem pominięta w `app.routes.server.ts` i złapana przez `'**'` (prerender w buildzie bez żądania) — także trasa, której ten test nie wymienia; trasa zalogowanego przeniesiona do `Server` (HTML zależny od ciasteczka bez `no-store`).
- **Research source**: research Summary 2(a), 3; „Tańsza alternatywa dla części render mode”; `ssr.mjs:977,1065,1098-1101`.
- **Edge/error/boundary**: ta sama trasa z sesją i bez sesji musi dać bajt w bajt tę samą odpowiedź.
- **Anti-pattern avoided**: wyrocznia przepisana z `app.routes.server.ts` (lista pochodzi z §7, nie z pliku tras); test „działa w `ng serve`” (biegnie na buildzie).

### Success Criteria:

#### Automated Verification:

- `npx playwright test --project=http` przechodzi
- `npm run typecheck:e2e` przechodzi

#### Manual Verification:

- Sabotaż 1: `''` w `app.routes.server.ts` → `RenderMode.Client`, `build:e2e`, projekt `http` czerwony (strona startowa); cofnięte `git checkout`
- Sabotaż 2: usunięty wpis `subscriptions` z `app.routes.server.ts`, `build:e2e`, strażnik prerenderu czerwony; cofnięte
- Sabotaż 3: usunięte `headers` trasy `''`, `build:e2e`, czerwone asercje `no-store` dla 200 i 302; cofnięte

**Implementation Note**: Po fazie i zielonej automatycznej weryfikacji zatrzymaj się na ręczne
potwierdzenie przed kolejną fazą.

---

## Faza 3: Przejścia guardów w przeglądarce (ryzyko #2)

### Overview

Trzy przejścia, których nie widzi ani unit (prawdziwy router, build i API), ani test HTTP (guard
na trasie `Client` biegnie dopiero w przeglądarce).

### Changes Required:

#### 1. Przejścia guardów

**File**: `frontend-subtracker/e2e/browser/guards.e2e-spec.ts`

**Intent**: Wylogowany nie wchodzi na stronę zalogowanego, niedostępne API nie wylogowuje i nie
gubi adresu, zalogowany nie utknie na stronie publicznej.

**Contract**:
1. Bez ciasteczka `page.goto('/subscriptions')` → adres `/sign-in`, widoczny nagłówek „Logowanie”.
2. Z ważną sesją, `page.route` przerywa (`abort`) żądanie do `http://localhost:3000/auth/session`;
   `page.goto('/subscriptions')` → widoczny nagłówek „Serwis chwilowo niedostępny”, adres nadal
   `/subscriptions`.
3. Z ważną sesją `page.goto('/sign-in')` → adres `/subscriptions`, widoczny nagłówek
   „Twoje subskrypcje”.

Ciasteczko przez `context.addCookies(sessionCookie(token))`; asercje przez `expect(page).toHaveURL`
i `getByRole('heading', { name })` (bez selektorów CSS i bez sprawdzania treści komunikatów).

- **Behavior asserted**: decyzje `authGuard`/`guestGuard` w przeglądarce na zbudowanym froncie z prawdziwym API.
- **Regression caught**: guard trasy zalogowanego zdjęty lub zmieniony cel przekierowania; błąd sieci traktowany jak „brak sesji” (wylogowanie przy awarii API) albo zmiana adresu przy stronie „niedostępne” (utrata `skipLocationChange`); ciasteczko nie jedzie z przeglądarki do API (brak `withCredentials`) — przejście 3 nie dojdzie do listy.
- **Research source**: research „Ryzyko #2 — guardy w przeglądarce” (przejścia 1–3); `auth.guard.ts:65-75`, `credentials.interceptor.ts`.
- **Edge/error/boundary**: przejście 2 — awaria sieci (status 0) zamiast odpowiedzi API; adres musi zostać ten sam, mimo że widać inną stronę.
- **Anti-pattern avoided**: podmiana `AuthService` w buildzie — zastępowana jest tylko sieć; wygasła sesja w przeglądarce nie jest powtarzana (różni się od braku sesji tylko odpowiedzią API, pokrytą unitem i e2e backendu).

### Success Criteria:

#### Automated Verification:

- `npx playwright test --project=chromium e2e/browser/guards.e2e-spec.ts` przechodzi
- `npm run e2e` (oba projekty) przechodzi
- `npm run typecheck:e2e` przechodzi

#### Manual Verification:

- Sabotaż: w `authGuard` gałąź błędu przekierowuje na `/sign-in` zamiast `/unavailable`, `build:e2e`, przejście 2 czerwone; cofnięte
- Sabotaż: `guestGuard` zdjęty z trasy `sign-in` w `app.routes.ts`, `build:e2e`, przejście 3 czerwone; cofnięte
- Ślad Playwrighta (`npx playwright show-trace`) przy celowo czerwonym teście pokazuje kroki i sieć — wzór diagnozy do §6.5

**Implementation Note**: Po fazie i zielonej automatycznej weryfikacji zatrzymaj się na ręczne
potwierdzenie przed kolejną fazą.

---

## Faza 4: Przepływ dodania i zmiana konta w tej samej karcie (ryzyko #1)

### Overview

Główny przepływ produktu end-to-end i jedna asercja izolacji po stronie klienta, której API-owy
test dwóch kont nie widzi.

### Changes Required:

#### 1. Dodanie → lista → inne konto

**File**: `frontend-subtracker/e2e/browser/subscriptions-flow.e2e-spec.ts`

**Intent**: Subskrypcja dodana w UI trafia do API i wraca na listę właściciela; po wylogowaniu
i wejściu drugiego konta w tej samej karcie (te same storage, cache HTTP i kontekst przeglądarki)
nie ma jej na ekranie.

**Contract**:
1. Konto A z sesją; `page.goto('/subscriptions')`; „Dodaj subskrypcję”; wypełnienie wymaganych
   pól po etykietach poprawnymi wartościami (nazwa unikalna z czasem, kwota `12,99`, data
   rozliczenia w przyszłości); „Zapisz”. Wartości nie są przedmiotem asercji.
2. Pozycja z tą nazwą widoczna na liście; `page.reload()` → nadal widoczna (przyszła z API, nie
   z lokalnego stanu formularza).
3. „Wyloguj” (widoczny przycisk) → adres `/sign-in`.
4. Konto B ma wcześniej własną subskrypcję utworzoną przez `request.post('http://localhost:3000/subscriptions')`
   z ciasteczkiem B (kategoria z `GET /categories` B). W tej samej karcie: `addCookies` z sesją B,
   `page.goto('/subscriptions')`.
5. Widoczny adres B w powłoce i pozycja B na liście (kotwica: lista wczytana dla B); dopiero potem
   pozycja A ma liczbę 0.

- **Behavior asserted**: zapis z formularza kończy się trwałą pozycją na liście właściciela; dane A nie przeżywają zmiany konta w tej samej karcie.
- **Regression caught**: formularz nie wysyła albo lista nie odświeża się po zapisie; wpis widoczny tylko lokalnie (znika po przeładowaniu); przyszły cache po stronie klienta (`localStorage`/`sessionStorage`, cache HTTP przy zgubionym `no-store`, service worker) pokazujący listę poprzedniego konta; wylogowanie, które nie unieważnia sesji (krok 3 nie dojdzie do `/sign-in`).
- **Research source**: research Summary 5, „Ryzyko #1 — w przeglądarce”; `subscriptions.ts:166-173`, `auth.service.ts:51`, `app-shell.ts:24`; `account-isolation.e2e-spec.ts:22,44` (co już jest pokryte).
- **Edge/error/boundary**: „nie widać” bez kotwicy przechodzi na pustym/ładującym się ekranie — dlatego B ma własną pozycję i test czeka na nią; przeładowanie oddziela „zapisane” od „pokazane”.
- **Anti-pattern avoided**: osobne konteksty przeglądarki (re-test API); asercje pól, walidacji lub treści komunikatów (test komponentu); test na jednym koncie.

### Success Criteria:

#### Automated Verification:

- `npx playwright test --project=chromium e2e/browser/subscriptions-flow.e2e-spec.ts` przechodzi
- `npm run e2e` (oba projekty) przechodzi trzy razy z rzędu (`npx playwright test --repeat-each=3`)
- `npm run typecheck:e2e` przechodzi

#### Manual Verification:

- Sabotaż: `SubscriptionsService` zapamiętuje listę w `sessionStorage` i zwraca ją przed żądaniem, `build:e2e`, krok 5 czerwony; cofnięte
- Sabotaż: strona po zapisie nie pobiera listy ponownie, `build:e2e`, krok 2 czerwony; cofnięte
- Po biegu w `subtracker-db-dev` nie zostaje żaden użytkownik ani subskrypcja kont `e2e-browser-%`

**Implementation Note**: Po fazie i zielonej automatycznej weryfikacji zatrzymaj się na ręczne
potwierdzenie przed kolejną fazą.

---

## Faza 5: Job CI `browser-e2e`

### Overview

Bramka z §5 („e2e w przeglądarce, required after §3 Phase 4”) jako osobny, nazwany check na
każdym pushu poza `main` i na PR do `main`.

### Changes Required:

#### 1. Nowy job

**File**: `.github/workflows/ci.yml`

**Intent**: Uruchomić `npm run e2e` na zbudowanym froncie (konfiguracja `e2e`) i zbudowanym API,
na Postgresie jak w produkcji, ze schematem z migracji.

**Contract**:
- Job `browser-e2e`, `runs-on: ubuntu-latest`, `timeout-minutes: 20`, serwis `postgres:16` jak w
  `backend-e2e` (`C.UTF-8`, `trust`, healthcheck). Kontrola locale nie jest powtarzana (należy
  do `backend-e2e`).
- `actions/setup-node@v5`, Node 24, cache npm dla obu lockfile'ów (`cache-dependency-path` z
  dwiema ścieżkami).
- `.env` backendu jak w `backend-e2e`, ale `CORS_ORIGINS=http://localhost:4000`,
  `FRONTEND_URL=http://localhost:4000`, `PORT=3000`; komentarz w YAML: origin to serwer SSR,
  nie `ng serve`.
- Kroki: backend `npm ci`, `npm run migration:run`, `npm run build`; frontend `npm ci`,
  `npx playwright install --with-deps chromium`, `npm run build:e2e`, `npm run e2e` z `CI=true`
  (Playwright sam startuje SSR i `start:prod` API).
- Przy błędzie: `actions/upload-artifact` (bieżący major sprawdzony przy implementacji)
  z `frontend-subtracker/playwright-report` i `test-results`, retencja 7 dni.
- Komentarz nad jobem w stylu `backend-e2e`: co sprawdza, dlaczego osobny build, czego nie kopiować
  na maszynę dewelopera (`.env` z jedną bazą).

### Success Criteria:

#### Automated Verification:

- Job `browser-e2e` zielony na pushu gałęzi `change/browser-critical-paths` (`gh run list --branch change/browser-critical-paths`, `gh run view <id>`)
- Pozostałe joby (`backend`, `frontend`, `backend-e2e`, `deploy-scripts`) nadal zielone

#### Manual Verification:

- Sabotaż w CI: tymczasowy commit z sabotażem 1 z fazy 2 daje czerwony `browser-e2e` z raportem w artefaktach; commit cofnięty przed merge
- Właściciel repo oznacza `browser-e2e` jako wymagany check dla `main` (poza zakresem agenta — token tylko do odczytu)

**Implementation Note**: Pushuje użytkownik (memory: brak pushy domyślnie). Po fazie zatrzymaj się
na ręczne potwierdzenie przebiegu CI. Gdy `browser-e2e` przejdzie na zielono (5.1), **wyraźnie
powiadom użytkownika**, że to moment na dodanie `browser-e2e` do wymaganych checków `main`
(GitHub → Settings → Branches / Rulesets) — użytkownik o to prosił; check pojawia się na liście
do wyboru dopiero po pierwszym przebiegu joba.

---

## Faza 6: Plan testów i dokumentacja

### Overview

Zamknięcie pętli: plan testów opisuje narzędzie, bramkę i wzorzec dodania testu e2e, a CLAUDE.md
zna nowe polecenia.

### Changes Required:

#### 1. Plan testów

**File**: `context/foundation/test-plan.md`

**Intent**: Uzupełnić §4, §5, §6.5, §6.6 i §8 o stan po etapie 4.

**Contract**:
- §4: wiersz „e2e (przeglądarka)” → `Playwright (@playwright/test)`, wersja `~1.65.1`, notatka:
  projekty `http` i `chromium`, build `e2e`, sesje w bazie, job `browser-e2e`; `checked: <data
  implementacji>`. Profil bazy testów uzupełniony o e2e. „Runtime/browser” w grounding tools:
  Playwright zamiast „not used”.
- §5: bramka „e2e w przeglądarce” → `CI on PR (job browser-e2e)`, `required`, „Catches”:
  prerender/render mode trasy z guardem, zgubione `no-store`, przekierowania guardów, główny
  przepływ dodania i dane poprzedniego konta po zmianie konta.
- §6.5: wzorzec (Location, Naming `*.e2e-spec.ts` i prefiks `e2e-browser-<temat>-`, wybór projektu
  — `http`, gdy wystarczy status/nagłówek/HTML, `chromium` tylko dla zachowania w przeglądarce;
  konta i sesje przez `e2e/support/accounts.ts`, nigdy przez maila; uchwyty po rolach i etykietach;
  „nie widać” zawsze z kotwicą; podmiana tylko sieci przez `page.route`; Reference tests — cztery
  pliki z faz 2–4; Run locally — warunki `.env` i `build:e2e`, jeden plik, `show-trace`; Sabotage
  check — przebudowa po sabotażu, bo testy biegną na buildzie).
- §6.6: 2–3 linie wniosków z etapu 4.
- §8: „Stack versions last verified” = data implementacji.
- §3 status wiersza 4 zostawiony orkiestratorowi (`/10x-test-plan`).

#### 2. CLAUDE.md i `.env.example`

**File**: `CLAUDE.md`, `backend-subtracker/.env.example`

**Intent**: Nowe polecenia i warunek CORS widoczne dla następnych sesji.

**Contract**: sekcja Commands → Frontend: `npm run build:e2e`, `npm run e2e` (warunki: lokalny
Postgres, `.env` backendu z `http://localhost:4000` w `CORS_ORIGINS`, API na :3000 albo build
backendu), odnośnik do §6.5. `.env.example`: przykład `CORS_ORIGINS` z oboma originami i komentarz,
że :4000 potrzebuje e2e.

### Success Criteria:

#### Automated Verification:

- `grep -n "TBD — see §3 Phase 4" context/foundation/test-plan.md` nic nie znajduje
- `grep -n "browser-e2e" context/foundation/test-plan.md CLAUDE.md` znajduje wpisy w §5, §6.5 i Commands

#### Manual Verification:

- §6.5 pozwala dodać nowy test e2e bez czytania kodu testów (przeczytane okiem przez użytkownika)
- §2 i §3 planu testów bez zmian poza tym, co zrobił orkiestrator

**Implementation Note**: Po fazie zatrzymaj się na ręczne potwierdzenie, potem `/10x-impl-review`
przed `/10x-archive` (memory: review przed archiwizacją).

---

## Testing Strategy

### Unit Tests:

- Bez nowych unitów. Macierz guardów zostaje w `auth.guard.spec.ts` (w tym serwerowe
  „API nie odpowiada” i wygasła sesja w przeglądarce).

### Integration Tests:

- Projekt `http`: strona startowa × {gość, ważna, wygasła sesja}; trasy z guardami × {bez sesji,
  z sesją} jako jedna powłoka CSR; lista tras prerenderowanych.
- Projekt `chromium`: 3 przejścia guardów; przepływ dodania ze zmianą konta w tej samej karcie.

### Manual Testing Steps:

1. Sabotaże z faz 2–4 (każdy: zmiana → `build:e2e` → czerwony test → `git checkout`).
2. Jeden celowo czerwony test w CI z raportem w artefaktach (faza 5).
3. Sprawdzenie, że po biegu w bazie dev nie ma kont `e2e-browser-%`.

## Performance Considerations

Zestaw ma ok. 10 testów; `workers: 1` (jedna baza) wystarcza. Build `e2e` (~1–2 min) nie jest
powtarzany przy każdym biegu lokalnym — testy na starym buildzie to znany koszt tej decyzji,
opisany w §6.5. W CI job trwa szacunkowo 5–8 min (instalacja Chromium + dwa buildy).

## Migration Notes

Bez zmian schematu i bez migracji. Lokalnie jednorazowo: `CORS_ORIGINS` w
`backend-subtracker/.env` rozszerzone o `http://localhost:4000`.

## References

- Research: `context/changes/browser-critical-paths/research.md`
- Plan testów: `context/foundation/test-plan.md` (§2 #1, #2; §3 wiersz 4; §5; §6.5)
- Wzorzec sesji: `dev-local/test-session.mjs:52-62`
- Wzorzec sprzątania: `backend-subtracker/test/support/e2e-app.ts:135-147`
- Wzorzec joba z Postgresem: `.github/workflows/ci.yml:70-151`
- Macierz unit guardów: `frontend-subtracker/src/app/auth/auth.guard.spec.ts:126-281`
- Archiwum: `context/archive/2026-11-10-ui-foundation/plan.md` (render mode strony startowej),
  `context/archive/2026-11-13-backend-e2e-account-isolation/` (job `backend-e2e`, dwa konta w API)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Szkielet e2e — Playwright, build e2e, serwery, pomocnik kont

#### Automated

- [x] 1.1 `npm run build:e2e` kończy się sukcesem i tworzy `dist/frontend-subtracker-e2e/`
- [x] 1.2 Build e2e nie zawiera adresu produkcyjnego API
- [x] 1.3 `npm run typecheck:e2e` przechodzi
- [x] 1.4 `npm run e2e` przechodzi (test dymny w projekcie `http`)
- [x] 1.5 `npm test` nie zbiera plików z `e2e/`
- [x] 1.6 `npm run prepare-mydevil` dalej pakuje produkcyjne API

#### Manual

- [x] 1.7 Po teście dymnym w bazie dev nie zostaje użytkownik `e2e-browser-%`
- [x] 1.8 Brak `http://localhost:4000` w `CORS_ORIGINS` daje czytelny komunikat na starcie

### Phase 2: Testy HTTP zbudowanego SSR (ryzyko #2)

#### Automated

- [ ] 2.1 `npx playwright test --project=http` przechodzi
- [ ] 2.2 `npm run typecheck:e2e` przechodzi

#### Manual

- [ ] 2.3 Sabotaż 1 (strona startowa jako `Client`) daje czerwony test
- [ ] 2.4 Sabotaż 2 (usunięty wpis `subscriptions`) daje czerwony strażnik prerenderu
- [ ] 2.5 Sabotaż 3 (usunięte nagłówki trasy) daje czerwone asercje `no-store`

### Phase 3: Przejścia guardów w przeglądarce (ryzyko #2)

#### Automated

- [ ] 3.1 `guards.e2e-spec.ts` przechodzi w projekcie `chromium`
- [ ] 3.2 `npm run e2e` (oba projekty) przechodzi
- [ ] 3.3 `npm run typecheck:e2e` przechodzi

#### Manual

- [ ] 3.4 Sabotaż gałęzi błędu `authGuard` daje czerwone przejście 2
- [ ] 3.5 Sabotaż zdjętego `guestGuard` z `sign-in` daje czerwone przejście 3
- [ ] 3.6 Ślad Playwrighta czerwonego testu pokazuje kroki i sieć

### Phase 4: Przepływ dodania i zmiana konta w tej samej karcie (ryzyko #1)

#### Automated

- [ ] 4.1 `subscriptions-flow.e2e-spec.ts` przechodzi w projekcie `chromium`
- [ ] 4.2 Cały zestaw przechodzi trzy razy z rzędu (`--repeat-each=3`)
- [ ] 4.3 `npm run typecheck:e2e` przechodzi

#### Manual

- [ ] 4.4 Sabotaż cache listy w `sessionStorage` daje czerwony krok 5
- [ ] 4.5 Sabotaż braku odświeżenia listy po zapisie daje czerwony krok 2
- [ ] 4.6 Po biegu w bazie dev nie zostają dane kont `e2e-browser-%`

### Phase 5: Job CI `browser-e2e`

#### Automated

- [ ] 5.1 Job `browser-e2e` zielony na gałęzi zmiany
- [ ] 5.2 Pozostałe joby CI nadal zielone

#### Manual

- [ ] 5.3 Tymczasowy sabotaż daje czerwony `browser-e2e` z raportem w artefaktach
- [ ] 5.4 Właściciel oznacza `browser-e2e` jako wymagany check dla `main`

### Phase 6: Plan testów i dokumentacja

#### Automated

- [ ] 6.1 W planie testów nie zostaje „TBD — see §3 Phase 4”
- [ ] 6.2 `browser-e2e` opisany w §5, §6.5 i w Commands CLAUDE.md

#### Manual

- [ ] 6.3 §6.5 wystarcza do dodania nowego testu e2e bez czytania kodu testów
- [ ] 6.4 §2 i §3 planu testów bez zmian poza orkiestratorem
