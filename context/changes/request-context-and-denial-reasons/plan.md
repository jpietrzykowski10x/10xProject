# Kontekst żądania i przyczyny odmów w logu API — plan implementacji

## Overview

Gdy na produkcji coś nie działa, z logu API ma dać się odczytać, które żądanie padło, u kogo i dlaczego, bez danych osobowych w pliku. Każda linia błędu 5xx dostaje metodę, szablon trasy, id użytkownika i id żądania. Id żądania wraca też w nagłówku `X-Request-Id`. Wybrane odmowy 4xx zostawiają jedną linię `warn` z kodem przyczyny, identyfikatorami (uuid) i nazwami pól, bez wartości, adresów, tokenów i query, z limitem 10 linii na kod na minutę. Te odmowy to: weryfikacja linku, sesja na trasach chronionych, CSRF/Origin, rola i ranga administratora oraz walidacja. Przy okazji wchodzą trzy poprawki z audytu dotykające tego samego kodu: 5xx `HttpException` z logiem (P12), `@CurrentUser()` bez użytkownika jako 500 (P5) i ważność linku liczona w bazie (L1).

Plan realizuje PRD v2 FR-021 i roadmapę S-13. Zamyka L1 (krytyczne), L7, P2, P5 i P12 z audytu `context/audits/observability/2026-11-22_sign-in-subscriptions-jobs-account-admin.md` oraz częściowo S1, S3, S4, A1, A2 i A4.

## Current State Analysis

- **Jeden punkt dla wszystkich błędów.** Globalny `SafeLoggingExceptionFilter` (`src/shared/filters/safe-logging-exception.filter.ts`, rejestrowany jako `APP_FILTER` w `src/app.module.ts:54`):
  - każdy `HttpException` zwraca bez logu (`:40-43`), także 5xx (P12);
  - inne błędy loguje tylko przy statusie ≥ 500, jako `describeError` (komunikat + kod) i stos pod `LOG_ERROR_STACKS` (`:56-62`);
  - `host` nie trafia do logu, więc linia nie ma trasy, metody, użytkownika ani id żądania (P2).
- **Brak middleware.** W kodzie nie ma middleware, interceptora, `AsyncLocalStorage` ani id żądania. `applyHttpSecurity` (`src/config/http-security.ts:5-16`), wołane przez `main.ts:20` i przez helper e2e (`test/support/e2e-app.ts:246-249`), robi CORS, `enableCsrfProtection` i `useSecurityHeaders`. CORS nie ma `exposedHeaders` (`src/config/cors.ts:3-5`).
- **CSRF.** Nest 12 odrzuca żądanie w globalnym middleware (`node_modules/@nestjs/core/security/http-security-hook.js:31-41`, `adapters/http-adapter.js:241-246`) jako `ForbiddenException` przez `next(err)`, więc trafia ono do globalnego filtra. Przyczynę rozróżniają tylko dwa stałe komunikaty (`security/cross-origin-protection.js:123-127`):
  - „Cross-origin request detected from Sec-Fetch-Site header”;
  - „Cross-origin request detected, and/or browser is out of date: Sec-Fetch-Site is missing, and Origin does not match Host”.
  
  Nest nie daje hooka do odrzucenia.
- **Szablon trasy.** `req.route.path` istnieje tylko dla żądań dopasowanych do trasy (router Express 5, `node_modules/router/index.js:279-282`). Przy CSRF, 404 i błędach body-parsera go nie ma. Komunikat 404 Nesta zawiera surowy URL razem z query.
- **Weryfikacja linku** (`src/auth/services/auth.service.ts:124-181`, w transakcji):
  - jedno zapytanie (`:128-138`) daje to samo 401 dla tokenu nieznanego, zużytego i wygasłego. Pobiera tylko `userId`, id wiersza tokenu nie;
  - dalej 401 przy braku użytkownika (`:147`), 403 `account_blocked` (`:150`) i 401 przy wyścigu zużycia (`:163`);
  - `issueLink` liczy `expiresAt` z `Date.now()` aplikacji (`:243`), a porównania używają `now()` bazy (`:133`, `:158`). Rozjazd zegarów psuje linki, a w logu nic się nie pojawia (L1).
- **Sesja.**
  - `SessionService.authenticate` (`src/auth/services/session.service.ts:86-98`) zwraca `AuthUser | null` w pięciu przypadkach (brak ciasteczka, nieznany hash, `revokedAt`, `expiresAt`, `!user.isActive`, przez `isValid` `:35-41`), bez przyczyny.
  - Korzystają z niego `SessionAuthGuard` (`src/auth/guards/session-auth.guard.ts:30-33`, gołe 401) i publiczne `GET /auth/session` (`src/auth/controllers/auth.controller.ts:70-75`, 200 `{user:null}`).
- **Rola i ranga.**
  - `RolesGuard` (`src/shared/guards/roles.guard.ts:29`) rzuca gołe 403.
  - Odmowa rangi to `ForbiddenException('Cannot manage this account')` w hooku transakcji (`src/admin/services/admin-users.service.ts:185`). W tym miejscu znane są `actor.id`, `locked.id` i `action`. `canManage` (`src/admin/admin-rank.ts:24-29`) zwraca boolean, więc „siebie” i „za niska ranga” trzeba rozróżnić porównaniem id.
- **`@CurrentUser()`** bez `request.user` rzuca 401 (`src/shared/decorators/current-user.decorator.ts:13`). To błąd programisty (P5), a front zamienia go w ciche wylogowanie.
- **Walidacja.** Globalny `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` bez `exceptionFactory` (`src/app.module.ts:46-53`). Body 400 to lista komunikatów z nazwami pól wplecionymi w tekst.
- **Limitu nie ma.** Jedyny podobny kod to wpisana w treść blokada 15 min alarmu operatora (`src/mail/services/mail.service.ts:216-235`). W `src/shared/` nie ma folderów `logging/` ani `rate-limit/`.
- **Wzorce testów logów:**
  - spec filtra: `vi.spyOn(Logger.prototype, 'error')`, host-stub `{ getArgByIndex }` bez requestu (`safe-logging-exception.filter.spec.ts:38-55`);
  - e2e: `test/auth/unexpected-errors.e2e-spec.ts:23-59` sprawdza dokładną linię 500 i brak adresu w logu.

## Desired End State

- Każda odpowiedź API ma nagłówek `X-Request-Id` z UUID nadanym przez API. Przychodzący nagłówek jest ignorowany. CORS go eksponuje.
- Linia błędu 5xx ma postać: `<METODA> <szablon trasy|(unrouted)> user=<uuid|-> req=<uuid>: <komunikat> (code: X)`, ze stosem pod `LOG_ERROR_STACKS`. Dotyczy to także `HttpException` ze statusem ≥ 500. Nigdy nie trafia do niej `originalUrl`, query, body ani nagłówek inny niż `Origin`.
- Wybrane odmowy 4xx zostawiają linię `warn` w kontekście `Denials`: `<kod> <status> <METODA> <trasa> user=<uuid|-> req=<uuid> [<klucz>=<uuid|słowo> …] [fields=a,b]`. Odpowiedzi HTTP pozostają bez zmian.
- **Limit:** każdy kod ma okno 1 minuty i najwyżej 10 linii. Nadmiar jest liczony, a pierwsza linia tego kodu w kolejnym oknie dopisuje `(suppressed N in the previous window)`. Licznik z ostatniego okna kodu, który potem ucichł, może nie zostać wypisany (przyjęte).
- **Kody odmów:**
  - weryfikacja: `link_unknown`, `link_used`, `link_expired`, `link_user_missing`, `link_race`, `link_account_blocked` (z id tokenu, a gdy jest znane, z id użytkownika);
  - sesja (tylko 401 guarda na trasach chronionych): `session_missing`, `session_unknown`, `session_revoked`, `session_expired`, `session_inactive` (z id sesji, gdy jest znane);
  - `csrf_sec_fetch_site` i `csrf_origin` (z `origin=<scheme://host[:port]>` przyciętym do 100 znaków albo `origin=invalid`/`origin=none`);
  - `role_missing` (aktor);
  - `admin_cannot_manage` (aktor, cel, akcja, `why=self|rank`);
  - `validation` (nazwy pól, z kropkami dla zagnieżdżonych; pole spoza DTO tylko w kształcie identyfikatora, reszta jako `unknown=N`).
- `GET /auth/session` z `{user:null}` niczego nie loguje.
- `@CurrentUser()` na trasie bez użytkownika daje 500 z linią w `err.log`.
- Ważność linku liczy baza: `expires_at = now() + interval '<MAGIC_LINK_TTL w sekundach> seconds'`.
- **Weryfikacja:**
  - testy jednostkowe limitera, opisu odmowy i filtra;
  - testy e2e, że każda rodzina odmów daje swój kod, a w żadnej linii nie ma adresu, tokenu ani query;
  - na produkcji: nagłówek w odpowiedzi, linia CSRF z `curl` z obcym `Origin`.

### Key Discoveries:

- CSRF dociera do globalnego filtra, a nie kończy się w middleware. Rozpoznanie po komunikacie to jedyna możliwość (`cross-origin-protection.js:123-127`), więc test e2e pilnuje, że aktualizacja Nesta nie zmieni tekstów bez naszej wiedzy.
- Middleware id żądania musi być zarejestrowane przed `enableCsrfProtection`. `app.use` w `applyHttpSecurity` zachowuje kolejność, a hook bezpieczeństwa rejestruje się w chwili wywołania (`nest-application.js:263-268`).
- `request.user` jest ustawiany dopiero przez guard (`session-auth.guard.ts:35`). Przy odmowie CSRF, 401 guarda i trasach `@Public` linia ma `user=-`.
- Filtr działa po wycofaniu transakcji (`verify`, hook rangi). Logowanie w filtrze, a nie w miejscu rzucenia, nie miesza więc logu z transakcją.

## What We're NOT Doing

- Access log każdego żądania, format logu (JSON, bez kolorów, ISO), wersja wydania w logu i w `/health`. To S-14 (FR-022).
- Raporty błędów z przeglądarki i SSR, odróżnianie 403 rangi od CSRF w komunikatach frontu. To S-15 (FR-023).
- Wiersz `DENIED` w `admin_audit`, ślad audytowy usunięcia konta i wyszukiwań. To S-16 (FR-024).
- Logowanie 404 (nieznana trasa, nieznane id), 409, 400 z `ParseUUIDPipe` i z serwisów (`budget.service.ts:107-109`, `subscriptions.service.ts:243-245`, `account-deletion.service.ts:31-33`), 403 `account_blocked` z `register` i `request-link`, 413 i błędów body-parsera.
- Logowanie odrzuceń sesji na `GET /auth/session` i `POST /auth/logout`.
- Przyjmowanie przychodzącego `X-Request-Id`, przekazywanie id z SSR frontu do API.
- Trwały albo międzyprocesowy limit (tylko pamięć procesu) i alarm z linii odmów.
- Zmiana odpowiedzi HTTP odmów (body, status, nagłówki). Jedyny wyjątek to P5: 401 → 500 w przypadku, który dziś nie występuje.
- Ważność sesji (`session.expires_at` liczy aplikacja i aplikacja porównuje, więc jest spójnie).

## Implementation Approach

Kontekst żądania dopisuje pierwsze middleware (`app.use` na początku `applyHttpSecurity`): nadaje UUID, zapisuje go na żądaniu i ustawia nagłówek. Każde wejście aplikacji (`main.ts` i e2e) dostaje je więc bez zmian w `AppModule`.

Przyczynę odmowy niesie sam wyjątek. Helper w `src/shared/logging/` dopina do `HttpException` opis odmowy (`kod`, para klucz→uuid/słowo, nazwy pól) pod symbolem, więc body i status odpowiedzi się nie zmieniają. Moduły funkcji (`auth/`, `admin/`) ustawiają własne kody, a `shared/` pozostaje liściem bez wiedzy o domenie (`lessons.md`). Filtr jako jedyny pisze linie: 5xx przez `error`, oznaczone odmowy przez `warn` po przejściu przez limiter. CSRF filtr rozpoznaje sam (mechanizm frameworka, nie domena). Walidację oznacza podklasa `ValidationPipe`, która zachowuje domyślne body.

Kolejność faz: najpierw kontekst i 5xx (fundament linii), potem mechanizm odmów z przekrojowymi przyczynami, na końcu przyczyny domenowe auth, które wymagają zmian w serwisach.

## Critical Implementation Details

- **Kolejność middleware:** id żądania musi być nadane, zanim zadziała hook CSRF, czyli `app.use(assignRequestId)` jako pierwsza instrukcja `applyHttpSecurity`, przed `applyCors`. W przeciwnym razie linie CSRF i preflight nie mają `req=`.
- **Kod odmowy przyczepiony do wyjątku przetrwa tylko na tej samej instancji.** `AccountBlockedException` i wyjątki Nesta są przekazywane do filtra bez opakowywania, ale ścieżka `isHttpError` (body-parser) tworzy nowy `HttpException` (`safe-logging-exception.filter.ts:53`). Opisu odmowy szukamy na oryginalnym `exception` przed tą zamianą.
- **Klasyfikacja `verify` po nieudanym zapytaniu biegnie w tej samej transakcji, przed rzuceniem.** Po rzuceniu transakcja się wycofuje, a token sprawdzony bez blokady może się w tym czasie zmienić. Kod jest diagnozą chwili odczytu, a nie gwarancją.

## Phase 1: Kontekst żądania i błędy 5xx

### Overview

Każde żądanie ma UUID w nagłówku `X-Request-Id`, a każda linia 5xx ma metodę, szablon trasy, użytkownika i id żądania. Do tego P12 (5xx `HttpException` z logiem) i P5 (`@CurrentUser()` bez użytkownika jako 500).

### Changes Required:

#### 1. Kontekst żądania

**File**: `backend-subtracker/src/shared/logging/request-context.ts` (nowy) + `request-context.spec.ts`

**Intent**: Jedno miejsce, które nadaje id żądania i z którego filtr składa bezpieczny opis żądania, bez query i bez wartości z klienta.

**Contract**:
- `REQUEST_ID_HEADER = 'X-Request-Id'`.
- `assignRequestId(req, res, next)`: Express middleware, `crypto.randomUUID()`, zapis na żądaniu, nagłówek odpowiedzi. Przychodzący nagłówek jest ignorowany.
- Typ `RequestWithContext` (`requestId?: string`, `user?: AuthUser`) z rozszerzeniem `AuthenticatedRequest` z `shared/types/auth-user.ts` albo obok niego.
- `describeRequest(req): string` daje `<METODA> <req.route?.path ?? '(unrouted)'> user=<req.user?.id ?? '-'> req=<requestId ?? '-'>`. Nigdy nie używa `originalUrl`/`url`.

#### 2. Rejestracja middleware i CORS

**File**: `backend-subtracker/src/config/http-security.ts`, `backend-subtracker/src/config/cors.ts`

**Intent**: Middleware działa przed CORS i CSRF w `main.ts` i we wszystkich e2e, a przeglądarka może odczytać nagłówek.

**Contract**:
- `app.use(assignRequestId)` jako pierwsza instrukcja `applyHttpSecurity`.
- `enableCors({ …, exposedHeaders: [REQUEST_ID_HEADER] })`.

#### 3. Filtr: kontekst w liniach 5xx i P12

**File**: `backend-subtracker/src/shared/filters/safe-logging-exception.filter.ts` + spec

**Intent**: Linia 5xx mówi, które żądanie padło i u kogo. 5xx `HttpException` też jest logowane.

**Contract**:
- Request z `host.switchToHttp().getRequest()` (w specu host-stub rozszerzony o `switchToHttp`).
- Linia `error`: `${describeRequest(req)}: ${describeError(exception)}`, stos pod `LOG_ERROR_STACKS` jak dziś.
- `HttpException` z `getStatus() >= 500` jest logowany przed `super.catch`, a odpowiedź pozostaje bez zmian.
- `describeError` bez zmian.

#### 4. `@CurrentUser()` bez użytkownika (P5)

**File**: `backend-subtracker/src/shared/decorators/current-user.decorator.ts` (+ spec, jeśli go nie ma)

**Intent**: Brak użytkownika na trasie z `@CurrentUser()` to błąd konfiguracji trasy, a nie wylogowanie. Ma dać 500 z linią w logu.

**Contract**: rzuca zwykły `Error('CurrentUser used on a route without a session user')`, nie `HttpException`. Filtr zamienia go w 500 i loguje.

#### 5. Testy e2e kontekstu

**File**: `backend-subtracker/test/auth/unexpected-errors.e2e-spec.ts` (rozszerzenie) albo nowy `test/request-context.e2e-spec.ts`

**Intent**: Dowód na prawdziwej aplikacji, że nagłówek jest, a linia 5xx ma kontekst i nie ma query ani adresu.

**Contract**:
- odpowiedź ma `X-Request-Id` w formacie UUID, różny dla dwóch żądań; przychodzący `X-Request-Id: abc` jest zignorowany;
- istniejący przypadek 500 na `/auth/request-link` daje linię `POST /auth/request-link user=- req=<ten sam uuid co w nagłówku>: awaria bazy (code: 57P01)`;
- 500 na trasie z `:id` i query (`?x=secret`) daje szablon z `:id`, bez `secret`;
- `Access-Control-Expose-Headers` zawiera `X-Request-Id` dla dozwolonego originu.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe `request-context` i filtra (kontekst, P12, brak query) przechodzą: `npx vitest run src/shared`
- Celowe uszkodzenie: `describeRequest` z `originalUrl` zamiast `route.path` czerwieni test „bez query”
- Testy e2e kontekstu przechodzą: `npm run test:e2e`
- Lint i build backendu: `npm run lint && npm run build`

#### Manual Verification:

- Lokalnie `start:dev`: `curl -i localhost:3000/health` ma `X-Request-Id`, a wymuszony 500 ma w logu linię z metodą, szablonem trasy i tym samym id

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 2.

---

## Phase 2: Mechanizm odmów i odmowy przekrojowe

### Overview

Ogólny limiter i opis odmowy na wyjątku. Filtr pisze linię `warn` dla oznaczonych odmów. Przyczyny CSRF, walidacji, braku roli i odmowy rangi admina są oznaczone.

### Changes Required:

#### 1. Limiter z oknem stałym

**File**: `backend-subtracker/src/shared/rate-limit/fixed-window-limiter.ts` (nowy) + spec

**Intent**: Ogólny licznik „najwyżej N na klucz w oknie” bez wiedzy o logach. Jest wielokrotnego użytku, a zegar jest wstrzykiwany do testów.

**Contract**:
- `new FixedWindowLimiter({ limit: number, windowMs: number })`;
- `take(key: string, now: number): { allowed: boolean; suppressedInPreviousWindow: number }`. Okno zaczyna się od pierwszego wywołania klucza; `suppressedInPreviousWindow` > 0 tylko przy pierwszym dozwolonym wywołaniu nowego okna;
- mapa kluczy w pamięci. Klucze to zamknięty zbiór kodów, więc nie rośnie bez granic.

#### 2. Opis odmowy na wyjątku

**File**: `backend-subtracker/src/shared/logging/denial.ts` (nowy) + spec

**Intent**: Moduł oznacza wyjątek przyczyną w miejscu, gdzie ją zna. Filtr ją odczytuje. Body i status odpowiedzi się nie zmieniają.

**Contract**:
- `interface Denial { code: string; ids?: Record<string, string>; fields?: string[] }`. `ids` to tylko uuid albo słowo z zamkniętego zbioru (np. `action=block`, `why=rank`), nigdy dane od klienta.
- `withDenial<T extends HttpException>(exception: T, denial: Denial): T` zapisuje pod `Symbol` i zwraca ten sam obiekt.
- `denialOf(exception: unknown): Denial | undefined`.
- `formatDenial(denial, status, requestDescription): string` daje linię z sekcji Desired End State. Kody i klucze `ids` są ograniczone do `[a-z_]+`, wartości `ids` do `[0-9a-z.:/-]+` (uuid, słowo albo origin), a inne znaki są zastępowane `?` (bariera dla przyszłych pomyłek).

#### 3. Filtr: linia odmowy i CSRF

**File**: `backend-subtracker/src/shared/filters/safe-logging-exception.filter.ts` + spec

**Intent**: Jedno miejsce pisze linie odmów, przez limiter, w kontekście `Denials`.

**Contract**:
- dla `HttpException` < 500: `denial = denialOf(exception) ?? csrfDenial(exception, req)`. Gdy jest i `limiter.take(denial.code, Date.now()).allowed`, `warn` z `formatDenial`, z dopiskiem `(suppressed N in the previous window)`, gdy N > 0. Potem `super.catch` jak dziś.
- `csrfDenial` porównuje `exception.message` z dwoma stałymi Nesta (stałe w pliku z odnośnikiem do `cross-origin-protection.js`) → `csrf_sec_fetch_site` albo `csrf_origin`. `ids.origin` to `new URL(origin).origin` małymi literami (np. `https://app.example.com`), przycięty do 100 znaków, `invalid` przy błędzie parsowania albo `none`, gdy nagłówka brak.

  Origin (obok nazw pól spoza DTO w kształcie identyfikatora, zob. #4) to jedyne dane od klienta w linii. To nazwa strony, a nie dana osobowa, i jest potrzebna do diagnozy złego `CORS_ORIGINS` (audyt A2).
- limiter w filtrze: `limit: 10`, `windowMs: 60_000`. Stałe w pliku filtra albo w `shared/logging/`.

#### 4. Walidacja: nazwy pól

**File**: `backend-subtracker/src/shared/validation/validation-pipe.ts` (nowy) + spec, `backend-subtracker/src/app.module.ts`

**Intent**: 400 walidacji ma w logu nazwy pól (bez wartości i bez tekstów ograniczeń), a body odpowiedzi pozostaje dokładnie takie jak dziś.

**Contract**:
- `class LoggingValidationPipe extends ValidationPipe`, `createExceptionFactory()` opakowuje fabrykę z `super`. Wynik oznacza `withDenial(…, { code: 'validation', fields })`, gdzie `fields` to ścieżki `property` z drzewa `ValidationError` (zagnieżdżone przez kropkę, bez duplikatów, posortowane).
- `APP_PIPE` w `app.module.ts` używa tej klasy z tymi samymi opcjami.
- Pole spoza DTO (`forbidNonWhitelisted`, błąd z kluczem ograniczenia `whitelistValidation`) to klucz JSON wybrany przez klienta, więc może nieść adres albo dowolny tekst. Trafia do `fields` tylko wtedy, gdy pasuje do `^[a-zA-Z][a-zA-Z0-9]{0,39}$` (kształt identyfikatora, bez kropek, `@` i długich ciągów). Pozostałe są liczone i trafiają do linii jako `ids.unknown = '<N>'` (tylko przy N > 0). Nazwy pól z DTO (inne ograniczenia) trafiają do `fields` wprost.

#### 5. Rola i ranga

**File**: `backend-subtracker/src/shared/guards/roles.guard.ts`, `backend-subtracker/src/admin/services/admin-users.service.ts`

**Intent**: Brak roli i odmowa rangi zostawiają linię z aktorem (i celem), bez zmiany odpowiedzi.

**Contract**:
- `RolesGuard`: `withDenial(new ForbiddenException(), { code: 'role_missing', ids: { actor } })`, gdy znany jest `user.id`.
- Hook rangi (`:184-186`): `withDenial(new ForbiddenException(CANNOT_MANAGE_MESSAGE), { code: 'admin_cannot_manage', ids: { actor, target, action, why } })`, gdzie `why = actor.id === locked.id ? 'self' : 'rank'`, a `action` to wartość `AdminAction` w zapisie małymi literami z podkreśleniem.

#### 6. Testy e2e odmów przekrojowych

**File**: `backend-subtracker/test/denials.e2e-spec.ts` (nowy; helpery z `test/support/e2e-app.ts`, `test/admin/admin-e2e.ts`)

**Intent**: Na prawdziwej aplikacji każda rodzina daje swój kod, a linia nie zawiera adresu, tokenu, query ani wartości pól.

**Contract** (spy na `Logger.prototype.warn`):
- POST z obcym `Origin` i `Sec-Fetch-Site: cross-site` daje `csrf_sec_fetch_site` z originem; bez `Sec-Fetch-Site` z niezgodnym `Origin` daje `csrf_origin`. Ten test pilnuje tekstów Nesta;
- rejestracja z błędnym adresem i polem spoza DTO daje `validation` z `fields=…`, a w linii nie ma wpisanego adresu;
- body z kluczem spoza DTO w kształcie adresu (`{"jan.kowalski@example.com": 1, …}`) daje `unknown=1`, a w linii nie ma tego klucza;
- zwykły użytkownik na `GET /admin/users` daje `role_missing` z `actor`;
- admin blokujący admina daje `admin_cannot_manage` z `why=rank`; admin blokujący siebie daje `why=self`;
- każdy przypadek sprawdza jedną linię swojego kodu. Limit (11 odmów → 10 linii, „suppressed N” w następnym oknie) sprawdza wyłącznie test jednostkowy filtra i limitera ze wstrzykniętym czasem, bo filtr żyje przez cały plik e2e i wyczerpany limit wyciszyłby asercje innych testów zależnie od kolejności.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe limitera, `denial`, filtra i pipe'a przechodzą: `npx vitest run src/shared`
- Celowe uszkodzenie: limit 10 → 11 albo wartość pola w `fields` czerwieni test
- Testy e2e odmów przekrojowych przechodzą: `npm run test:e2e`
- Lint i build backendu: `npm run lint && npm run build`

#### Manual Verification:

- Lokalnie: `curl -X POST -H 'Origin: https://evil.example' -H 'Sec-Fetch-Site: cross-site' localhost:3000/auth/logout` daje 403 i jedną linię `csrf_sec_fetch_site` z `origin=https://evil.example`

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 3.

---

## Phase 3: Przyczyny logowania i sesji

### Overview

Nieudana weryfikacja linku i 401 guarda mają rozróżnione przyczyny. Ważność linku liczy baza (L1).

### Changes Required:

#### 1. Weryfikacja linku: klasyfikacja

**File**: `backend-subtracker/src/auth/services/auth.service.ts` (+ stałe kodów w `src/auth/auth.constants.ts` albo obok), testy jednostkowe serwisu, jeśli istnieją

**Intent**: Każda odmowa `verify` mówi, dlaczego się nie udała, z id tokenu. Odpowiedź dla klienta pozostaje ta sama: 401 albo 403 `account_blocked`.

**Contract**:
- pierwsze zapytanie (`:128-138`) wybiera też `id`;
- przy `null` drugie zapytanie po `tokenHash` bez warunków `used_at`/`expires_at` wybiera `id`, `usedAt` i znacznik `expires_at > now()` (raw select) → `link_unknown` (brak wiersza; także link zastąpiony nowszym, bo `issueLink` usuwa stare), `link_used`, `link_expired`, z `ids.token`, gdy wiersz jest. Token zużyty i wygasły to `link_used` (sprawdzane przed wygaśnięciem: zużycie jest faktem, a wygaśnięcie nie ma już znaczenia); przypadek w teście jednostkowym;
- `:147` → `link_user_missing` (`token`, `user`); `:150` → `link_account_blocked` (`token`, `user`); `:163` → `link_race` (`token`, `user`);
- wszystkie przez `withDenial` na tym samym typie wyjątku co dziś.

#### 2. Ważność linku w bazie (L1)

**File**: `backend-subtracker/src/auth/services/auth.service.ts` (`issueLink`, `:240-245`)

**Intent**: Wystawienie i sprawdzenie linku liczą czas tym samym zegarem (bazy).

**Contract**:
- `expiresAt: () => \`now() + interval '${MAGIC_LINK_TTL / 1000} seconds'\`` (stała z kodu, nie dane wejściowe);
- `MAGIC_LINK_TTL` bez zmian. Testy e2e, które postarzają tokeny (`PAST`, `token-rules.e2e-spec.ts`), dalej przechodzą.

#### 3. Sesja: przyczyna odrzucenia

**File**: `backend-subtracker/src/auth/services/session.service.ts`, `backend-subtracker/src/auth/guards/session-auth.guard.ts` (+ spec, jeśli istnieje)

**Intent**: Guard wie, dlaczego sesja została odrzucona. `/auth/session` działa jak dziś.

**Contract**:
- nowa metoda `check(request): { user: AuthUser } | { reason: SessionRejection; sessionId?: string }`, gdzie `SessionRejection = 'session_missing' | 'session_unknown' | 'session_revoked' | 'session_expired' | 'session_inactive'`, w kolejności sprawdzania jak `isValid` (unieważniona przed wygasłą przed nieaktywnym kontem);
- `authenticate` zostaje i zwraca `AuthUser | null` przez `check` (używa go `/auth/session`);
- guard rzuca `withDenial(new UnauthorizedException(), { code: reason, ids: sessionId ? { session: sessionId } : undefined })`.

#### 4. Testy e2e przyczyn auth

**File**: `backend-subtracker/test/auth/denials.e2e-spec.ts` (nowy) albo rozszerzenie `token-rules.e2e-spec.ts` i `session.e2e-spec.ts`

**Intent**: Każda przyczyna z tej fazy daje swój kod, a linia nie zawiera tokenu, hasha, adresu ani ciasteczka.

**Contract** (spy na `Logger.prototype.warn`):
- `link_unknown` (losowy token), `link_used` (drugie użycie), `link_expired` (token postarzony jak w `token-rules`), `link_account_blocked` (zablokowane konto); `link_user_missing` i `link_race` tylko jednostkowo, jeśli e2e wymagałoby wyścigu;
- `session_missing` (bez ciasteczka na `/auth/me`), `session_unknown` (losowe ciasteczko), `session_revoked` (po wylogowaniu), `session_expired` (postarzona sesja), `session_inactive` (zablokowane konto);
- `GET /auth/session` z nieznanym ciasteczkiem: 200 i zero linii `warn`;
- w żadnej linii nie ma wartości tokenu, ciasteczka ani adresu konta;
- link wystawiony przez `request-link` ma `expires_at - created_at` (albo `- now()` bazy) równe 15 min ± 5 s.

### Success Criteria:

#### Automated Verification:

- Testy e2e przyczyn auth przechodzą: `npm run test:e2e`
- Pełne testy backendu przechodzą: `npm test`
- Celowe uszkodzenie: zamiana kolejności `revoked`/`expired` w `check` albo `Date.now()` z powrotem w `issueLink` czerwieni test
- Lint i build backendu: `npm run lint && npm run build`

#### Manual Verification:

- Lokalnie: zużyty link z maila w konsoli daje 401 i jedną linię `link_used` z id tokenu; ponowne wejście na `/subscriptions` po wylogowaniu w innej karcie daje linię `session_revoked`

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 4.

---

## Phase 4: Dokumentacja i produkcja

### Overview

Wzorce i instrukcje opisują nowe linie, a całość jest sprawdzona na produkcji.

### Changes Required:

#### 1. Dokumenty

**File**: `context/foundation/backend-patterns.md`, `CLAUDE.md`

**Intent**: Kolejny slice wie, jak oznaczyć nową odmowę i czego nie wolno wpisać do linii.

**Contract**:
- `backend-patterns.md`, „Ochrona CSRF”: zdanie „Odrzucenia nie są logowane (4xx)” zastąpione opisem linii `csrf_*` z originem;
- nowa sekcja „Logi błędów i odmów”: `X-Request-Id`, kształt linii 5xx, `withDenial` i zasady `ids` (tylko uuid i słowa z zamkniętego zbioru), limit 10/min/kod, lista kodów, czego nie logujemy (404, 409, `/auth/session`), test „bez adresu, tokenu i query” dla każdej nowej odmowy;
- `CLAUDE.md`, Architecture (backend): jedno zdanie o `X-Request-Id`, kontekście linii 5xx i liniach `Denials`.

### Success Criteria:

#### Automated Verification:

- CI zielone na PR (`backend`, `backend-e2e`, `frontend`, `browser-e2e`, `deploy-scripts`)

#### Manual Verification:

- Po deployu API: `curl -i https://<api-domain>/health` ma nagłówek `X-Request-Id`
- Na serwerze: `curl -X POST -H 'Origin: https://evil.example' -H 'Sec-Fetch-Site: cross-site' localhost:<PORT_API>/auth/logout` daje 403, a `out.log` ma jedną linię `csrf_sec_fetch_site` z `origin=https://evil.example`
- Logowanie linkiem na produkcji działa (ważność liczona w bazie), a zużyty link daje linię `link_used`
- Przy tym deployu sprawdzić `watchdog.log` pod kątem linii o pominiętym przebiegu, jeśli cron trafił w okno deployu (F1 z przeglądu S-11)

**Implementation Note**: Po wdrożeniu i ręcznych testach na produkcji zatrzymaj się na potwierdzenie przed `/10x-impl-review` i `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- `FixedWindowLimiter`: 10 dozwolonych, 11. zablokowany, nowe okno z `suppressedInPreviousWindow`, osobne klucze się nie mieszają.
- `denial`: `withDenial` zwraca ten sam obiekt i nie zmienia `getResponse()`, `formatDenial` usuwa znaki spoza dozwolonych.
- `describeRequest`: szablon trasy, `(unrouted)`, `user=-`, brak query.
- Filtr: linia 5xx z kontekstem, 5xx `HttpException` logowany, 4xx bez opisu nielogowany, 4xx z opisem w limicie, CSRF po komunikacie, origin `invalid`/`none`.
- `LoggingValidationPipe`: body identyczne z domyślnym, `fields` z zagnieżdżeniem i polem spoza DTO w kształcie identyfikatora; klucz w kształcie adresu tylko jako `unknown=1`.
- Klasyfikacja `verify`: token zużyty i wygasły daje `link_used`.
- `SessionService.check`: pięć przyczyn i ich kolejność.

### Integration Tests:

- e2e: nagłówek i linia 5xx (faza 1), odmowy przekrojowe (faza 2), przyczyny auth i `/auth/session` bez logu (faza 3). Każda linia jest sprawdzana pod kątem braku adresu, tokenu, ciasteczka i query.

### Manual Testing Steps:

1. Lokalnie: nagłówek, wymuszony 500 z kontekstem, `curl` CSRF z obcym `Origin`.
2. Lokalnie: zużyty link → `link_used`; wylogowanie w innej karcie → `session_revoked`.
3. Produkcja: nagłówek, linia CSRF z serwera, logowanie linkiem.

## Performance Considerations

Middleware dokłada jedno `randomUUID()` i jeden nagłówek na żądanie. Klasyfikacja `verify` to jedno dodatkowe zapytanie po unikalnym `token_hash`, tylko przy nieudanej weryfikacji. Limiter trzyma najwyżej kilkanaście kluczy (zamknięty zbiór kodów).

## Migration Notes

Bez zmian schematu i bez migracji: `magic_link_token.expires_at` istnieje, zmienia się tylko sposób liczenia wartości przy wstawieniu. Linki wydane przed deployem zachowują swoją ważność.

## References

- Roadmapa: `context/foundation/roadmap.md`, S-13; PRD v2: FR-021
- Audyt: `context/audits/observability/2026-11-22_sign-in-subscriptions-jobs-account-admin.md` (L1, L7, P2, P5, P12, S1, S3, S4, A1, A2, A4; §6 pkt 2)
- Filtr: `backend-subtracker/src/shared/filters/safe-logging-exception.filter.ts:40-62`
- Weryfikacja linku: `backend-subtracker/src/auth/services/auth.service.ts:124-181`, `:236-249`
- Sesja: `backend-subtracker/src/auth/services/session.service.ts:35-41`, `:86-98`
- CSRF w Nest 12: `node_modules/@nestjs/core/security/cross-origin-protection.js:123-127, 201-218`
- Wzorzec testu logu: `backend-subtracker/test/auth/unexpected-errors.e2e-spec.ts:23-59`
- Poprzedni slice o podobnym kształcie: `context/archive/2026-11-22-operator-liveness-alerts/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Kontekst żądania i błędy 5xx

#### Automated

- [x] 1.1 Testy jednostkowe `request-context` i filtra (kontekst, P12, brak query)
- [x] 1.2 Celowe uszkodzenie `describeRequest` (`originalUrl`) czerwieni test
- [x] 1.3 Testy e2e kontekstu
- [x] 1.4 Lint i build backendu

#### Manual

- [x] 1.5 Lokalnie nagłówek `X-Request-Id` i linia 5xx z kontekstem

### Phase 2: Mechanizm odmów i odmowy przekrojowe

#### Automated

- [ ] 2.1 Testy jednostkowe limitera, `denial`, filtra i pipe'a
- [ ] 2.2 Celowe uszkodzenie limitu albo `fields` czerwieni test
- [ ] 2.3 Testy e2e odmów przekrojowych
- [ ] 2.4 Lint i build backendu

#### Manual

- [ ] 2.5 Lokalnie `curl` CSRF daje linię `csrf_sec_fetch_site`

### Phase 3: Przyczyny logowania i sesji

#### Automated

- [ ] 3.1 Testy e2e przyczyn auth
- [ ] 3.2 Pełne testy backendu
- [ ] 3.3 Celowe uszkodzenie kolejności w `check` albo `Date.now()` w `issueLink` czerwieni test
- [ ] 3.4 Lint i build backendu

#### Manual

- [ ] 3.5 Lokalnie `link_used` i `session_revoked`

### Phase 4: Dokumentacja i produkcja

#### Automated

- [ ] 4.1 CI zielone na PR

#### Manual

- [ ] 4.2 Po deployu nagłówek `X-Request-Id` na produkcji
- [ ] 4.3 Na serwerze `curl` CSRF daje linię `csrf_sec_fetch_site`
- [ ] 4.4 Logowanie linkiem na produkcji i linia `link_used`
- [ ] 4.5 `watchdog.log` przy deployu (F1 z przeglądu S-11)
