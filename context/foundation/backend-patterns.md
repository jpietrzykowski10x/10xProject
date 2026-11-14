# Wzorce backendu (NestJS)

> Wzorce dla `backend-subtracker/` przejęte i poprawione z wcześniejszego projektu użytkownika (`fyi/nestboilerplate`, poza gitem). Czytają je /10x-plan i /10x-implement, gdy slice dotyka uwierzytelniania, ról, CORS albo maili. Pierwsze zastosowanie: S-01 `magic-link-sign-in`, potem S-09 `admin-account-management`. Sekcja „Dane domenowe” (od S-02) dotyczy każdego slice'a z nowymi encjami domeny.

## Dostęp: bezpiecznie domyślnie

- **Globalny guard uwierzytelniania** (`APP_GUARD`): każda trasa wymaga zalogowania, chyba że ma `@Public()`. Wzór pochodzi z boilerplate'u (`AccessTokenGuard` + `@Public()`).
  - Guard czyta ciasteczko sesji i szuka sesji po `sha256(token)`.
  - Sprawdza wygaśnięcie, unieważnienie i `user.isActive`.
  - Raz ładuje role użytkownika i dopina typowany `request.user: AuthUser` (`{ id, email, roles: RoleCode[] }`).
  - Brak lub nieważna sesja → `401 UnauthorizedException`.
  - **Wprowadzając guard (S-01), oznaczyć `@Public()` istniejące `GET /` i `GET /health`.** Inaczej health-check w `deploy.sh` dostanie 401 i każdy deploy API będzie się cofał. Test e2e: `/health` bez ciasteczka → 200.
- **Globalny guard ról**, rejestrowany po guardzie uwierzytelniania:
  - czyta metadane `@Roles(...)` przez `reflector.getAllAndOverride` (metoda i klasa);
  - bez metadanych przepuszcza;
  - przy braku roli zwraca `403 ForbiddenException`, nie 401.
  - Jest jeden mechanizm ról, a nie trzy jak w boilerplate (`RoleGuard` z fabryką, `SuperUserGuard`, `AllowedRolesGuard`). Guard ról nie powtarza uwierzytelniania i nie odpytuje bazy, bo role są już w `request.user`.
- **Dekoratory**:
  - `@Public()` i `@Roles()` tworzone przez `Reflector.createDecorator<T>()`, żeby metadane były typowane;
  - klucze metadanych jako stałe;
  - `@CurrentUser()` jako typowany dekorator parametru, zwraca `AuthUser` bez `any` (wzór z `GetCurrentUser` / `GetCurrentUserId`).
- **Izolacja kont nie jest zadaniem guarda.** Każde zapytanie o dane użytkownika filtruje po `currentUser.id` w serwisie (`where: { id, user: { id: currentUser.id } }`). Dostęp admina do cudzych danych idzie wyłącznie przez osobne kontrolery `/admin/...` z `@Roles(RoleCode.ADMIN)`.
- **Walidacja wejścia**: globalny `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` i DTO z `class-validator`. Bez `whitelist` klient może dopisać do żądania pola spoza DTO (np. `isActive`, `roles`) i nadpisać je przez `Object.assign`.
- **Bez sekretów w nagłówkach jako zabezpieczenia** (`EnvSecretKeyGuard` z boilerplate'u). Operacje serwisowe, takie jak nadanie roli, robimy skryptem CLI na serwerze, nie endpointem.

## Role: osobne tabele od początku

- `role`: `id uuid` (`gen_random_uuid()`), `code varchar(30) unique` (`USER`, `ADMIN`), `name`, `is_active boolean`.
- `user_role`: jawna encja łącząca (`user_id`, `role_id`, `granted_at`, `granted_by` nullable), klucz główny `(user_id, role_id)`. Wybraliśmy ją zamiast `@ManyToMany` z automatycznym `@JoinTable`, żeby później dało się dopisać kolumny (kto, kiedy, do kiedy) bez przebudowy.
- Role startowe zakłada migracja danych ze stałymi UUID i `code` (`SeedRoles`), jak `AddBaseUserRoles` w boilerplate. Nowy użytkownik dostaje `USER` w tej samej transakcji, w której powstaje konto.
- Baza dev powstaje z encji przez `synchronize`, więc migracja danych do niej nie dociera. Tam role zakłada `RolesSeeder` przy starcie aplikacji, idempotentnie i tylko gdy działa `synchronize` (`MODE=DEV` i `DATABASE_AUTO_SYNCHRONIZATION=true`).
- `ADMIN` nadaje operator poza aplikacją (PRD: Access Control), skryptem CLI. Lokalnie to `npm run admin:grant -- <mail>`. Na serwerze ta komenda nie zadziała, bo `prepare-mydevil.mjs` spłaszcza `dist/` do korzenia paczki, więc uruchamiamy `cli/admin-grant.js` z katalogu `public_nodejs` (komenda: `deploy/mydevil/README.md`). Skrypt jest idempotentny, a nieznany adres kończy się kodem wyjścia 1. Nie ma API do zarządzania adminami ani roli superadmina na MVP.
- Do uprawnień liczą się tylko role z `is_active = true`. Boilerplate tego pola nie sprawdzał.
- Kod porównuje `code` przez unię typów / enum `RoleCode`, nigdy przez nazwę wyświetlaną.
- Rozszerzenie na później, bez łamania schematu: tabela `permission` i `role_permission` oraz dekorator `@RequirePermission()`.

## Sesja zamiast JWT

- Tabela `session`: `id`, `user_id`, `token_hash` (sha256, unique), `created_at`, `expires_at`, `revoked_at`, opcjonalnie `user_agent`. Każde urządzenie ma osobną sesję. W boilerplate był jeden wiersz tokenów na użytkownika, więc zalogowanie na drugim urządzeniu wylogowywało z pierwszego.
- Token jest losowy (`crypto.randomBytes(32)`) i ma wysoką entropię, więc wystarczy sha256. Argon2 zostaje dla haseł (FR-003, nice-to-have). Boilerplate weryfikował argon2 przy każdym żądaniu, a to celowo wolny algorytm.
- Sesja trwa stałe 30 dni od utworzenia (`SESSION_TTL`). `expires_at` nie jest przedłużane.
- Ciasteczko `subtracker_session`, atrybuty według `MODE`:
  - zawsze `httpOnly`, `SameSite=Lax`, `Path=/`;
  - `Secure` tylko przy `MODE=PROD`;
  - `Domain` z `SESSION_COOKIE_DOMAIN` tylko przy `MODE=PROD` (na produkcji `.jakubpietrzykowski.pl`), w DEV ciasteczko jest host-only.
  - `validateEnv` zatrzymuje start w PROD, gdy `SESSION_COOKIE_DOMAIN` nie obejmuje hosta `FRONTEND_URL` albo `CORS_ORIGINS` nie zawiera `FRONTEND_URL`.
- Wylogowanie i blokada konta (S-09) ustawiają `revoked_at`.
- Magic link: tabela `magic_link_token` (`token_hash`, `user_id`, `expires_at`, `used_at`). Jednorazowość zapewnia atomowy `UPDATE … SET used_at = now() WHERE used_at IS NULL AND expires_at > now()`. Link działa 15 minut (`MAGIC_LINK_TTL`), a nowy link unieważnia poprzednie.
- **Token we fragmencie adresu**: link w mailu to `${FRONTEND_URL}/auth/verify#token=...`, więc token nie trafia do logów proxy ani nagłówka `Referer`. Zużywa go wyłącznie `POST /auth/verify`, bo skanery poczty otwierają linki przez GET.
- **`email_verified_at`**: `NULL` do pierwszego udanego `POST /auth/verify`, potem ustawione raz i niezmieniane. Dopóki jest `NULL`, mail z linkiem zawiera dodatkowy akapit o tym, że użycie linku potwierdza zgody.
- **Zgody**: `POST /auth/register` wymaga `confirmedAdult` i `acceptedPrivacyPolicy` równych `true`. Zapisujemy `consents_accepted_at` i `privacy_policy_version` (`PRIVACY_POLICY_VERSION`). Formularz mógł wypełnić ktoś, kto nie jest właścicielem skrzynki, więc do potwierdzenia adresu liczą się ostatnie zgody, a potwierdzone konto zachowuje te, które dał jego właściciel.
- `POST /auth/register` i `POST /auth/request-link` odpowiadają tak samo (202), niezależnie od tego, czy adres ma konto.
- Trasy sesji:
  - `GET /auth/session` jest publiczne, zwraca 200 `{ user: AuthUser | null }` z `Cache-Control: no-store` i z niego korzysta frontend. Niezalogowany gość to tam normalny przypadek, a 401 pokazywałby się jako błąd w konsoli przeglądarki na każdej publicznej stronie.
  - `GET /auth/me` zostaje chronione: bez sesji zwraca 401.
  - `POST /auth/logout` jest publiczne i idempotentne, zawsze zwraca 204. Kończy tylko sesję, której token niesie żądanie.
- **Ochrona CSRF** (zmiana `csrf-protection`, sprawdzone na produkcji 2026-11-11): `app.enableCsrfProtection({ trustedOrigins: corsOrigins })` w `applyHttpSecurity`, więc mają ją `main.ts` i oba zestawy e2e. Nest odrzuca 403 każde żądanie zmieniające stan (`POST`, `PUT`, `PATCH`, `DELETE`), które przeglądarka wysłała z obcej strony: `Sec-Fetch-Site` inne niż `same-origin`/`none` albo `Origin` niezgodny z `Host`. Frontend na innej subdomenie wysyła `Sec-Fetch-Site: same-site`, więc przechodzi tylko dlatego, że jego origin jest w `CORS_ORIGINS` — nowy frontend musi trafić na tę listę. `GET`, `HEAD`, `OPTIONS` oraz klienci bez `Origin` (curl, health-check, SSR frontendu) przechodzą. Odrzucenia nie są logowane (4xx). Testy: macierz nagłówków w `test/app.e2e-spec.ts`, atak login CSRF na `/auth/verify` w `test/auth/token-rules.e2e-spec.ts`. Nowe trasy nie potrzebują nic dodatkowego; wyjątki (`exclude`) tylko dla tras wołanych z obcych domen, np. webhooków.

## CORS

- Jedna globalna konfiguracja: `app.enableCors({ origin: parseCorsOrigins(CORS_ORIGINS), credentials: true })`. `*` jest odrzucane. Przy starcie aplikacja loguje listę dozwolonych originów (wzór z `fyi/main.ts`). Wprowadza to F-01.
- **Nie przenosimy `CorsInterceptor` ani `@Cors()` na poziomie trasy.**
  - Preflight `OPTIONS` obsługuje `enableCors` jeszcze przed interceptorami, więc nadpisanie działa tylko dla prostych żądań.
  - Tryb `CUSTOM_ORIGIN` z tablicą ustawia niepoprawny nagłówek.
  - `*` gryzie się z `credentials`.
  - Poza przeglądarką CORS nie ma znaczenia: curl i monitoring wołają `/health` bez niego.
- **CORS to nie kontrola dostępu.** Przeglądarka ogranicza tylko to, czy skrypt z innej domeny odczyta odpowiedź. Serwisy monitorujące, curl i inne backendy go ignorują. Blokowanie dostępu to zadanie guardów (sesja, role), tokenu w nagłówku albo listy dozwolonych IP.
- **Publiczna trasa dla przeglądarki z dowolnej domeny** (np. strona statusu w JS wołająca `/health`): zamiast interceptora jedna funkcja w `enableCors((req, cb) => …)`. Dla ścieżek z listy `PUBLIC_CORS_PATHS` zwraca `{ origin: '*', credentials: false }`, dla reszty `{ origin: corsOrigins, credentials: true }`. Ta funkcja obsługuje też preflight. Na taką listę trafiają tylko trasy z `@Public()`, które nie zwracają danych użytkownika. Dopóki żadna strona w przeglądarce tego nie potrzebuje, lista zostaje pusta.

## Maile

- Przejmujemy:
  - osobne transportery `nodemailer` dla maili do użytkowników i powiadomień systemowych;
  - zapis wysłanych maili w tabeli `mail` z `MailType`, jako audyt;
  - klucze w env, udokumentowane w `backend-subtracker/.env.example` od F-01:
    - poczta do użytkowników: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`;
    - powiadomienia do operatora: `NOTIFICATION_ADMINISTRATOR_MAIL`, `NOTIFICATION_SMTP_*` z tym samym zestawem pól.
    
    Klucze sprawdza przy starcie `validateEnv` (`src/config/env.ts`). W PROD wymagane są `SMTP_HOST` i `NOTIFICATION_ADMINISTRATOR_MAIL`. Ustawiony host, `SMTP_HOST` albo `NOTIFICATION_SMTP_HOST`, wymaga kompletu pól: `*_USERNAME`, `*_PASSWORD`, `*_FROM_EMAIL`. W DEV pusty `SMTP_HOST` kieruje maile na konsolę. Puste `NOTIFICATION_SMTP_*` oznaczają, że powiadomienia idą przez transporter `SMTP_*`.
- Poprawki:
  - zapis do bazy z `await` i obsługą błędu;
  - treść HTML z szablonu z escapowaniem danych użytkownika (boilerplate wstawiał `${text}` do HTML wprost);
  - konfiguracja SMTP walidowana przy starcie, tak jak reszta env.

## Struktura i ESM

- Moduł per funkcja (`auth/`, `users/`, `mail/`) z podkatalogami `controllers/`, `services/`, `dtos/`, `entities/`, jak w boilerplate. `shared/` (dekoratory, guardy, typy) jest liściem: nie importuje modułów funkcji, więc nie ma `forwardRef`. Guardy dostają to, czego potrzebują, przez wstrzyknięcie repozytorium lub serwisu z modułu `auth`.
- Importy względne z rozszerzeniem `.js`. Bez aliasu `src/...`, bo w natywnym ESM nie zadziała bez dodatkowego loadera.
- Operacje na kilku encjach w `dataSource.transaction(...)` (wzór z `register`). Zwracamy DTO odpowiedzi; status zostaje w kodzie HTTP, nie w treści.
- Każdy `Promise` z `await` albo jawnie obsłużony. W boilerplate dwa brakujące `await` przy `argon2.verify` i `changeActivateUserAccount` wyłączały kontrole bezpieczeństwa.

## Dane domenowe (od S-02)

Sprawdzone w pierwszym module domenowym `subscriptions/` (S-02 `first-subscription-in-list`, 2026-11-11). Reguły ogólne (indeksy na FK, migracje, `Relation<T>`, `shared/` vs moduł funkcji) są w `lessons.md`.

- **Kwoty:** kolumna `numeric(10,2)`; node-pg zwraca ją jako string, więc encja ma `amount: string`, a API oddaje string z dwoma miejscami (`"43.00"`). Na wejściu liczba (`@IsNumber({ maxDecimalPlaces: 2 })`, zakres w DTO), zapis przez `toFixed(2)`. Bez transformerów i bez arytmetyki na floatach w SQL ani w serwisie. Kwota jest kwotą za cykl (`monthly` / `yearly`); przeliczenie na miesiąc liczy się w groszach (frontend: `monthlyAmount`).
- **Daty bez czasu:** kolumna `date`, w encji i API string `YYYY-MM-DD` (bez strefy, bez `Date`). Walidacja `IsDateOnly` z `shared/validation/` (odrzuca 31.02). Daty w przeszłości są dozwolone.
- **Zamknięte listy:** `varchar(n)` + enum TS + `@IsEnum`, bez enumów Postgresa (`SubscriptionStatus`, `BillingCycle`, `PaymentMethod`).
- **Kategorie domyślne i własne w jednej tabeli:** domyślne mają `user_id NULL` i stałe UUID w module (`default-categories.ts`), wstawiane migracją danych z wartościami wpisanymi wprost i seederem bazy dev (`orIgnore`). Własne mają `user_id` z kaskadą. Zapytania „moje + domyślne”: `user_id IS NULL OR user_id = :userId`; cudza kategoria daje ten sam 400 co nieistniejąca.
- **Unikalność bez wielkości liter:** klucz porównania liczy aplikacja (`toNameKey` = `toLocaleLowerCase('pl')`, `shared/text/`) i zapisuje w `name_key` (varchar dwa razy dłuższy niż nazwa). Indeks wyrażeniowy `(COALESCE(user_id, <zero uuid>), name_key)` pisany ręcznie w migracji, w encji `@Index(<nazwa>, { synchronize: false })`, ten sam SQL jako stała uruchamiana przez seeder bazy dev. Serwis sprawdza konflikt przed zapisem (409), a wyścig (`23505` tego ograniczenia, sprawdzanego po nazwie) też mapuje na 409. W unikalności nie opieramy się na `lower()` w SQL: jego wynik zależy od locale bazy (`lower()` zostaje tylko w remisie sortowania, z kolacją ICU).
- **Sortowanie tekstu w SQL:** produkcja ma `datcollate = C.UTF-8` (kolejność kodów Unicode), więc `ORDER BY` po nazwach dostaje `COLLATE "pl-PL-x-icu"` ze stałej `POLISH_COLLATION` (`shared/database/`). Lokalne bazy (`Polish_Poland.1250`) sortują poprawnie i bez tego, więc lokalne testy e2e takiego błędu nie złapią. Łapie go dopiero job `backend-e2e` w CI (Postgres `C.UTF-8`), o ile test sprawdza kolejność nazw z polskimi literami.
- **Kolejność listy jako enum w serwisie:** `SubscriptionSort` (dziś jedna wartość `status_then_date`) budowany w SQL (`subscription-order.ts`): grupa statusu, data odniesienia, remis po nazwie, potem `created_at`. Sortowanie przez użytkownika (FR-016) dołoży wartości enumu zamiast nowego kodu.
- **Kaskada od użytkownika:** dane domenowe mają `ON DELETE CASCADE` na `user_id` — podstawa przyszłego usuwania konta. FK między danymi domenowymi zostają `NO ACTION` (`subscription.category_id`): usunięcie kategorii musi najpierw przepiąć subskrypcje albo zwrócić 409 (`23503`).
- **Nowa kolumna NOT NULL a baza dev:** `synchronize` nie doda jej do tabeli, która ma już wiersze (np. kategorie domyślne), i aplikacja nie wstanie, zanim seeder cokolwiek naprawi. Migracja na `subtracker-db` dodaje kolumnę jako nullable, uzupełnia i ustawia NOT NULL; bazę dev trzeba uzupełnić tak samo jednorazowym skryptem w `dev-local/` (wzór: `backfill-category-name-key.mjs`) albo odtworzyć. `subtracker-db-dev` jest wspólna dla wszystkich worktree: start ze starszego brancha (bez nowej kolumny) przez `synchronize` ją usunie, więc worktree na starszych branchach nie uruchamiają API na wspólnej bazie dev.
- **Odpowiedzi:** encja mapowana na typ odpowiedzi bez `userId`; `GET` z danymi użytkownika z `Cache-Control: no-store`; `POST` z jawnym `@HttpCode(201)`. Odpowiedź po zapisie budowana z zapisanej encji, bez ponownego odczytu.
