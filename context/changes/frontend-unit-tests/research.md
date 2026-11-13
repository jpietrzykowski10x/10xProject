---
date: 2026-11-13T12:40:20+01:00
researcher: Claude (Opus 5.5) — /10x-research
git_commit: ff65b5f
branch: change/frontend-unit-tests
repository: 10xProject
topic: "Ugruntowanie fazy 1 planu testów: testy jednostkowe frontendu (F-03)"
tags: [research, frontend-subtracker, unit-tests, vitest, guards, amounts, dates]
status: complete
last_updated: 2026-11-13
last_updated_by: Claude (Opus 5.5) — /10x-research
---

# Research: Ugruntowanie fazy 1 planu testów — testy jednostkowe frontendu (F-03)

**Date**: 2026-11-13T12:40:20+01:00
**Researcher**: Claude (Opus 5.5) — /10x-research
**Git Commit**: ff65b5f
**Branch**: change/frontend-unit-tests
**Repository**: 10xProject

## Research Question

Ugruntować fazę 1 z `context/foundation/test-plan.md` §3 („Frontend unit tests”, roadmap F-03) względem
aktualnego kodu: jaki runner, jak go podłączyć do CI, oraz które jednostki i gałęzie kodu realizują ryzyka
#3 (parsowanie kwot i dat), #2 (decyzje guardów serwer/przeglądarka) i #4 (przeliczenie na miesiąc) —
wraz z kontraktem API, który daje niezależną wyrocznię.

## Summary

- **Runner**: zainstalowany `@angular/build` 22.2.0 zawiera builder `unit-test` z domyślnym runnerem
  `vitest` (schemat: `runner` default `"vitest"`, enum `karma|vitest`). Brakuje tylko: celu `test` w
  `angular.json` (sekcja `architect` ma `build` i `serve`, `frontend-subtracker/angular.json:42-117`),
  pakietu `vitest` (peer `^4.0.8 || ^5.0.0`) i środowiska DOM (`jsdom` albo `happy-dom` — builder
  wymaga jednego z nich, gdy nie podano `browsers`, `node_modules/@angular/build/src/builders/unit-test/runners/vitest/index.js:41-43`).
  `tsconfig.spec.json` już istnieje ze scaffoldu (typy `vitest/globals`, include `src/**/*.spec.ts`),
  a `npm test` już wywołuje `ng test` (`frontend-subtracker/package.json:9`). Backend używa Vitest
  4.1.11 — ta sama linia mieści się w peer range frontu.
- **CI**: job `frontend` w `.github/workflows/ci.yml:43-58` robi tylko `npm ci` i `npm run prepare-mydevil`;
  bramka „unit frontend” (§5) wymaga dodania kroku testów.
- **Ryzyko #3**: wejścia użytkownika przechodzą przez 4 czyste funkcje (`parseDecimal`, `parseAmount`,
  `parseDayMonthYear`, `toDateOnly`) i adapter `PlDateAdapter.parse`; składanie żądania odbywa się w
  prywatnej metodzie `SubscriptionForm.request()` (`subscription-form.ts:269-296`). Wyrocznia: DTO
  backendu (`amount` jako liczba, ≤ 2 miejsca, 0…99 999,99; daty `YYYY-MM-DD`).
- **Ryzyko #2**: dwa guardy w jednym pliku (`auth/auth.guard.ts:33-76`) rozgałęziają się po
  `PLATFORM_ID`, ciasteczku z `REQUEST` i odpowiedzi `GET /auth/session`; wszystkie gałęzie da się
  pokryć w TestBed z `HttpTestingController` (makieta tylko na granicy HTTP). Render mode i nagłówki
  cache (`app.routes.server.ts`) nie są testowalne jednostkowo — należą do fazy 3.
- **Ryzyko #4**: jedna funkcja `monthlyAmount` (`subscriptions/subscription-amounts.ts:8-16`), liczona w
  całych groszach z `Math.round`; PRD nie określa reguły zaokrąglenia, więc wyrocznia dla wartości
  z połówką grosza wymaga decyzji produktowej. Sum jeszcze nie ma (S-04).
- **Strefa czasowa**: `toDateOnly` i `parseDayMonthYear` zależą od lokalnej strefy procesu; runner
  `ubuntu-latest` domyślnie działa w UTC, w którym błąd przesunięcia doby nie wystąpi. Plan musi
  ustawić strefę testów jawnie.

## Detailed Findings

### 1. Runner i konfiguracja

- `@angular/build` 22.2.0 ma katalog buildera `unit-test` z runnerami `karma` i `vitest`
  (`node_modules/@angular/build/src/builders/unit-test/runners/`). Peer dependencies: `vitest: "^4.0.8 || ^5.0.0"`, `karma: "^6.4.0"` (oba opcjonalne; odczyt z `@angular/build/package.json`).
- Opcje schematu istotne dla planu: `runner` (default `vitest`), `tsConfig` (domyślnie
  `tsconfig.spec.json`, jeśli istnieje), `include` (default `**/*.spec.ts`, `**/*.test.ts`),
  `watch` (domyślnie `true` w TTY, `false` poza nim), `setupFiles`, `providersFile`, `runnerConfig`,
  `browsers` (bez niego: Node + jsdom), `coverage*`, `reporters`.
- Walidacja zależności (`runners/vitest/index.js:22-48`): zawsze wymaga `vitest`; bez `runnerConfig` i
  bez `browsers` wymaga `jsdom` lub `happy-dom`; z `runnerConfig` sprawdza tylko `vitest`.
  `plugins.js:58-63` wybiera `happy-dom`, gdy jest zainstalowany, w przeciwnym razie `jsdom`.
- W `frontend-subtracker/node_modules` brak `vitest`, `jsdom` i `happy-dom` (sprawdzone `ls`).
- `angular.json:12-38` ustawia `skipTests: true` dla wszystkich schematów — nowe pliki z `ng generate`
  nadal nie dostaną `.spec.ts`; to wybór planu, czy to zmienić.
- `tsconfig.spec.json` (z commita scaffoldu `024a6fc`): `types: ["vitest/globals"]`, include
  `src/**/*.d.ts` i `src/**/*.spec.ts`; `tsconfig.app.json` wyklucza `src/**/*.spec.ts`, więc testy nie
  trafią do bundla aplikacji.
- Aplikacja jest bez `zone.js` (brak trafień w `src/` i `angular.json`) — TestBed działa w trybie
  zoneless, testy asynchroniczne nie mają `fakeAsync` z zone; przy timeoutach guardów pasują
  fake timery Vitest.
- Node lokalnie: v24.21.0; CI: `node-version: 24` (`ci.yml:34,53`).

### 2. Bramka CI

- `ci.yml:43-58` — job `frontend`: checkout, setup-node 24 z cache npm, `npm ci`, `npm run prepare-mydevil`.
  Brak kroku testów. Job `backend` (`ci.yml:24-41`) ma wzorzec `npm ci` → `npm run lint` → `npm test` → build.
- Poza TTY `watch` domyślnie jest `false`, więc `npm test` w CI zakończy się po jednym przebiegu;
  jawne `--watch=false` jest opcjonalne, ale usuwa zależność od wykrycia TTY.

### 3. Ryzyko #3 — kwoty i daty z formularza do API

**Ścieżka kwoty** (pole tekstowe → liczba w żądaniu):
- `shared/decimal.ts:3` — separatory grup: spacja, U+00A0 i U+202F (sprawdzone bajtowo `od -c`).
- `shared/decimal.ts:7-12` — `parseDecimal(value, maxFractionDigits)`: trim, usunięcie separatorów,
  wzorzec `^\d+(?:[.,]\d{1,N})?$`, wynik `Number(...)` po zamianie przecinka na kropkę, inaczej `null`.
  Wzorzec budowany przez `String.raw` (komentarz w l. 9) — to poprawka błędu „każda kwota odrzucana”
  z wywiadu Q2, wprowadzona w `68751b3`.
- `subscriptions/subscription-validators.ts:7-10` — `parseAmount`: `parseDecimal(value, 2)` i
  `≤ AMOUNT_MAX` (`subscription.types.ts:14`, `99999.99`); `:12-14` — `amountValidator`.
- `subscription-form.ts:274,287` — do API idzie `amount: number` z `parseAmount`.
- Wynikające z kodu (wniosek, do potwierdzenia testem): `"1.299,00"` (kropka jako separator grup) daje
  `null`, bo wzorzec dopuszcza jeden separator dziesiętny; `"1,234"` daje `null` (3 cyfry po przecinku).

**Ścieżka daty** (tekst `d.m.rrrr` lub kalendarz → `YYYY-MM-DD`):
- `shared/date-only.ts:39-53` — `parseDayMonthYear`: wzorzec `^(\d{1,2})\.(\d{1,2})\.(\d{4})$`, lokalna
  północ, odrzuca datę, która „przeskoczyłaby” (31.02 → `null`) przez porównanie składników.
- `shared/pl-date-adapter.ts:11-19` — `PlDateAdapter.parse`: nie-string → `NativeDateAdapter.parse`;
  pusty/biały string → `null` (pole puste); nieczytelny tekst → `this.invalid()` (nie `null`), żeby
  datepicker zgłosił `matDatepickerParse`. Ta różnica `null` vs invalid jest częścią kontraktu.
- `shared/date-only.ts:33-37` — `toDateOnly`: lokalny dzień z `getFullYear/getMonth/getDate`, z dopełnieniem
  zerami (rok do 4 cyfr).
- `shared/date-only.ts:9-16` — `parseDateOnly` (API → lokalna północ); `:21-29` — `daysFromToday(value, today = new Date())` z wstrzykiwalnym „dziś” i porównaniem jako północe UTC (odporność na DST).
- `shared/validation/not-before-date.ts:7-15` — porównanie `toDateOnly` jako stringów; `null` po
  którejkolwiek stronie = brak błędu.
- `shared/validation/trimmed-required.ts:4-6` — `"   "` → `{ required: true }`.
- `subscription-form.ts:291-294` — `nextBillingDate` i (tylko dla `trial`) `trialEndDate` przez `toDateOnly`.

**Kontrakt API (wyrocznia z backendu, nie z kodu frontu):**
- `backend-subtracker/src/subscriptions/dtos/create-subscription.dto.ts:67-70` — `amount`:
  `@IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })`, `@Min(0)`, `@Max(AMOUNT_MAX)`.
- `create-subscription.dto.ts:84-86` — `nextBillingDate` z `@IsDateOnly()`; `:30,49-55` — reguły
  `trialEndDate` i „rozliczenie nie wcześniej niż koniec trialu”.
- `create-subscription.dto.spec.ts:68-79` — przypadki akceptowane `0, 0.01, 43.5, 99999.99` i odrzucane
  kwoty; gotowe przykłady wyroczni dla tabeli frontu.

**Granica testowalności**: `SubscriptionForm.request()` jest `private` i zależy od komponentu z Material
(`subscription-form.ts:70-101`). Kompozycja „wartości formularza → żądanie” nie jest dziś czystą
funkcją; roadmap F-03 wyklucza testy komponentów (`roadmap.md:122`). Zob. Open Questions.

**Strefa czasowa**: komentarze `date-only.ts:1-2` (zachód: `new Date('YYYY-MM-DD')` daje dzień wcześniej)
i `:31-32` (wschód: `toISOString()` daje dzień wcześniej) opisują błędy widoczne w dwóch różnych
kierunkach od UTC. Test uruchomiony wyłącznie w UTC nie odróżni poprawnej implementacji od tych błędów.

### 4. Ryzyko #2 — decyzje guardów

- `auth/auth.guard.ts:19-29` — `sessionCookie()`: w przeglądarce `{ onServer: false }`; na serwerze
  czyta nagłówek `cookie` z `REQUEST` (może być `null` przy prerenderze) i przekazuje tylko parę
  `subtracker_session=…` (stała w l. 12 musi zgadzać się z backendem `auth.constants.ts`).
- `auth.guard.ts:33-51` — `guestGuard`: serwer bez ciasteczka → `true` bez wywołania API; w pozostałych
  przypadkach `AuthService.session(cookie?)` z `timeout(3000)`; `user === null` → `true`, użytkownik →
  `UrlTree('/subscriptions')`; błąd lub timeout → `true`.
- `auth.guard.ts:57-76` — `authGuard`: serwer bez ciasteczka → `UrlTree('/sign-in')` bez API;
  `timeout(10000)`; `user === null` → `/sign-in`; użytkownik → `true`; błąd lub timeout →
  `RedirectCommand('/unavailable', { skipLocationChange: true })`.
- `auth/auth.service.ts:42-48` — `session(cookie?)`: `GET {apiUrl}/auth/session`, nagłówek `Cookie` tylko,
  gdy podano; mapuje `{ user }` i ustawia sygnał `currentUser`.
- „Wygasła sesja” z macierzy planu: dla tej trasy API zwraca 200 z `user: null`, nie 401 (komentarz
  `session-expired.interceptor.ts:9-10`); w teście to odpowiedź `{ user: null }`.
- Macierz {serwer, przeglądarka} × {brak ciasteczka, ważna sesja, wygasła, API nie odpowiada} daje
  dla obu guardów osiem komórek; komórka „przeglądarka × brak ciasteczka” jest tą samą ścieżką kodu
  co „wygasła” (przeglądarka zawsze pyta API). Dodatkowe komórki z kodu: serwer z nagłówkiem
  `cookie` bez pary sesji (np. inne ciasteczka) → traktowany jak brak ciasteczka; timeout odróżniony
  od błędu HTTP tylko czasem.
- Punkty wstrzyknięcia do TestBed: `PLATFORM_ID` (`'server'`/`'browser'`), `REQUEST` (z `@angular/core`),
  `provideHttpClient()` + `provideHttpClientTesting()` → `HttpTestingController`; uruchomienie guarda
  przez `TestBed.runInInjectionContext`. To spełnia regułę planu „makieta tylko na granicy HTTP”.
- Pokrewne interceptory (testowalne tym samym narzędziem): `auth/session-expired.interceptor.ts:12-26`
  (401 poza `/auth/` → `navigateByUrl('/sign-in')`, błąd przekazany dalej) i
  `auth/credentials.interceptor.ts:4-10` (`withCredentials` tylko dla `apiUrl` i `apiUrl/…`).
- Poza zasięgiem testu jednostkowego: render mode tras i `Cache-Control: private, no-store`
  (`app.routes.server.ts:8-34`) oraz filtr transfer cache dla `/auth/session` (`app.config.ts:21-23`) —
  wymagają zbudowanego serwera SSR (faza 3 planu).

### 5. Ryzyko #4 — kwota miesięczna

- `subscriptions/subscription-amounts.ts:8-16` — `monthlyAmount(amount, cycle)`: dla `monthly` lub
  stringu niezgodnego z `^\d+\.\d{2}$` zwraca wejście bez zmian; dla `yearly` liczy grosze całkowite,
  `Math.round(grosze / 12)`, formatuje `X.YY`. Przykład z komentarza (l. 6): `"1233.87"` → 123387 gr →
  10282,25 → 10282 → `"102.82"`.
- Jedyny konsument w `src/`: `pages/subscriptions/subscription-table/subscription-table.ts:59` (szablon
  `.html:80,146`). Sumy (dashboard) jeszcze nie istnieją — S-04 (`roadmap.md:166-170`).
- PRD wymaga zgodności sum z ręcznym wyliczeniem (`prd.md:34`) i przeliczenia do wspólnego mianownika
  (`prd.md:55,76`), ale nie ustala reguły zaokrąglenia ani tego, czy zaokrąglać per subskrypcja, czy
  dopiero sumę. Wyrocznia dla przypadków bez połówki grosza jest jednoznaczna (kwota podzielna przez 12),
  dla przypadków z resztą — nie.

## Code References

- `frontend-subtracker/package.json:9` — `"test": "ng test"`; brak `vitest`/`jsdom` w devDependencies
- `frontend-subtracker/angular.json:12-38` — `skipTests: true` w schematach; `:42-117` — brak celu `test`
- `frontend-subtracker/tsconfig.spec.json` — `vitest/globals`, `src/**/*.spec.ts`
- `.github/workflows/ci.yml:43-58` — job `frontend` bez testów
- `frontend-subtracker/src/app/shared/decimal.ts:3-12` — `parseDecimal`
- `frontend-subtracker/src/app/subscriptions/subscription-validators.ts:7-14` — `parseAmount`, `amountValidator`
- `frontend-subtracker/src/app/shared/date-only.ts:9-53` — `parseDateOnly`, `daysFromToday`, `toDateOnly`, `parseDayMonthYear`
- `frontend-subtracker/src/app/shared/pl-date-adapter.ts:11-19` — `PlDateAdapter.parse`
- `frontend-subtracker/src/app/shared/validation/not-before-date.ts:7-15`, `trimmed-required.ts:4-6`
- `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts:120-134,269-296` — walidatory pól i składanie żądania
- `frontend-subtracker/src/app/subscriptions/subscription-amounts.ts:8-16` — `monthlyAmount`
- `frontend-subtracker/src/app/subscriptions/subscription-labels.ts:54-94` — `referenceDate`, `relativeDays`, `dateNote`, `phoneDatePrefix` (czyste, z wstrzykiwanym `today`)
- `frontend-subtracker/src/app/auth/auth.guard.ts:19-76` — `sessionCookie`, `guestGuard`, `authGuard`
- `frontend-subtracker/src/app/auth/auth.service.ts:42-48` — `session(cookie?)`
- `frontend-subtracker/src/app/auth/session-expired.interceptor.ts:12-26`, `credentials.interceptor.ts:4-10`
- `backend-subtracker/src/subscriptions/dtos/create-subscription.dto.ts:67-86` — kontrakt kwoty i dat
- `backend-subtracker/src/subscriptions/dtos/create-subscription.dto.spec.ts:67-137` — przykłady wyroczni

## Architecture Insights

- Logika podatna na błąd jest już wyciągnięta do czystych funkcji w `shared/` i `subscriptions/`
  (bez DI), więc większość ryzyka #3 i #4 pokrywają testy bez TestBed. TestBed jest potrzebny dla
  guardów, interceptorów i `PlDateAdapter` (dziedziczy po `NativeDateAdapter`, który wstrzykuje
  `MAT_DATE_LOCALE` opcjonalnie).
- Reguła z `lessons.md` („helper w `shared/<obszar>/` z testem obok”) przenosi się na front: test
  `*.spec.ts` obok pliku, zgodnie z domyślnym `include` buildera i `tsconfig.spec.json`.
- `daysFromToday` i funkcje z `subscription-labels.ts` już przyjmują `today` jako parametr — wzorzec
  deterministycznego czasu bez fake timerów.
- Reguła „unikaj `any`” (`lessons.md`) dotyczy też testów (np. typowanie odpowiedzi w `HttpTestingController`).

## Historical Context (from prior changes)

- `context/archive/2026-11-11-first-subscription-in-list/plan.md:112-113` — S-02 testował walidację kwot
  i dat tylko po stronie backendu (unit DTO + e2e: `-1`, `100000`, `1.234` → 400, `0` → 201). Supported:
  backend ma te testy (`create-subscription.dto.spec.ts`).
- `context/archive/2026-11-11-first-subscription-in-list/plan.md:244` — front sprawdzany ręcznie
  (`abc`, `-1`, `100 000`, `31.02.2026`). Supported: brak `*.spec.ts` w `frontend-subtracker/src`.
- Commit `68751b3` wprowadził `parseDecimal` z `String.raw` (jedyny commit w `git log -S"String.raw"`
  dla `frontend-subtracker/src`) — zgodne z wywiadem Q2 planu testów (regex odrzucał każdą kwotę).
- `roadmap.md:110-122` — F-03 obejmuje runner, CI i testy helperów oraz „kontrolę celowego uszkodzenia
  dla każdego testu”; wyklucza testy komponentów i e2e przeglądarki.

## Related Research

- `context/archive/2026-11-11-first-subscription-in-list/research.md` — format kwot i dat, locale bazy.
- `context/archive/2026-11-10-ui-foundation/` — decyzje o guardach przy SSR i przekazywaniu ciasteczka.

## Open Questions

1. **Reguła zaokrąglenia kwoty miesięcznej (produkt, blokuje wyrocznię #4 tylko dla kwot z resztą)** —
   `Math.round` na groszach (połówka w górę) per subskrypcja, czy inna reguła? Decyzja wpływa też na
   sumy w S-04. Bez niej test może bezpiecznie objąć kwoty podzielne przez 12 i przypadki „bez zmian”.
2. **Kompozycja żądania z formularza** — test `request()` wymaga testu komponentu (poza zakresem F-03)
   albo wyciągnięcia czystej funkcji „wartości formularza → `CreateSubscriptionRequest`”. Wybór dla `/10x-plan`.
3. **Strefa czasowa testów** — jak wymusić strefę inną niż UTC (np. `Europe/Warsaw` i strefa na zachód
   od Greenwich) pod builderem Angulara: zmienna `TZ` w skrypcie/CI czy ustawienie w `setupFiles`.
   Do zweryfikowania przy implementacji; nie sprawdzono, czy builder przekazuje `TZ` do workerów Vitest.
4. **`jsdom` czy `happy-dom`** — oba spełniają wymaganie buildera; wybór i wersja do planu.
5. **`skipTests: true` w `angular.json`** — zostawić czy przełączyć, skoro od F-03 helpery mają mieć test obok.
6. Pytanie z roadmapy „czy moduł 3 kursu narzuca układ testów” — odpowiedź daje `test-plan.md` §6.1,
   który ta faza ma uzupełnić (lokalizacja, nazewnictwo, test referencyjny, polecenie).
