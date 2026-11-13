# Testy komponentów frontendu — plan implementacji

## Overview

Faza 2 planu testów (`context/foundation/test-plan.md` §3, „Frontend component tests”): `frontend-subtracker`
dostaje testy komponentów w istniejącym runnerze (Vitest + jsdom przez `@angular/build:unit-test`),
z TestBed w trybie zoneless i harnessami Angular Material. Pokrywamy ryzyko #7 (pola warunkowe
i komunikaty walidacji formularza subskrypcji, każdy komponent da się utworzyć) i drugą połowę #3
(tekst wpisany w prawdziwe pole trafia do `POST /subscriptions` zgodnie z kontraktem API).
Schemat komponentu dostaje `skipTests: false`. Na koniec §6.2 planu testów staje się przepisem
„jak dodać test komponentu”.

## Current State Analysis

- Runner działa od fazy 1: `angular.json` cel `test` = `@angular/build:unit-test` z samym `tsConfig`;
  11 plików `*.spec.ts` (czyste funkcje, guardy, interceptory, strażnik strefy), żadnego przy komponencie
  (research §6). CI uruchamia `npm run test:ci` (`.github/workflows/ci.yml:58`), który puszcza cały
  zestaw w `Europe/Warsaw` i `America/New_York` (`scripts/test-time-zones.mjs`) — nowe specy wchodzą
  do bramki bez zmian w CI.
- Builder obsługuje opcję `providersFile` (plik TS z domyślnym eksportem tablicy providerów dla
  środowiska testów; sprawdzone w `node_modules/@angular/build/src/builders/unit-test/schema.json`,
  2026-11-13). Dziś nieużywana.
- `LOCALE_ID` `pl-PL` i `registerLocaleData(localePl)` są tylko w `app.config.ts:13,18`; w TestBed
  domyślnie jest `en-US` (research §5).
- `@angular/animations` nie jest zainstalowany; Material 22 czyta `MATERIAL_ANIMATIONS`
  (eksport z `@angular/material/core`), a w jsdom bez `matchMedia` uznaje animacje za włączone
  (research §5, `_animation-chunk.mjs:6-19`).
- Formularz subskrypcji (`subscriptions/subscription-form/subscription-form.ts`) sam dostarcza
  `PlDateAdapter`, `MAT_DATE_LOCALE`, `PL_DATE_FORMATS`, `FORM_FIELD_DEFAULTS` (`:92-98`).
  Pola warunkowe mają dwa niezależne mechanizmy: `@if` w szablonie (`subscription-form.html:39,117`)
  i `enable()/disable()` kontrolki `trialEndDate` (`subscription-form.ts:163-169`). `categoryName` to
  samodzielna kontrolka poza grupą `form` (`:135`). `request()` używa `getRawValue()` (`:272`).
  Przy starcie formularz robi `GET /categories` (`:176-189`).
- `register` pokazuje błędy checkboxów nie przez `mat-error`, tylko przez `<p role="alert">`
  sterowane sygnałem `submitted` i powiązane przez `aria-describedby` (`register.html:18-42`).
- Wzorzec makiety na granicy HTTP już jest: `auth/auth.guard.spec.ts` (`provideHttpClient()` +
  `provideHttpClientTesting()`, URL-e z `environment.apiUrl`, `httpTesting.verify()` w `afterEach`).
- `angular.json` → `projects.frontend-subtracker.schematics["@schematics/angular:component"]`
  ma `skipTests: true`.

## Desired End State

- `npm run test:ci` przechodzi w obu strefach i obejmuje 12 nowych plików `*.spec.ts` przy komponentach.
- Spec `SubscriptionForm` dowodzi: pole końca trialu i pole własnej kategorii są w DOM dokładnie w swoich
  stanach; ukryte pole nigdy nie blokuje zapisu; po błędnym wpisie i próbie zapisu pole ma błąd
  (`MatFormFieldHarness.hasErrors()`); wpisany tekst kwoty i daty daje oczekiwane ciało `POST
  /subscriptions`, a złe wejście nie wysyła żądania.
- `register` ma test komunikatów przy checkboxach; pozostałe komponenty mają »should create«
  z wyrenderowanym szablonem.
- `ng generate component` tworzy plik `*.spec.ts`, który od razu przechodzi w polskim locale
  i z wyłączonymi animacjami (z `providersFile`).
- §6.2 i §6.6 planu testów opisują wzorzec, a §4 ma wiersz warstwy component.

### Key Discoveries:

- Bez adaptera z komponentu `05.01.2027` zostałoby odczytane przez `Date.parse` jako 1 maja 2027
  (research §4, sprawdzone w Node) — jedyny test, który to złapie, wpisuje tekst w pole i patrzy na ciało
  żądania.
- Domyślny `ErrorStateMatcher` pokazuje błąd przy `invalid && (touched || form.submitted)`
  (`_error-options-chunk.mjs:44-46`); `submit()` woła `markAllAsTouched()`, ale ta nie dotyka
  `categoryName` (poza grupą) — czy jej błąd pokaże się po zapisie, nie zostało jeszcze sprawdzone
  uruchomieniem (research Open Question 1).
- `getRawValue()` zawiera wyłączone kontrolki; koniec trialu nie trafia do API przy innym statusie tylko
  dzięki warunkowi w `toCreateSubscriptionRequest` (`subscription-request.ts:45-47`).
- `29.02.2027` nie istnieje (2027 nie jest przestępny) — należy do wejść odrzucanych; dzień przestępny
  do tabeli przyjętych to `29.02.2028` (research §4, poprawione w §2 #3).
- `MediaMatcher` w jsdom używa `noopMatchMedia`, więc `BreakpointObserver` daje układ desktopowy bez
  dodatkowych providerów (research §5).
- `Subscriptions` przy pustej liście sam otwiera formularz (`autoOpen`), więc jego »should create« musi
  obsłużyć `GET /subscriptions` i `GET /categories`.

## What We're NOT Doing

- Nie testujemy treści komunikatów, położenia elementów ani snapshotów (§7 planu testów).
- Nie powtarzamy w teście komponentu każdego przypadku parserów z fazy 1 — tylko reprezentatywne wejścia
  przez prawdziwe pole (okablowanie).
- Nie mockujemy `SubscriptionsService`, `AuthService` ani wnętrza formularza; makieta wyłącznie na granicy
  HTTP.
- Nie testujemy wariantu telefonu (`stickyActions`, podmiana `BreakpointObserver`) — układ, poza minimum.
- Nie dodajemy testów zachowania dla `sign-in`, `verify-link`, `app-shell`, strony `/subscriptions`
  (tylko »should create«); `/privacy-policy` i `/unavailable` zgodnie z §7 mają tylko »should create«.
- Nie zmieniamy `skipTests` dla schematów innych niż komponent.
- Nie zmieniamy CI ani nie dodajemy hooków (lekcje m3l3/m3l5); bramka „unit frontend” już uruchamia nowe specy.
- Nie podpinamy interceptorów aplikacji w testach komponentów (mają własne testy w `auth/`).

## Implementation Approach

Najpierw środowisko (providery globalne jak w `app.config`) i od razu najwyżej ocenione ryzyko #7
na formularzu, zaczynając od pytania otwartego z researchu (błąd `categoryName` po zapisie). Potem #3 tym
samym specem i tą samą pomocą „wypełnij poprawny formularz”, ale z tabelą wpisanych wejść. Następnie
tani, płytki pas »should create« plus jeden test `register`. Na koniec cookbook.

Wyrocznia w każdym teście zachowania to kontrakt API (`subscription.types.ts:37-48`,
`CreateSubscriptionRequest`; DTO backendu) i kalendarz, nigdy obecny kod. Asercja na całym ciele
żądania (`toEqual`), więc dodatkowe pole też jest błędem. Pola znajdujemy po etykiecie
(`floatingLabelText`), co jest uchwytem użytkownika, a nie asercją treści komunikatu. Narzędzia:
harnessy z `@angular/material/*/testing` w zainstalowanej wersji 22.2.6 (checked: 2026-11-13). Faza nie
używa narzędzi AI-native; wiersz AI-native w §4 zostaje bez zmian (checked: 2026-11-13).

## Critical Implementation Details

- **Kolejność w każdym teście formularza:** po `fixture.whenStable()` zawsze najpierw obsłuż
  `GET /categories` (`httpTesting.expectOne`, flush listy z co najmniej jedną kategorią), inaczej
  `verify()` w `afterEach` odpadnie, a select nie ma opcji. Brak żądania sprawdzamy przez
  `httpTesting.expectNone({ method: 'POST', url })`, a nie przez brak wyjątku.
- **»Should create« musi renderować:** samo `TestBed.createComponent` bez `await fixture.whenStable()`
  nie tworzy dyrektyw z szablonu, więc nie złapie brakującego providera (np. `DateAdapter` dla
  `MatDatepickerInput`). Każdy test tworzenia czeka na stabilność.
- **Pytanie otwarte o `categoryName`:** jeśli test „po próbie zapisu pole własnej kategorii ma błąd”
  jest czerwony, to realny błąd #7, a nie problem testu. Poprawka w tej samej fazie: `submit()` oznacza
  `categoryName` jako dotkniętą, gdy wybrano „Dodaj własną…”; test zostaje jako regresja.

## Phase 1: Środowisko testów komponentów i pola warunkowe formularza (#7)

### Overview

Wspólne providery testowe przez `providersFile`, `skipTests: false` dla schematu komponentu i spec
`SubscriptionForm` dla stanów warunkowych oraz komunikatów pól.

### Changes Required:

#### 1. Providery środowiska testów

**File**: `frontend-subtracker/src/test-providers.ts` (nowy), `frontend-subtracker/angular.json`

**Intent**: Testy dostają to, co aplikacja ma globalnie w `app.config.ts` (polskie locale), plus
wyłączone animacje Material (jsdom nie kończy animacji), żeby każdy spec — także wygenerowany
schematem — działał jak produkcja bez pamiętania o tym.

**Contract**: domyślny eksport tablicy providerów: `{ provide: LOCALE_ID, useValue: 'pl-PL' }`,
`{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }`; `registerLocaleData(localePl)`
na poziomie modułu (jak `app.config.ts:13`). Komentarz w pliku: dlaczego tylko to (HTTP i router są
zależnościami konkretnych komponentów i zostają w specach). `angular.json`: `architect.test.options.providersFile:
"src/test-providers.ts"`. Plik nie może pasować do `src/**/*.spec.ts`. Builder sam dodaje go do kompilacji
i przekazuje do `initTestEnvironment` dla całego przebiegu (`@angular/build/.../vitest/build-options.js:34-39,197-200`),
więc `tsconfig.spec.json` zostaje bez zmian.

#### 2. Schemat komponentu

**File**: `frontend-subtracker/angular.json`

**Intent**: Nowy komponent od razu dostaje spec (minimum »should create«, §3 faza 2).

**Contract**: `schematics["@schematics/angular:component"].skipTests: false`; pozostałe schematy bez zmian.

#### 3. Spec formularza — stany warunkowe i komunikaty

**File**: `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.spec.ts` (nowy)

**Intent**: Dowód dla #7 na prawdziwym formularzu z prawdziwym `SubscriptionsService`, makieta tylko na
granicy HTTP.

**Contract**: TestBed z `provideHttpClient()`, `provideHttpClientTesting()`; `TestbedHarnessEnvironment.loader`;
pomoc lokalna w specu „wypełnij poprawny formularz” (nazwa, kategoria z obsłużonej listy, kwota, forma
płatności, następne rozliczenie — wpisywane harnessami) z możliwością nadpisania pól; `afterEach`
→ `httpTesting.verify()`. Komentarz nad `describe` ze źródłem wyroczni (kontrakt API + reguła z §2 #7).
Testy, w tej kolejności:

- **a) Błąd pola własnej kategorii po próbie zapisu** (najpierw, rozstrzyga pytanie otwarte)
  - Zachowanie: wybrane „Dodaj własną…”, pusta nazwa, klik „Zapisz” → pole „Nazwa nowej kategorii”
    `hasErrors() === true`, pole „Kategoria” też ma błąd, brak `POST /subscriptions`.
  - Regresja: samodzielna kontrolka nie widzi `form.submitted` albo nie jest dotknięta → użytkownik nie
    widzi, czemu zapis nie przechodzi.
  - Źródło: research §2 i Open Question 1; §2 #7.
  - Przypadek brzegowy: kontrolka poza grupą `form` (`markAllAsTouched()` jej nie dotyka).
  - Anty-wzorzec unikany: asercja tekstu „Podaj nazwę kategorii.”.
- **b) Pole końca trialu obecne dokładnie dla statusu „okres próbny”**
  - Zachowanie: domyślnie (aktywna) brak pola „Koniec okresu próbnego”; po wyborze trialu jest; po
    powrocie do innego statusu znika (liczba harnessów 0/1/0).
  - Regresja: zgubiony lub odwrócony `@if (isTrial())`.
  - Źródło: research §1; §2 #7 „dla każdego stanu element jest albo go nie ma”.
  - Brzeg: przejście trial → aktywna (nie tylko stan początkowy).
  - Anty-wzorzec: sprawdzanie sygnału `isTrial` zamiast DOM.
- **c) Ukryte pole końca trialu nie blokuje zapisu**
  - Zachowanie: status aktywna, reszta poprawna → `POST /subscriptions` wychodzi; ciało bez `trialEndDate`.
  - Regresja: kontrolka zostaje włączona i wymagana, choć pole niewidoczne (rozjazd `@if` i `enable`).
  - Źródło: research §1 „ścieżka awarii”.
  - Brzeg: stan domyślny, którego »should create« nie sprawdza.
  - Anty-wzorzec: sprawdzanie `form.valid` zamiast wyjścia żądania.
- **d) Koniec trialu wpisany, potem status zmieniony → nie ma go w `POST`**
  - Zachowanie: trial, wpisany koniec trialu, zmiana na „aktywna”, zapis → ciało bez `trialEndDate`
    (kontrakt: „absent or null otherwise”).
  - Regresja: `getRawValue()` wysyła wyłączoną kontrolkę, gdy ktoś usunie warunek w budowie żądania.
  - Źródło: research §1 „Uwaga na `getRawValue()`”; `subscription.types.ts:37-38`.
  - Brzeg: wartość pozostała w wyłączonej kontrolce.
  - Anty-wzorzec: oczekiwane ciało przepisane z `toCreateSubscriptionRequest`.
- **e) Trial bez końca trialu i rozliczenie przed końcem trialu**
  - Zachowanie: trial bez daty końca → zapis nie wysyła `POST`, pole końca trialu `hasErrors()`.
    Trial z końcem `10.01.2027` i rozliczeniem `09.01.2027` → brak `POST`, pole „Następne rozliczenie”
    ma błąd; rozliczenie `10.01.2027` (ten sam dzień) → `POST` wychodzi.
  - Regresja: widoczne pole bez komunikatu albo zbyt ostra granica (`<` vs `<=`).
  - Źródło: kontrakt „`nextBillingDate` must not be earlier than `trialEndDate`” (`subscription.types.ts:37-38`).
  - Brzeg: równe daty (dzień graniczny).
  - Anty-wzorzec: treść komunikatu `notBeforeDate`.
- **f) Pole własnej kategorii obecne dokładnie dla „Dodaj własną…” i nie blokuje po zmianie wyboru**
  - Zachowanie: domyślnie brak pola „Nazwa nowej kategorii”; po „Dodaj własną…” jest; po wyborze
    istniejącej kategorii znika, a zapis z pustą `categoryName` wysyła `POST`.
  - Regresja: ukryta, pusta `categoryName` zaczyna blokować zapis albo pole się nie pokazuje.
  - Źródło: research §2.
  - Brzeg: powrót z „Dodaj własną…” do zwykłej kategorii.
  - Anty-wzorzec: sprawdzanie sygnału `addingOwnCategory`.
- **g) Dodanie własnej kategorii i konflikt**
  - Zachowanie: wpis nazwy, „Dodaj” → `POST /categories` z `{ name }` (przycięte), potem `GET /categories`;
    pole znika, a następny zapis wysyła `categoryId` nowej kategorii. Wariant 409 → pole zostaje, ma błąd,
    nie ma ponownego `GET`.
  - Regresja: po dodaniu kategoria nie jest wybrana albo konflikt nie jest pokazany.
  - Źródło: research §2; kontrakt 409 (`subscription.types.ts:50`).
  - Brzeg: odpowiedź 409.
  - Anty-wzorzec: asercja „Taka kategoria już istnieje.”.
- **h) Nieudane wczytanie kategorii pokazuje komunikat**
  - Zachowanie: `GET /categories` → 500 → w formularzu jest element `role="alert"` (liczba, bez treści).
  - Regresja: użytkownik ma pusty select bez wyjaśnienia.
  - Źródło: research §2 (`subscription-form.html:32-37`); §2 #7.
  - Brzeg: błąd sieci przy starcie.
  - Anty-wzorzec: asercja treści.
- **i) »Should create«** formularza z wyrenderowanym szablonem (łapie zgubiony provider dat lub pola).

### Success Criteria:

#### Automated Verification:

- Spec formularza przechodzi: `cd frontend-subtracker && npx ng test --include src/app/subscriptions/subscription-form/subscription-form.spec.ts --watch=false`
- Cały zestaw przechodzi w obu strefach: `cd frontend-subtracker && npm run test:ci`
- Build produkcyjny przechodzi: `cd frontend-subtracker && npm run build`
- Formatowanie: `cd frontend-subtracker && npx prettier --check src angular.json`
- Schemat komponentu tworzy spec: `cd frontend-subtracker && npx ng generate component tmp-check --dry-run` wypisuje `tmp-check.spec.ts`

#### Manual Verification:

- Sabotaż (w working tree, potem `git checkout --`): usunięcie `@if (isTrial())`, usunięcie `trialEndDate.enable()` i usunięcie warunku `status === 'trial'` w budowie żądania — każde daje czerwony test
- Wynik testu a) zapisany w notatce fazy: błąd `categoryName` pojawił się sam albo wymagał poprawki w `submit()`

**Implementation Note**: Po zielonej weryfikacji automatycznej zatrzymaj się na potwierdzenie sabotażu przez człowieka przed fazą 2.

---

## Phase 2: Wpisany tekst → ciało `POST /subscriptions` (#3)

### Overview

Tabela reprezentatywnych wpisów w polskim formacie wpisywanych przez harness w prawdziwe pola;
wyrocznia z kontraktu API i kalendarza.

### Changes Required:

#### 1. Spec formularza — okablowanie parsowania

**File**: `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.spec.ts`

**Intent**: Dowód, że formularz ma podpięte parsery i adapter dat, a wynik trafia do ciała żądania;
nie powtarza tabel fazy 1.

**Contract**: nowy `describe` z `it.each`; wejścia wpisywane `MatInputHarness.setValue` (kwota) i
`MatDatepickerInputHarness.setValue` (daty); spacje twarde jako ` `. Komentarz nad tabelą: źródło
wyroczni (kontrakt: `amount` liczba, daty `YYYY-MM-DD`; kalendarz) i odesłanie do
`subscription-request.spec.ts` po resztę przypadków.

- **a) Przyjęte wejścia → ciało `POST`** (całe ciało `toEqual`):

  | Wpisane | Pole | W ciele |
  |---|---|---|
  | `12,99` | kwota | `amount: 12.99` |
  | `1 299,00` (spacja) | kwota | `amount: 1299` |
  | `1 299,00` | kwota | `amount: 1299` |
  | `05.01.2027` | następne rozliczenie | `nextBillingDate: '2027-01-05'` |
  | `29.02.2028` | następne rozliczenie | `nextBillingDate: '2028-02-29'` |
  | `05.01.2027` (trial) | koniec trialu + rozliczenie | `trialEndDate: '2027-01-05'`, `nextBillingDate: '2027-01-05'` |

  - Zachowanie: wpisany tekst = wartość w ciele żądania.
  - Regresja: zgubiony `PlDateAdapter`/`MAT_DATE_FORMATS` na komponencie (`05.01.2027` → `2027-05-01`),
    przesunięcie doby w strefie (biegnie w `Europe/Warsaw` i `America/New_York` przez `test:ci`),
    kwota wysłana jako string.
  - Źródło: research §4 (tabela i luka 1–2); §2 #3.
  - Brzeg: dzień ≠ miesiąc (`05.01`), 29 lutego roku przestępnego, spacja twarda.
  - Anty-wzorzec: wartości przepisane z implementacji.
- **b) Odrzucone wejścia → brak żądania i błąd pola**:

  | Wpisane | Pole |
  |---|---|
  | `12,999` | kwota |
  | `29.02.2027` | następne rozliczenie |
  | `31.02.2027` | następne rozliczenie |

  - Zachowanie: `expectNone` dla `POST /subscriptions`, pole `hasErrors() === true`.
  - Regresja: nieistniejąca data przechodzi jako inny dzień (np. 1–3 marca) albo trzecie miejsce po
    przecinku jest zaokrąglane.
  - Źródło: research §4; poprawka przykładu §2 #3 (2027 nie jest przestępny).
  - Brzeg: nieistniejący dzień w istniejącym miesiącu.
  - Anty-wzorzec: ponowne testowanie każdego przypadku `parseAmount`/`parseDayMonthYear` z fazy 1.

### Success Criteria:

#### Automated Verification:

- Spec formularza przechodzi: `cd frontend-subtracker && npx ng test --include src/app/subscriptions/subscription-form/subscription-form.spec.ts --watch=false`
- Cały zestaw przechodzi w obu strefach: `cd frontend-subtracker && npm run test:ci`
- Formatowanie: `cd frontend-subtracker && npx prettier --check src`

#### Manual Verification:

- Sabotaż: usunięcie `{ provide: DateAdapter, useClass: PlDateAdapter }` z providerów formularza daje czerwony test (wiersz `05.01.2027` albo błąd przy tworzeniu), potem `git checkout --`
- Sabotaż: zamiana `toDateOnly` na `toISOString().slice(0, 10)` w budowie żądania daje czerwony test w co najmniej jednej strefie `test:ci`, potem `git checkout --`

**Implementation Note**: Zatrzymaj się na potwierdzenie sabotażu przed fazą 3.

---

## Phase 3: »Should create« dla pozostałych 11 komponentów i zachowanie `register`

### Overview

Płytki pas tworzenia dla każdego komponentu (sygnał: brakujący import lub provider) i jeden test
zachowania komunikatów przy checkboxach `register`.

### Changes Required:

#### 1. »Should create«

**File**: `*.spec.ts` obok: `app.ts`, `layout/app-shell/app-shell.ts`, `layout/public-layout/public-layout.ts`,
`pages/home/home.ts`, `pages/privacy-policy/privacy-policy.ts`, `pages/register/register.ts`,
`pages/service-unavailable/service-unavailable.ts`, `pages/sign-in/sign-in.ts`,
`pages/subscriptions/subscriptions.ts`, `pages/subscriptions/subscription-table/subscription-table.ts`,
`pages/verify-link/verify-link.ts` (wszystko pod `frontend-subtracker/src/app/`)

**Intent**: Każdy komponent tworzy się i renderuje szablon z minimalnymi zależnościami takimi jak
w aplikacji.

**Contract**: test `should create` z `await fixture.whenStable()` i asercją na instancji. Providery tylko te,
których komponent potrzebuje: `provideRouter([])` (`App`, `AppShell`, `PublicLayout`, `Home`, `PrivacyPolicy`
i `ServiceUnavailable` — przez `PublicLayout`, `Register`, `SignIn`, `VerifyLink`, `Subscriptions` — przez
`AppShell`), `provideHttpClient()` + `provideHttpClientTesting()` (`AppShell`, `Register`, `SignIn`,
`VerifyLink`, `Subscriptions`). `SubscriptionTable`: `setInput('subscriptions', [])`, bez routera i HTTP.
`Subscriptions`: kolejność `whenStable` → `expectOne GET /subscriptions` → flush `[]` → `whenStable`
(formularz montuje się sam przy pustej liście) → `expectOne GET /categories` → flush; `httpTesting.verify()`
w `afterEach` tam, gdzie jest HTTP.

- Zachowanie: komponent się renderuje. Regresja: usunięty import lub provider (zakres #7 „komponent się nie
  pokazuje”). Źródło: research §6; §2 #7; hot-spot `pages/`. Brzeg: wymagany input tabeli, żądania
  w `ngOnInit`. Anty-wzorzec: »should create« bez renderowania albo traktowany jako dowód działania formularza.

#### 2. `register` — komunikaty przy checkboxach

**File**: `frontend-subtracker/src/app/pages/register/register.spec.ts`

**Intent**: Dowód, że nie-Materialowy komunikat przy wymaganych oświadczeniach pojawia się po próbie zapisu
i jest powiązany z checkboxem.

**Contract**: harnessy `MatInputHarness`, `MatCheckboxHarness`, `MatButtonHarness`; makieta HTTP.

- Zachowanie: poprawny e-mail, bez oświadczeń, zapis → brak `POST /auth/register`, dwa elementy
  `role="alert"`, a `aria-describedby` każdego checkboxa wskazuje istniejący element. Atrybut czytamy
  z wewnętrznego `mat-checkbox input[type=checkbox]` (MatCheckbox wiąże go tam, nie na hoście; harness go
  nie odczytuje); bez błędu atrybut jest pusty (`register.html` wiąże `''`). Tylko jedno zaznaczone
  → dokładnie jeden komunikat (przy drugim). Oba zaznaczone → zero komunikatów i `POST /auth/register`
  z `{ email, confirmedAdult: true, acceptedPrivacyPolicy: true }` (kontrakt `RegisterRequest`).
- Regresja: zgubiony `@if` komunikatu lub powiązanie `aria-describedby`; zapis mimo braku oświadczeń.
- Źródło: research §3 (`register.html:25-42`), Open Question 4; decyzja planu.
- Brzeg: jedno z dwóch oświadczeń zaznaczone.
- Anty-wzorzec: asercja treści „To oświadczenie jest wymagane.”.

### Success Criteria:

#### Automated Verification:

- Cały zestaw przechodzi w obu strefach: `cd frontend-subtracker && npm run test:ci`
- Każdy z 12 komponentów ma spec: `cd frontend-subtracker && npx ng test --list-tests` wypisuje 12 plików `*.spec.ts` przy plikach z `@Component`
- Formatowanie: `cd frontend-subtracker && npx prettier --check src`

#### Manual Verification:

- Sabotaż: usunięcie `RouterLink` z importów `Register` albo `@if` komunikatu przy checkboxie daje czerwony test, potem `git checkout --`

**Implementation Note**: Zatrzymaj się na potwierdzenie przed fazą 4.

---

## Phase 4: Aktualizacja planu testów

### Overview

§6.2 staje się przepisem „jak dodać test komponentu”; notatka fazy w §6.6; §4 dostaje wiersz warstwy.

### Changes Required:

#### 1. Plan testów

**File**: `context/foundation/test-plan.md`

**Intent**: Następny test komponentu (także przez `/10x-tdd`) powstaje według sprawdzonego wzorca.

**Contract**: §6.2 w układzie §6.1: **Location** (spec obok komponentu, generowany schematem), **Providers**
(globalne z `src/test-providers.ts`; w specu tylko HTTP testowy i `provideRouter([])`), **Harnesses**
(pole po etykiecie, `hasErrors()`, `setValue`, `expectNone` dla braku żądania, całe ciało `toEqual`),
**Reference tests** (`subscription-form.spec.ts`, `register.spec.ts`, jeden »should create« z HTTP —
`subscriptions.spec.ts`), **Run locally** (jeden plik `--include`, obie strefy `test:ci`), **Sabotage
check**. §6.6: 2–3 linie o fazie 2 (wynik pytania o `categoryName`, co dały sabotaże). §4: wiersz
„component (frontend)” = TestBed (zoneless) + harnessy Angular Material/CDK 22.2.6 w tym samym runnerze;
linia profilu bazy testów uzupełniona o testy komponentów. §1–§3 i §5 bez zmian (status §3 prowadzi orkiestrator;
bramka „unit frontend” w §5 już obejmuje fazę 2).

### Success Criteria:

#### Automated Verification:

- §6.2 nie zawiera już „TBD”: `grep -n -e "TBD — see §3 Phase 2" -e "none yet — see Phase 2" context/foundation/test-plan.md` nic nie zwraca
- Ścieżki referencyjne z §6.2 istnieją: `ls frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.spec.ts frontend-subtracker/src/app/pages/register/register.spec.ts frontend-subtracker/src/test-providers.ts`

#### Manual Verification:

- §6.2 czyta się jako samodzielny przepis: nowy komponent wygenerowany schematem, z testem według §6.2, przechodzi bez zaglądania do tego planu

---

## Testing Strategy

### Unit Tests:

- Bez zmian — parsery i budowa żądania pokryte w fazie 1; ten plan dodaje tylko okablowanie.

### Integration Tests:

- Test komponentu z prawdziwym serwisem i makietą na granicy HTTP (`HttpTestingController`) jest tu warstwą
  integracyjną frontu; e2e w przeglądarce to faza 4 planu testów.

### Manual Testing Steps:

1. Sabotaże z faz 1–3 (każdy czerwony, potem cofnięty).
2. `ng generate component` w working tree → wygenerowany spec przechodzi → plik usunięty.

## Performance Considerations

Harnessy wpisują znak po znaku i czekają na stabilność; tabela #3 ma 9 wierszy, więc czas zestawu rośnie
o sekundy, dwukrotnie w `test:ci`. Jeśli przebieg przekroczy kilka minut, łączyć wiersze tabeli kwot w jeden
formularz zamiast skracać pokrycie.

## Migration Notes

Brak — tylko testy i konfiguracja testów; produkcja zmienia się tylko, jeśli test 1a wykaże błąd `categoryName`.

## References

- Research: `context/changes/frontend-component-tests/research.md`
- Plan testów: `context/foundation/test-plan.md` §2 #3, #7; §3 faza 2; §6.1; §7
- Faza 1: `context/archive/2026-11-13-frontend-unit-tests/plan.md`
- Wzorzec makiety HTTP: `frontend-subtracker/src/app/auth/auth.guard.spec.ts:1-40`
- Formularz: `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts:92-277`, `subscription-form.html:39-148`
- Kontrakt API: `frontend-subtracker/src/app/subscriptions/subscription.types.ts:22-52`
- Matcher błędów: `frontend-subtracker/node_modules/@angular/material/fesm2022/_error-options-chunk.mjs:44-46`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Środowisko testów komponentów i pola warunkowe formularza (#7)

#### Automated

- [x] 1.1 Spec formularza przechodzi — 9ecc892
- [x] 1.2 Cały zestaw przechodzi w obu strefach — 9ecc892
- [x] 1.3 Build produkcyjny przechodzi — 9ecc892
- [x] 1.4 Formatowanie — 9ecc892
- [x] 1.5 Schemat komponentu tworzy spec — 9ecc892

#### Manual

- [x] 1.6 Sabotaż @if, enable() i warunku trialu daje czerwony test — 9ecc892
- [x] 1.7 Wynik testu a) zapisany w notatce fazy — 9ecc892

### Phase 2: Wpisany tekst → ciało POST /subscriptions (#3)

#### Automated

- [x] 2.1 Spec formularza przechodzi
- [x] 2.2 Cały zestaw przechodzi w obu strefach
- [x] 2.3 Formatowanie

#### Manual

- [x] 2.4 Sabotaż adaptera dat daje czerwony test
- [x] 2.5 Sabotaż toISOString daje czerwony test w co najmniej jednej strefie

### Phase 3: »Should create« dla pozostałych 11 komponentów i zachowanie register

#### Automated

- [ ] 3.1 Cały zestaw przechodzi w obu strefach
- [ ] 3.2 Każdy z 12 komponentów ma spec
- [ ] 3.3 Formatowanie

#### Manual

- [ ] 3.4 Sabotaż importu lub komunikatu register daje czerwony test

### Phase 4: Aktualizacja planu testów

#### Automated

- [ ] 4.1 §6.2 nie zawiera już TBD
- [ ] 4.2 Ścieżki referencyjne z §6.2 istnieją

#### Manual

- [ ] 4.3 §6.2 czyta się jako samodzielny przepis
