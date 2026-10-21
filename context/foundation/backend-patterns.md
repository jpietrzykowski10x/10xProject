# Wzorce backendu (NestJS)

> Wzorce dla `backend-subtracker/` przejęte i poprawione z wcześniejszego projektu użytkownika (`fyi/nestboilerplate`, poza gitem). Czytają je /10x-plan i /10x-implement, gdy slice dotyka uwierzytelniania, ról, CORS albo maili. Pierwsze zastosowanie: S-01 `magic-link-sign-in`, potem S-09 `admin-account-management`.

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
- Role startowe zakłada migracja danych ze stałymi UUID i `code`, jak `AddBaseUserRoles` w boilerplate. Nowy użytkownik dostaje `USER` w tej samej transakcji, w której powstaje konto.
- `ADMIN` nadaje operator poza aplikacją (PRD: Access Control), skryptem `npm run admin:grant -- <mail>` uruchamianym na serwerze. Nie ma API do zarządzania adminami ani roli superadmina na MVP.
- Do uprawnień liczą się tylko role z `is_active = true`. Boilerplate tego pola nie sprawdzał.
- Kod porównuje `code` przez unię typów / enum `RoleCode`, nigdy przez nazwę wyświetlaną.
- Rozszerzenie na później, bez łamania schematu: tabela `permission` i `role_permission` oraz dekorator `@RequirePermission()`.

## Sesja zamiast JWT

- Tabela `session`: `id`, `user_id`, `token_hash` (sha256, unique), `created_at`, `expires_at`, `revoked_at`, opcjonalnie `user_agent`. Każde urządzenie ma osobną sesję. W boilerplate był jeden wiersz tokenów na użytkownika, więc zalogowanie na drugim urządzeniu wylogowywało z pierwszego.
- Token jest losowy (`crypto.randomBytes(32)`) i ma wysoką entropię, więc wystarczy sha256. Argon2 zostaje dla haseł (FR-003, nice-to-have). Boilerplate weryfikował argon2 przy każdym żądaniu, a to celowo wolny algorytm.
- Ciasteczko: `httpOnly`, `Secure`, `SameSite=Lax`, `Domain=.jakubpietrzykowski.pl`, `Path=/`. Wylogowanie i blokada konta (S-09) ustawiają `revoked_at`.
- Magic link: tabela `magic_link_token` (`token_hash`, `user_id`, `expires_at`, `used_at`). Jednorazowość zapewnia atomowy `UPDATE … SET used_at = now() WHERE used_at IS NULL AND expires_at > now()`.

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
  - klucze `SMTP_*` w env.
- Poprawki:
  - zapis do bazy z `await` i obsługą błędu;
  - treść HTML z szablonu z escapowaniem danych użytkownika (boilerplate wstawiał `${text}` do HTML wprost);
  - konfiguracja SMTP walidowana przy starcie, tak jak reszta env.

## Struktura i ESM

- Moduł per funkcja (`auth/`, `users/`, `mail/`) z podkatalogami `controllers/`, `services/`, `dtos/`, `entities/`, jak w boilerplate. `shared/` (dekoratory, guardy, typy) jest liściem: nie importuje modułów funkcji, więc nie ma `forwardRef`. Guardy dostają to, czego potrzebują, przez wstrzyknięcie repozytorium lub serwisu z modułu `auth`.
- Importy względne z rozszerzeniem `.js`. Bez aliasu `src/...`, bo w natywnym ESM nie zadziała bez dodatkowego loadera.
- Operacje na kilku encjach w `dataSource.transaction(...)` (wzór z `register`). Zwracamy DTO odpowiedzi; status zostaje w kodzie HTTP, nie w treści.
- Każdy `Promise` z `await` albo jawnie obsłużony. W boilerplate dwa brakujące `await` przy `argon2.verify` i `changeActivateUserAccount` wyłączały kontrole bezpieczeństwa.
