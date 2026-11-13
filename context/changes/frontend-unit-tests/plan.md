# Testy jednostkowe frontendu (F-03) — plan implementacji

## Overview

Faza 1 planu testów (`context/foundation/test-plan.md` §3): `frontend-subtracker` dostaje działający
runner (Vitest przez builder `@angular/build:unit-test`), przebieg testów w dwóch strefach czasowych,
bramkę „unit frontend” w CI oraz testy z niezależną wyrocznią dla ryzyk #3 (kwoty i daty z formularza do
API), #4 (kwota miesięczna) i #2 (decyzje guardów na serwerze i w przeglądarce). Na koniec §6.1 planu
testów staje się przepisem „jak dodać test jednostkowy frontendu”.

## Current State Analysis

- Frontend nie ma żadnego testu ani runnera: `angular.json:42-117` ma tylko cele `build` i `serve`,
  w `devDependencies` brak `vitest` i środowiska DOM, a `skipTests: true` jest ustawione dla wszystkich
  schematów (`angular.json:12-38`). `npm test` (`package.json:9`) już wywołuje `ng test`, a
  `tsconfig.spec.json` ze scaffoldu ma `vitest/globals` i `src/**/*.spec.ts`.
- `@angular/build` 22.2.0 ma builder `unit-test` z domyślnym runnerem `vitest` (peer `^4.0.8 || ^5.0.0`);
  bez `browsers` wymaga `jsdom` lub `happy-dom` (research §1).
- Job `frontend` w CI (`.github/workflows/ci.yml:43-58`) robi tylko `npm ci` i `npm run prepare-mydevil`.
- Logika ryzyk #3 i #4 jest w czystych funkcjach: `shared/decimal.ts:7-12`,
  `subscriptions/subscription-validators.ts:7-14`, `shared/date-only.ts:9-53`,
  `shared/validation/not-before-date.ts`, `shared/validation/trimmed-required.ts`,
  `subscriptions/subscription-amounts.ts:8-16`. Wyjątek: `PlDateAdapter.parse`
  (`shared/pl-date-adapter.ts:11-19`) dziedziczy po `NativeDateAdapter`, a ciało żądania do API składa
  prywatna metoda `SubscriptionForm.request()` (`subscription-form.ts:269-296`).
- Ryzyko #2: `guestGuard` i `authGuard` (`auth/auth.guard.ts:33-76`) rozgałęziają się po `PLATFORM_ID`,
  ciasteczku z `REQUEST` i odpowiedzi `GET /auth/session` (`auth.service.ts:42-48`); interceptory
  `session-expired.interceptor.ts:12-26` i `credentials.interceptor.ts:4-10` porównują URL z
  `environment.apiUrl`.
- Aplikacja działa bez `zone.js` — TestBed w trybie zoneless, czas w testach guardów sterowany fake
  timerami Vitest.

## Desired End State

- `npm test` lokalnie uruchamia Vitest przez `ng test`; `npm run test:ci` uruchamia cały zestaw jeden raz
  w `Europe/Warsaw` i jeden raz w `America/New_York`, a test-strażnik odpada, jeśli strefa nie dotarła do
  workerów.
- Job `frontend` w CI uruchamia `npm run test:ci` przed buildem; czerwony test blokuje PR.
- Testy obok plików (`*.spec.ts`) pokrywają: parsowanie kwot, parsowanie i zapis dat, adapter
  datepickera, walidatory formularza, nową czystą funkcję składającą żądanie, `monthlyAmount`, oba
  guardy w macierzy {serwer, przeglądarka} × {brak ciasteczka, ważna sesja, wygasła sesja, API nie
  odpowiada} oraz oba interceptory auth. Każdy plik przeszedł ręczną kontrolę celowego uszkodzenia
  zapisaną w `context/changes/frontend-unit-tests/sabotage-log.md`.
- `test-plan.md` §6.1 opisuje lokalizację, nazewnictwo, test referencyjny i polecenia; §4 ma wiersz
  „unit (frontend)” z wersjami; §3 faza 1 ma status `complete`.

### Key Discoveries:

- Wyrocznia kwoty pochodzi z kontraktu API, nie z frontu: `create-subscription.dto.ts:67-70` (liczba,
  ≤ 2 miejsca, 0…99 999,99) i przykłady `create-subscription.dto.spec.ts:68-79`.
- Reguła zaokrąglenia #4 jest ustalona w `test-plan.md` §2 (wiersz #4): grosze / 12, do grosza per
  subskrypcja, połówka w górę. Przykład policzony ręcznie: `"12.06"` rocznie = 1206 gr → 100,5 gr →
  101 gr → `"1.01"`.
- „Wygasła sesja” dla `GET /auth/session` to odpowiedź 200 z `{ user: null }`, nie 401
  (`session-expired.interceptor.ts:6-10`).
- `daysFromToday` i funkcje w `subscription-labels.ts` przyjmują `today` jako parametr — czas w testach
  helperów wstrzykujemy, bez fake timerów.
- Komentarze `date-only.ts:1-2` i `:31-32` opisują błędy przesunięcia doby widoczne w przeciwnych
  kierunkach od UTC — stąd dwie strefy (wschód i zachód), a nie jedna.

## What We're NOT Doing

- Testów komponentów (np. renderowania `SubscriptionForm`, tabeli) — poza F-03 (`roadmap.md:122`).
- Testów render mode tras, nagłówków `Cache-Control` i filtra transfer cache (`app.routes.server.ts`,
  `app.config.ts`) — wymagają zbudowanego SSR, należą do fazy 4 planu testów.
- Narzędzia mutacyjnego (Stryker) — kontrola celowego uszkodzenia jest ręczna i zapisana w logu.
- Zmiany `skipTests: true` w `angular.json` — wygenerowane specy komponentów („should create”) nie dają
  sygnału; wzorzec testu obok helpera opisuje §6.1.
- Pokrycia kodu jako metryki i progu w CI.
- Hooków agenta, MCP i e2e — późniejsze lekcje i fazy planu testów.
- Sum kwot (dashboard) — powstaną w S-04; ten plan testuje tylko kwotę per subskrypcja.

## Implementation Approach

Najpierw infrastruktura z jednym prawdziwym testem, żeby bramka w CI od początku coś sprawdzała. Potem
czyste funkcje (najtańsza warstwa, bez TestBed) dla #3 i #4, z jednym wydzieleniem kodu produkcyjnego:
składanie żądania z formularza staje się czystą funkcją, którą formularz wywołuje. Potem TestBed z
`HttpTestingController` dla guardów i interceptorów — makieta wyłącznie na granicy HTTP. Każda tabela
przypadków ma wyrocznię z wymagań (PRD, kontrakt DTO backendu, decyzja zaokrąglenia, polski kalendarz),
nigdy przepisaną z implementacji. Gdy test z taką wyrocznią wykaże błąd w kodzie produkcyjnym, błąd jest
naprawiany w tej samej fazie, a test zostaje jako strażnik regresji; jeśli poprawka nie jest mała,
implementujący zatrzymuje się i pyta.

Każdy plik testów przechodzi kontrolę celowego uszkodzenia: implementujący psuje testowaną jednostkę
(np. usuwa separator grup, odwraca gałąź guarda, zamienia `Math.round` na `Math.floor`), potwierdza, że
co najmniej jeden test zmienia się na czerwony, cofa zmianę i dopisuje wpis do `sabotage-log.md`
(plik testów, uszkodzenie, test, który odpadł).

## Critical Implementation Details

- **Strefa czasowa musi być ustawiona przed startem procesu.** `TZ=… ng test` w skrypcie npm nie działa
  na Windowsie, dlatego oba przebiegi uruchamia skrypt Node, który ustawia `TZ` w `env` procesu
  potomnego. Nie sprawdzono, czy builder przekazuje `TZ` do workerów Vitest — test-strażnik musi to
  udowodnić, inaczej testy dat są zielone w UTC i nic nie dowodzą.
- **Timeouty guardów:** `timeout()` z RxJS używa `setTimeout`/`setInterval`; testy przesuwają fake timery
  Vitest za 3000 ms (`guestGuard`) i 10000 ms (`authGuard`) i sprawdzają, że przed progiem decyzji
  jeszcze nie ma.

## Phase 1: Runner, przebieg w dwóch strefach i bramka CI

### Overview

Działający `ng test` z Vitest i jsdom, skrypt dwóch stref, krok w CI i pierwszy plik testów (kwoty).

### Changes Required:

#### 1. Zależności i skrypty

**File**: `frontend-subtracker/package.json`, `frontend-subtracker/package-lock.json`

**Intent**: Dodać runner i środowisko DOM wymagane przez builder oraz skrypt przebiegu w dwóch strefach.

**Contract**: `devDependencies`: `vitest` w linii `^4.1` (jak backend, w peer range `@angular/build`),
`jsdom` (aktualna wersja zgodna z Vitest 4). Skrypty: `test` zostaje `ng test`; nowy `test:ci` =
`node scripts/test-time-zones.mjs`. Instalacja przez `npm install` (lockfile commitowany).

#### 2. Cel `test` w `angular.json`

**File**: `frontend-subtracker/angular.json`

**Intent**: Podłączyć builder testów jednostkowych, żeby `ng test` miał cel.

**Contract**: `architect.test` z `builder: "@angular/build:unit-test"`; runner domyślny (`vitest`), bez
`browsers` (Node + jsdom), `tsConfig` `tsconfig.spec.json`. Jeśli wersja buildera wymaga `buildTarget`,
wskazać konfigurację `development` celu `build`. `skipTests` bez zmian.

#### 3. Typy w `tsconfig.spec.json`

**File**: `frontend-subtracker/tsconfig.spec.json`

**Intent**: Test-strażnik strefy czyta `process.env.TZ`, więc specy potrzebują typów Node obok
`vitest/globals`.

**Contract**: `compilerOptions.types`: `["vitest/globals", "node"]`. `tsconfig.app.json` bez zmian (nadal
wyklucza specy).

#### 4. Skrypt dwóch stref

**File**: `frontend-subtracker/scripts/test-time-zones.mjs` (nowy)

**Intent**: Uruchomić cały zestaw jeden raz na strefę — na wschód (`Europe/Warsaw`) i na zachód
(`America/New_York`) od UTC — tak samo lokalnie (Windows) i w CI (Linux).

**Contract**: Dla każdej strefy uruchamia `ng test --watch=false` jako proces potomny z `env.TZ`
ustawionym na tę strefę, wypisuje nazwę strefy przed przebiegiem, kończy się kodem ≠ 0 przy pierwszym
nieudanym przebiegu. Bez zależności spoza Node. Przenośne między Windows i Linux (np. `spawn` z
`shell: true` albo przez ścieżkę do `ng` w `node_modules/.bin`).

#### 5. Test-strażnik strefy

**File**: `frontend-subtracker/src/test-time-zone.spec.ts` (nowy)

**Intent**: Udowodnić, że strefa ustawiona przez skrypt dotarła do kodu testów; bez tego przebieg w
dwóch strefach mógłby po cichu biec w UTC.

**Contract**: Gdy `process.env.TZ` jest ustawione, `Intl.DateTimeFormat().resolvedOptions().timeZone`
równa się tej wartości, a przesunięcie (`getTimezoneOffset`) dla daty zimowej ma znak zgodny ze
stroną Greenwich (Warszawa ujemne, Nowy Jork dodatnie). Gdy `TZ` nie jest ustawione (zwykłe
`npm test`), test jest pomijany z czytelną nazwą.

#### 6. Pierwszy plik testów: kwoty

**File**: `frontend-subtracker/src/app/shared/decimal.spec.ts`,
`frontend-subtracker/src/app/subscriptions/subscription-validators.spec.ts` (nowe)

**Intent**: Pokryć ryzyko #3 dla kwoty tabelą polskich wejść z wyrocznią z kontraktu API.

**Contract**: Tabela `it.each` wejście → oczekiwany wynik. `parseAmount` przyjmuje: `"12,99"`→12.99,
`"12.99"`→12.99, `"43,5"`→43.5, `"0"`→0, `" 12,99 "`→12.99, `"1 299,00"` ze spacją, U+00A0 i U+202F →
1299, `"99 999,99"`→99999.99. Odrzuca (`null`): `""`, `"abc"`, `"-1"`, `"1,234"`, `"12,"`, `",5"`,
`"100 000"`, `"99 999,991"`, `"1.299,00"` (kropka nie jest polskim separatorem grup), `"12,99 zł"`,
`"1e3"`. `parseDecimal` dodatkowo sprawdza parametr `maxFractionDigits` (np. 0 i 3). `amountValidator`:
`{ amount: true }` dla odrzuconej wartości, `null` dla przyjętej.

#### 7. Krok w CI

**File**: `.github/workflows/ci.yml`

**Intent**: Bramka „unit frontend” z §5 planu testów.

**Contract**: W jobie `frontend` krok `npm run test:ci` między `npm ci` a `npm run prepare-mydevil`
(wzorzec joba `backend`: testy przed buildem).

#### 8. Log kontroli uszkodzenia

**File**: `context/changes/frontend-unit-tests/sabotage-log.md` (nowy)

**Intent**: Zapis kontroli celowego uszkodzenia wymaganej przez F-03.

**Contract**: Tabela: plik testów | uszkodzenie w kodzie | test, który odpadł | data. Pierwsze wpisy dla
plików z tej fazy (np. usunięcie U+00A0 z separatorów, zmiana `{1,N}` na `{1,}`, usunięcie limitu
`AMOUNT_MAX`).

### Success Criteria:

#### Automated Verification:

- `npm test -- --watch=false` w `frontend-subtracker/` przechodzi
- `npm run test:ci` przechodzi w obu strefach i wypisuje nazwę każdej strefy
- `npm run build` przechodzi (specy nie trafiają do bundla)
- Job `frontend` w CI na gałęzi `change/frontend-unit-tests` jest zielony z krokiem `npm run test:ci`

#### Manual Verification:

- Test-strażnik odpada, gdy skrypt dostanie strefę różną od faktycznej (np. tymczasowo podmieniona
  oczekiwana strefa), i przechodzi po cofnięciu
- Kontrola celowego uszkodzenia dla `decimal.spec.ts` i `subscription-validators.spec.ts` wpisana do
  `sabotage-log.md`

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie
przed fazą 2.

---

## Phase 2: Kwoty, daty i kwota miesięczna (#3, #4)

### Overview

Testy czystych helperów dat, adaptera datepickera, walidatorów formularza i `monthlyAmount`; wydzielenie
składania żądania z `SubscriptionForm` do czystej funkcji z testem.

### Changes Required:

#### 1. Daty

**File**: `frontend-subtracker/src/app/shared/date-only.spec.ts` (nowy)

**Intent**: Pokryć ryzyko #3 dla dat: tekst `d.m.rrrr` → dzień, dzień → `YYYY-MM-DD` bez przesunięcia
doby w obu strefach, liczba dni do daty.

**Contract**: `parseDayMonthYear`: przyjmuje `"5.1.2026"` i `"05.01.2026"` (oba → 5 stycznia 2026,
lokalna północ), `" 05.01.2026 "`, `"29.02.2028"`; odrzuca `"29.02.2027"`, `"31.02.2027"`,
`"31.04.2026"`, `"0.01.2026"`, `"1.13.2026"`, `"2026-01-05"`, `"5/1/2026"`, `"5.1.26"`. `toDateOnly`:
lokalna północ i 23:30 tego samego dnia dają ten sam `YYYY-MM-DD`; dopełnienie zerami miesiąca i dnia.
`parseDateOnly`: `"2026-11-15"` → lokalna północ 15 listopada (sprawdzone składnikami daty, nie
`toISOString`); niepoprawny format → `null`. Złożenie `toDateOnly(parseDayMonthYear(x))` daje dzień
wpisany przez użytkownika. `daysFromToday` z wstrzykniętym `today`: 0, 1, −1, przez zmianę czasu w
Europie (29.03.2026) i w USA (08.03.2026) dokładnie 1 dzień, `null` dla złego formatu.

#### 2. Adapter datepickera

**File**: `frontend-subtracker/src/app/shared/pl-date-adapter.spec.ts` (nowy)

**Intent**: Zabezpieczyć kontrakt `null` (puste pole) vs nieprawidłowa data (błąd
`matDatepickerParse`).

**Contract**: Adapter z TestBed (`DateAdapter` → `PlDateAdapter`, `MAT_DATE_LOCALE` `pl-PL`).
`parse("05.01.2026")` → 5 stycznia; `parse("")` i `parse("   ")` → `null`; `parse("abc")` i
`parse("31.02.2027")` → obiekt, dla którego `isValid` daje `false` (nie `null`); wartość nie-string
(np. `Date`) przechodzi ścieżką bazową.

#### 3. Walidatory formularza

**File**: `frontend-subtracker/src/app/shared/validation/not-before-date.spec.ts`,
`frontend-subtracker/src/app/shared/validation/trimmed-required.spec.ts` (nowe)

**Intent**: Pokryć reguły formularza z PRD i DTO: nazwa nie może być pusta po przycięciu, rozliczenie
nie wcześniej niż koniec trialu.

**Contract**: `trimmedRequired`: `""`, `"   "` → `{ required: true }`; `" a "` → `null`. `notBeforeDate`:
ten sam dzień o różnych godzinach → `null`; dzień wcześniej → `{ notBeforeDate: true }`; `null` po
którejkolwiek stronie → `null`. Kontrolki tworzone przez `new FormControl`, bez TestBed.

#### 4. Wydzielenie składania żądania

**File**: `frontend-subtracker/src/app/subscriptions/subscription-request.ts` (nowy),
`frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts`

**Intent**: Zamienić prywatne `SubscriptionForm.request()` na czystą funkcję, żeby „wartość wysłana do
API” z ryzyka #3 dała się sprawdzić bez testu komponentu. Zachowanie formularza bez zmian.

**Contract**: Eksportowany typ wartości formularza (pola jak `form.getRawValue()`: `name`, `categoryId`,
`amount: string`, `billingCycle`, `paymentMethod: PaymentMethod | ''`, `status`,
`trialEndDate: Date | null`, `nextBillingDate: Date | null`) i funkcja
`toCreateSubscriptionRequest(value): CreateSubscriptionRequest | null` z dzisiejszą logiką l. 274-295
(przycięta nazwa, `parseAmount`, `toDateOnly`, `trialEndDate` tylko dla `trial`). Formularz zostawia
sprawdzenie `this.form.invalid` i deleguje do funkcji. Typy bez `any` (`lessons.md`).

#### 5. Test składania żądania

**File**: `frontend-subtracker/src/app/subscriptions/subscription-request.spec.ts` (nowy)

**Intent**: Tabela wartości formularza → dokładne ciało żądania albo `null`.

**Contract**: `amount: "1 299,00"` → `amount: 1299`; `amount: "12,99"` → `12.99`; daty z
`new Date(2027, 1, 28)` → `"2027-02-28"` w obu strefach; `name: "  Netflix  "` → `"Netflix"`;
`status: "trial"` z `trialEndDate` → pole `trialEndDate` obecne; `status: "active"` z ustawionym
`trialEndDate` → klucza `trialEndDate` brak; `null` dla: niepoprawnej kwoty, `paymentMethod: ""`,
`nextBillingDate: null`, `trial` bez `trialEndDate`. Porównanie całego obiektu (`toEqual`), żeby
dodatkowe pole też odpadło.

#### 6. Kwota miesięczna

**File**: `frontend-subtracker/src/app/subscriptions/subscription-amounts.spec.ts` (nowy)

**Intent**: Pokryć ryzyko #4 wyrocznią policzoną ręcznie według reguły z `test-plan.md` §2 (grosze / 12,
do grosza, połówka w górę).

**Contract**: rocznie: `"120.00"`→`"10.00"`, `"1233.87"`→`"102.82"` (123387/12 = 10282,25),
`"12.06"`→`"1.01"` (100,5 → 101, połówka), `"12.05"`→`"1.00"` (100,42), `"0.06"`→`"0.01"`,
`"0.05"`→`"0.00"`, `"99999.99"`→`"8333.33"` (833333,25); miesięcznie: `"12.99"`→`"12.99"`; wartość spoza
formatu API (`"12.9"`) wraca bez zmian. Wartości oczekiwane wpisane jako literały z obliczeniem w
komentarzu, nie liczone wzorem w teście.

#### 7. Log kontroli uszkodzenia

**File**: `context/changes/frontend-unit-tests/sabotage-log.md`

**Intent**: Wpisy dla każdego pliku testów z tej fazy.

**Contract**: Przykładowe uszkodzenia: `toISOString().slice(0, 10)` w `toDateOnly`, usunięcie porównania
składników w `parseDayMonthYear`, `return null` zamiast `this.invalid()`, wysyłanie `trialEndDate` dla
każdego statusu, `Math.floor` zamiast `Math.round`.

### Success Criteria:

#### Automated Verification:

- `npm run test:ci` przechodzi w obu strefach
- `npm run build` przechodzi po wydzieleniu `subscription-request.ts`
- Job `frontend` w CI zielony

#### Manual Verification:

- Formularz dodawania subskrypcji (`/subscriptions`, `npm start` + backend) zapisuje subskrypcję z kwotą
  `1 299,00` i datą wpisaną jako `5.1.2027` tak samo jak przed zmianą (wartości na liście)
- `toDateOnly` uszkodzone przez `toISOString` odpada w przebiegu `Europe/Warsaw`, a złe
  `parseDateOnly` (`new Date('YYYY-MM-DD')`) odpada w `America/New_York` — potwierdzenie, że dwie
  strefy dają sygnał
- Kontrola celowego uszkodzenia dla każdego pliku testów z fazy wpisana do `sabotage-log.md`

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie
przed fazą 3.

---

## Phase 3: Guardy i interceptory (#2)

### Overview

TestBed z `HttpTestingController`: macierz decyzji obu guardów i dwa interceptory auth. Makieta tylko na
granicy HTTP — `AuthService` i `Router` są prawdziwe.

### Changes Required:

#### 1. Guardy

**File**: `frontend-subtracker/src/app/auth/auth.guard.spec.ts` (nowy)

**Intent**: Dla {serwer, przeglądarka} × {brak ciasteczka, ważna sesja, wygasła sesja, API nie
odpowiada} każdy guard daje oczekiwaną decyzję i nie pyta API, gdy nie powinien.

**Contract**: Providery: `PLATFORM_ID` (`'server'`/`'browser'`), `REQUEST` (obiekt `Request` z nagłówkiem
`cookie` albo `null` — prerender), `provideHttpClient()`, `provideHttpClientTesting()`,
`provideRouter([])`. Guard uruchamiany przez `TestBed.runInInjectionContext`, wynik Observable
odczytywany po `HttpTestingController.expectOne(...).flush(...)`. Oczekiwane decyzje:

| Platforma / sytuacja | `guestGuard` | `authGuard` |
|---|---|---|
| serwer, brak `REQUEST` lub brak ciasteczka sesji (także same inne ciasteczka) | `true`, brak żądania | UrlTree `/sign-in`, brak żądania |
| serwer, ciasteczko + `{ user }` | UrlTree `/subscriptions` | `true` |
| serwer, ciasteczko + `{ user: null }` (wygasła) | `true` | UrlTree `/sign-in` |
| serwer, ciasteczko + błąd HTTP / sieci | `true` | `RedirectCommand` `/unavailable`, `skipLocationChange: true` |
| serwer, ciasteczko + brak odpowiedzi | `true` po 3000 ms | `RedirectCommand` `/unavailable` po 10000 ms |
| przeglądarka + `{ user }` / `{ user: null }` / błąd / brak odpowiedzi | jak wyżej | jak wyżej |

Dodatkowo: na serwerze żądanie ma nagłówek `Cookie` równy dokładnie `subtracker_session=<wartość>`
(bez innych ciasteczek z nagłówka); w przeglądarce nagłówka `Cookie` nie ma. Przed progiem czasu (np.
2999 ms / 9999 ms) decyzji jeszcze nie ma. Fake timery Vitest, przywracane po każdym teście;
`httpTesting.verify()` po każdym teście.

#### 2. Interceptory

**File**: `frontend-subtracker/src/app/auth/session-expired.interceptor.spec.ts`,
`frontend-subtracker/src/app/auth/credentials.interceptor.spec.ts` (nowe)

**Intent**: Wygaśnięcie sesji na otwartej stronie kończy się przejściem do `/sign-in`, a ciasteczko leci
tylko do API.

**Contract**: `HttpClient` z `provideHttpClient(withInterceptors([...]))` + `provideHttpClientTesting()`;
URL-e budowane z `environment.apiUrl`. `sessionExpiredInterceptor`: 401 na `${apiUrl}/subscriptions` →
`Router.navigateByUrl('/sign-in')` wywołane i błąd przekazany do wywołującego; 401 na
`${apiUrl}/auth/session` i `${apiUrl}/auth/verify` → brak nawigacji; 500 na trasie API → brak nawigacji;
401 z innego hosta → brak nawigacji. Obserwacja nawigacji przez `vi.spyOn` na prawdziwym `Router`.
`credentialsInterceptor`: `withCredentials` `true` dla `apiUrl` i `${apiUrl}/x`; `false` dla
`${apiUrl}.example.com/x` i obcego hosta.

#### 3. Log kontroli uszkodzenia

**File**: `context/changes/frontend-unit-tests/sabotage-log.md`

**Intent**: Wpisy dla plików testów z tej fazy.

**Contract**: Przykładowe uszkodzenia: przekazywanie całego nagłówka `cookie`, zamiana `true`/UrlTree w
gałęzi braku ciasteczka, `catchError` w `authGuard` zwracający `/sign-in`, usunięcie wyjątku `/auth/`,
prefiks bez końcowego `/` w `credentialsInterceptor`.

### Success Criteria:

#### Automated Verification:

- `npm run test:ci` przechodzi w obu strefach
- `npm run build` przechodzi
- Job `frontend` w CI zielony

#### Manual Verification:

- Kontrola celowego uszkodzenia dla `auth.guard.spec.ts` i obu specy interceptorów wpisana do
  `sabotage-log.md`
- Przegląd specy: żaden test nie mockuje `AuthService` ani wnętrza guarda (tylko granica HTTP)

**Implementation Note**: Po przejściu weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie
przed fazą 4.

---

## Phase 4: Cookbook i zamknięcie

### Overview

Przepis §6.1 w planie testów, wiersz stosu §4, notatka fazy §6.6 i status fazy w §3.

### Changes Required:

#### 1. `test-plan.md`

**File**: `context/foundation/test-plan.md`

**Intent**: Uczynić §6.1 kanoniczną odpowiedzią na „jak dodać test jednostkowy frontendu” (czyta to
`/10x-tdd` w lekcji 2).

**Contract**: §6.1: **Location** (`*.spec.ts` obok pliku w `frontend-subtracker/src/`; helper w `shared/`
zawsze z testem obok), **Naming** (`describe` = nazwa jednostki, `it.each` z tabelą wejście → wynik i
źródłem wyroczni w komentarzu), **Reference tests** (`subscription-validators.spec.ts` — tabela z
wyrocznią z DTO; `auth.guard.spec.ts` — TestBed + `HttpTestingController`; `subscription-amounts.spec.ts`
— wyrocznia policzona ręcznie), **Run locally** (`npm test`, jeden plik: `npx ng test --include
<ścieżka> --watch=false`, obie strefy: `npm run test:ci`), **Sabotage check** (krótko: uszkodź, zobacz
czerwony, cofnij). §4: wiersz „unit (frontend)” — Vitest + jsdom z wersjami, przez
`@angular/build:unit-test`. §5: „unit frontend” → `required`. §6.6: 2–3 linie wniosków z fazy. §3 faza
1: status `complete`. `Last updated` na dzień zamknięcia.

### Success Criteria:

#### Automated Verification:

- `test-plan.md` §6.1 nie zawiera już „TBD — see §3 Phase 1”
- Polecenie jednego pliku z §6.1 działa dla `subscription-amounts.spec.ts`

#### Manual Verification:

- Osoba spoza zmiany potrafi dodać nowy test helpera wyłącznie na podstawie §6.1

---

## Testing Strategy

### Unit Tests:

- Kwoty: polskie wejścia (przecinek, kropka, trzy rodzaje spacji grup), granice 0 i 99 999,99, odrzucenia
  z kontraktu DTO.
- Daty: `d.m.rrrr`, nieistniejące dni, rok przestępny, przesunięcie doby w strefie na wschód i zachód,
  zmiana czasu.
- Żądanie: dokładne ciało wysyłane do API, `trialEndDate` tylko dla trialu.
- Kwota miesięczna: reszta z dzielenia przez 12, połówka grosza, maksimum.
- Guardy i interceptory: macierz platforma × stan sesji, timeouty, przekazywanie ciasteczka.

### Integration Tests:

- Brak w tej fazie — e2e backendu i przeglądarki w fazach 2 i 3 planu testów.

### Manual Testing Steps:

1. `npm run test:ci` lokalnie na Windows — oba przebiegi i nazwy stref widoczne.
2. Dodanie subskrypcji z kwotą `1 299,00` i datą `5.1.2027` po wydzieleniu `subscription-request.ts`.
3. Kontrola celowego uszkodzenia dla każdego pliku testów, wpisy w `sabotage-log.md`.

## Performance Considerations

Dwa przebiegi zestawu w CI wydłużają job `frontend` o czas uruchomienia buildera testów ×2; przy kilku
plikach czystych testów to sekundy. Jeśli przekroczy minutę, rozważyć osobny przebieg tylko dla specy
dat — decyzja przy `--refresh` planu testów, nie teraz.

## Migration Notes

Brak zmian w bazie i API. Jedyna zmiana kodu produkcyjnego to wydzielenie
`subscription-request.ts` bez zmiany zachowania (oraz ewentualne poprawki błędów wykrytych testami).

## References

- Research: `context/changes/frontend-unit-tests/research.md`
- Plan testów: `context/foundation/test-plan.md` (§2 wiersze #2–#4, §3 faza 1, §5, §6.1)
- Roadmap: `context/foundation/roadmap.md` F-03
- Kontrakt kwoty i dat: `backend-subtracker/src/subscriptions/dtos/create-subscription.dto.ts:67-86`,
  `create-subscription.dto.spec.ts:67-137`
- Wzorzec testów jednostkowych backendu: `backend-subtracker/src/**/*.spec.ts`
- Wzorzec joba CI: `.github/workflows/ci.yml:24-41`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Runner, przebieg w dwóch strefach i bramka CI

#### Automated

- [x] 1.1 `npm test -- --watch=false` w `frontend-subtracker/` przechodzi — bf7c89f
- [x] 1.2 `npm run test:ci` przechodzi w obu strefach i wypisuje nazwę każdej strefy — bf7c89f
- [x] 1.3 `npm run build` przechodzi (specy nie trafiają do bundla) — bf7c89f
- [x] 1.4 Job `frontend` w CI na gałęzi `change/frontend-unit-tests` jest zielony z krokiem `npm run test:ci` — bf7c89f

#### Manual

- [x] 1.5 Test-strażnik odpada, gdy skrypt dostanie strefę różną od faktycznej, i przechodzi po cofnięciu — bf7c89f
- [x] 1.6 Kontrola celowego uszkodzenia dla `decimal.spec.ts` i `subscription-validators.spec.ts` wpisana do `sabotage-log.md` — bf7c89f

### Phase 2: Kwoty, daty i kwota miesięczna (#3, #4)

#### Automated

- [x] 2.1 `npm run test:ci` przechodzi w obu strefach — e7bbd5c
- [x] 2.2 `npm run build` przechodzi po wydzieleniu `subscription-request.ts` — e7bbd5c
- [ ] 2.3 Job `frontend` w CI zielony

#### Manual

- [x] 2.4 Formularz dodawania subskrypcji zapisuje kwotę `1 299,00` i datę `5.1.2027` tak samo jak przed zmianą — e7bbd5c
- [x] 2.5 Uszkodzone `toDateOnly` odpada w `Europe/Warsaw`, a złe `parseDateOnly` w `America/New_York` — e7bbd5c
- [x] 2.6 Kontrola celowego uszkodzenia dla każdego pliku testów z fazy wpisana do `sabotage-log.md` — e7bbd5c

### Phase 3: Guardy i interceptory (#2)

#### Automated

- [x] 3.1 `npm run test:ci` przechodzi w obu strefach
- [x] 3.2 `npm run build` przechodzi
- [ ] 3.3 Job `frontend` w CI zielony

#### Manual

- [x] 3.4 Kontrola celowego uszkodzenia dla `auth.guard.spec.ts` i obu specy interceptorów wpisana do `sabotage-log.md`
- [x] 3.5 Przegląd specy: żaden test nie mockuje `AuthService` ani wnętrza guarda

### Phase 4: Cookbook i zamknięcie

#### Automated

- [ ] 4.1 `test-plan.md` §6.1 nie zawiera już „TBD — see §3 Phase 1”
- [ ] 4.2 Polecenie jednego pliku z §6.1 działa dla `subscription-amounts.spec.ts`

#### Manual

- [ ] 4.3 Osoba spoza zmiany potrafi dodać nowy test helpera wyłącznie na podstawie §6.1
