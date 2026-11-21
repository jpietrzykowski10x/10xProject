# Zarządzanie kontami przez administratora (S-09) — plan implementacji

## Overview

Administrator (rola `ADMIN`, nadawana skryptem) dostaje panel `/admin/users`. Może tam:

- wyszukać konto po fragmencie adresu albo wyświetlić same zablokowane;
- obejrzeć wszystkie dane konta (profil, subskrypcje, sumy, ustawienia budżetu), wyłącznie do odczytu;
- zablokować i odblokować konto oraz zrobić „wyloguj wszędzie”.

Każda akcja i każdy podgląd danych konkretnego konta zapisuje się w audycie. Nowa rola `SUPER_ADMIN` (jedna osoba, tylko skryptem; pilnują tego skrypt i indeks w bazie) może to samo, a do tego zarządza adminami. Nikt nie zarządza samym sobą ani superadminem.

Zablokowany użytkownik:

- dostaje maila o blokadzie;
- przy logowaniu i rejestracji widzi komunikat „konto zablokowane” z adresem kontaktowym (`SUPPORT_EMAIL`);
- jest pomijany przez joby i maile, z wyjątkiem maili o dostępie do konta.

Odblokowanie i „wyloguj wszędzie” też wysyłają mail.

## Current State Analysis

Pełny stan z kotwicami: `research.md` (sekcje 1–8 i Follow-up 2026-11-21). Najważniejsze:

- **Role:** `RolesGuard` i `@Roles()` istnieją, ale żadna trasa ich nie używa (`backend-subtracker/src/shared/guards/roles.guard.ts:14-33`). `RoleCode` ma wartości `USER` i `ADMIN` (`src/shared/types/role-code.ts:1-19`). Rolę nadaje tylko `npm run admin:grant` (`src/users/grant-admin.ts:9-35`, `src/cli/admin-grant.ts`).
- **`user.is_active`:** czytają go `isValid` (`session.service.ts:35-41`), `lockActiveUser` (`auth.service.ts:157-166`), `verify` (`auth.service.ts:100-106`) i job przypomnień (`trial-reminder.service.ts:58-60`). Nic w `src/` nie ustawia go na `false`. Blokada nie unieważnia sesji ani nie usuwa tokenów.
- **`verify`:** blokuje najpierw token (`auth.service.ts:84-93`), a użytkownika czyta potem bez blokady. Archiwum S-01 przypisuje poprawkę kolejności do S-09 (`context/archive/2026-11-03-magic-link-sign-in/plan.md:437`).
- **`register` / `request-link`:** zawsze 202 (`auth.controller.ts:32-46`). Strony logowania i rejestracji znają tylko 400 i błąd ogólny (`sign-in.ts:47`, `register.ts:53`).
- **Serwisy danych:** biorą `userId` jako argument (`subscriptions.service.ts:99-117`, `budget.service.ts:50,82`), ale `SubscriptionsModule` nic nie eksportuje.
- **`MailService.sendToUser`:** sprawdza tylko istnienie konta (`mail.service.ts:71-91`). Job cyklu życia nie patrzy na `is_active` (`subscription-lifecycle.service.ts:27-52`).
- **Lista tras:** zna tylko dostęp `public` i `session` (`test/routes.e2e-spec.ts:324,346-541`). Sprzątanie e2e opiera się na kluczach obcych (`test/support/e2e-app.ts:158-172`).
- **Frontend:**
  - `AuthUser.roles` istnieje, ale nic go nie sprawdza.
  - Nawigacja to stała `NAV_LINKS` (`app-shell.ts:8-12`), a shell ładuje sumy zalogowanego (`app-shell.ts:32-34`).
  - `SubscriptionTable` zawsze pokazuje akcje.
  - `CostTotals` czyta tylko sklep bieżącego konta.

## Desired End State

- **Role i skrypty:**
  - `RoleCode.SUPER_ADMIN` istnieje.
  - `npm run superadmin:grant -- <mail>` kończy się kodem 1, gdy inne konto już ma tę rolę; częściowy indeks unikalny w `user_role` odrzuca drugiego superadmina także przy ręcznym SQL.
  - `admin:revoke` i `superadmin:revoke` odbierają role; wszystkie skrypty są idempotentne.
- **Blokada, odblokowanie, reset:**
  - Blokada w jednej transakcji: `is_active = false`, usunięcie niewykorzystanych linków, `revoked_at` na wszystkich aktywnych sesjach. Potem mail `ACCOUNT_BLOCKED`.
  - Odblokowanie ustawia `is_active = true` i wysyła `ACCOUNT_UNBLOCKED`.
  - Reset unieważnia sesje i linki aktywnego konta i wysyła `SESSIONS_RESET`.
- **Odpowiedzi dla zablokowanego konta:**
  - `POST /auth/register`, `/auth/request-link` i `/auth/verify` zwracają `403 { code: 'account_blocked', contact: <SUPPORT_EMAIL> }`, a `request-link` dodatkowo wysyła mail `ACCOUNT_BLOCKED`.
  - Adresy aktywne i nieznane dostają nadal identyczne 202.
- **Joby i maile:** `sendToUser` nie wysyła na adres zablokowanego konta, poza typami dostępu (`ACCOUNT_BLOCKED`, `ACCOUNT_UNBLOCKED`, `SESSIONS_RESET`). Job cyklu życia pomija zablokowane konta i nadrabia je po odblokowaniu.
- **API `/admin`:**
  - Trasy `/admin/...` mają `@Roles(ADMIN, SUPER_ADMIN)`: bez sesji 401, sesja bez roli 403.
  - `GET /admin/users?q=…&blocked=…` zwraca do 20 kont.
  - `GET /admin/users/:id` zwraca profil, subskrypcje, sumy i budżet konta oraz zapisuje wpis audytu `VIEW`.
  - Akcje `POST /admin/users/:id/{block,unblock,reset-sessions}` zapisują audyt w tej samej transakcji. Gdy aktor nie ma wyższej rangi niż cel, zwracają 403.
- **Ukrycie superadmina:** API admina nigdy nie zwraca `SUPER_ADMIN` innemu kontu. Superadmin wygląda tam jak „admin” bez akcji.
- **Audyt:** wpisy (`admin_audit`) mają id aktora i celu bez FK i bez adresów. Przeżywają usunięcie konta.
- **Frontend:**
  - Logowanie, rejestracja i weryfikacja linku pokazują „Konto zostało zablokowane. Napisz na <contact>”.
  - Admin i superadmin widzą w nawigacji „Administracja”.
  - `/admin/users` (wyszukiwanie) i `/admin/users/:id` (szczegóły tylko do odczytu, akcje z potwierdzeniem, tylko gdy `canManage`) mają `RenderMode.Client` i są w `GUARDED_ROUTES`.
  - Zwykły użytkownik wchodzący na `/admin/...` trafia na `/subscriptions`.

### Key Discoveries:

- **Ranga zamiast listy przypadków.** `rank(user) = 2` dla `SUPER_ADMIN`, `1` dla `ADMIN`, `0` dla pozostałych. Aktor może zarządzać celem wtedy i tylko wtedy, gdy `aktor ≠ cel` i `rank(aktor) > rank(cel)`. Jedna reguła daje wszystkie decyzje użytkownika: nie siebie, admin tylko zwykłych użytkowników, superadmin także adminów, nikt superadmina.
- **Blokada wiersza.** `AccountDeletionService` blokuje wiersz `user` (`pessimistic_write`, `account-deletion.service.ts:18-45`) tak samo jak `lockActiveUser`. Blokada konta używa tej samej blokady, więc równoległy `request-link` czeka i po commicie widzi `is_active = false`. `verify` po poprawce bierze tę samą blokadę jako pierwszą.
- **Kolejność zapisu roli.** Role są czytane przy każdym żądaniu (`session.service.ts:86-98`). Nadanie lub odebranie roli działa więc od następnego żądania i nie wymaga wylogowania.
- **Indeksy.** `session.user_id` i `magic_link_token.user_id` mają indeksy (migracja `AddAuthUserIdIndexes`), więc „wszystkie sesje konta” nie skanuje tabeli.
- **Pakiet serwera.** `prepare-mydevil.mjs` kopiuje cały `dist/` (`backend-subtracker/scripts/prepare-mydevil.mjs:13`), więc nowe pliki `dist/cli/*.js` trafią na serwer bez zmian w deployu.
- **Wzór indeksu pisanego ręcznie.** Indeks z warunkiem powstaje jak `name_key` kategorii: SQL ręcznie w migracji, w encji `@Index(<nazwa>, { synchronize: false })`, ten sam SQL jako stała uruchamiana przez seeder bazy dev (`backend-patterns.md`, „Unikalność bez wielkości liter”).

## What We're NOT Doing

- Edycji danych użytkownika przez admina (subskrypcje, budżet, adres). Panel jest tylko do odczytu, poza aktywnością konta.
- „Resetu dostępu” jako wysyłki linku przez admina albo zmiany adresu e-mail. Reset to wyłącznie „wyloguj wszędzie”.
- API do nadawania i odbierania ról (ADMIN, SUPER_ADMIN): tylko skrypty CLI.
- Widoku audytu w UI. Audyt czyta operator w SQL, więc tabela nie dostaje indeksów (lekcja: indeks tylko pod zapytanie).
- Pola „powód blokady”.
- Pełnej listy kont ze stronicowaniem. Jest tylko wyszukiwanie po fragmencie adresu (min. 3 znaki) i filtr zablokowanych.
- Samoobsługowego odblokowania. Przyjdzie z FR-003 (blokada po nieudanych hasłach), podobnie jak zaufane urządzenia (Parked).
- „Wyloguj wszędzie” dla samego użytkownika na `/account`. Byłoby proste przy tym serwisie, ale nie było w decyzjach.
- Pomijania zablokowanych w alertach operatora (`notifyOperator`): idą do operatora, nie do użytkownika.

## Implementation Approach

Kolejność: dane, logika, API, UI, dokumentacja. Faza 1 kładzie schemat (rola, indeks, audyt) i skrypty, więc kolejne fazy mają gotowe role do testów. Faza 2 buduje `AccountAccessService` (blokada, odblokowanie, reset) i zmienia kontrakt auth. Działa bez API admina i jest testowana e2e przez serwis. Faza 3 wystawia trasy admina, które składają serwis dostępu, audyt i istniejące serwisy danych. Faza 4 to frontend, faza 5 dokumentacja i produkcja.

## Critical Implementation Details

**Kolejność w `verify`.** Nowa sekwencja w jednej transakcji:

1. odczyt `user_id` tokenu po hashu, bez blokady (brak → 401);
2. blokada wiersza `user` (`pessimistic_write`, osobne zapytanie bez `relations`);
3. `is_active = false` → 403 `account_blocked`, bez zużycia tokenu;
4. atomowy `UPDATE` tokenu (0 wierszy → 401);
5. odczyt ról i utworzenie sesji.

Ta sama kolejność (user → token) jest przy wystawianiu linku i blokadzie, więc znika deadlock z follow-upu S-01 i sesja nie powstanie po blokadzie.

**Mail po commicie.** Blokada, odblokowanie i reset wysyłają mail dopiero po commicie transakcji. Kontroler albo serwis woła `sendToUser`, który nigdy nie odrzuca. Wysyłka nie wydłuża blokady wiersza, a rollback nie zostawia wysłanego maila.

**Audyt podglądu przed danymi.** `GET /admin/users/:id` najpierw zapisuje wpis `VIEW`, potem czyta dane. Błąd zapisu audytu daje 500 bez danych, więc nie ma podglądu bez śladu.

**403 z `/auth/` a interceptor.** Front odróżnia blokadę od CSRF po `error.error?.code === 'account_blocked'`, nie po samym statusie. Interceptor sesji i tak pomija `/auth/`.

---

## Faza 1: Model ról i audytu

### Overview

Rola `SUPER_ADMIN` z gwarancją „jeden” w bazie i w skrypcie, skrypty nadawania i odbierania ról, tabela audytu bez FK. Testy e2e i sprzątanie znają audyt.

### Changes Required:

#### 1. Rola SUPER_ADMIN

**File**: `backend-subtracker/src/shared/types/role-code.ts`, `src/users/entities/user-role.entity.ts`, `src/users/services/roles-seeder.ts`, nowa migracja danych `SeedSuperAdminRole` i schematu `AdminRolesAndAudit` w `src/database/migrations/`

**Intent**: Dodać trzecią rolę ze stałym UUID i nazwą „Superadministrator” oraz częściowy indeks unikalny, który dopuszcza najwyżej jeden wiersz `user_role` z tą rolą.

**Contract**:
- `RoleCode.SUPER_ADMIN = 'SUPER_ADMIN'` i wpis w `ROLE_DEFINITIONS`.
- Migracja danych wstawia rolę z wartościami wpisanymi wprost (wzór `SeedRoles`).
- Migracja schematu tworzy `CREATE UNIQUE INDEX "UQ_user_role_single_super_admin" ON "user_role" ("role_id") WHERE "role_id" = '<uuid SUPER_ADMIN>'`.
- Encja `UserRole` ma `@Index('UQ_user_role_single_super_admin', { synchronize: false })`.
- SQL indeksu to stała współdzielona z `RolesSeeder`, który zakłada go w bazie dev (`IF NOT EXISTS`) po wstawieniu ról.

#### 2. Skrypty ról

**File**: `src/users/grant-admin.ts` → `src/users/role-grants.ts` (z testem jednostkowym albo e2e), `src/cli/admin-grant.ts`, nowe `src/cli/admin-revoke.ts`, `src/cli/superadmin-grant.ts`, `src/cli/superadmin-revoke.ts`, `package.json`

**Intent**: Uogólnić `grantAdmin` do nadawania i odbierania dowolnej roli. Nadanie `SUPER_ADMIN` odmawia, gdy inne konto już ją ma. Wyścig, który przejdzie przez sprawdzenie, zatrzyma indeks: błąd `23505` tego indeksu mapujemy na ten sam komunikat.

**Contract**:
- `grantRole(dataSource, email, RoleCode)` i `revokeRole(dataSource, email, RoleCode)`. Obie są idempotentne; nieznany adres albo brak roli w tabeli rzuca błąd.
- `grantRole` dla `SUPER_ADMIN` rzuca „Superadmin już istnieje: najpierw `superadmin:revoke`”, gdy rolę ma inne konto (bez adresu tamtego konta w komunikacie).
- `grantAdmin` zostaje jako cienka funkcja (używają jej testy).
- Skrypty `admin:revoke`, `superadmin:grant` i `superadmin:revoke` w `package.json` mają ten sam kształt co `admin:grant`, z kodem wyjścia 1 przy błędzie.
- Wspólny szkielet CLI (env, `DataSource`, `finally destroy`) przenosimy do jednego helpera w `src/cli/`, żeby cztery pliki go nie kopiowały.

#### 3. Tabela audytu

**File**: nowy `src/admin/entities/admin-audit.entity.ts`, `src/admin/admin-audit.types.ts`, migracja `AdminRolesAndAudit` (ta sama co indeks)

**Intent**: Trwały ślad akcji admina, który przeżywa usunięcie konta aktora albo celu i nie zawiera danych osobowych poza identyfikatorami.

**Contract**:
- Tabela `admin_audit`: `id uuid PK default gen_random_uuid()`, `actor_id uuid NOT NULL`, `target_id uuid NOT NULL` (oba bez FK), `action varchar(30) NOT NULL`, `created_at timestamptz default now()`.
- Enum TS `AdminAction { VIEW, BLOCK, UNBLOCK, RESET_SESSIONS }`, bez enumu Postgresa (wzór „Zamknięte listy”).
- Bez indeksów: żadne zapytanie aplikacji nie filtruje tej tabeli.
- Encja trafia do `AdminModule`, który w tej fazie ma tylko `TypeOrmModule.forFeature`; kontrolery dochodzą w fazie 3.

#### 4. Testy i sprzątanie

**File**: `backend-subtracker/test/support/e2e-app.ts`, `frontend-subtracker/e2e/support/accounts.ts`, `test/auth/account-deletion.e2e-spec.ts`, `test/auth/sign-in.e2e-spec.ts` (albo nowy `test/auth/roles.e2e-spec.ts`)

**Intent**:
- Sprzątanie e2e (backend i przeglądarka) usuwa wpisy `admin_audit`, w których aktor albo cel jest kontem testowym. Przy okazji poprawia nieaktualny komentarz o `NO ACTION`.
- Test usuwania konta sprawdza, że wpisy audytu konta zostają: ta sama liczba, te same id, bez adresu.
- Testy skryptów: drugi superadmin odrzucony przez skrypt i, przy bezpośrednim `INSERT`, przez indeks (`23505`); odebranie roli działa od następnego żądania tej samej sesji (`/auth/me`); nadanie i odebranie są idempotentne.

**Contract**: Nowy prefiks adresów dla nowego pliku testów zgodnie z §6.4 test-planu.

### Success Criteria:

#### Automated Verification:

- Migracje wygenerowane i zastosowane na `subtracker-db`: `npm run migration:run` (w `backend-subtracker/`), a `npm run migration:generate -- Check` kończy się komunikatem „No changes in database schema were found”
- Lint i build backendu: `npm run lint` i `npm run build`
- Testy jednostkowe backendu: `npm test`
- Testy e2e backendu, w tym nowe testy ról i zaktualizowany test usuwania konta: `npm run test:e2e`

#### Manual Verification:

- `npm run superadmin:grant -- <adres A>` nadaje rolę, a ten sam skrypt z `<adres B>` kończy się kodem 1 z czytelnym komunikatem; `superadmin:revoke` dla A, potem grant dla B działa

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie.

---

## Faza 2: Blokada i reset w backendzie

### Overview

Serwis dostępu do konta, poprawka `verify`, kontrakt 403 `account_blocked` w trasach logowania, trzy maile o dostępie, pomijanie zablokowanych w `sendToUser` i jobie cyklu życia.

### Changes Required:

#### 1. `SUPPORT_EMAIL`

**File**: `backend-subtracker/src/config/env.ts` (+ spec), `.env.example`

**Intent**: Adres kontaktowy dla zablokowanych, pokazywany na stronie i w mailu.

**Contract**: `SUPPORT_EMAIL: string`. Wymagany w `PROD` (`requireString`, jak `NOTIFICATION_ADMINISTRATOR_MAIL`); w `DEV` domyślnie `admin@subtracker.test`. Walidowany jako adres.

#### 2. `AccountAccessService`

**File**: nowy `src/auth/services/account-access.service.ts` (+ spec), `src/auth/auth.module.ts` (eksport serwisu)

**Intent**: Jedno miejsce dla trzech zmian dostępu. Każda to jedna transakcja z blokadą wiersza `user`, a mail wychodzi po commicie.

**Contract**:
- `block(userId)`: `is_active` z `true` na `false`, `DELETE magic_link_token WHERE user_id AND used_at IS NULL`, `UPDATE session SET revoked_at = now() WHERE user_id AND revoked_at IS NULL`. Po commicie mail `ACCOUNT_BLOCKED`.
- `unblock(userId)`: `is_active` z `false` na `true`. Po commicie mail `ACCOUNT_UNBLOCKED`.
- `resetSessions(userId)`: tylko dla aktywnego konta. Linki i sesje jak w `block`, flaga bez zmian. Po commicie mail `SESSIONS_RESET`.
- Każda metoda przyjmuje opcjonalny `EntityManager` (albo callback w transakcji), żeby faza 3 dopisała audyt w tej samej transakcji.
- Wynik: zaktualizowany `User`. Brak konta → `NotFoundException`; stan niepozwalający na akcję (blokada zablokowanego, odblokowanie aktywnego, reset zablokowanego) → `ConflictException` (wzór akcji cyklu życia).
- Funkcja „wszystkie sesje i linki konta” to prywatny helper serwisu (sugestia z `account-deletion/research.md:104`).

#### 3. Kontrakt auth dla zablokowanego konta

**File**: `src/auth/services/auth.service.ts`, `src/auth/controllers/auth.controller.ts`, nowy `src/auth/account-blocked.exception.ts` (albo w `auth.constants.ts`), testy `test/auth/*.e2e-spec.ts`, `auth.service.spec.ts`

**Intent**:
- `lockActiveUser` rozróżnia „brak konta” od „zablokowane”.
- `register` i `request-link` dla zablokowanego adresu rzucają 403 z kodem i kontaktem; `request-link` wcześniej wysyła mail `ACCOUNT_BLOCKED` (bez `await` na wysyłkę, jak link).
- `verify` dostaje kolejność blokad z Critical Implementation Details. Dla zablokowanego konta zwraca 403 bez zużycia tokenu.

**Contract**:
- Treść odpowiedzi: `{ statusCode: 403, code: 'account_blocked', contact: SUPPORT_EMAIL, message: 'Account blocked' }`.
- Adres aktywny i nieznany: dalej 202 bez treści.
- Zgody przy `register` zablokowanego adresu nie są odświeżane.
- Testy:
  - macierz adresów: aktywny, nieznany i zablokowany dla `register` i `request-link`; pierwsze dwa identyczne, trzeci 403 i dokładnie jeden mail `ACCOUNT_BLOCKED`;
  - `verify` zablokowanego: 403, token pozostaje niezużyty;
  - po `unblock` stary link wydany przed blokadą nie działa (usunięty), a nowy działa;
  - istniejący test „inactive like active” w `privacy-validation.e2e-spec.ts:55-71` zmienia oczekiwanie na 403 (decyzja użytkownika zastępuje wcześniejszą regułę).

#### 4. Maile o dostępie

**File**: `src/mail/mail.types.ts`, `src/auth/mail-templates.ts` (+ spec), `src/mail/services/mail.service.ts` (+ spec)

**Intent**: Trzy szablony z escapowaniem i kontaktem. `sendToUser` pomija konta zablokowane, z wyjątkiem typów dostępu.

**Contract**:
- `MailType` dostaje `ACCOUNT_BLOCKED`, `ACCOUNT_UNBLOCKED` i `SESSIONS_RESET`.
- Eksportowana stała `ACCOUNT_ACCESS_MAIL_TYPES` (te trzy).
- Sprawdzenie w `sendToUser` przed wysyłką: konto istnieje oraz (`is_active` albo typ ∈ `ACCOUNT_ACCESS_MAIL_TYPES`). Pominięcie zachowuje się jak dziś przy braku konta: brak wysyłki i audytu, log bez adresu, wynik `false`.
- Drugie sprawdzenie przed zapisem audytu (anonimizacja z S-10) zostaje bez zmian.
- Treści:
  - blokada: „Konto zostało zablokowane przez administratora. Kontakt: <SUPPORT_EMAIL>”;
  - odblokowanie: „Możesz się znowu zalogować” z linkiem do `/sign-in`;
  - reset: „Administrator wylogował Cię ze wszystkich urządzeń; zaloguj się ponownie”.

#### 5. Job cyklu życia pomija zablokowane

**File**: `src/subscriptions/services/subscription-lifecycle.service.ts`, `test/subscriptions/subscription-lifecycle.e2e-spec.ts`

**Intent**: Kroki 1–3 joba dostają warunek właściciela `is_active = true`, jak `whereDue` przypomnień. Po odblokowaniu następny przebieg nadrabia zaległe przejścia.

**Contract**: Warunek `EXISTS (SELECT 1 FROM "user" WHERE id = subscription.user_id AND is_active)` we wszystkich trzech zapytaniach. Test: zablokowane konto z zaległym trialem → bez zmian; po odblokowaniu → przejście.

### Success Criteria:

#### Automated Verification:

- Lint, build i testy jednostkowe backendu: `npm run lint`, `npm run build`, `npm test`
- Testy e2e backendu z nowymi scenariuszami blokady, resetu, `verify` i joba: `npm run test:e2e`

#### Manual Verification:

- Lokalnie (DEV, maile na konsolę): dla konta testowego z `is_active = false` (ustawionego w bazie dev) curl `POST /auth/request-link` daje 403 z `code` i `contact`, a w konsoli API pojawia się mail o blokadzie; adres nieznany dalej dostaje 202. Pełny przepływ blokady z sesją sprawdza faza 3 (trasy admina).

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie.

---

## Faza 3: API `/admin`

### Overview

Moduł `admin` z wyszukiwaniem, szczegółami konta (audyt podglądu) i akcjami z regułą rangi. Lista tras zna dostęp `admin`.

### Changes Required:

#### 1. Eksport serwisów danych

**File**: `src/subscriptions/subscriptions.module.ts`

**Intent**: `AdminModule` korzysta z istniejących zapytań zamiast ich kopiować.

**Contract**: `exports: [SubscriptionsService, BudgetService]`. Bez zmian sygnatur.

#### 2. Ranga i reguła zarządzania

**File**: nowy `src/admin/admin-rank.ts` (+ spec)

**Intent**: Czysta funkcja reguły hierarchii, testowana tabelą przypadków.

**Contract**: `rankOf(roles: RoleCode[]): 0 | 1 | 2` i `canManage(actor: { id; roles }, target: { id; roles }): boolean`, równe `actor.id !== target.id && rankOf(actor) > rankOf(target)`. Do tego `visibleRole(roles): 'user' | 'admin'`: `ADMIN` i `SUPER_ADMIN` → `'admin'`, więc API nie ujawnia superadmina.

#### 3. Kontroler i serwis admina

**File**: nowe `src/admin/controllers/admin-users.controller.ts`, `src/admin/services/admin-users.service.ts`, `src/admin/services/admin-audit.service.ts`, `src/admin/dtos/*.ts`, `src/admin/admin.module.ts`, `src/app.module.ts`

**Intent**: Trzy rodzaje tras pod `@Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)` na klasie kontrolera. Akcje woła `AccountAccessService` z zapisem audytu w tej samej transakcji.

**Contract**:
- `GET /admin/users?q=&blocked=`:
  - `q` (trim, lower) to 3–254 znaki, chyba że `blocked=true` (wtedy `q` opcjonalne);
  - `ILIKE '%' || :q || '%'` z escapowaniem `%`, `_` i `\`;
  - `ORDER BY email COLLATE POLISH_COLLATION`, `LIMIT 20`.
- Element listy (`AdminUserSummary`): `{ id, email, role: 'user'|'admin', isActive, createdAt, canManage }`. `Cache-Control: no-store`.
- `GET /admin/users/:id` (`ParseUUIDPipe`):
  - najpierw zapisuje audyt `VIEW`, potem zwraca `{ user: AdminUserSummary & { emailVerifiedAt }, subscriptions: SubscriptionResponse[], totals: CostTotalsResponse, budget: BudgetResponse }`;
  - nieznane id → 404 bez wpisu audytu;
  - `no-store`.
- `POST /admin/users/:id/block | unblock | reset-sessions` (`@HttpCode(200)`, bez body):
  - zwraca `AdminUserSummary`;
  - 404 dla nieznanego id, 403 `Cannot manage this account`, gdy `!canManage`, 409 przy niedozwolonym stanie;
  - audyt `BLOCK`, `UNBLOCK` albo `RESET_SESSIONS` w transakcji akcji.
- Role celu czytamy z `user_role` z aktywnymi rolami, jak `toAuthUser`.

#### 4. Lista tras i testy

**File**: `test/routes.e2e-spec.ts`, nowe `test/admin/admin-users.e2e-spec.ts` i `test/admin/admin-e2e.ts`, `test/subscriptions/access.e2e-spec.ts`, `context/foundation/test-plan.md` §6.4

**Intent**: Każda trasa admina jest sprawdzona automatycznie: 401 bez sesji i 403 z sesją bez roli. Trasy z parametrem mają test reguły rangi zamiast testu dwóch kont.

**Contract**:
- `Access = 'public' | 'session' | 'admin'`. Nowy test listy: „answers 403 to a session without an admin role on every admin route”. Trasy `admin` są też w teście 401.
- Pole `twoAccountTest` dla tras `admin` wskazuje test macierzy rang.
- Scenariusze e2e:
  - macierz rang: user, admin, inny admin i superadmin jako aktorzy wobec celów user, admin, superadmin i siebie samego. Asercje: 403 tam, gdzie `!canManage`, i stan celu bez zmian;
  - wyszukiwanie (fragment, za krótkie `q` → 400, `blocked=true`, limit 20, znaki `%` i `_` traktowane dosłownie);
  - szczegóły: dane celu równe temu, co cel widzi sam przez `/subscriptions` i `/subscriptions/totals`, plus wpis `VIEW`;
  - akcje: stan, sesja celu daje 401, maile w `sent`, wpis audytu;
  - `role` superadmina widziany przez admina jako `'admin'` z `canManage: false`;
  - nic z `/admin` nie zwraca `SUPER_ADMIN` (asercja na surowym JSON odpowiedzi).
- Cookbook §6.4 opisuje dostęp `admin` i test rang.

### Success Criteria:

#### Automated Verification:

- Lint, build i testy jednostkowe backendu: `npm run lint`, `npm run build`, `npm test`
- Testy e2e backendu z listą tras i macierzą rang: `npm run test:e2e`

#### Manual Verification:

- Lokalnie curl z ciasteczkiem admina (`dev-local/test-session.mjs`, rola nadana `admin:grant`): wyszukanie, podgląd i blokada konta testowego działają, a w `admin_audit` są wpisy `VIEW` i `BLOCK`

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie.

---

## Faza 4: Frontend

### Overview

Komunikat blokady w logowaniu, guard ról, strony admina w app-shell, nawigacja i testy.

### Changes Required:

#### 1. Komunikat „konto zablokowane”

**File**: `frontend-subtracker/src/app/pages/sign-in/*`, `pages/register/*`, `auth/verify-link` (komponent weryfikacji), `src/app/auth/auth.service.ts`, nowy helper `auth/account-blocked.ts` (+ spec)

**Intent**: Te trzy ekrany pokazują stan `blocked` z adresem kontaktowym (link `mailto:`) zamiast „niedostępne”.

**Contract**: Funkcja `accountBlockedContact(error: HttpErrorResponse): string | null` rozpoznaje `status === 403 && error.error?.code === 'account_blocked'`. Stan formularza dostaje wariant `'blocked'`. Testy komponentów (harness, wzór §6.2) dla trzech ekranów.

#### 2. Guard ról i trasy admina

**File**: `src/app/auth/auth.guard.ts` (+ spec), `src/app/app.routes.ts`, `src/app/app.routes.server.ts`, `e2e/http/render-modes.e2e-spec.ts`

**Intent**: `adminGuard` działa jak `authGuard`, a dodatkowo przepuszcza tylko role `ADMIN` albo `SUPER_ADMIN`. Inny zalogowany użytkownik dostaje `UrlTree('/subscriptions')`.

**Contract**:
- Trasy `admin/users` i `admin/users/:id`, lazy, z `adminGuard`, obie `RenderMode.Client` (`admin/users/:id` nie może trafić do prerenderu).
- Obie trafiają do `GUARDED_ROUTES` (z przykładowym id).
- Stała `ADMIN_ROLES` i funkcja `isAdmin(user)` w `auth/`.
- Fikstury testów używają kodów jak w API (`'USER'`, `'ADMIN'`): poprawić `auth.guard.spec.ts:36` (`'user'`).

#### 3. Strony admina

**File**: nowe `src/app/pages/admin/admin-users/*`, `pages/admin/admin-user/*`, `src/app/admin/admin.service.ts` i `admin.types.ts`, `layout/app-shell/app-shell.ts|html` (+ spec), `pages/subscriptions/subscription-table/*`, `subscriptions/cost-totals/*`

**Intent**: Wyszukiwanie z wynikami i szczegóły konta tylko do odczytu, w obecnym stylu (`_theme.scss`, `--st-*`, układ telefonu przy 840px; lista ma własny obszar przewijania zgodnie z regułą app-shell).

**Contract**:
- `AdminService` z metodami `search(q, blocked)`, `user(id)`, `block(id)`, `unblock(id)`, `resetSessions(id)`.
- `SubscriptionTable` dostaje wejście `readOnly` (domyślnie `false`), które ukrywa przyciski akcji na desktopie i telefonie.
- `CostTotals` dostaje opcjonalne wejście `totals`, które ma pierwszeństwo przed sklepem bieżącego konta.
- `AppShell` dostaje wejście `showTotals` (domyślnie `true`). Strony admina ustawiają `false`, więc nie ładują ani nie pokazują sum admina.
- Szczegóły pokazują profil (adres, status, rola, daty), sumy celu, tabelę subskrypcji `readOnly` i limity budżetu w formie listy.
- Akcje „Zablokuj”, „Odblokuj” i „Wyloguj wszędzie” są widoczne tylko przy `canManage`, każda z dialogiem potwierdzenia (wzór `delete-subscription-dialog`). Po akcji widok się odświeża.
- 403 na stronie admina pokazuje „Brak uprawnień”, 404 „Nie ma takiego konta”, 409 komunikat stanu.

#### 4. Nawigacja

**File**: `layout/app-shell/app-shell.ts|html` (+ spec)

**Intent**: Pozycja „Administracja” (`/admin/users`) w obu nawigacjach, tylko dla admina i superadmina.

**Contract**: `links = computed(() => isAdmin(user()) ? [...NAV_LINKS, ADMIN_LINK] : NAV_LINKS)`. Test shella: użytkownik bez roli nie widzi pozycji, admin widzi.

#### 5. Browser e2e

**File**: `frontend-subtracker/e2e/support/accounts.ts`, nowy `e2e/browser/admin.e2e-spec.ts`

**Intent**: Jeden krytyczny przepływ w przeglądarce: admin wyszukuje konto, blokuje je, a zablokowany użytkownik przy próbie logowania widzi komunikat z kontaktem. Do tego zwykły użytkownik na `/admin/users` ląduje na `/subscriptions`.

**Contract**: `createE2eAccounts` dostaje opcję nadania roli (`roles: ['ADMIN']`, zapis do `user_role`) i sprzątanie audytu z fazy 1. Własny prefiks adresów (§6.5).

### Success Criteria:

#### Automated Verification:

- Testy frontendu w obu strefach czasowych: `npm run test:ci` (w `frontend-subtracker/`)
- Build produkcyjny: `npm run build`
- Browser i HTTP e2e na buildzie e2e: `npm run build:e2e` i `npm run e2e`

#### Manual Verification:

- Na desktopie i telefonie (≤ 840px): admin widzi „Administracja”, wyszukuje konto, ogląda dane bez przycisków edycji, blokuje z potwierdzeniem; zablokowany widzi komunikat z kontaktem na logowaniu; superadmin wygląda dla admina jak admin bez akcji

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie.

---

## Faza 5: Dokumentacja i produkcja

### Overview

Wzorce, README deployu, CLAUDE.md, PRD i sprawdzenie na produkcji.

### Changes Required:

#### 1. Dokumenty

**File**: `context/foundation/backend-patterns.md`, `deploy/mydevil/README.md` (PL i EN), `backend-subtracker/.env.example`, `CLAUDE.md`, `context/foundation/prd.md`

**Intent**:
- `backend-patterns.md`:
  - sekcja „Role”: trzy role, ranga, skrypty, indeks jednego superadmina;
  - sekcja „Sesja”: blokada, reset, kolejność blokad w `verify`, wyjątek 403 `account_blocked` od jednakowej odpowiedzi;
  - „Maile”: typy dostępu i pomijanie zablokowanych;
  - „Kaskada od użytkownika”: wyjątek `admin_audit` (id bez FK, bez adresów, przeżywa konto);
  - „Cykl życia”: job pomija zablokowanych.
- README deployu: komendy `cli/admin-revoke.js`, `cli/superadmin-grant.js` i `cli/superadmin-revoke.js` na serwerze, nowy klucz `SUPPORT_EMAIL` w `.env` serwera (przed deployem fazy 2, inaczej `validateEnv` zatrzyma start).
- CLAUDE.md, akapit backendu: moduł `admin/`, trasy `/admin/users`, blokada.
- PRD, Access Control: rola Superadmin i komunikat dla zablokowanych.

**Contract**: Tylko proza; bez prawdziwej domeny (tokeny `<frontend-domain>`), README dwujęzyczne.

### Success Criteria:

#### Automated Verification:

- Testy backendu i frontendu nadal zielone po zmianach dokumentacji: `npm test` w obu aplikacjach (skrypty `sh` się nie zmieniają, więc shellcheck nie jest potrzebny)

#### Manual Verification:

- `SUPPORT_EMAIL` dopisany do `.env` na serwerze przed deployem; po deployu (migracje w `deploy.sh`) `cli/superadmin-grant.js` nadaje rolę właścicielowi
- Na produkcji: superadmin wyszukuje konto testowe, ogląda dane, blokuje je (mail o blokadzie dochodzi), próba logowania pokazuje komunikat z kontaktem, odblokowanie przywraca logowanie (mail dochodzi), „wyloguj wszędzie” kończy sesję na drugim urządzeniu; wpisy w `admin_audit`

**Implementation Note**: Po fazie zatrzymaj się na ręczne potwierdzenie.

---

## Testing Strategy

### Unit Tests:

- `canManage` i `visibleRole`: pełna tabela rang (w tym sam siebie i superadmin jako cel).
- `validateEnv`: `SUPPORT_EMAIL` wymagany w PROD, domyślny w DEV, odrzucany zły format.
- `MailService.sendToUser`: zablokowane konto plus typ zwykły → pominięcie; typ dostępu → wysyłka.
- Szablony maili: escapowanie i obecność kontaktu.
- Frontend: `accountBlockedContact`, `adminGuard` (server i browser, wzór `auth.guard.spec.ts`), shell z pozycją admina, `SubscriptionTable` z `readOnly`, `CostTotals` z wejściem `totals`, ekrany logowania, rejestracji i weryfikacji w stanie `blocked`.

### Integration Tests:

- Backend e2e:
  - role i skrypty (jeden superadmin: skrypt i indeks);
  - blokada, odblokowanie i reset (sesje, linki, maile, kolejność `verify`);
  - macierz `register` i `request-link`;
  - job cyklu życia;
  - lista tras z dostępem `admin`;
  - macierz rang;
  - podgląd z audytem;
  - usunięcie konta zostawia audyt bez adresów.
- Browser e2e: admin blokuje konto, zablokowany widzi komunikat, zwykły użytkownik nie wejdzie do panelu.

### Manual Testing Steps:

1. Lokalnie nadać sobie `ADMIN`, w drugiej przeglądarce zalogować konto testowe, zablokować je z panelu i sprawdzić, że druga przeglądarka trafia na logowanie, a prośba o link pokazuje komunikat.
2. Odblokować, zalogować się ponownie, zrobić „wyloguj wszędzie” i sprawdzić, że sesja się kończy.
3. Sprawdzić telefon (≤ 840px): nawigacja, lista, szczegóły, dialogi.

## Performance Considerations

- Wyszukiwanie `ILIKE '%q%'` skanuje tabelę `user`. Przy skali MVP (dziesiątki do setek kont) to akceptowalne; indeks trigramowy dopiero, gdy pojawi się problem.
- Szczegóły konta składają trzy istniejące zapytania; bez nowych indeksów.
- Warunek `EXISTS` po PK `user` w jobie cyklu życia nie zmienia planów zapytań opartych na `(status, data)`.

## Migration Notes

- Dwie migracje: schemat (`admin_audit` i indeks jednego superadmina) oraz dane (rola `SUPER_ADMIN`). Obie generowane i sprawdzane na `subtracker-db` (lekcja o migracjach), w produkcji wykonuje je `deploy.sh`.
- Baza dev: `RolesSeeder` dodaje rolę i indeks; `synchronize` zakłada `admin_audit`.
- `SUPPORT_EMAIL` musi być w `.env` serwera przed pierwszym deployem z fazą 2. Inaczej start się zatrzyma, health-check zawiedzie i `deploy.sh` przywróci poprzednią wersję z dumpu.
- Wycofanie: `restore-db.sh` z kopii (bez `migration:revert` na produkcji).

## References

- Research: `context/changes/admin-account-management/research.md` (z Follow-up 2026-11-21)
- Follow-upy S-01: `context/archive/2026-11-03-magic-link-sign-in/plan.md:437,445`
- Wzór transakcji z blokadą: `backend-subtracker/src/auth/services/account-deletion.service.ts:18-45`
- Wzór akcji z 404/409: `backend-patterns.md`, „Akcje użytkownika a edycja”
- Wzór indeksu pisanego ręcznie: `backend-patterns.md`, „Unikalność bez wielkości liter”
- Lista tras: `backend-subtracker/test/routes.e2e-spec.ts:324,346-541`; cookbook `context/foundation/test-plan.md` §6.4–6.5

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Model ról i audytu

#### Automated

- [x] 1.1 Migracje wygenerowane i zastosowane na `subtracker-db`; ponowne `migration:generate` nie znajduje zmian — 5824708
- [x] 1.2 Lint i build backendu — 5824708
- [x] 1.3 Testy jednostkowe backendu — 5824708
- [x] 1.4 Testy e2e backendu, w tym testy ról i test usuwania konta — 5824708

#### Manual

- [x] 1.5 Skrypt `superadmin:grant` odmawia drugiego superadmina, a po `superadmin:revoke` nadaje rolę innemu kontu — 5824708

### Phase 2: Blokada i reset w backendzie

#### Automated

- [x] 2.1 Lint, build i testy jednostkowe backendu — cf12e22
- [x] 2.2 Testy e2e backendu z blokadą, resetem, `verify` i jobem — cf12e22

#### Manual

- [x] 2.3 Lokalnie `request-link` dla zablokowanego konta daje 403 z kontaktem i mail o blokadzie, nieznany adres dalej 202 — cf12e22

### Phase 3: API `/admin`

#### Automated

- [x] 3.1 Lint, build i testy jednostkowe backendu — 277e5b1
- [x] 3.2 Testy e2e backendu z listą tras i macierzą rang — 277e5b1

#### Manual

- [x] 3.3 Lokalnie curl admina: wyszukanie, podgląd i blokada działają, w `admin_audit` są wpisy `VIEW` i `BLOCK` — 277e5b1

### Phase 4: Frontend

#### Automated

- [x] 4.1 Testy frontendu w obu strefach czasowych (`npm run test:ci`) — 2c372db
- [x] 4.2 Build produkcyjny frontendu — 2c372db
- [x] 4.3 Browser i HTTP e2e na buildzie e2e — 2c372db

#### Manual

- [x] 4.4 Desktop i telefon: panel admina, blokada z potwierdzeniem, komunikat dla zablokowanego, superadmin bez akcji dla admina — 2c372db

### Phase 5: Dokumentacja i produkcja

#### Automated

- [x] 5.1 Testy backendu i frontendu nadal zielone po zmianach dokumentacji — b9328ff

#### Manual

- [ ] 5.2 `SUPPORT_EMAIL` w `.env` serwera przed deployem, a po deployu `superadmin-grant` nadaje rolę właścicielowi
- [ ] 5.3 Na produkcji: wyszukanie, podgląd, blokada z mailem i komunikatem, odblokowanie, „wyloguj wszędzie”, wpisy audytu
