# Rejestracja i logowanie magic linkiem — Implementation Plan

## Overview

S-01 to pierwszy slice użytkowy SubTrackera. Użytkownik rejestruje się adresem e-mail i zgodami, potwierdza skrzynkę jednorazowym linkiem, loguje się na sesję w bazie i widzi swoją pustą listę subskrypcji. Link logowania dostają wyłącznie zarejestrowani użytkownicy. Slice wprowadza też bezpieczne domyślnie guardy, role i moduł maili, z których korzystają kolejne slice'y.

## Current State Analysis

- Backend ma tylko `GET /` i `GET /health`, bez encji domenowych, modułów funkcji, `ValidationPipe` i guardów. Jedyna migracja to `Init`.
- Klucze `SMTP_*` i `NOTIFICATION_*` są udokumentowane w `.env.example`, ale `validateEnv` ich nie czyta.
- Frontend nie ma tras (`app.routes.ts` jest puste), `app.html` na stałe pokazuje stronę główną z tymczasowym `ApiStatus`, a `app.routes.server.ts` prerenderuje wszystko.
- Wzorce guardów, ról, sesji i maili są opisane w `context/foundation/backend-patterns.md`. Ten plan stosuje je, z wyjątkami wymienionymi w tabeli decyzji w `plan-brief.md`.
- Deploy na MyDevil zatrzymuje API, robi kopię bazy, uruchamia migracje przez `node_modules/typeorm/cli.js` z płaskiego pakietu `.mydevil/`, a potem sprawdza `/health`.

## Desired End State

Na produkcji:

- Nowa osoba wypełnia `/rejestracja` (e-mail, oświadczenie 18+, akceptacja polityki), dostaje jeden mail, klika w nim link, potem „Zaloguj” na stronie potwierdzenia i trafia na `/subskrypcje` z pustą listą.
- Zarejestrowana osoba wpisuje adres na `/logowanie` i dostaje link ważny 15 minut, działający raz. Nowy link unieważnia poprzednie.
- Sesja wygasa po stałych 30 dniach, a wylogowanie unieważnia ją natychmiast.
- Niezalogowany dostaje `401` z każdej trasy API oprócz `@Public()`, a `/subskrypcje` przekierowuje go na `/logowanie`.
- Odpowiedzi API i komunikaty nie ujawniają, czy adres ma konto.
- Nieudana wysyłka maila jest zapisana w tabeli `mail` i wywołuje powiadomienie do operatora.

Weryfikacja: testy backendu z tego planu przechodzą, a na produkcji przechodzi test ręczny z fazy 5.

### Key Discoveries:

- `validateEnv` obsługuje też CLI migracji (`backend-subtracker/src/database/data-source.ts:15`), a `deploy.sh:141` uruchamia je z `shared/.env`. Brak wymaganego klucza zatrzyma więc deploy już na kroku migracji.
- `database.options.spec.ts:14` buduje środowisko PROD przez `validateEnv`, więc nowe klucze wymagane w PROD wymagają aktualizacji tego testu.
- `DATABASE_AUTO_SYNCHRONIZATION` buduje schemat bazy dev z encji, ale nie uruchamia migracji (`database.options.ts:45`). Baza dev nie dostanie więc seedu ról z migracji.
- `prepare-mydevil.mjs` spłaszcza `dist/` do korzenia pakietu, więc na serwerze ścieżka to `cli/admin-grant.js`, a nie `dist/cli/admin-grant.js`.
- CLI migracji szuka encji po wzorcu `*.entity.js` (`database.options.ts:58`), więc pliki encji muszą trzymać tę nazwę.
- `health_check` w `deploy.sh:60` woła `/health` bez ciasteczka, a `deploy.sh:174` cofa deploy po niepowodzeniu. Brak `@Public()` na tej trasie cofałby każdy deploy.
- `api-status.ts:12` ma adnotację, że S-01 zastępuje tę tymczasową stronę.

## What We're NOT Doing

- Limitów wysyłki (per adres ani per IP). To decyzja użytkownika na MVP; skutki opisuje plan-brief w Open Risks.
- Pełnego tekstu polityki prywatności. Strona mówi „w przygotowaniu”; tekst powstanie przed publicznym startem, wraz z ponownym zbieraniem zgód, jeśli będzie potrzebne.
- Renderowania tras zalogowanych na serwerze i przekazywania ciasteczka przez SSR. Ciasteczko ma `Domain` nadrzędny, więc taka zmiana będzie możliwa później.
- Encji `Subscription` i endpointu listy (S-02). Pusta lista jest statycznym stanem widoku.
- Paneli i tras `/admin/...` (S-09); powstaje tylko skrypt `admin:grant`.
- Czyszczenia niepotwierdzonych kont, wygasłych tokenów i sesji. Scheduler pojawia się dopiero w S-05.
- Logowania hasłem (FR-003), usuwania konta i anonimizacji danych (pytanie otwarte roadmapy #1). Przyszłe usuwanie konta musi objąć też adresy w tabeli `mail`, bo nie ma ona klucza obcego do `user`.
- Przedłużania sesji aktywnością.
- Runnera testów frontendu. Frontend sprawdzamy buildem i ręcznie.

## Implementation Approach

Najpierw backend, warstwami: konfiguracja i maile, potem encje i guardy, potem przepływ rejestracji i logowania z migracjami. Dopiero potem frontend, a na końcu wdrożenie. Migracje są generowane raz, po ustaleniu wszystkich encji (`lessons.md`).

Wysyłka maila odbywa się po zatwierdzeniu transakcji i bez czekania na SMTP w odpowiedzi HTTP. Dzięki temu zajęty i wolny adres odpowiadają podobnie szybko, a błąd SMTP nie wycofuje założonego konta.

## Critical Implementation Details

- **Seed ról w bazie dev**: migracja danych nie działa na `subtracker-db-dev`. W trybie auto-synchronizacji aplikacja musi przy starcie sama założyć role `USER` i `ADMIN` (idempotentnie). Bez tego rejestracja lokalnie i testy e2e padną na braku roli.
- **Skanery poczty**: `GET` strony potwierdzenia nie może zużywać tokenu. Token zużywa wyłącznie `POST /auth/verify` po kliknięciu „Zaloguj”.
- **Token w URL**: link przenosi token we fragmencie (`/auth/potwierdz#token=...`), a nie w query stringu. Fragment nie trafia do logów proxy ani nagłówka `Referer`.
- **Kolejność zapisów**: mail wychodzi po zatwierdzeniu transakcji tworzącej token. Inaczej link mógłby przyjść, zanim token istnieje, albo dotyczyć wycofanego zapisu.
- **Tajemnice w audycie**: tabela `mail` nie przechowuje treści ani linku. Hash tokenu zostaje tylko w `magic_link_token`.
- **Kolejność guardów**: oba guardy są rejestrowane w tym samym module, uwierzytelnianie przed rolami, bo guard ról czyta `request.user`.

## Phase 1: Konfiguracja i moduł maili

### Overview

Aplikacja waliduje nowe klucze przy starcie i umie wysłać mail z audytem. W DEV bez SMTP treść maila trafia do konsoli.

### Changes Required:

#### 1. Konfiguracja

**File**: `backend-subtracker/src/config/env.ts`, `src/config/env.spec.ts`, `src/database/database.options.spec.ts`, `.env.example`

**Intent**: Dodać klucze maili, adres frontendu i domenę ciasteczka, wymagane w PROD i opcjonalne w DEV, żeby brak konfiguracji wykrywał start, a nie pierwszy użytkownik.

**Contract**: `EnvConfig` i `envFromConfig` dostają:
- `FRONTEND_URL`: wymagany w PROD (bare origin https), w DEV domyślnie `http://localhost:4200`;
- `SESSION_COOKIE_DOMAIN`: wymagany w PROD, w DEV `undefined`;
- `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`: wymagane w PROD, w DEV opcjonalne;
- `SMTP_PORT` (587), `SMTP_SECURE` (false), `SMTP_FROM_NAME` (`SubTracker`);
- `NOTIFICATION_ADMINISTRATOR_MAIL`: wymagany w PROD;
- `NOTIFICATION_SMTP_*`: opcjonalne, puste `NOTIFICATION_SMTP_HOST` oznacza transporter `SMTP_*`, a ustawiony wymaga kompletu pól.

Dopisać nowe klucze do `.env.example` i usunąć adnotację „join this list in S-01” w komentarzu `validateEnv`.

#### 2. Moduł maili

**File**: `backend-subtracker/src/mail/` — `mail.module.ts`, `mail.transport.ts`, `services/mail.service.ts` ze specem, `entities/mail.entity.ts`, `mail.types.ts`; `package.json` (`nodemailer`, `@types/nodemailer`); `src/app.module.ts`

**Intent**: Wprowadzić dwa kanały wysyłki z audytem. Transport jest za tokenem DI, żeby testy e2e mogły podstawić atrapę i przechwycić link.

**Contract**:
- Token DI `MAIL_TRANSPORT` z interfejsem `MailTransport { send(message): Promise<void> }`.
- Encja `mail`: `id` (uuid), `type` (`MailType`: `MAGIC_LINK`, `OPERATOR_ALERT`), `recipient`, `status` (`SENT` | `FAILED`), `error_message` (nullable, maks. 500 znaków), `created_at`, `sent_at` (nullable). Bez treści i tematu.
- `MailService.sendToUser(type, to, content)` i `notifyOperator(content)`: nigdy nie odrzucają promise'a, zawsze zapisują wiersz audytu, a błąd audytu tylko logują.
- Po nieudanej wysyłce do użytkownika: powiadomienie do operatora z `id` i `type` wiersza, bez treści maila i linku, najwyżej raz na 15 minut (licznik w pamięci). Nieudane `OPERATOR_ALERT` tylko się loguje, żeby uniknąć pętli.
- W DEV bez `SMTP_HOST` transport loguje odbiorcę i treść do konsoli i kończy się sukcesem.
- Szablony HTML escapują dane użytkownika.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `npm test` (env: wymagane klucze w PROD i DEV bez SMTP; `MailService`: `SENT`, `FAILED`, powiadomienie z limitem, brak pętli)
- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`

#### Manual Verification:

- Start lokalny bez `SMTP_HOST` działa, a `MODE=PROD` bez `SMTP_HOST` kończy się czytelnym błędem o brakującym kluczu

**Implementation Note**: Po przejściu automatycznych kontroli zatrzymaj się na ręczne potwierdzenie przed kolejną fazą.

---

## Phase 2: Encje, sesje i guardy

### Overview

Każda trasa domyślnie wymaga sesji. Działają `GET /auth/me`, `POST /auth/logout` i nadawanie roli admina skryptem.

### Changes Required:

#### 1. Encje użytkowników i ról

**File**: `backend-subtracker/src/users/` — `entities/user.entity.ts`, `entities/role.entity.ts`, `entities/user-role.entity.ts`, `users.module.ts`, `services/users.service.ts`, `services/roles-seeder.ts`; `src/shared/types/role-code.ts`

**Intent**: Założyć schemat z `backend-patterns.md`, uzupełniony o potwierdzenie adresu i zgody.

**Contract**:
- `user`: `id` (uuid), `email` (varchar 254, unique, zapis znormalizowany: trim + małe litery), `is_active` (domyślnie true), `email_verified_at` (nullable), `consents_accepted_at`, `privacy_policy_version` (varchar 20), `created_at`.
- `role` i `user_role` dokładnie jak we wzorcach; relacje jako `Relation<T>` i `() => Encja`.
- Stałe UUID ról są w jednym module kodu. `RolesSeeder` w `OnApplicationBootstrap` działa tylko przy `isAutoSynchronization(env)` i zakłada role przez `INSERT ... ON CONFLICT DO NOTHING`.

#### 2. Sesje i dekoratory

**File**: `backend-subtracker/src/auth/` — `entities/session.entity.ts`, `services/session.service.ts`, `auth.constants.ts`; `src/shared/decorators/` — `public.decorator.ts`, `roles.decorator.ts`, `current-user.decorator.ts`; `src/shared/types/auth-user.ts`

**Intent**: Sesja w bazie z tokenem w postaci hasha i ciasteczkiem zgodnym z decyzjami.

**Contract**:
- `session`: `id`, `user_id`, `token_hash` (sha256, unique), `created_at`, `expires_at`, `revoked_at`, `user_agent` (nullable).
- Token: `crypto.randomBytes(32)`. Sesja wygasa stałe 30 dni po utworzeniu, bez przedłużania.
- Ciasteczko `subtracker_session`: `httpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` 30 dni, `Secure` tylko w PROD, `Domain` z `SESSION_COOKIE_DOMAIN`. Czyszczenie używa tych samych atrybutów.
- `MAGIC_LINK_TTL` = 15 minut i `SESSION_TTL` = 30 dni jako nazwane stałe.

#### 3. Guardy i walidacja

**File**: `backend-subtracker/src/auth/guards/session-auth.guard.ts` ze specem, `src/shared/guards/roles.guard.ts` ze specem, `src/auth/auth.module.ts`, `src/app.module.ts`, `src/app.controller.ts`, `src/health/health.controller.ts`; `package.json` (`cookie`, `class-validator`, `class-transformer`)

**Intent**: Bezpieczny dostęp domyślny według wzorców, bez przerywania health-checku deployu.

**Contract**:
- Guard sesji odczytuje ciasteczko z nagłówka pakietem `cookie` i szuka sesji po hashu. Sesja wygasła lub unieważniona oraz `is_active = false` dają `401`. Dopina `request.user: AuthUser`, licząc tylko role z `is_active = true`.
- Guard ról: brak metadanych przepuszcza, brak roli daje `403`, nie odpytuje bazy.
- Oba przez `APP_GUARD` w `AuthModule`, w kolejności sesja → role. `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` przez `APP_PIPE`, żeby testy e2e go dziedziczyły.
- `@Public()` na `GET /` i `GET /health`.

#### 4. Endpointy sesji

**File**: `backend-subtracker/src/auth/controllers/auth.controller.ts`

**Intent**: Dać frontendowi odczyt bieżącego użytkownika i wylogowanie.

**Contract**: `GET /auth/me` → `200 { id, email, roles }` z `Cache-Control: no-store`. `POST /auth/logout` → `204`, ustawia `revoked_at` i czyści ciasteczko.

#### 5. Skrypt `admin:grant`

**File**: `backend-subtracker/src/users/grant-admin.ts`, `src/cli/admin-grant.ts`, `package.json`

**Intent**: Nadać rolę `ADMIN` poza aplikacją (PRD: Access Control), bez endpointu.

**Contract**: `npm run admin:grant -- <mail>` = `nest build && node dist/cli/admin-grant.js`. `grant-admin.ts` eksportuje `grantAdmin(dataSource, email)`, idempotentne i bez efektów przy imporcie, więc test e2e może go użyć. `cli/admin-grant.ts` tylko czyta argument, łączy się z bazą i wywołuje tę funkcję. Baza to cel `'app'` bez synchronizacji, czyli `-dev` lokalnie i jedyna baza na serwerze. Nieznany adres daje exit 1 z czytelnym komunikatem.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `npm test` (guard sesji: brak ciasteczka, wygasła, unieważniona, nieaktywny użytkownik, nieaktywna rola; guard ról: bez metadanych, z rolą, bez roli)
- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`
- Test e2e `/health` bez ciasteczka zwraca 200, a `/auth/me` bez ciasteczka 401: `npm run test:e2e`

#### Manual Verification:

- Lokalny start z pustą bazą dev zakłada tabele i obie role

**Implementation Note**: Po przejściu automatycznych kontroli zatrzymaj się na ręczne potwierdzenie przed kolejną fazą.

---

## Phase 3: Rejestracja i magic link

### Overview

Pełny przepływ działa przez API, ma testy e2e i migracje gotowe do deployu.

### Changes Required:

#### 1. Tokeny

**File**: `backend-subtracker/src/auth/entities/magic-link-token.entity.ts`

**Intent**: Jednorazowy token wskazujący zarejestrowanego użytkownika.

**Contract**: `magic_link_token`: `id`, `user_id`, `token_hash` (sha256, unique), `created_at`, `expires_at`, `used_at`.

#### 2. Logika rejestracji i linków

**File**: `backend-subtracker/src/auth/services/auth.service.ts` ze specem, `src/auth/dtos/`, `src/auth/mail-templates.ts`

**Intent**: Wdrożyć zasady ustalone z użytkownikiem bez ujawniania, czy adres ma konto.

**Contract**:
- `register`: nowy adres → w jednej transakcji `user` (ze zgodami i `privacy_policy_version` = stała `0-placeholder`), rola `USER` i token; po commicie wysyłka. Adres istniejący (także po przegranym wyścigu o unique) → ta sama logika co `requestLink`. Jeśli konto ma puste `email_verified_at`, rejestracja najpierw odświeża `consents_accepted_at` i `privacy_policy_version`; konta potwierdzonego nie zmienia.
- `requestLink`: aktywny użytkownik, także niepotwierdzony → nowy token i wysyłka. Nieznany adres lub `is_active = false` → nic się nie dzieje, odpowiedź taka sama.
- Mail do konta z pustym `email_verified_at` mówi dodatkowo, że użycie linku potwierdza oświadczenie 18+ i akceptację polityki. Zgodę złożoną przez osobę bez dostępu do skrzynki potwierdza dopiero właściciel adresu.
- Tylko najnowszy link: wystawienie tokenu blokuje wiersz użytkownika (`FOR UPDATE`), usuwa jego niezużyte tokeny i wstawia nowy.
- `verify`: atomowy `UPDATE ... SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`, potem w tej samej transakcji sprawdzenie `is_active`, ustawienie `email_verified_at` (jeśli puste) i utworzenie sesji. Każda porażka daje ten sam `401`.
- Link: `${FRONTEND_URL}/auth/potwierdz#token=<token>`, z informacją w mailu o ważności 15 minut.
- Wysyłka jest bez `await` w odpowiedzi HTTP, jawnie obsłużona; `MailService` nie odrzuca promise'a.

#### 3. Endpointy

**File**: `backend-subtracker/src/auth/controllers/auth.controller.ts`

**Intent**: Publiczne trasy przepływu, z neutralnymi odpowiedziami.

**Contract** (wszystkie `@Public()`):
- `POST /auth/register` `{ email, confirmedAdult: true, acceptedPrivacyPolicy: true }` → `202` bez treści; błędny e-mail lub brak zgody → `400`.
- `POST /auth/request-link` `{ email }` → `202` bez treści.
- `POST /auth/verify` `{ token }` → `200 { id, email, roles }` i `Set-Cookie`; nieważny token → `401`.

#### 4. Migracje

**File**: `backend-subtracker/src/database/migrations/`

**Intent**: Przenieść schemat na produkcję zgodnie z `lessons.md`.

**Contract**: `npm run migration:generate -- AuthAndMailSchema`, przegląd pliku, potem `npm run migration:create -- SeedRoles` ze stałymi UUID i kodami `USER`, `ADMIN` wpisanymi dosłownie w migracji, `npm run migration:run` na `subtracker-db`, commit razem z kodem.

#### 5. Konfiguracja testów e2e

**File**: `backend-subtracker/vitest.config.e2e.ts`

**Intent**: Pliki e2e uruchamiają `AppModule` i synchronizację na tej samej bazie dev, więc nie mogą działać równolegle.

**Contract**: `fileParallelism: false` w sekcji `test`.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `npm test` (normalizacja adresu, brak wysyłki dla nieznanego i nieaktywnego adresu, usuwanie starszych tokenów)
- Testy e2e przechodzą: `npm run test:e2e`, z atrapą transportu, we wszystkich scenariuszach z fazy 3:
  - rejestracja → token z maila → `verify` → `/auth/me` zwraca użytkownika z rolą `USER`, `email_verified_at` ustawione
  - ponowna rejestracja odświeża zgody konta niepotwierdzonego, a potwierdzonego nie zmienia
  - token użyty drugi raz → 401; token po terminie → 401; starszy token po wydaniu nowego → 401
  - logowanie na nieznany adres i rejestracja na zajęty dają odpowiedź identyczną z sukcesem
  - rejestracja bez zgód → 400; pole spoza DTO → 400
  - po wylogowaniu i po upływie `expires_at` ciasteczko daje 401
  - `grantAdmin` dodaje `ADMIN`, a `/auth/me` to pokazuje
  - ciasteczko ma `HttpOnly` i `SameSite=Lax`
- Wiersz w `mail` po wysyłce nie zawiera tokenu: asercja w teście e2e
- Migracje są zastosowane i brak różnicy względem encji: `npm run migration:show`, a `npm run migration:generate -- Check` kończy się „No changes in database schema were found”
- Lint i build przechodzą: `npm run lint`, `npm run build`

#### Manual Verification:

- Przegląd wygenerowanej migracji: indeksy unique na `email` i `token_hash`, poprawne klucze obce, brak operacji poza zakresem
- Prawdziwy mail lokalnie: z danymi SMTP w `.env` link dociera na Gmaila

**Implementation Note**: Po przejściu automatycznych kontroli zatrzymaj się na ręczne potwierdzenie przed kolejną fazą.

---

## Phase 4: Frontend

### Overview

Użytkownik przechodzi cały przepływ w przeglądarce, a trasy zalogowanych nie są prerenderowane.

### Changes Required:

#### 1. Warstwa auth

**File**: `frontend-subtracker/src/app/auth/` — `auth.service.ts`, `auth.guard.ts`, `credentials.interceptor.ts`; `src/app/app.config.ts`

**Intent**: Jedno miejsce dla wywołań API i ochrony tras.

**Contract**: Serwis ma `register`, `requestLink`, `verify`, `logout`, `me`. Interceptor dodaje `withCredentials` tylko do żądań na `environment.apiUrl`. `authGuard` woła `me`: `401` przekierowuje na `/logowanie`, a błąd sieci lub `5xx` pokazuje komunikat o niedostępności bez przekierowania, bo przestój API przy deployu nie oznacza utraty sesji. `logout` traktuje `401` jak udane wylogowanie.

#### 2. Trasy i strony

**File**: `frontend-subtracker/src/app/app.routes.ts`, `app.routes.server.ts`, `app.html`, `app.ts`, `src/app/pages/` — `home`, `register`, `sign-in`, `privacy-policy`, `verify-link`, `subscriptions`. Usunąć `src/app/api-status/` i wzmiankę o nim w komentarzu `backend-subtracker/src/health/health.controller.ts`.

**Intent**: Zastąpić tymczasową stronę prawdziwym przepływem po polsku.

**Contract**:

| Trasa | Tryb | Zawartość |
| --- | --- | --- |
| `/` | Prerender | Opis i odnośniki do rejestracji i logowania |
| `/rejestracja` | Prerender | E-mail, wymagane oświadczenie 18+, wymagana akceptacja z odnośnikiem do polityki; po wysłaniu neutralny komunikat „sprawdź skrzynkę” |
| `/logowanie` | Prerender | E-mail; po wysłaniu „Jeśli konto istnieje, wysłaliśmy link” i odnośnik do rejestracji |
| `/polityka-prywatnosci` | Prerender | Informacja „w przygotowaniu” |
| `/auth/potwierdz` | Client | Czyta token z fragmentu, nic nie wysyła do kliknięcia „Zaloguj”; po sukcesie przejście na `/subskrypcje` z `replaceUrl`; przy błędzie komunikat i odnośnik do `/logowanie` |
| `/subskrypcje` | Client, `authGuard` | Adres użytkownika, pusty stan listy, „Wyloguj” |

- `app.html` zawiera tylko `<router-outlet />`. Wpis `'**'` → Prerender zostaje ostatni w `serverRoutes`.
- Błąd sieci lub `5xx` pokazuje komunikat o niedostępności, a nie sukces.

### Success Criteria:

#### Automated Verification:

- Build produkcyjny przechodzi: `npm run build`
- Pakiet deployu buduje się: `npm run prepare-mydevil`
- W wyniku buildu jest prerenderowany `index.html` dla `/rejestracja` i `/logowanie`, a nie ma go dla `/subskrypcje` i `/auth/potwierdz`

#### Manual Verification:

- Pełny przepływ lokalnie: rejestracja → link z konsoli → „Zaloguj” → pusta lista
- Samo otwarcie linku bez kliknięcia „Zaloguj” nie zużywa tokenu
- Odświeżenie `/subskrypcje` zachowuje sesję, a wylogowanie przekierowuje przy kolejnym wejściu
- Wejście na `/subskrypcje` bez sesji przekierowuje na `/logowanie`
- Formularz rejestracji nie wysyła się bez obu zgód
- Konsola przeglądarki bez błędów hydratacji
- Przy wyłączonym API odświeżenie `/subskrypcje` pokazuje komunikat o niedostępności, bez przekierowania na `/logowanie`

**Implementation Note**: Po przejściu automatycznych kontroli zatrzymaj się na ręczne potwierdzenie przed kolejną fazą.

---

## Phase 5: Wdrożenie

### Overview

Serwer i dokumentacja są przygotowane, zmiana jest zmergowana i sprawdzona na produkcji. Skrypty `deploy/mydevil/*.sh` nie zmieniają się, więc nie trzeba ich wgrywać.

### Changes Required:

#### 1. Konfiguracja serwera (przed merge'em, wykonuje użytkownik)

**File**: `~/apps/subtracker/api/shared/.env`, lokalny `.env.mydevil`

**Intent**: Bez tych kluczy deploy zatrzyma się na migracjach i wróci do poprzedniej wersji.

**Contract**: Dopisać `FRONTEND_URL=https://subtracker.jakubpietrzykowski.pl`, `SESSION_COOKIE_DOMAIN=.jakubpietrzykowski.pl`, `SMTP_*`, `NOTIFICATION_ADMINISTRATOR_MAIL`. Wartości proste albo w `'...'`, bez powtórzonych kluczy.

#### 2. Dokumentacja

**File**: `context/foundation/backend-patterns.md`, `CLAUDE.md` (sekcja poza blokiem 10x-cli), `deploy/mydevil/README.md`, `context/foundation/roadmap.md`

**Intent**: Żeby kolejne slice'y czytały stan faktyczny.

**Contract**:
- `backend-patterns.md`: `email_verified_at`, zgody, token we fragmencie, seed ról w bazie dev, stałe `SameSite`/`Secure` według `MODE`.
- `CLAUDE.md`: usunąć magic-link auth i rolę admina z „Still planned”.
- `README` deployu: komenda serwerowa `cli/admin-grant.js` uruchamiana z `public_nodejs`, tak jak migracje w `deploy.sh`, oraz nowe klucze env.
- `roadmap.md`: dopisać rejestrację do Outcome S-01 i zapisać rozstrzygnięte Unknowns oraz pytanie otwarte #2.

#### 3. Merge i weryfikacja

**File**: brak zmian w kodzie.

**Intent**: Potwierdzić działanie na produkcji przed `/10x-archive`.

**Contract**: `/10x-impl-review` i triage przed merge'em, potem PR, merge i test ręczny poniżej.

### Success Criteria:

#### Automated Verification:

- CI na PR jest zielone: joby `backend`, `frontend`, `deploy-scripts`
- Deploy API i frontendu na `main` przeszedł, wraz z health-checkiem

#### Manual Verification:

- `/health` zwraca `{"status":"ok","db":"ok"}`, a `/auth/me` bez ciasteczka 401
- Rejestracja na Gmailu działa od wejścia na stronę do pustej listy, w mniej niż 3 minuty
- Ciasteczko w przeglądarce ma `HttpOnly`, `Secure`, `SameSite=Lax`, `Domain=.jakubpietrzykowski.pl`
- Sesja działa po ponownym wejściu na stronę, a wylogowanie ją kończy
- Link dociera na skrzynkę Outlook, a otwarcie go przez skaner nie spala tokenu
- Nagłówki maila pokazują wynik SPF i DKIM dla `jakubpietrzykowski.pl`
- `cli/admin-grant.js` nadaje rolę `ADMIN` na serwerze, a `/auth/me` ją pokazuje
- Powiadomienie o błędzie maila dociera do operatora (test chwilowo złym hasłem SMTP albo lokalnie)

**Implementation Note**: Po przejściu tych kontroli przejdź do `/10x-archive magic-link-sign-in`.

---

## Testing Strategy

### Unit Tests:

- `validateEnv`: klucze wymagane w PROD, opcjonalne w DEV, komplet `NOTIFICATION_SMTP_*`
- `MailService`: audyt `SENT` i `FAILED`, limit powiadomień, brak pętli
- Guardy: wszystkie gałęzie decyzji
- `AuthService`: normalizacja adresu i reguły wysyłki

### Integration Tests:

- `test/auth.e2e-spec.ts`: scenariusze z fazy 3 na lokalnej bazie dev z atrapą transportu, z unikalnymi adresami, żeby kolejne przebiegi się nie zderzały; pliki e2e działają po kolei (`fileParallelism: false`)
- E2E wymagają lokalnego PostgreSQL i nie działają w CI (`app.e2e-spec.ts:10`), więc trzeba je uruchomić lokalnie przed PR

### Manual Testing Steps:

1. Lokalnie: rejestracja, link z konsoli, otwarcie bez kliknięcia, „Zaloguj”, pusta lista, wylogowanie.
2. Dwie prośby o link, potem starszy link: błąd z odnośnikiem do `/logowanie`.
3. Na produkcji: lista kontrolna z fazy 5.

## Performance Considerations

Guard wykonuje jedno zapytanie po indeksowanym `token_hash` na żądanie, co przy małej skali wystarczy, a pula ma 5 połączeń. Wysyłka SMTP nie blokuje odpowiedzi HTTP.

## Migration Notes

Na produkcji są tylko migracje `Init`, nowe tabele są puste. Migracje uruchamia `deploy.sh` po `pg_dump`. Wycofanie: `rollback.sh api`, który przywraca kod i bazę. Po rollbacku konta założone po deployu znikają, co jest akceptowalne na tym etapie.

## References

- Roadmapa: `context/foundation/roadmap.md` (S-01)
- Wymagania: `context/foundation/prd.md` (FR-001, US-01, Access Control)
- Wzorce: `context/foundation/backend-patterns.md`
- Reguły: `context/foundation/lessons.md`
- Deploy: `deploy/mydevil/deploy.sh:133`, `deploy/mydevil/README.md`
- Poprzednia zmiana: `context/archive/2026-10-16-production-database-wiring/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Konfiguracja i moduł maili

#### Automated

- [x] 1.1 Testy jednostkowe przechodzą: `npm test` (env: wymagane klucze w PROD i DEV bez SMTP; `MailService`: `SENT`, `FAILED`, powiadomienie z limitem, brak pętli) — 10883c9
- [x] 1.2 Lint przechodzi: `npm run lint` — 10883c9
- [x] 1.3 Build przechodzi: `npm run build` — 10883c9

#### Manual

- [x] 1.4 Start lokalny bez `SMTP_HOST` działa, a `MODE=PROD` bez `SMTP_HOST` kończy się czytelnym błędem o brakującym kluczu — 10883c9

### Phase 2: Encje, sesje i guardy

#### Automated

- [x] 2.1 Testy jednostkowe przechodzą: `npm test` (guard sesji: brak ciasteczka, wygasła, unieważniona, nieaktywny użytkownik, nieaktywna rola; guard ról: bez metadanych, z rolą, bez roli)
- [x] 2.2 Lint przechodzi: `npm run lint`
- [x] 2.3 Build przechodzi: `npm run build`
- [x] 2.4 Test e2e `/health` bez ciasteczka zwraca 200, a `/auth/me` bez ciasteczka 401: `npm run test:e2e`

#### Manual

- [x] 2.5 Lokalny start z pustą bazą dev zakłada tabele i obie role

### Phase 3: Rejestracja i magic link

#### Automated

- [ ] 3.1 Testy jednostkowe przechodzą: `npm test` (normalizacja adresu, brak wysyłki dla nieznanego i nieaktywnego adresu, usuwanie starszych tokenów)
- [ ] 3.2 Testy e2e przechodzą: `npm run test:e2e`, z atrapą transportu, we wszystkich scenariuszach z fazy 3:
- [ ] 3.3 Wiersz w `mail` po wysyłce nie zawiera tokenu: asercja w teście e2e
- [ ] 3.4 Migracje są zastosowane i brak różnicy względem encji: `npm run migration:show`, a `npm run migration:generate -- Check` kończy się „No changes in database schema were found”
- [ ] 3.5 Lint i build przechodzą: `npm run lint`, `npm run build`

#### Manual

- [ ] 3.6 Przegląd wygenerowanej migracji: indeksy unique na `email` i `token_hash`, poprawne klucze obce, brak operacji poza zakresem
- [ ] 3.7 Prawdziwy mail lokalnie: z danymi SMTP w `.env` link dociera na Gmaila

### Phase 4: Frontend

#### Automated

- [ ] 4.1 Build produkcyjny przechodzi: `npm run build`
- [ ] 4.2 Pakiet deployu buduje się: `npm run prepare-mydevil`
- [ ] 4.3 W wyniku buildu jest prerenderowany `index.html` dla `/rejestracja` i `/logowanie`, a nie ma go dla `/subskrypcje` i `/auth/potwierdz`

#### Manual

- [ ] 4.4 Pełny przepływ lokalnie: rejestracja → link z konsoli → „Zaloguj” → pusta lista
- [ ] 4.5 Samo otwarcie linku bez kliknięcia „Zaloguj” nie zużywa tokenu
- [ ] 4.6 Odświeżenie `/subskrypcje` zachowuje sesję, a wylogowanie przekierowuje przy kolejnym wejściu
- [ ] 4.7 Wejście na `/subskrypcje` bez sesji przekierowuje na `/logowanie`
- [ ] 4.8 Formularz rejestracji nie wysyła się bez obu zgód
- [ ] 4.9 Konsola przeglądarki bez błędów hydratacji
- [ ] 4.10 Przy wyłączonym API odświeżenie `/subskrypcje` pokazuje komunikat o niedostępności, bez przekierowania na `/logowanie`

### Phase 5: Wdrożenie

#### Automated

- [ ] 5.1 CI na PR jest zielone: joby `backend`, `frontend`, `deploy-scripts`
- [ ] 5.2 Deploy API i frontendu na `main` przeszedł, wraz z health-checkiem

#### Manual

- [ ] 5.3 `/health` zwraca `{"status":"ok","db":"ok"}`, a `/auth/me` bez ciasteczka 401
- [ ] 5.4 Rejestracja na Gmailu działa od wejścia na stronę do pustej listy, w mniej niż 3 minuty
- [ ] 5.5 Ciasteczko w przeglądarce ma `HttpOnly`, `Secure`, `SameSite=Lax`, `Domain=.jakubpietrzykowski.pl`
- [ ] 5.6 Sesja działa po ponownym wejściu na stronę, a wylogowanie ją kończy
- [ ] 5.7 Link dociera na skrzynkę Outlook, a otwarcie go przez skaner nie spala tokenu
- [ ] 5.8 Nagłówki maila pokazują wynik SPF i DKIM dla `jakubpietrzykowski.pl`
- [ ] 5.9 `cli/admin-grant.js` nadaje rolę `ADMIN` na serwerze, a `/auth/me` ją pokazuje
- [ ] 5.10 Powiadomienie o błędzie maila dociera do operatora (test chwilowo złym hasłem SMTP albo lokalnie)
