---
date: 2026-11-14T17:25:09+01:00
researcher: Claude (Opus 5.5) via /10x-research
git_commit: e5b9849
branch: change/browser-critical-paths
repository: 10xProject (SubTracker)
topic: "Etap 4 planu testów — krytyczne ścieżki w przeglądarce (ryzyka #2 i #1)"
tags: [research, test-plan, e2e, ssr, auth-guard, playwright, ci]
status: complete
last_updated: 2026-11-14
last_updated_by: Claude (Opus 5.5)
---

# Research: Etap 4 planu testów — krytyczne ścieżki w przeglądarce

**Date**: 2026-11-14T17:25:09+01:00
**Researcher**: Claude (Opus 5.5) via /10x-research
**Git Commit**: e5b9849 (plus niezacommitowana zmiana `context/foundation/test-plan.md`: status wiersza 4)
**Branch**: change/browser-critical-paths
**Repository**: 10xProject (SubTracker)

## Research Question

Ugruntować etap 4 z `context/foundation/test-plan.md` dla ryzyk #2 (guard SSR/przeglądarka:
przekierowania i brak cache strony zalogowanego) i #1 (IDOR w przeglądarce). Sprawdzić wskazówki
odpowiedzi, a nie przyjmować ich bez weryfikacji. Do tego: jak e2e dostaje sesję bez maila, jak
uruchomić razem zbudowany SSR, API i bazę lokalnie i w CI oraz który job CI ma nieść bramkę
„required after §3 Phase 4”.

## Summary

1. **#2 jest realne, a test SSR w większości nie potrzebuje przeglądarki.** Na serwerze tylko `/`
   jest renderowane per żądanie (`RenderMode.Server` z `Cache-Control: private, no-store`,
   `frontend-subtracker/src/app/app.routes.server.ts:9-11`). Trasy z guardami poza `/` są w
   `RenderMode.Client` (`:16-29`), więc serwer oddaje dla nich wspólną powłokę `index.csr.html`
   bez danych użytkownika i bez uruchamiania guarda (`node_modules/@angular/ssr/fesm2022/ssr.mjs:1098-1101`).
   Zachowanie serwera da się więc sprawdzić zwykłym żądaniem HTTP do zbudowanego serwera (status,
   `Location`, `Cache-Control`, znacznik `ng-server-context`, brak `/auth/session` w stanie
   transferu). Przeglądarka jest potrzebna tylko dla guardów po stronie klienta.
2. **„Działa w `ng serve`, więc działa w SSR” jest fałszywe w dwóch udokumentowanych miejscach.**
   (a) Prerender `'**'` dzieje się tylko w buildzie; serwer produkcyjny nie renderuje tras
   statycznych na żądanie (`allowStaticRouteRender` domyślnie `false`, `ssr.mjs:977`, `:1065`).
   Trasa z guardem pominięta w `app.routes.server.ts` przejdzie w `ng serve`, a w buildzie zostanie
   prerenderowana bez żądania (komentarz `auth.guard.ts:53-56`). (b) Build produkcyjny wskazuje
   produkcyjne API (`environment.ts:3`); tylko konfiguracja `development` podmienia je na
   `http://localhost:3000` (`angular.json:91-101`). E2e na „zbudowanym SSR” potrzebuje więc
   osobnej konfiguracji builda (produkcyjnej, z podmianą środowiska), inaczej serwer i przeglądarka
   zawołają produkcję.
3. **Wskazówka „strona zalogowanego nie jest cache'owana” wymaga zawężenia.** HTML, który zależy
   od ciasteczka, powstaje dla jednej trasy (`/`), a jej odpowiedzi 200 i 302 dostają
   `private, no-store` (nagłówki trasy idą też do odpowiedzi przekierowania, `ssr.mjs:1082-1089`,
   `:1112-1113`). `/subscriptions` to powłoka CSR wspólna dla wszystkich, więc brak nagłówka
   cache nie wycieka danych. Dane zalogowanego idą z API z `Cache-Control: no-store`
   (`auth.controller.ts:66,72`, `subscriptions.controller.ts:21`, `categories.controller.ts:21`),
   co już sprawdzają e2e backendu (`test/auth/session.e2e-spec.ts:27`,
   `test/subscriptions/subscriptions-e2e.ts:50,59`). Do udowodnienia w e2e zostaje:
   odpowiedź dla `/` ma `no-store` w obu wariantach i nie zawiera odpowiedzi `/auth/session`,
   a trasy zalogowanego oddają powłokę CSR, nie prerender.
4. **Macierz decyzji guardów jest już pokryta unitami** (`auth.guard.spec.ts:126-281`: serwer bez
   ciasteczka, serwer z ciasteczkiem, przeglądarka × guest/auth × zalogowany/wygasła/błąd/limit
   czasu; granica HTTP zastąpiona przez `HttpTestingController`, prawdziwe `AuthService` i
   `Router`). E2e nie powinno jej powtarzać; ma sprawdzić tylko to, czego unit nie widzi: render
   mode z builda, nagłówki, przekazanie ciasteczka przez prawdziwy serwer i prawdziwe API oraz
   2–3 przejścia w przeglądarce.
5. **#1 w przeglądarce jest w dużej mierze dublem testu API.** Izolację list i kategorii pilnuje
   `test/subscriptions/account-isolation.e2e-spec.ts:22,44` w jobie `backend-e2e`. Frontend nie
   trzyma danych między kontami: `SubscriptionsService` nie ma cache (`subscriptions.service.ts`),
   stan listy żyje w instancji strony (`subscriptions.ts:105,117-118`), a wylogowanie zeruje
   użytkownika i nawiguje na `/sign-in` (`auth.service.ts:51`, `app-shell.ts:24`). Ścieżki awarii
   w przeglądarce dziś nie ma. Wartość e2e dla #1 to główny przepływ „dodaj → widać na liście”
   (formularz → POST → ponowne pobranie listy, `subscriptions.ts:166-173`) i jedna asercja,
   że drugie konto w **tej samej karcie** po wylogowaniu pierwszego nie widzi tej pozycji
   (łapie przyszły cache po stronie klienta). Osobne konteksty przeglądarki sprawdzałyby tylko API.
6. **Sesja bez maila: wstawienie wiersza `session` do bazy**, jak w `dev-local/test-session.mjs:52-62`
   (losowy token, w bazie tylko sha256). Konto można założyć prawdziwym `POST /auth/register`
   (konto jest aktywne od razu, `user.entity.ts:22-23`), a wygasłą sesję wstawić z `expires_at` w
   przeszłości. Ciasteczko w DEV jest host-only, `secure: false`, `sameSite: lax`
   (`session.service.ts:52-57`); ciasteczka nie zależą od portu, więc to samo ciasteczko dla
   `localhost` trafia do SSR (:4000) i API (:3000). Skryptów `dev-local/` nie da się użyć w CI:
   `assertLocalDev()` odmawia, gdy `POSTGRES_DATABASE_DEV == POSTGRES_DATABASE`
   (`dev-local/local-only.mjs:9-10`), a tak jest w CI (`ci.yml:137-138`).
7. **CI: nowy job, nie rozszerzenie istniejącego.** `frontend` (`ci.yml:43-61`) nie ma bazy ani
   API; `backend-e2e` (`ci.yml:70-151`) ma Postgresa `C.UTF-8`, migracje i `.env`, ale nie ma
   frontendu. Bramka etapu 4 to najprościej nowy job (np. `browser-e2e`) z tym samym serwisem
   Postgresa i `migration:run`, z API uruchomionym z buildu i z frontem zbudowanym w konfiguracji
   e2e. W `.env` tego joba `CORS_ORIGINS`/`FRONTEND_URL` muszą wskazywać origin serwera SSR
   (domyślnie `http://localhost:4000`, `server.ts`), a nie `:4200` jak w `backend-e2e`
   (`ci.yml:140-141`), inaczej CORS i ochrona CSRF (`http-security.ts:13`) odrzucą żądania
   przeglądarki.

## Detailed Findings

### Ryzyko #2 — guardy na serwerze

- `guestGuard` na serwerze bez ciasteczka przepuszcza bez pytania API (`auth.guard.ts:40-42`); z
  ciasteczkiem przekazuje tylko parę `subtracker_session` (`auth.guard.ts:19-29`) do
  `AuthService.session(cookie)` (`auth.service.ts:42-48`),
  z limitem 3 s i przepuszczeniem przy błędzie (`auth.guard.ts:44-50`). Zalogowany dostaje
  `UrlTree('/subscriptions')`, które silnik SSR zamienia na odpowiedź przekierowania 302
  (`ssr.mjs:1112-1113`, domyślny status `ssr.mjs:253`) z nagłówkami trasy, czyli z
  `Cache-Control: private, no-store`.
- `authGuard` na serwerze uruchamia się tylko wtedy, gdy trasa zalogowanego jest renderowana na
  serwerze. W obecnej konfiguracji to się nie zdarza (wszystkie trasy z `authGuard` — jedna,
  `subscriptions` — są `Client`, `app.routes.ts` + `app.routes.server.ts:28-29`). Jego gałąź
  serwerowa (`auth.guard.ts:61-63`) to zabezpieczenie na wypadek prerenderu.
- Macierz serwera do e2e (przez HTTP, bez przeglądarki), w tej sprawdzonej konfiguracji:

  | Żądanie | Ciasteczko | Oczekiwane |
  |---|---|---|
  | `GET /` | brak | 200, `Cache-Control: private, no-store`, HTML z `ng-server-context="ssr"`, API niepytane |
  | `GET /` | ważna sesja | 302 `Location: /subscriptions`, `Cache-Control: private, no-store` |
  | `GET /` | wygasła sesja | 200, `no-store`, w stanie transferu brak odpowiedzi `/auth/session` (`app.config.ts:22`) |
  | `GET /` | API nie odpowiada | 200 po ≤ 3 s (gość) — opcjonalne, kosztowne w czasie |
  | `GET /subscriptions` | dowolne | 200, powłoka CSR (bez `ng-server-context`), identyczna dla każdego |
  | `GET /privacy-policy`, `/unavailable` | — | prerender (`prerendered-routes.json` w dist ma dokładnie te dwie trasy w buildzie z 2026-11-13) |

  Znacznik: w ostatnim buildzie `index.csr.html` nie zawiera `ng-server-context`, a
  `unavailable/index.html` zawiera go raz (sprawdzone `grep -c` na `dist/`).
- Tańsza alternatywa dla części „render mode”: po `ng build` porównać
  `dist/frontend-subtracker/prerendered-routes.json` z listą dozwolonych tras statycznych. To łapie
  „trasa z guardem trafiła do prerenderu” bez uruchamiania serwera; nie łapie nagłówków ani
  przekierowania.

### Ryzyko #2 — guardy w przeglądarce

- Na trasach `Client` guard biegnie dopiero w przeglądarce; ciasteczko jedzie samo
  (`withCredentials` z `credentials.interceptor.ts`). `authGuard`: brak/wygasła sesja → `/sign-in`;
  błąd lub limit 10 s → `/unavailable` z `skipLocationChange` (adres zostaje `/subscriptions`,
  `auth.guard.ts:65-75`).
- Przejścia warte przeglądarki (2–3): (1) `/subscriptions` bez sesji → adres `/sign-in`;
  (2) `/subscriptions` przy niedostępnym API (np. `page.route` przerywa żądanie do `/auth/session`)
  → widać stronę „niedostępne”, adres zostaje `/subscriptions`; (3) zalogowany na `/sign-in` →
  `/subscriptions`. Wygasła sesja w przeglądarce różni się od braku sesji tylko odpowiedzią API
  (`{ user: null }`), co pokrywają unity i e2e backendu — w przeglądarce to dubel.
- „Nie mockować wnętrza guarda” w e2e oznacza: zastępować najwyżej sieć (`page.route`) albo
  zatrzymać prawdziwe API, nigdy podmieniać `AuthService` w buildzie.

### Ryzyko #1 — w przeglądarce

- API: `account-isolation.e2e-spec.ts:22` („keeps the subscriptions and own categories of one user
  from another”) i `:44` już dowodzą izolacji na prawdziwej bazie. Plan testów §2 wskazuje
  integrację API jako najtańszą warstwę dla #1; to się potwierdza.
- Front: brak stanu współdzielonego między kontami w obecnym kodzie (patrz Summary 5). Ryzyko w
  przeglądarce jest spekulatywne dziś, ale tanie do pilnowania w tym samym teście co główny
  przepływ. Przepływ dodania nie ma osobnej trasy (stan „adding” na `/subscriptions`, CLAUDE.md
  Tripwires); formularz pokrywa test komponentu z etapu 2, więc e2e nie powinno sprawdzać pól ani
  walidacji, tylko że zapis kończy się pozycją na liście z API.

### Sesja testowa i dane

- Wzór: `dev-local/test-session.mjs:52-62` — `INSERT INTO session (user_id, token_hash, expires_at,
  user_agent)` z sha256 tokenu. Wygasła sesja: `expires_at` w przeszłości (backend uznaje sesję za
  nieważną, `session.service.ts:35-40`).
- Konto: prawdziwe `POST /auth/register` (CSRF przepuszcza klienta bez nagłówków przeglądarki,
  `http-security.ts:10-13`) albo bezpośredni `INSERT` użytkownika. Rejestracja przez API zakłada też
  rolę, więc jest bliższa produkcji.
- Sprzątanie: wzór prefiksu adresu z `test/support/e2e-app.ts` (`removeTestData`, kolejność
  usuwania: subskrypcje, kategorie, sesje, tokeny, role, użytkownicy, maile).
- Dostęp do bazy z testów przeglądarki wymaga sterownika `pg` po stronie testów (frontend go nie
  ma; `test-session.mjs` pożycza go z `backend-subtracker/node_modules` przez `createRequire`).

### Uruchomienie: zbudowany SSR + API + baza

- Frontend: `ng build` w konfiguracji produkcyjnej z podmianą `environment.ts` na lokalne API (nowa
  konfiguracja w `angular.json`; `development` wyłącza optymalizację, więc nie jest „buildem jak na
  produkcji”). Start: `node dist/frontend-subtracker/server/server.mjs` (port `PORT`, domyślnie 4000;
  `allowedHosts` zawiera `localhost`, `angular.json:69`). `prepare-mydevil` musi dalej budować
  `production` z produkcyjnym API.
- API: `npm run build` + `npm run start:prod` (albo `start:dev`) z `MODE=DEV`, bazą z migracji i
  `CORS_ORIGINS`/`FRONTEND_URL` = origin SSR.
- Lokalnie: baza `subtracker-db-dev` i sprzątanie po prefiksie (jak e2e backendu). W CI: kopia
  serwisu Postgresa z `backend-e2e`.

## Code References

- `frontend-subtracker/src/app/app.routes.server.ts:9-33` — render mode tras; `/` Server + `no-store`
- `frontend-subtracker/src/app/auth/auth.guard.ts:19-29,40-50,61-75` — ciasteczko na serwerze, decyzje guardów
- `frontend-subtracker/src/app/auth/auth.guard.spec.ts:126-281` — istniejąca macierz unit
- `frontend-subtracker/src/app/app.config.ts:22` — `/auth/session` poza transfer cache
- `frontend-subtracker/src/environments/environment.ts:3`, `environment.development.ts:2` — adres API w buildach
- `frontend-subtracker/angular.json:69,76-103` — `allowedHosts`, konfiguracje builda
- `frontend-subtracker/src/server.ts:21,51-52,62` — silnik SSR, statyczne pliki z `maxAge: '1y'`
- `frontend-subtracker/node_modules/@angular/ssr/fesm2022/ssr.mjs:253,977,1065,1082-1101,1112-1113` — przekierowanie 302, brak renderu tras statycznych na żądanie, powłoka CSR, nagłówki trasy (wersja 22.2.0)
- `frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts:105,117-118,166-173` — lista i ponowne pobranie po zapisie
- `backend-subtracker/src/auth/services/session.service.ts:35-40,52-57` — ważność sesji, atrybuty ciasteczka
- `backend-subtracker/src/auth/controllers/auth.controller.ts:66,72` — `no-store` na `/auth/session`
- `backend-subtracker/test/subscriptions/account-isolation.e2e-spec.ts:22,44` — izolacja kont w API
- `dev-local/test-session.mjs:52-62`, `dev-local/local-only.mjs:9-10` — wzór sesji, blokada poza lokalnym DEV
- `.github/workflows/ci.yml:43-61,70-151,137-141` — joby `frontend` i `backend-e2e`, `.env` CI

## Architecture Insights

- Jedna trasa (`/`) ma HTML zależny od ciasteczka; reszta to powłoka CSR albo prerender. Ten
  podział jest prawdziwym kontraktem do pilnowania w e2e: każda zmiana render mode trasy z guardem
  powinna czerwienić test.
- SSR guarda `/` jest jedynym miejscem, gdzie serwer frontu woła API z ciasteczkiem użytkownika;
  test HTTP na zbudowanym serwerze z prawdziwym API sprawdza to przekazanie jedyny raz w całym
  stosie testów.
- Frontend i API na różnych portach `localhost` są „same-site”, więc lokalny układ odwzorowuje
  produkcję (różne subdomeny, ciasteczko domeny nadrzędnej) pod względem `sameSite: lax`, ale nie
  sprawdza atrybutu `domain` ani `secure` (tylko w `PROD`).

## Historical Context (from prior changes)

- `context/archive/2026-11-10-ui-foundation/plan.md:54` — „lokalny build produkcyjny woła
  produkcyjne API (`environment.ts`)”; wciąż prawdziwe (`environment.ts:3`). Wtedy przekierowanie
  sprawdzano ręcznie.
- `context/archive/2026-11-10-ui-foundation/plan.md:18,27` — pierwotnie `/` był prerenderowany, a
  przekierowanie zalogowanego działo się w przeglądarce. Zastąpione: `/` jest dziś `Server` z
  `no-store` (`app.routes.server.ts:9-11`, kontrakt wariantu awaryjnego w tym samym planie, `:272`).
- `context/archive/2026-11-13-frontend-unit-tests/` — źródło macierzy unit guardów (etap 1).
- `context/archive/2026-11-13-backend-e2e-account-isolation/` — test dwóch kont w API i job
  `backend-e2e` (etap 3).

## Related Research

- `context/archive/2026-11-13-frontend-unit-tests/research.md`
- `context/archive/2026-11-13-backend-e2e-account-isolation/research.md`

## Open Questions

- Narzędzie: Playwright jest w §4 kandydatem; wersji i daty `checked:` nie sprawdzano (należy do
  `/10x-plan`).
- Czy test nagłówków/render mode ma iść jako test HTTP w tym samym runnerze co przeglądarka
  (np. `request` z Playwright), czy osobno (Vitest + `fetch`). Oba nie potrzebują przeglądarki.
- Gdzie mieszka pomocnik sesji dla e2e: w `frontend-subtracker/e2e/` z własnym `pg`, czy wspólny z
  `dev-local/` (wymagałby zmiany `assertLocalDev` dla CI — dziś celowo odmawia).
- „API nie odpowiada” dla `/` po stronie serwera kosztuje ≥ 3 s na test; wystarczy unit
  (`auth.guard.spec.ts:235`), chyba że plan uzna inaczej.
- Korekta do §2 planu testów (dla `/10x-test-plan`): wiersz #2 „strona zalogowanego nie jest
  cache'owana” → „HTML zależny od ciasteczka (`/`) nie jest cache'owany, trasy zalogowanego oddają
  powłokę CSR”; wiersz #1: e2e w przeglądarce to przepływ dodania + to samo okno po zmianie konta,
  nie osobne konteksty.
