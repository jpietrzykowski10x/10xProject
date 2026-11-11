# Ochrona CSRF w API — plan implementacji

## Overview

API odrzuca żądania zmieniające stan (`POST`, `PUT`, `PATCH`, `DELETE`), które przeglądarka wysłała z obcej strony. Używamy wbudowanej ochrony Nesta (`app.enableCsrfProtection`), a zaufane są originy z `CORS_ORIGINS`. Zamyka to follow-up F1 z pełnego przeglądu S-01 (login CSRF na `/auth/verify`) i bloker S-02 w roadmapie, zanim dojdą trasy zapisujące subskrypcje.

## Current State Analysis

- `backend-subtracker/src/config/http-security.ts:5-11`: `applyHttpSecurity(app, corsOrigins)` woła tylko `applyCors` i `app.useSecurityHeaders()`. Używają go `src/main.ts:19` i `test/app.e2e-spec.ts:26`.
- `backend-subtracker/test/auth.e2e-spec.ts:148`: aplikacja testowa auth powstaje bez `applyHttpSecurity`, więc testy auth nie biegną na polityce produkcyjnej (CORS, nagłówki, a po tej zmianie CSRF).
- Ochrona w Nest 12 (`node_modules/@nestjs/core/security/cross-origin-protection.js`, wzór z Go `CrossOriginProtection`): `GET`/`HEAD`/`OPTIONS` zawsze przechodzą; przy `Sec-Fetch-Site` przechodzą tylko `same-origin` i `none`; bez `Sec-Fetch-Site` żądanie bez `Origin` przechodzi (curl, health-check), a `Origin` musi pasować do `Host`. Pozostałe dostają `403 ForbiddenException`, chyba że `Origin` jest na liście `trustedOrigins` (dokładne dopasowanie po normalizacji).
- Frontend (`subtracker.jakubpietrzykowski.pl`) woła API (`apisubtracker.jakubpietrzykowski.pl`) z innej subdomeny, więc przeglądarka wysyła `Sec-Fetch-Site: same-site`. Bez `trustedOrigins` frontend zostałby odcięty. Lokalnie `localhost:4200` → `localhost:3000` to także `same-site`.
- `CORS_ORIGINS` jest już znormalizowane do `scheme://host[:port]` (`src/config/cors.ts:11-26`, `assertExactOrigin`), a `env.ts:104-117` wymaga, żeby zawierało `FRONTEND_URL`.
- Serwer SSR frontendu woła z serwera tylko `GET /auth/session` (bez `Origin`) — nie podlega ochronie.
- 4xx nie są logowane (`SafeLoggingExceptionFilter`, decyzja F8 z S-01), więc odrzucenia CSRF też nie.

## Desired End State

- Każde żądanie zmieniające stan z obcej strony w przeglądarce dostaje 403, zanim dotrze do kontrolera — dotyczy `/auth/verify`, `/auth/logout`, `/auth/register`, `/auth/request-link` i każdej przyszłej trasy S-02.
- Frontend z `CORS_ORIGINS` działa bez zmian; klienci bez nagłówków przeglądarki (curl, health-check, SSR) też.
- Testy e2e pokazują oba kierunki i biegną na tej samej polityce co produkcja.
- Po potwierdzeniu na produkcji wzorzec jest opisany w `backend-patterns.md`, specyfikacji skilla (10.6) i roadmapie.

### Key Discoveries:

- `backend-subtracker/src/config/http-security.ts:5` — jedyne miejsce, gdzie składa się polityka HTTP; wspólne dla `main.ts` i e2e (wzorzec z F-01).
- `backend-subtracker/test/app.e2e-spec.ts:15-28` — e2e z `applyHttpSecurity` i `allowedOrigin = env.CORS_ORIGINS[0]`; tu pasują testy CSRF.
- `POST /auth/logout` (publiczne, idempotentne, zawsze 204, `backend-patterns.md:54-56`) — cel testów bez danych i skutków ubocznych.
- `fyi/mydevil-boilerplate-skill-spec.md` 10.6 — wzorzec CSRF opisany jako „niesprawdzony, potwierdzić przed włączeniem do szablonu”.

## What We're NOT Doing

- Tokenów CSRF (double-submit, synchronizer) — ochrona oparta na nagłówkach przeglądarki wystarcza przy `SameSite=Lax` i braku formularzy na innych domenach.
- Wyjątków (`exclude`) — API nie ma webhooków ani tras dla obcych stron.
- Zmian we frontendzie — wywołania już idą z zaufanego originu.
- Logowania odrzuceń 403 (zostaje decyzja F8).
- Osobnej listy zaufanych originów — `trustedOrigins` to całe `CORS_ORIGINS`.

## Implementation Approach

Jedna zmiana w `applyHttpSecurity`, więc produkcja i oba zestawy e2e dostają tę samą politykę. Testy wywołują `POST /auth/logout` z kombinacjami nagłówków, które wysyła przeglądarka (obca strona, prawdziwy frontend) i klient bez przeglądarki. Dokumentacja wzorca dopiero po teście na produkcji, w osobnym commicie.

## Critical Implementation Details

- **Kolejność w `applyHttpSecurity`:** `enableCsrfProtection` i `useSecurityHeaders` dzielą jeden hook żądania, rejestrowany przy pierwszym z nich, i oba muszą być wywołane przed `app.init()`/`listen()`. `applyHttpSecurity` już jest wołane przed `init` w `main.ts` i e2e — `auth.e2e-spec.ts` musi zrobić to samo przed swoim `app.init()`.

## Phase 1: Ochrona CSRF i testy e2e

### Overview

Włączenie ochrony w polityce HTTP i testy pilnujące, że obca strona jest odrzucana, a frontend i klienci bez przeglądarki przechodzą.

### Changes Required:

#### 1. Polityka HTTP

**File**: `backend-subtracker/src/config/http-security.ts`

**Intent**: Dodać ochronę CSRF do wspólnej polityki, z zaufanymi originami z `CORS_ORIGINS`.

**Contract**: `applyHttpSecurity(app, corsOrigins)` bez zmiany sygnatury woła dodatkowo `app.enableCsrfProtection({ trustedOrigins: corsOrigins })`. Komentarz nad wywołaniem mówi, dlaczego `trustedOrigins` jest potrzebne (frontend na innej subdomenie = `same-site`).

#### 2. Testy e2e polityki

**File**: `backend-subtracker/test/app.e2e-spec.ts`

**Intent**: Pokazać oba kierunki ochrony na `POST /auth/logout`.

**Contract**: nowe przypadki:
- `Origin: https://example.com` + `Sec-Fetch-Site: cross-site` → 403;
- tylko `Origin: https://example.com` (stara przeglądarka, bez `Sec-Fetch-Site`) → 403;
- `Origin: <allowedOrigin>` + `Sec-Fetch-Site: same-site` (prawdziwy frontend) → 204;
- bez `Origin` i `Sec-Fetch-Site` (curl, health-check) → 204;
- `GET /health` z `Origin: https://example.com` + `Sec-Fetch-Site: cross-site` → 200 (bezpieczne metody nie są blokowane).

#### 3. Testy auth na polityce produkcyjnej

**File**: `backend-subtracker/test/auth.e2e-spec.ts`

**Intent**: Aplikacja testowa auth dostaje `applyHttpSecurity(app, env.CORS_ORIGINS)` przed `app.init()`, żeby testy logowania biegły na tej samej polityce co produkcja.

**Contract**: istniejące testy (żądania supertest bez `Origin`) przechodzą bez zmian; dodatkowo jeden test scenariusza z F1: `POST /auth/verify` z ważnym tokenem, `Origin: https://example.com` i `Sec-Fetch-Site: cross-site` → 403, bez `Set-Cookie`, a token pozostaje niezużyty (następne `POST /auth/verify` bez obcych nagłówków go przyjmuje).

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `cd backend-subtracker && npm test`
- Testy e2e przechodzą, w tym nowe przypadki CSRF: `npm run test:e2e`
- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`

#### Manual Verification:

- Lokalnie (`npm run start:dev` + `npm start` we frontendzie): rejestracja, logowanie linkiem, „Zaloguj” na `/auth/verify` i „Wyloguj” działają, a w Network żadne żądanie API nie dostaje 403
- Lokalnie curl z `-H "Origin: https://example.com" -H "Sec-Fetch-Site: cross-site"` na `POST http://localhost:3000/auth/logout` zwraca 403

**Implementation Note**: Po fazie i automatycznych kontrolach zatrzymaj się na potwierdzenie testów ręcznych przez użytkownika.

---

## Phase 2: Wdrożenie i dokumentacja

### Overview

Deploy API, test na produkcji z prawdziwym frontendem i sfałszowanym żądaniem, a po potwierdzeniu zapisanie wzorca w dokumentacji.

### Changes Required:

#### 1. Pull request i deploy

**File**: —

**Intent**: Użytkownik pushuje `change/csrf-protection`, otwiera PR i scala go po zielonym CI. Rusza deploy API (krótki przestój, bez migracji).

**Contract**: bez zmian w `deploy/mydevil/` i w `shared/.env`; `CORS_ORIGINS` na serwerze już zawiera frontend.

#### 2. Dokumentacja wzorca (po potwierdzeniu na produkcji)

**File**: `context/foundation/backend-patterns.md`, `context/foundation/roadmap.md`, `fyi/mydevil-boilerplate-skill-spec.md` (poza gitem)

**Intent**: Zapisać sprawdzony wzorzec i zdjąć bloker S-02.

**Contract**:
- `backend-patterns.md`: punkt „Ochrona CSRF jest odłożona…” zastąpiony opisem stanu: `enableCsrfProtection({ trustedOrigins: CORS_ORIGINS })` w `applyHttpSecurity`, dlaczego `trustedOrigins` (same-site), co przechodzi (GET/HEAD/OPTIONS, klienci bez `Origin`), 403 bez logu, testy w `app.e2e-spec.ts` i `auth.e2e-spec.ts`.
- `roadmap.md`: w S-02 linia `Blockers` mówi, że CSRF jest zrobione (`csrf-protection`), a w tabeli backlogu Notes S-02 nie czeka już na CSRF.
- Specyfikacja 10.6: punkt CSRF przeniesiony do opisu backendu (10.2) jako sprawdzony na produkcji; w 10.6 zostaje tylko reszta listy.

### Success Criteria:

#### Automated Verification:

- CI na PR jest zielone: joby `backend`, `frontend`, `deploy-scripts`
- Deploy API na `main` przeszedł, wraz z health-checkiem

#### Manual Verification:

- Na produkcji pełny przepływ z frontendu: logowanie linkiem, „Zaloguj”, pusta lista, „Wyloguj” — bez 403 w Network
- Na produkcji `curl -X POST https://apisubtracker.jakubpietrzykowski.pl/auth/logout -H "Origin: https://example.com" -H "Sec-Fetch-Site: cross-site"` zwraca 403, a to samo z `Origin: https://subtracker.jakubpietrzykowski.pl` i `Sec-Fetch-Site: same-site` zwraca 204
- Dokumentacja (`backend-patterns.md`, roadmapa, spec 10.6) opisuje wzorzec jako sprawdzony na produkcji

---

## Testing Strategy

### Unit Tests:

- Brak nowych: zmiana to konfiguracja frameworka, sprawdzana na całej aplikacji w e2e.

### Integration Tests:

- `app.e2e-spec.ts`: macierz nagłówków dla `POST /auth/logout` i bezpieczna metoda.
- `auth.e2e-spec.ts`: atak z F1 na `/auth/verify` odrzucony bez zużycia tokenu i bez ciasteczka; reszta testów auth na polityce produkcyjnej.
- Kontrola celowego uszkodzenia: bez `enableCsrfProtection` testy 403 mają być czerwone; z pustym `trustedOrigins` czerwony ma być test frontendu (`same-site` → 204).

### Manual Testing Steps:

1. Lokalnie pełny przepływ S-01 z frontendu, Network bez 403.
2. Lokalnie i na produkcji curl z obcym `Origin` → 403, z originem frontendu + `same-site` → 204.

## Performance Considerations

Brak: sprawdzenie nagłówków w hooku żądania, bez I/O.

## Migration Notes

Brak zmian w bazie. Wycofanie: `rollback.sh api` na serwerze albo revert commita.

## References

- Przegląd S-01, F1: `context/archive/2026-11-03-magic-link-sign-in/reviews/impl-review.md`
- Follow-up w planie S-01: `context/archive/2026-11-03-magic-link-sign-in/plan.md` (## Follow-ups)
- Wzorce backendu: `context/foundation/backend-patterns.md` (sekcja o trasach sesji i CSRF)
- Implementacja Nesta: `backend-subtracker/node_modules/@nestjs/core/security/cross-origin-protection.js`
- Roadmapa, bloker S-02: `context/foundation/roadmap.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Ochrona CSRF i testy e2e

#### Automated

- [x] 1.1 Testy jednostkowe przechodzą: `cd backend-subtracker && npm test` — 6351951
- [x] 1.2 Testy e2e przechodzą, w tym nowe przypadki CSRF: `npm run test:e2e` — 6351951
- [x] 1.3 Lint przechodzi: `npm run lint` — 6351951
- [x] 1.4 Build przechodzi: `npm run build` — 6351951

#### Manual

- [x] 1.5 Lokalnie (`npm run start:dev` + `npm start` we frontendzie): rejestracja, logowanie linkiem, „Zaloguj” na `/auth/verify` i „Wyloguj” działają, a w Network żadne żądanie API nie dostaje 403 — 6351951
- [x] 1.6 Lokalnie curl z `-H "Origin: https://example.com" -H "Sec-Fetch-Site: cross-site"` na `POST http://localhost:3000/auth/logout` zwraca 403 — 6351951

### Phase 2: Wdrożenie i dokumentacja

#### Automated

- [x] 2.1 CI na PR jest zielone: joby `backend`, `frontend`, `deploy-scripts` — c6b27d7
- [x] 2.2 Deploy API na `main` przeszedł, wraz z health-checkiem — c6b27d7

#### Manual

- [x] 2.3 Na produkcji pełny przepływ z frontendu: logowanie linkiem, „Zaloguj”, pusta lista, „Wyloguj” — bez 403 w Network — c6b27d7
- [x] 2.4 Na produkcji `curl -X POST https://apisubtracker.jakubpietrzykowski.pl/auth/logout -H "Origin: https://example.com" -H "Sec-Fetch-Site: cross-site"` zwraca 403, a to samo z `Origin: https://subtracker.jakubpietrzykowski.pl` i `Sec-Fetch-Site: same-site` zwraca 204 — c6b27d7
- [x] 2.5 Dokumentacja (`backend-patterns.md`, roadmapa, spec 10.6) opisuje wzorzec jako sprawdzony na produkcji — c6b27d7
