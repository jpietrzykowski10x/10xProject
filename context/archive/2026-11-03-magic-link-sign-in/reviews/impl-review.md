<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Rejestracja i logowanie magic linkiem

- **Plan**: context/changes/magic-link-sign-in/plan.md
- **Scope**: Full plan (fazy ukończone; faza 5 jeszcze nie ruszyła)
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-04
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 7 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Evidence

Kontrole automatyczne uruchomione 2026-11-04 na 2d7f9b7:

- Backend: `npm test` 100/100, `npm run test:e2e` 40/40, `npm run lint` exit 0 (9 ostrzeżeń `unbound-method` w specach guardów), `npm run build` przechodzi.
- Migracje: `npm run migration:show` pokazuje 4 zastosowane, `npm run migration:generate -- Check` kończy się „No changes in database schema were found” (oczekiwane exit 1).
- Frontend: `npm run build` i `npm run prepare-mydevil` przechodzą; prerender jest dla `/register` i `/sign-in`, a nie ma go dla `/subscriptions` i `/auth/verify`.

Kontrole ręczne: wszystkie pozycje faz 1–4 są odhaczone. Pozycje 4.4–4.10 i test przekierowań potwierdził użytkownik w tej sesji. Pozycje 1.4, 2.5, 3.6 i 3.7 pochodzą z wcześniejszych sesji; 3.6 przeczytano ponownie w przeglądzie fazy 3.

Ustalenia z przeglądu fazy 3 są w `impl-review-phase-3.md` i nie są tu powtarzane. Testy przeglądarkowe recenzenta (Chrome bez interfejsu) działały na zbudowanym `dist` z atrapą API, a nie na produkcji.

## Findings

### F1 — Obca strona może zalogować ofiarę na konto atakującego (login CSRF)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/main.ts:19, src/auth/controllers/auth.controller.ts:47
- **Detail**: Atakujący rejestruje się, bierze świeży token z własnego maila i umieszcza na swojej stronie automatycznie wysyłany formularz POST na `/auth/verify`. Ofiara, która otworzy tę stronę, dostaje ciasteczko sesji konta atakującego, a dane wpisane później (S-02) są dla niego widoczne. `SameSite=Lax` ogranicza wysyłanie ciasteczka, a nie jego zapis, CORS ukrywa tylko odpowiedź, a przycisk „Zaloguj” da się ominąć. W Chrome automatyczny POST z obcej domeny zapisał ciasteczko na atrapie API; atrapa Nest przyjęła ciało urlencoded. Nie testowano tego na prawdziwym `/auth/verify` przez HTTPS. Ten sam brak dotyczy `/auth/logout` i przyszłych tras S-02.
- **Fix**: `app.enableCsrfProtection({ trustedOrigins: env.CORS_ORIGINS })` w funkcji wspólnej dla `main.ts` i testów e2e, razem z `applyCors`, plus test e2e na odrzucenie obcego `Origin` i `Sec-Fetch-Site`.
  - Strength: Wbudowane w zainstalowanego Nesta (`core/security/cross-origin-protection.js`); chroni wszystkie obecne i przyszłe trasy zmieniające stan.
  - Tradeoff: Jedna linia i test. Klienci bez nagłówków `Origin` i `Sec-Fetch-Site` (curl, health-check) przechodzą dalej, a ochrona działa dla przeglądarek.
  - Confidence: HIGH — kod zabezpieczenia przeczytany, a `GET`, `HEAD` i `OPTIONS` są z niego wyłączone, więc preflight i `/health` działają.
  - Blind spot: Działanie z prawdziwego frontendu na produkcji trzeba potwierdzić w fazie 5 (5.4).
- **Decision**: DEFERRED: użytkownik odkłada do czasu, gdy będą możliwe testy w pełnym zakresie; zapisane w ## Follow-ups z zaleceniem zrobienia tego przed S-02.

### F2 — Formularze prerenderowane nie działają, dopóki /auth/me nie odpowie

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/auth/auth.guard.ts:13, src/app/app.routes.ts:8,13,18
- **Detail**: `guestGuard`, dodany po testach fazy 4, opóźnia utworzenie komponentu, choć formularz z prerenderu jest już widoczny. W Chrome przy `/auth/me` opóźnionym o 2 s wpisany adres został skasowany po `401`, a wczesne kliknięcie spowodowało natywne wysłanie formularza i przeładowanie strony, bez `POST /auth/request-link`. Okno trwa jedno żądanie do API, a przy zawieszonym API do 3 s. `/register` ma tę samą budowę, ale nie był osobno testowany, tak jak autouzupełnianie. Test ręczny tego nie wykazał, bo lokalne API odpowiada natychmiast.
- **Fix A ⭐ Recommended**: Guard przepuszcza od razu, a sprawdzenie sesji i przekierowanie działają w tle po wyrenderowaniu strony.
  - Strength: Formularz działa od razu i nic nie znika; prerender zostaje, więc kryterium 4.3 nadal obowiązuje.
  - Tradeoff: Zalogowany przez ułamek sekundy dłużej widzi stronę przed przekierowaniem.
  - Confidence: HIGH — usuwa przyczynę potwierdzoną testem w Chrome.
  - Blind spot: Trzeba sprawdzić, że przekierowanie w tle nie koliduje z wysyłką formularza zaczętą przed odpowiedzią `me`.
- **Fix B**: Zmienić `/`, `/register` i `/sign-in` na `RenderMode.Client`.
  - Strength: Najprostsze; bez prerenderu nie ma widocznego formularza przed guardem.
  - Tradeoff: Pusta strona do czasu odpowiedzi API, trzeba przepisać kryterium 4.3 i tracimy główny zysk z prerenderu.
  - Confidence: MED — zachowanie pewne, ale wprost zmienia decyzję z planu.
  - Blind spot: Czas pustej strony przy wolnym API.
- **Decision**: FIXED via Fix B: `/`, `/register`, `/sign-in` w RenderMode.Client; kryterium 4.3 nieaktualne dla tych tras (## Follow-ups).

### F3 — TLS do SMTP nie jest wymuszony

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/mail/mail.transport.ts:26
- **Detail**: Przy `SMTP_SECURE=false` nodemailer przechodzi na STARTTLS tylko wtedy, gdy serwer je ogłosi. Jeśli atakujący w sieci to usunie, hasło i mail z działającym tokenem idą otwartym tekstem. `.env.example` opisuje ten tryb jako „STARTTLS on 587”, czego kod nie wymusza. Nie sprawdzano, czy ruch do SMTP MyDevil da się przechwycić.
- **Fix**: Dodać `requireTLS: !settings.secure` w `smtpSender` i sprawdzić prawdziwą wysyłkę lokalnie.
- **Decision**: FIXED: `requireTLS: !settings.secure`. Sprawdzone na mail39.mydevil.net:587: STARTTLS ogłoszone, logowanie z requireTLS udane, bez wysyłki.

### F4 — authGuard bez limitu czasu

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/auth/auth.guard.ts:28
- **Detail**: Gdy API wisi, a nie zwraca błędu, `/subscriptions` zostaje pustą stroną; test w Chrome pokazał brak treści po 5 s. `guestGuard` ma limit, a ten guard nie.
- **Fix**: Dodać `timeout`, po którym guard kieruje na `/unavailable`.
- **Decision**: FIXED: timeout 10 s w authGuard kieruje na /unavailable; sprawdzone w Chrome przy zawieszonej atrapie API.

### F5 — Sesja nieudana po udanym verify bez jasnego komunikatu

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/verify-link/verify-link.ts:29, backend-subtracker/src/config/env.ts:158
- **Detail**: Przy błędnym `SESSION_COOKIE_DOMAIN` albo zablokowanym ciasteczku `verify` daje 200, a kolejne `me` 401: użytkownik wraca na `/sign-in` bez komunikatu, ze zużytym tokenem. `validateEnv` sprawdza tylko niepustość domeny i nie porównuje `CORS_ORIGINS` z `FRONTEND_URL`, więc literówka w `shared/.env` wyjdzie dopiero w teście na produkcji. Przy `me` z 503 adres zachowuje zużyty token, a odświeżenie mówi „nieprawidłowy link”.
- **Fix**: W PROD sprawdzać w `validateEnv`, że host `FRONTEND_URL` należy do `SESSION_COOKIE_DOMAIN`, a `FRONTEND_URL` jest w `CORS_ORIGINS`; drugi przypadek zostawić.
- **Decision**: FIXED: validateEnv w PROD sprawdza, że SESSION_COOKIE_DOMAIN obejmuje host FRONTEND_URL, a CORS_ORIGINS zawiera FRONTEND_URL. Drugi przypadek (503 po verify) zostaje.

### F6 — Podwójne wysłanie formularza i adresy w cudzysłowie

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/sign-in/sign-in.ts:25, register.ts:25, backend-subtracker/src/auth/dtos/request-link.dto.ts:15
- **Detail**: `submit()` nie sprawdza stanu `sending`, a jedynie blokuje przycisk. Syntetyczne wywołania w jednym zadaniu wysłały 3 żądania, a każde unieważnia poprzedni link; prawdziwego podwójnego kliknięcia nie odtworzono. Osobno `IsEmail` przyjmuje część lokalną w cudzysłowie, np. z CRLF: adres na koncie i adres dostarczenia mogą się wtedy różnić. W 10 przypadkach testowych nie było wstrzyknięcia nagłówków ani zmiany domeny, a dojść do tego można tylko wywołując API bezpośrednio.
- **Fix**: Dodać `if (state() === 'sending') return` i odrzucać `"` w adresie w DTO.
- **Decision**: FIXED częściowo: `ValidEmail` odrzuca `"` w adresie (test e2e). Podwójne wysłanie zostaje na decyzję użytkownika: 2 POST-y tylko przy 0 ms odstępu, 1 POST przy 30 i 120 ms oraz przy Enter x3.

### F7 — Brak nagłówków bezpieczeństwa

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/main.ts, frontend-subtracker/src/server.ts
- **Detail**: Żadna aplikacja nie wysyła CSP, `X-Frame-Options` ani `nosniff`, a obie ujawniają `X-Powered-By: Express`. Wpływ jest dziś mały, bo aplikacja nie ma miejsc wstrzyknięcia HTML. Strona `/subscriptions` zacznie pokazywać dane użytkownika w S-02.
- **Fix**: `app.useSecurityHeaders()` w API teraz, a w `server.ts` mała warstwa nagłówków przed S-02.
- **Decision**: FIXED: app.useSecurityHeaders() w API (applyHttpSecurity), a w server.ts nosniff, X-Frame-Options, Referrer-Policy i bez x-powered-by. CSP frontendu odłożone.

### F8 — Logi: błędy klienta jako ERROR i komunikaty SMTP

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/shared/filters/safe-logging-exception.filter.ts:45, src/mail/services/mail.service.ts:83
- **Detail**: Błędy 413 i 415 powodowane przez klienta trafiają na poziom ERROR ze stack trace'em, bez sesji, co pozwala anonimowo zwiększać `err.log`; logi przycina tylko tygodniowy cron. Osobna hipoteza, bez wywołania prawdziwego błędu SMTP: komunikat o odrzuconym odbiorcy może zawierać adres e-mail, wbrew intencji F7 z fazy 3.
- **Fix**: Logować ERROR ze stackiem tylko dla statusu >= 500, a w `mail.service.ts:83` logować `code` i `id` wiersza audytu.
- **Decision**: FIXED: filtr nie loguje błędów 4xx, a 5xx loguje wg `LOG_ERROR_STACKS`. MailService loguje `code` i `id` wiersza; pełny komunikat zostaje w audycie. Alertu nie ma tylko przy trwałym odrzuceniu odbiorcy (`EENVELOPE`, `RCPT TO`, 5xx); odrzucony nadawca i odmowy tymczasowe nadal alarmują.

### F9 — TypeORM próbuje instalować pgcrypto na współdzielonym PostgreSQL

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/database/database.options.ts:35
- **Detail**: Encje z `uuid` powodują `CREATE EXTENSION IF NOT EXISTS "pgcrypto"` przy każdym połączeniu, na roli współdzielonego serwera (`PostgresDriver.js:357`). Niepowodzenie daje tylko ostrzeżenie. Przy powodzeniu kolejne kopie mogą zawierać rozszerzenie, a to `restore-db.sh` musiałby obsłużyć; skutek dla odtwarzania to hipoteza, nie uruchamiano tego na PostgreSQL. Migracje używają wbudowanego `gen_random_uuid()`, więc rozszerzenie nie jest potrzebne.
- **Fix**: Ustawić `installExtensions: false` w opcjach bazy.
- **Decision**: FIXED: `installExtensions: false`; `uuidExtension: pgcrypto` zostaje, bo wybiera wbudowane `gen_random_uuid()`.

### F10 — Drobne odstępstwa, martwy kod i otwarte sprawy

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence / Scope Discipline / Pattern Consistency
- **Location**: backend-subtracker/src/users/services/users.service.ts:16, src/mail/services/mail.service.ts:54, src/config/env.ts:96,133, context/foundation/backend-patterns.md:31, frontend-subtracker/src/app/pages/verify-link/verify-link.ts:16, .github/workflows/ci.yml:38
- **Detail**: (1) `UsersService.findByEmail` nie ma wywołań, a `AuthModule` importuje `UsersModule` bez potrzeby; używana jest tylko funkcja `normalizeEmail`. (2) `notifyOperator` bez adresu operatora nie zapisuje audytu; dotyczy tylko DEV, a kolumna `recipient` jest wymagana. (3) DEV z `SMTP_HOST` wymaga danych logowania, ostrzej niż plan. (4) `FRONTEND_URL` ma przycinany końcowy ukośnik zamiast odrzucenia. (5) `/niedostepne` → `/unavailable`, wspólny `styles.scss` i `lang="pl"` są poza planem i nieszkodliwe. (6) `backend-patterns.md:31` poleca `npm run admin:grant` na serwerze, co tam nie zadziała, bo pakiet nie ma `nest build` ani `dist/`. (7) Niekliknięty link zostaje w historii przeglądarki z żywym tokenem do 15 minut. (8) Testy e2e chroniące granicę auth nie działają w CI, co pasuje do Modułu 3.
- **Fix**: Usunąć martwy `UsersService`, zostawiając `normalizeEmail`; poprawić linię o `admin:grant` razem z dokumentacją fazy 5; resztę zapisać jedną notatką w `## Follow-ups`.
- **Decision**: FIXED częściowo: UsersService usunięty, normalizeEmail w users/normalize-email.ts, AuthModule bez UsersModule. Czerwony 401 usunięty publicznym `GET /auth/session`, idempotentnym `POST /auth/logout` i walidacją domeny adresu w formularzach. Linia backend-patterns.md:31 idzie z dokumentacją fazy 5. Pozostałe punkty ACCEPTED przez użytkownika (zapis w ## Follow-ups).
