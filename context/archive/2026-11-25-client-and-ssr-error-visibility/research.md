---
date: 2026-11-25T15:39:36Z
researcher: Claude (Opus 5.5) z trzema sub-agentami badawczymi
git_commit: 2ef328e
branch: change/client-and-ssr-error-visibility
repository: 10xProject (SubTracker)
topic: "S-15 (FR-023): błędy przeglądarki i SSR nie znikają bez śladu; błąd nawigacji SSR nie wygląda jak 404; nieaktualny plik po wdrożeniu przeładowuje stronę"
tags: [research, frontend-subtracker, ssr, error-handling, router, deploy]
status: complete
last_updated: 2026-11-25
last_updated_by: Claude (Opus 5.5)
---

# Research: S-15 — widoczność błędów przeglądarki i SSR

**Date**: 2026-11-25T15:39:36Z
**Researcher**: Claude (Opus 5.5) z trzema sub-agentami (gałęzie błędów w przeglądarce, SSR, ładowanie chunków i deploy)
**Git Commit**: 2ef328e (origin/main po S-17; `frontend-subtracker/src` bez zmian względem tego commita)
**Branch**: change/client-and-ssr-error-visibility
**Repository**: 10xProject (SubTracker)

## Research Question

Co trzeba zmienić, żeby (1) strony i formularze nie zamieniały nieznanego błędu w ogólny komunikat bez zapisu przyczyny, (2) błąd nawigacji przy renderowaniu na serwerze nie wyglądał jak 404, (3) nieaktualny plik aplikacji po wdrożeniu przeładowywał stronę (PRD FR-023, audyt L4, L5, L6, S5, S6, S7, A9, P7, P8). Zapis tylko do konsoli przeglądarki i logu SSR, dopóki PRD Open Questions #2 nie zdecyduje o wysyłce do API. Dodatkowo: które pliki dzieli z równoległym researchem S-18.

## Summary

- **Przeglądarka nie zapisuje żadnej obsłużonej przyczyny.** W sprawdzonym zakresie (`grep` po `error:`, `catchError`, `.catch(`, `console.*`, `ErrorHandler` w `frontend-subtracker/src`, bez `*.spec.ts`) 25 gałęzi błędów zamienia błąd na stan UI, a jedynym `console.error` w kodzie przeglądarki jest `main.ts:6` (błąd bootstrapu). Wszystkie 7 pozycji audytu nadal występuje (tylko numery linii się przesunęły), a S-17 dodało 5 nowych gałęzi tego samego typu (`pages/budget/budget.ts:351`, `:428`, `:466`, dwa dialogi kategorii).
- **Brak wspólnego helpera i własnego `ErrorHandler`.** `app.config.ts:17` ma tylko `provideBrowserGlobalErrorListeners()` (nieprzechwycone błędy okna → domyślny `ErrorHandler` → `console.error`); błędy obsłużone w `subscribe({ error })` tam nie trafiają. Interceptory: `credentials.interceptor.ts` i `session-expired.interceptor.ts` (`app.config.ts:26`). Żaden spec nie sprawdza `console` ani `ErrorHandler`.
- **SSR: błąd nawigacji = 404 „Cannot GET”.** `@angular/ssr` 22.2.0 zwraca `null` z `handle()`, gdy nawigacja nie skończyła się sukcesem (`node_modules/@angular/ssr/fesm2022/ssr.mjs:134`, `:153-158`, `:1113-1114`); `server.ts:94-99` woła wtedy `next()`, a Express odpowiada 404 (`finalhandler` 2.1.1 `index.js:107`). Odrzucenie `handle()` idzie przez `next(err)` do `logerror` Expressa — surowy `err.stack` bez metody i ścieżki, poza formatem `serverLine` (S-14 impl-review F8, przeniesione do S-15). `server.ts` nie ma middleware błędów ani handlera 404.
- **Na serwerze błąd nawigacji może dziś trafić tylko `/`** (jedyna trasa `RenderMode.Server`, `app.routes.server.ts:8-12`): trasy Client dostają `index.csr.html` bez routera na serwerze (`ssr.mjs:1098-1101`), Prerender jest serwowany z plików (`:1013-1057`). Na `/` `guestGuard` łapie każdy błąd API i timeout 3 s (`auth/auth.guard.ts:50`, L5 — strona gościa, nic w logu); błąd nawigacji to wyjątek poza tym `pipe` albo nieudany leniwy `loadComponent` (także przy przekierowaniu zalogowanego na `/subscriptions` w tym samym renderze).
- **Po wdrożeniu stare chunki znikają i dają 404.** `deploy/mydevil/deploy.sh:157-164` podmienia cały katalog `public_nodejs`; `outputHashing: all` (`angular.json:89`). Brakujący `/chunk-*.js` przechodzi przez `express.static` i Angulara do 404 (`server.ts:57-63`, `ssr.mjs:1035`, `:1065`), więc przeglądarka dostaje prawdziwe 404, nie HTML. HTML tras Client nie ma `Cache-Control`, więc jedno przeładowanie wystarcza.
- **Router nie obsługuje błędów nawigacji.** `provideRouter(routes)` bez funkcji (`app.config.ts:19`); 12 tras `loadComponent` (`app.routes.ts:9-64`), bez `@defer` i innych `import(`. Nieudany import kończy się `console.error` z domyślnego `ErrorHandler`, a kliknięty link nic nie robi (`@angular/router` 22.2.0 `_router_module-chunk.mjs:369`). Dostępne `withNavigationErrorHandler` (`router.d.ts:745`) z kontekstem wstrzykiwania i opcją `RedirectCommand`.

## Detailed Findings

### 1. Gałęzie błędów w przeglądarce (stan pozycji audytu)

| Pozycja | Stan | Gdzie teraz | Co widzi użytkownik |
|---|---|---|---|
| L4 | występuje | `auth/auth.guard.ts:80-82` | każdy błąd `/auth/session` (sieć, timeout, 5xx, 403) → `/unavailable` (`skipLocationChange`) |
| L5 | występuje | `auth/auth.guard.ts:50` | SSR nie dosięga API → strona gościa; zalogowany nie jest przekierowany |
| L6 | występuje | `pages/sign-in/sign-in.ts:49-56`, `register/register.ts:55-62`, `verify-link/verify-link.ts:38-45` | 403 `account_blocked` i 400 rozróżnione, reszta (403 CSRF, 429, 0, 5xx) → „niedostępne” |
| S5 | występuje (+ nowe miejsce) | `subscriptions/subscription-form/subscription-form.ts:245-251`; S-17: `pages/budget/budget.ts:428-437` | 400 przy tworzeniu kategorii wygląda jak awaria |
| S6 | występuje | `subscriptions/cost-totals.store.ts:45-49` | nieudane odświeżenie sum zostawia stare sumy i alert bez znaku |
| S7 | występuje (+ S-17) | `subscription-form.ts:201, 225, 245, 279`; `pages/subscriptions/subscriptions.ts:176-183, 341-349`; `cancel-subscription-dialog.ts:94-105`; `delete-subscription-dialog.ts:85-92`; `budget.ts:351-354, 466-474`; `delete-category-dialog.ts:88-99`; `rename-category-dialog.ts:115-128` | `HttpErrorResponse` nigdzie nie zapisany |
| A9 | występuje | `pages/admin/admin-users/admin-users.ts:115-123`; `admin-user/admin-user.ts:116-124`; `delete-account-dialog.ts:119-131`; `admin/admin-action-dialog/admin-action-dialog.ts:127-136` | statusy rozróżnione częściowo, przyczyna nie zapisana |

Dodatkowo bez zapisu: wylogowanie `layout/app-shell/app-shell.ts:62-65`; `session-expired.interceptor.ts:23-29` (401 poza `/auth/` → `/sign-in`; to oczekiwany przypadek, nie błąd do raportu). Dashboard i konto nie mają własnych gałęzi błędów (pokazują stan `CostTotalsStore`, `afterClosed`). Serwisy (`auth/auth.service.ts:42-48` i inne) przekazują błąd bez zmian.

Jedyny wspólny helper klasyfikacji błędu to `auth/account-blocked.ts` (`accountBlockedContact`). `src/server-log.ts` (`serverLine(level, context, msg)`, poziom `ERROR` zdefiniowany, nieużywany — `:13`, `:21`) jest czysty (bez `node:*`) i działa w testach jednostkowych; nie sprawdzono, czy pasuje do kodu przeglądarki.

Testy: błędy symulowane przez `HttpTestingController.flush(…, { status })` i `request.error(new ProgressEvent('error'))` (`auth/auth.guard.spec.ts:112-118`); asercje tylko na stan UI i przekierowania. Wzorzec `vi.spyOn(TestBed.inject(...), ...)` (`session-expired.interceptor.spec.ts:38-39`) wystarczy do szpiega na wstrzykiwanym reporterze albo `console.error`. `src/test-providers.ts` dodaje tylko locale i wyłącza animacje.

### 2. SSR: przepływ żądania i 404 po błędzie nawigacji

- **Kolejność w `src/server.ts`** (po S-14): nagłówki bezpieczeństwa `:35-40` → `express.static` (`maxAge: '1y'`, `index: false`, `redirect: false`) `:57-63` → access log `:71-89` (tylko gdy `listening`, `:28`) → `angularApp.handle(req).then(r => r ? writeResponseToNodeResponse(r, res) : next()).catch(next)` `:94-99`. Brak middleware błędów i handlera 404.
- **`null` z `handle()`** w `@angular/ssr` 22.2.0 (`ssr.mjs`) ma 6 sprawdzonych źródeł: znane URL-e spoza Angulara (`:988-989`), brak pasującej trasy (`:993-994`), `handleServe` bez zasobu prerenderu (`:1018-1035`), trasa Prerender bez zasobu (`:1065-1066`), błąd nawigacji (`:1113-1114`), brak entry pointu/locale (`AngularAppEngine.handle` `:1312-1327`). Publiczne API nie mówi, który z nich zaszedł (`Hooks` ma tylko `html:transform:pre`; `ServerRouter` i `RouteTree` są wewnętrzne).
- **Trasy Angulara nie mają `**`** (`app.routes.ts:4-66`), więc `null` na ścieżce, którą aplikacja zna, oznacza błąd nawigacji albo brak zasobu — nieznana ścieżka to zwykłe 404.
- **Konsola bez URL**: początkowa nawigacja routera kieruje odrzucenie do `_INTERNAL_APPLICATION_ERROR_HANDLER` (`@angular/router` `_router-chunk.mjs:4632-4637`), który drukuje `ERROR <error>` bez adresu. Zdarzenie `NavigationError` i hook `navigationErrorHandler` znają URL (`:4047-4049`).
- **Odrzucenie `handle()`** (błąd bootstrapu, `whenStable`, `ssr.mjs:187-190`; także `AbortError` po przerwaniu żądania przez klienta, `:231-247`) → `next(err)` → Express `lib/application.js:154-157`, `logerror` `:615-618` (`console.error(err.stack)`) → 500. Treść 500 zawiera stos, gdy `NODE_ENV` nie jest `production` (`finalhandler` `:157-170`): na serwerze `NODE_ENV=production` (`deploy/mydevil/README.md:22,38`), w e2e i lokalnie nie.
- **Błąd po wysłaniu nagłówków** w trybie Server (strumień, `ssr.mjs:1124-1139`): `writeResponseToNodeResponse` (`@angular/ssr` `node.mjs:365-367`, `:435-438`) kończy treść tekstem `Internal server error.` i nic nie loguje; access log pokazuje 200. Nie zweryfikowano w działaniu, czy błędy szablonu dają częściową stronę 200 czy odrzucenie.
- **Przypadek do sprawdzenia w działaniu**: zalogowany na `/`, `guestGuard` przekierowuje na `/subscriptions`, a `authGuard` przy błędzie API zwraca `RedirectCommand('/unavailable', { skipLocationChange: true })` (`auth.guard.ts:80-81`) — możliwe, że serwer wyrenderuje `/unavailable` jako 200 pod `/`. Wniosek z kodu, nie zaobserwowany.
- **Dwie drogi rozróżnienia błędu nawigacji** (bez prywatnego API): (a) w `server.ts` — `null` na znanej ścieżce traktowane jako błąd (wymaga listy znanych ścieżek); (b) w aplikacji, tylko na serwerze (`app.config.server.ts`) — `withNavigationErrorHandler` albo własny `ErrorHandler` z `inject(REQUEST)` do zapisu metody i ścieżki, ewentualnie `RedirectCommand` na `/unavailable` + `RESPONSE_INIT` ze statusem 500 (wzorzec `authGuard`).
- **Testy**: Playwright `http` (`e2e/http/render-modes.e2e-spec.ts`, `start-page.e2e-spec.ts`, `smoke.e2e-spec.ts`) na zbudowanym `server.mjs` z `PORT=4000` (`playwright.config.ts:68-86`), access log aktywny. `src/server-log.spec.ts` testuje czyste formatery; `server.ts` nie ma testów. Konfiguracja `e2e` (`angular.json:102-110`) już używa `fileReplacements`, co pozwala dodać trasę testową z rzucającym guardem albo komponentem tylko w buildzie e2e (zmienia to testy ekstrakcji tras i manifest prerenderu).

### 3. Nieaktualne chunki po wdrożeniu

- **Router**: `provideRouter(routes)` bez funkcji (`app.config.ts:19`); brak `withNavigationErrorHandler`, subskrypcji `NavigationError` i własnego `ErrorHandler` w `src/`. Trasy leniwe, w kolejności: `''`, `register`, `sign-in`, `privacy-policy`, `auth/verify`, `subscriptions`, `dashboard`, `budget`, `account`, `admin/users`, `admin/users/:id`, `unavailable` (`app.routes.ts:9-64`, 12 × `loadComponent`, 0 × `loadChildren`).
- **API Angulara 22.2.0**: `withNavigationErrorHandler(handler: (error: NavigationError) => unknown | RedirectCommand)` (`node_modules/@angular/router/types/router.d.ts:745`, dokumentacja `:709-744`); handler działa w kontekście wstrzykiwania; `RedirectCommand` → `NavigationCancel` + przekierowanie, inna wartość → `NavigationError` i ponowne rzucenie (`_router-chunk.mjs:4047-4068`). `RouterConfigLoader.loadComponent` czyści zapamiętany loader w `finally` (`:3494-3519`), więc kolejna nawigacja ponawia `import()`; czy przeglądarka nie zapamiętuje nieudanego modułu, nie sprawdzono — pewne jest tylko pełne przeładowanie.
- **Rozpoznanie błędu chunka**: Angular nie ma własnego rozpoznania (grep po fesm routera, core i build). Komunikaty przeglądarek pochodzą z wiedzy ogólnej, nie z repo: Chrome/Edge `Failed to fetch dynamically imported module`, Firefox `error loading dynamically imported module`, Safari `Importing a module script failed` — wszystkie jako `TypeError` w `NavigationError.error`. Nieudany import współdzielonego chunka wewnątrz leniwego daje to samo odrzucenie.
- **Deploy**: `scripts/prepare-mydevil.mjs` kopiuje `dist/.../browser` do `.mydevil/public`; `.github/workflows/deploy-frontend.yml:58-59` → `deploy.sh` rozpakowuje do `public_nodejs_new` (`:83-85`) i podmienia katalog (`:157-164`); stare wydania są w `releases/` (`KEEP=3`, `:26`, `:205-207`), ale nie są serwowane. Znikają tylko chunki o zmienionym hashu.
- **Odpowiedź na brakujący chunk**: 404 `Cannot GET /chunk-…` (text/html) i linia access logu `GET /chunk-… 404` — po wdrożeniu darmowy sygnał w `out.log` frontu. `X-Content-Type-Options: nosniff` (`server.ts:36`).
- **Cache**: zasoby statyczne `max-age=31536000` (bez `immutable`); HTML tras Client (`index.csr.html`, `ssr.mjs:1092-1096`) bez `Cache-Control`; prerender (`/privacy-policy`, `/unavailable`) tylko ETag (`:1040-1055`); `/` `private, no-store` (`app.routes.server.ts:8-12`).
- **Ochrona przed pętlą**: `src/` nie używa dziś `sessionStorage` ani `localStorage` — to byłoby pierwsze użycie; `sessionStorage` jest per karta, dostęp w `try/catch`. Wzorce tylko-przeglądarkowe: `isPlatformServer(inject(PLATFORM_ID))` (`auth.guard.ts:21`), `afterNextRender` (`pages/home/home.ts:37`).
- **E2E**: wzorzec przechwytywania `page.route(…, route => route.abort())` (`e2e/browser/guards.e2e-spec.ts:38-41`); brakujący chunk: `page.route(/\/chunk-[^/]+\.js$/, r => r.fulfill({ status: 404 }))`, klik w trasę, której chunk nie był pobrany, asercja przeładowania i braku drugiego. SSR dodaje `modulepreload` per trasa (`context/archive/2026-11-14-browser-critical-paths/plan.md:266-268`), więc trasa docelowa musi mieć własny, niepobrany chunk.

## Code References

- `frontend-subtracker/src/app/app.config.ts:17,19,26` — globalne nasłuchiwanie błędów, `provideRouter` bez funkcji, interceptory
- `frontend-subtracker/src/app/app.config.server.ts` — miejsce na konfigurację tylko serwerową
- `frontend-subtracker/src/app/app.routes.ts:4-66` — 12 tras leniwych, bez `**`
- `frontend-subtracker/src/app/app.routes.server.ts:8-12,52-55` — `/` Server (no-store), `**` Prerender
- `frontend-subtracker/src/app/auth/auth.guard.ts:21,50,80-82` — platforma, L5, L4
- `frontend-subtracker/src/main.ts:6` — jedyny `console.error` w przeglądarce
- `frontend-subtracker/src/server.ts:28,35-40,57-63,71-89,94-99` — kolejność middleware, `next()`/`next(err)`
- `frontend-subtracker/src/server-log.ts:13,21` — poziom `ERROR` bez użycia
- `frontend-subtracker/node_modules/@angular/ssr/fesm2022/ssr.mjs:134,153-158,1113-1114` (22.2.0) — błąd nawigacji → `null`
- `frontend-subtracker/node_modules/@angular/router/types/router.d.ts:745` (22.2.0) — `withNavigationErrorHandler`
- `deploy/mydevil/deploy.sh:83-85,157-164` — podmiana katalogu frontu
- `frontend-subtracker/e2e/browser/guards.e2e-spec.ts:38-41` — przechwytywanie żądań w Playwright

## Architecture Insights

- Front ma dwa środowiska z różnym kanałem zapisu: przeglądarka (dziś tylko `console`, decyzja OQ #2 otwarta) i proces SSR (`serverLine` z S-14 w formacie `[<app>] <pid> - <czas> <LEVEL> [<Context>] <msg>`). Wspólny reporter klienta musi działać na obu platformach: w przeglądarce `console.error`, na serwerze linia `ERROR` w formacie S-14.
- Wzorzec „zdecyduj w czystej funkcji, testuj Vitestem” jest już użyty w `server-log.ts` i pasuje do decyzji „`null` na znanej ścieżce → 500 + linia `ERROR`”.
- Lekcja `lessons.md` „Kod ogólny w `shared/`” dotyczy backendu; we froncie `src/app/shared/` zawiera narzędzia bez wiedzy o domenie (daty, kwoty, walidacja), więc helper raportu błędu pasuje tam albo do `core/` (którego nie ma).
- Dane osobowe: linia błędu nie powinna zawierać query ani e-maili (zasada access logu S-14: ścieżka bez query; API: szablon trasy, uuid, bez adresów).

## Historical Context (from prior changes)

- `context/archive/2026-11-24-log-format-version-and-access-log/plan.md:51`, `plan-brief.md:63` — „Błędy SSR i guardów połykane bez logu (S-15)” poza zakresem S-14 (potwierdzone).
- `context/archive/2026-11-24-log-format-version-and-access-log/reviews/impl-review.md:114-122` — F8: błędy żądań SSR poza nowym formatem; SKIPPED do S-15 (middleware błędów w `server.ts`) (potwierdzone, `server.ts` bez zmian w tym zakresie).
- `context/archive/2026-11-24-log-format-version-and-access-log/reviews/impl-review.md:36-53` — F2: access log SSR zapisuje surową ścieżkę także nieznanych URL-i, zaakceptowane.
- `context/archive/2026-11-23-request-context-and-denial-reasons/plan.md:42,70,74` — raporty błędów przeglądarki i SSR odłożone do S-15; format linii 5xx API (metoda, szablon trasy, użytkownik, id żądania, bez query) jako wzór.
- `context/audits/observability/2026-11-22_sign-in-subscriptions-jobs-account-admin.md:86-88,103-105,145,158-159,172` — pozycje L4–A9, P7, P8 i proponowana kolejność; `:187` — P7 nie udowodnione w działaniu (ustalenie statyczne, nadal nieudowodnione).
- `context/foundation/prd.md:122-123,162` — FR-023 i OQ #2 (wysyłka do API dopiero po decyzji o limicie i danych bez PII), wciąż otwarte.

## Related Research

- `context/archive/2026-11-24-log-format-version-and-access-log/research.md` — format logu i access log SSR (S-14).
- `context/archive/2026-11-23-request-context-and-denial-reasons/research.md` — kontekst żądania i odmowy w API (S-13).
- `context/changes/subscription-list-sort-filter/research.md` — S-18, research równoległy (pliki wspólne poniżej).

## Pliki wspólne z S-18

Pliki, których S-15 najpewniej dotknie w warstwie list subskrypcji (gałęzie `error:` z S7): `frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts` (`:176-183`, `:341-349`) i jego spec, `subscriptions/subscription-form/subscription-form.ts`, `subscriptions/cost-totals.store.ts`, dialogi anulowania i usuwania subskrypcji. Werdykt po porównaniu z `context/changes/subscription-list-sort-filter/research.md` (sekcja „Pliki wspólne z S-15”):

- **kolizja możliwa**: `pages/subscriptions/subscriptions.ts` i `subscriptions.spec.ts` (S-15 zmienia gałęzie `error:` w `load()` i `resume()`, S-18 dodaje sortowanie i filtrowanie w tej samej klasie);
- **kolizja mała**: `pages/subscriptions/subscriptions.html` (bloki błędów obok kontrolek S-18), `subscription-labels.ts` (jeśli S-15 zmieni komunikaty);
- **kolizja tekstowa**: `CLAUDE.md`, `context/foundation/roadmap.md` (oba slice'y aktualizują je na koniec);
- **brak kolizji**: `server.ts`, `server-log.ts`, interceptory, `app.config*.ts`, `app.routes*.ts`, `subscription-table/*`, backend (w wariancie S-18 bez zmian w API).

Kolejność S-15 → S-18 (S-18 z `origin/main` po merge'u S-15) usuwa kolizję; research i plan S-18 mogą powstać wcześniej.

## Open Questions

1. **OQ #2 (owner: user)** — czy błędy przeglądarki trafiają do API (`POST /client-errors` z limitem, bez PII)? Domyślnie S-15 zapisuje tylko w konsoli przeglądarki i w logu SSR.
2. **Zakres S7/A9 (do planu)** — wspólny helper wołany w każdej gałęzi `error:` (ok. 25 miejsc), czy tylko w gałęziach „nieznany błąd” (pomijając rozpoznane 400/404/409)?
3. **S5/S6 (do planu)** — czy osobna obsługa 400 przy tworzeniu kategorii i flaga nieudanego odświeżenia sum wchodzą do S-15 (zmiana widoczna dla użytkownika), czy tylko zapis przyczyny?
4. **Błąd nawigacji SSR (do planu)** — droga (a) w `server.ts` czy (b) handler w `app.config.server.ts`; odpowiedź 500 z linią `ERROR` czy strona `/unavailable`.
5. **Do sprawdzenia w działaniu** — przypadek `/unavailable` jako 200 pod `/` przy błędzie API w przekierowaniu SSR; czy błędy szablonu w trybie Server dają częściową stronę 200.
