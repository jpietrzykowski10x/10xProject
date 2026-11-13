---
date: 2026-11-13T20:06:17+01:00
researcher: Claude (Opus 5.5)
git_commit: 68cfcba
branch: change/frontend-component-tests
repository: 10xProject
topic: "Ugruntowanie fazy 2 planu testów (Frontend component tests) — ryzyka #7 i #3"
tags: [research, frontend, component-tests, subscription-form, angular-material, harness, testbed]
status: complete
last_updated: 2026-11-13
last_updated_by: Claude (Opus 5.5)
---

# Research: Ugruntowanie fazy 2 planu testów (Frontend component tests) — ryzyka #7 i #3

**Date**: 2026-11-13T20:06:17+01:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: 68cfcba
**Branch**: change/frontend-component-tests
**Repository**: 10xProject

## Research Question

Faza 2 z `context/foundation/test-plan.md` §3 („Frontend component tests”, ryzyka #7 i #3). Dla każdego
ryzyka: znaleźć w kodzie rzeczywistą ścieżkę awarii, zweryfikować (a nie przyjąć) wskazówki z §2 Risk
Response Guidance, wskazać istniejące testy, najtańszą warstwę z sygnałem i ocenić dowody hot-spot.
Kontekst do ugruntowania: kiedy Material pokazuje błąd pola, jak pola warunkowe są pokazywane
i włączane, potrzebne providery testowe (locale, animacje, breakpointy w jsdom, HttpClient testowy),
harnessy Material, ustawienie `skipTests` schematu komponentu i lista komponentów do »should create«.

## Summary

- **Formularz subskrypcji to jedyne miejsce, gdzie oba ryzyka się spotykają**, i nie leży on
  w `pages/`, tylko w `src/app/subscriptions/subscription-form/` (`subscription-form.ts:70-101`).
  Używa go strona `/subscriptions` (`pages/subscriptions/subscriptions.html:93`).
- **#7 — pola warunkowe** są sterowane dwoma niezależnymi mechanizmami, które muszą się zgadzać:
  `@if` w szablonie (widoczność) i `enable()`/`disable()` kontrolki (walidacja i wysyłka). Pole końca
  trialu: `@if (isTrial())` (`subscription-form.html:117`) + `trialEndDate.enable()/disable()`
  (`subscription-form.ts:163-169`). Pole własnej kategorii: `@if (addingOwnCategory())`
  (`subscription-form.html:39`), a jego kontrolka `categoryName` jest **poza grupą** `form`
  (`subscription-form.ts:135`). Testy walidatorów (faza 1) nie widzą żadnego z tych powiązań.
- **#7 — komunikat przy polu**: domyślny `ErrorStateMatcher` Material 22.2.6 pokazuje `mat-error`, gdy
  `control.invalid && (control.touched || form.submitted)`
  (`node_modules/@angular/material/fesm2022/_error-options-chunk.mjs:45-46`). `submit()` dodatkowo woła
  `markAllAsTouched()` (`subscription-form.ts:246`). Harness `MatFormFieldHarness.hasErrors()` liczy
  wyrenderowane błędy bez sprawdzania treści (`form-field-testing.mjs:56-57`) — pasuje do zakazu
  asercji tekstu z §7.
- **#3 — wskazówka się potwierdza, z korektą przykładu**: testy fazy 1 sprawdzają `parseAmount`,
  `PlDateAdapter` i `toCreateSubscriptionRequest` osobno, na obiekcie wartości formularza
  (`subscription-request.spec.ts:7-26`). Nie sprawdzają, że formularz ma te klocki podpięte: adapter
  dat jest dostarczany **na poziomie komponentu** (`subscription-form.ts:92-98`). Bez niego Material
  użyłby `NativeDateAdapter` (`Date.parse`), który w Node czyta `05.01.2027` jako **1 maja 2027**
  (sprawdzone w tej sesji: `new Date(Date.parse('05.01.2027'))` → `Sat May 01 2027`). Tę klasę awarii
  łapie tylko test, który wpisuje tekst w pole i patrzy na ciało `POST /subscriptions` na granicy HTTP.
- **Korekta przykładu z §2 #3**: `29.02.2027` **nie istnieje** (2027 nie jest przestępny), więc razem
  z `31.02.2027` należy do wejść odrzucanych. Poprawny dzień przestępny do tabeli przyjętych to
  `29.02.2028` → `2028-02-29`.
- **Najtańsza warstwa** dla obu ryzyk: test komponentu `SubscriptionForm` w TestBed (zoneless) +
  jsdom + harnessy Material, z prawdziwym `SubscriptionsService` i makietą wyłącznie na granicy HTTP
  (`provideHttpClientTesting()` + `HttpTestingController`, jak `auth/auth.guard.spec.ts`).
  »Should create« dla 12 komponentów (lista niżej) to osobna, płytka warstwa.
- **Dowody hot-spot są częściowo mylące**: 67 zmian w `pages/` to głównie strona `/subscriptions`,
  `sign-in` i `register` (git log 30 dni, niżej), a sam formularz (poza `pages/`) miał 3 zmiany. Hot-spot
  `pages/` uzasadnia »should create« i stronę `/subscriptions`, ale nie jest dowodem dla formularza.

## Detailed Findings

### 1. Ryzyko #7 — pole końca trialu (warunkowe)

- Kontrolka startuje jako wyłączona: `this.fb.control<Date | null>({ value: null, disabled: true }, Validators.required)` (`subscription-form.ts:115-118`).
- Widoczność: `isTrial = computed(() => this.statusValue() === 'trial')`, gdzie `statusValue` to
  `toSignal(this.status.valueChanges, …)` (`subscription-form.ts:143-146`); szablon `@if (isTrial())`
  (`subscription-form.html:117-131`).
- Włączanie: osobna subskrypcja `status.valueChanges` → `enable()` / `disable()`
  (`subscription-form.ts:163-169`).
- Wpływ na sąsiednie pole: `nextBillingDate` ma `notBeforeDate(() => status === 'trial' ? trialEndDate : null)`
  (`subscription-form.ts:130-133`), przeliczane przy zmianie statusu lub końca trialu
  (`subscription-form.ts:171-173`); błąd `notBeforeDate` wybiera inny `mat-error`
  (`subscription-form.html:144-148`).
- **Ścieżka awarii** (wnioskowanie): jeśli widoczność i `enable/disable` się rozjadą, dostajemy pole
  ukryte, ale wymagane (formularz nie da się zapisać i nie widać dlaczego — dokładnie scenariusz #7)
  albo pole widoczne, ale wyłączone. Test powinien sprawdzać oba: obecność pola (harness) **i** to, że
  po wypełnieniu reszty zapis przechodzi / nie przechodzi.
- **Uwaga na `getRawValue()`**: `request()` buduje ciało z `form.getRawValue()`
  (`subscription-form.ts:272`), które zawiera też wyłączone kontrolki. Koniec trialu nie trafia do API
  dla innego statusu tylko dzięki warunkowi w `toCreateSubscriptionRequest`
  (`subscription-request.ts:45-47`). Scenariusz wart testu komponentu: wpisz koniec trialu, zmień status
  na „aktywna”, zapisz → ciało POST bez `trialEndDate` (kontrakt API: `subscription.types.ts:37-38`).

### 2. Ryzyko #7 — pole własnej kategorii (warunkowe)

- Opcja „Dodaj własną…” ma wartość `'new'` (`subscription-form.ts:59`, `subscription-form.html:28`);
  `addingOwnCategory = computed(() => categoryValue() === NEW_CATEGORY)` (`subscription-form.ts:147-150`);
  szablon `@if (addingOwnCategory())` (`subscription-form.html:39-71`).
- Wybrana „Dodaj własną…” trzyma `categoryId` w stanie błędu przez walidator `notNewCategory`
  (`subscription-form.ts:62-63,122`), więc zapis jest blokowany.
- Kontrolka `categoryName` jest **samodzielna** (`[formControl]`, `subscription-form.html:45`), nie
  należy do `form`, więc `markAllAsTouched()` jej nie dotyka. Czy jej `mat-error` pokaże się po próbie
  zapisu, zależy od tego, czy `MatInput` widzi rodzica `FormGroupDirective` (`form.submitted`). Z kodu
  Material wynika, że tak (matcher dostaje rodzica formularza), ale **nie zweryfikowano tego
  uruchomieniem** — to pierwsza asercja do sprawdzenia w planie (patrz Open Questions).
- Przycisk „Dodaj” → `POST /categories`, potem ponowny `GET /categories`, ustawienie nowego id i zniknięcie
  pola (`subscription-form.ts:197-239`); 409 → błąd `conflict` i inny `mat-error`
  (`subscription-form.html:50-54`). Inne błędy → komunikat `role="alert"` (`subscription-form.html:66-70`).
- Komunikat o nieudanym wczytaniu kategorii: `@if (categoriesFailed())` (`subscription-form.html:32-37`).

### 3. Ryzyko #7 — kiedy Material pokazuje komunikat

- Domyślny matcher: `control.invalid && (control.touched || form && form.submitted)`
  (`node_modules/@angular/material/fesm2022/_error-options-chunk.mjs:44-46`; wersja 22.2.6). Formularz nie
  podmienia matchera (brak `ErrorStateMatcher` w providerach, `subscription-form.ts:92-98`).
- `submit()` woła `markAllAsTouched()` i przy błędzie przenosi fokus na pierwsze `[formcontrolname].ng-invalid`
  (`subscription-form.ts:242-251,275-277`); żądanie nie wychodzi (`request()` zwraca `null`, `:268-273`).
- Pola daty: wpisany nieczytelny tekst daje wartość kontrolki `null` i błąd `matDatepickerParse`
  (`datepicker.mjs:3230-3236,3337-3348`); `PlDateAdapter` zwraca `invalid()` zamiast `null` właśnie po to,
  żeby błąd w ogóle powstał (`shared/pl-date-adapter.ts:5-19`).
- Strony `register` i `sign-in` też używają `mat-error` w formularzu (`register.html:12-16`); `register`
  ma własne komunikaty checkboxów zależne od sygnału `submitted` (`register.html:25-42`). Są to kandydaci
  na drugi poziom #7, ale wywiad wskazał najpierw formularz subskrypcji (§2 #7 Source: Q4).
- **Werdykt dla „testy walidatorów dowodzą, że komunikat się wyświetla”**: nieprawda dla tego kodu.
  Walidatory (`subscription-validators.spec.ts:44-50`) zwracają tylko obiekt błędu; to, czy komunikat
  się pojawi, zależy od szablonu (`mat-error` w polu, gałęzie `@if`), matchera i od tego, czy pole
  w ogóle jest w DOM (`@if`).
- **Werdykt dla „»should create« dowodzi, że formularz działa”**: nieprawda. »Should create« przechodzi
  przy domyślnym stanie (`status: 'active'`, pole trialu nieobecne), więc nie dotyka żadnej gałęzi
  `@if`, żadnego błędu ani zapisu. Daje natomiast realny sygnał na brakujący provider lub import
  (np. usunięty `DateAdapter` z `subscription-form.ts:94` kończy się błędem przy tworzeniu
  `MatDatepickerInput` — wnioskowanie z działania DI Material, nie uruchomione).

### 4. Ryzyko #3 — droga od wpisanego tekstu do ciała żądania

- Kwota: kontrolka `amount` to string (`subscription-form.ts:123`), walidator `amountValidator`
  (`subscription-validators.ts:12-14`) i ponowne parsowanie w `toCreateSubscriptionRequest`
  (`subscription-request.ts:27`). Separatory grup: spacja, U+00A0, U+202F
  (`shared/decimal.ts:3`, sprawdzone bajtowo w tej sesji).
- Daty: tekst → `PlDateAdapter.parse` → `parseDayMonthYear` (`shared/date-only.ts:43-53`) → `Date`
  lokalna o północy → `toDateOnly` (`shared/date-only.ts:33-37`) → `YYYY-MM-DD` w ciele.
- Granica HTTP: `SubscriptionsService.create` → `POST ${environment.apiUrl}/subscriptions`
  (`subscriptions/subscriptions.service.ts:23-25`); przy starcie formularz robi
  `GET ${environment.apiUrl}/categories` (`subscriptions.service.ts:28-30`, `subscription-form.ts:176-189`)
  — test musi go obsłużyć w `HttpTestingController`, inaczej `verify()` odpadnie.
- **Co już pokrywa faza 1** (`subscription-request.spec.ts:28-60`): tabela wartość formularza → ciało, w tym
  `1 299,00`, `1 299,00`, `12,99`, koniec lutego, trial. Wejście to jednak gotowy obiekt z `Date`,
  a nie tekst wpisany w pole.
- **Czego faza 1 nie widzi** (luka dla testu komponentu):
  1. czy pole daty ma podpięty `PlDateAdapter` i `PL_DATE_FORMATS` (`subscription-form.ts:92-98`);
     bez nich `05.01.2027` → 1 maja 2027 (V8 `Date.parse`, sprawdzone w tej sesji);
  2. czy `request()` jest wywoływane z `getRawValue()` i czy wynik idzie do `create()`
     (`subscription-form.ts:247-256`);
  3. czy wpisane złe wejście blokuje wysyłkę **i** pokazuje komunikat (połączenie z #7).
- **Werdykt dla „unit testy parserów (faza 1) dowodzą, że formularz wysyła dobrą wartość”**: częściowo.
  Dowodzą poprawności klocków; nie dowodzą okablowania (providery na komponencie, kolejność
  walidacja → budowa żądania → POST).
- **Wyrocznia**: oczekiwane wartości z kontraktu API (`subscription.types.ts:22-48`: `amount` jako
  liczba, daty `YYYY-MM-DD`, `trialEndDate` tylko dla trialu) i z kalendarza, nie z kodu. Proponowana
  tabela (wartości policzone z kalendarza i definicji liczby, nie z implementacji):

  | Wpisane | Pole | Oczekiwane w ciele POST |
  |---|---|---|
  | `12,99` | kwota | `amount: 12.99` |
  | `1 299,00` (spacja) | kwota | `amount: 1299` |
  | `1 299,00` | kwota | `amount: 1299` |
  | `12,999` | kwota | brak POST, komunikat widoczny |
  | `05.01.2027` | następne rozliczenie | `nextBillingDate: '2027-01-05'` |
  | `29.02.2028` | następne rozliczenie | `'2028-02-29'` |
  | `29.02.2027` | następne rozliczenie | brak POST, komunikat widoczny (2027 nie jest przestępny) |
  | `31.02.2027` | następne rozliczenie | brak POST, komunikat widoczny |

- **Strefy czasowe**: `npm run test:ci` uruchamia cały zestaw w `Europe/Warsaw` i `America/New_York`
  (`frontend-subtracker/scripts/test-time-zones.mjs`), więc testy komponentu automatycznie biegną
  w obu strefach — wymóg z §2 #3 jest spełniony bez dodatkowej pracy.

### 5. Providery i środowisko testu komponentu

- **Runner**: `@angular/build:unit-test` z samym `tsConfig` (`angular.json`, cel `test`), bez
  `setupFiles`/`providersFile`. Aplikacja jest zoneless (archiwum fazy 1: `plan.md:30`) — w testach
  `await fixture.whenStable()` zamiast `fakeAsync`/`tick`; harnessy
  (`TestbedHarnessEnvironment`) same czekają na stabilność.
- **Animacje**: pakiet `@angular/animations` nie jest zainstalowany (`node_modules/@angular/` go nie
  ma). Material 22 sprawdza `MATERIAL_ANIMATIONS` albo `prefers-reduced-motion`
  (`_animation-chunk.mjs:6-19`); w jsdom bez `matchMedia` dostaje `'enabled'`. Rekomendacja: provider
  `{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }` w testach z `mat-select`
  i datepickerem (panel overlay) — **do potwierdzenia pierwszym testem**, czy bez niego coś czeka na
  `animationend`.
- **Breakpointy**: `MediaMatcher` w jsdom (brak `window.matchMedia`) używa `noopMatchMedia`
  (`cdk/fesm2022/_breakpoints-observer-chunk.mjs:17`), więc `BreakpointObserver` nie rzuca, a
  `isMatched(PHONE_MEDIA_QUERY)` i `isMatched(WIDE_MEDIA_QUERY)` dają `false` (układ „średni”
  desktop). Dotyczy `Subscriptions` (`subscriptions.ts:69-79`) i `SubscriptionTable`
  (`subscription-table.ts:41-46`). Wariant telefonu wymaga podmiany `BreakpointObserver`/`MediaMatcher`
  w teście — poza minimum fazy 2.
- **Locale**: `LOCALE_ID` `pl-PL` i `registerLocaleData(localePl)` są w `app.config.ts:13,18`, nie
  w komponentach. Formularz sam dostarcza `MAT_DATE_LOCALE` (`subscription-form.ts:95`). `SubscriptionTable`
  używa `CurrencyPipe` i `DateOnlyPipe` (`subscription-table.html:66,78`), które biorą `LOCALE_ID` —
  w TestBed domyślnie `en-US`; dla zgodności z produkcją test tabeli/strony powinien dać `LOCALE_ID`
  `pl-PL` i zarejestrować `localePl`.
- **HTTP**: `provideHttpClient()` + `provideHttpClientTesting()`; URL-e budować z `environment.apiUrl`
  (jak `auth.guard.spec.ts:34`). Interceptory z `app.config.ts:24-27` nie są potrzebne w teście
  komponentu (mają własne testy w `auth/`).
- **Router**: `Register`, `SignIn`, `VerifyLink`, `Home`, `PublicLayout`, `AppShell` używają
  `RouterLink`/`Router`/`ActivatedRoute` → `provideRouter([])`. `VerifyLink` czyta
  `ActivatedRoute.snapshot.fragment` w polu klasy (`verify-link.ts:18-20`).
- **Harnessy dostępne w 22.2.6** (`node_modules/@angular/material/fesm2022/*-testing.mjs`):
  `MatFormFieldHarness` (`hasErrors`, `getControl`, `isDisabled`), `MatInputHarness.setValue`
  (czyści, wpisuje znak po znaku, `setInputValue`; `_input-harness-chunk.mjs:56-63`),
  `MatSelectHarness` (`open`, `clickOptions`), `MatDatepickerInputHarness.setValue`
  (wpisuje i wysyła `change`; `_date-range-input-harness-chunk.mjs:23-30`), `MatButtonHarness`,
  `MatButtonToggleGroupHarness`, `MatCheckboxHarness`.

### 6. »Should create« — lista komponentów i `skipTests`

- `angular.json` ma `"@schematics/angular:component": { "style": "scss", "skipTests": true }` oraz
  `skipTests: true` dla class, directive, guard, interceptor, pipe, resolver i service (sekcja
  `projects.frontend-subtracker.schematics`). Faza 2 §3 każe zmienić to tylko dla schematu komponentu.
- Komponenty (`@Component` w `frontend-subtracker/src`, 12 wystąpień w 12 plikach, sprawdzone grep):
  `App` (`app.ts`), `AppShell`, `PublicLayout`, `Home`, `PrivacyPolicy`, `Register`,
  `ServiceUnavailable`, `SignIn`, `Subscriptions`, `SubscriptionTable`, `VerifyLink`,
  `SubscriptionForm`. Żaden nie ma dziś pliku `*.spec.ts`.
- Zależności przy tworzeniu (wnioskowane z konstruktorów/`inject`): HTTP (`AuthService`,
  `SubscriptionsService`) — `Register`, `SignIn`, `VerifyLink`, `AppShell`, `Subscriptions`,
  `SubscriptionForm`; `BreakpointObserver` — `Subscriptions`, `SubscriptionTable`; wymagany input
  `subscriptions` — `SubscriptionTable` (`subscription-table.ts:36`). `Subscriptions` i
  `SubscriptionForm` robią żądania w `ngOnInit` (`subscriptions.ts:104-106`,
  `subscription-form.ts:176-178`).

### 7. Ocena dowodów hot-spot

`git log --since=2026-10-14 --name-only` dla `pages/` i `subscriptions/` (licznik zmian plików):
`pages/subscriptions/subscriptions.{ts,html}` po 7, `pages/sign-in/sign-in.ts` 6,
`pages/register/register.ts` 5, `subscription-form.ts` 3 (w `subscriptions/`, poza `pages/`).
Wniosek: hot-spot `pages/` wspiera »should create« dla stron i ewentualny test strony `/subscriptions`,
a formularz subskrypcji jest uzasadniony wywiadem (Q1, Q4) i archiwum, nie liczbą zmian. Hot-spot
`shared/` (12) wspiera #3 — tam są parser kwoty, adapter dat i `toDateOnly`.

## Code References

- `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts:92-98` — providery dat na komponencie (`PlDateAdapter`, `pl-PL`, formaty)
- `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts:114-135` — kontrolki, w tym wyłączony `trialEndDate` i samodzielny `categoryName`
- `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts:143-174` — sygnały widoczności i `enable/disable`
- `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts:242-277` — `submit`, `request`, fokus pierwszego błędu
- `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.html:39-71,117-131,144-148` — pola warunkowe i gałęzie `mat-error`
- `frontend-subtracker/src/app/subscriptions/subscription-request.ts:24-49` — budowa ciała żądania
- `frontend-subtracker/src/app/shared/decimal.ts:3-14` — separatory i regex kwoty
- `frontend-subtracker/src/app/shared/date-only.ts:33-53` — `toDateOnly`, `parseDayMonthYear`
- `frontend-subtracker/src/app/shared/pl-date-adapter.ts:9-20` — `invalid()` zamiast `null`
- `frontend-subtracker/src/app/subscriptions/subscriptions.service.ts:19-34` — granica HTTP
- `frontend-subtracker/src/app/subscriptions/subscription.types.ts:22-48` — kontrakt API (wyrocznia)
- `frontend-subtracker/src/app/auth/auth.guard.spec.ts:1-40` — wzorzec TestBed + `HttpTestingController`
- `frontend-subtracker/src/app/subscriptions/subscription-request.spec.ts:1-60` — pokrycie fazy 1 na obiekcie wartości
- `frontend-subtracker/node_modules/@angular/material/fesm2022/_error-options-chunk.mjs:44-46` — domyślny `ErrorStateMatcher`
- `frontend-subtracker/node_modules/@angular/cdk/fesm2022/_breakpoints-observer-chunk.mjs:17` — `noopMatchMedia` w jsdom
- `frontend-subtracker/node_modules/@angular/material/fesm2022/_animation-chunk.mjs:6-19` — `MATERIAL_ANIMATIONS`
- `frontend-subtracker/angular.json` (`schematics`) — `skipTests: true` dla komponentu

## Architecture Insights

- Logika formularza jest już rozbita na czyste funkcje (parsowanie, budowa żądania, walidatory) —
  test komponentu nie powinien ich powtarzać tabelą wszystkich wariantów, tylko pokazać kilka
  reprezentatywnych wejść przez prawdziwe pole (okablowanie) i wszystkie stany warunkowe.
- Formularz dostarcza własne providery (pola Material, daty), żeby nie ciągnąć ich do bundla
  początkowego (`subscription-form.ts:88-91`, `shared/form-field-defaults.ts:7-9`). To sprawia, że
  test komponentu jest jedynym miejscem, które pilnuje tych providerów.
- Komponent zapisuje sam (`saved` emitowane po odpowiedzi API, `subscription-form.ts:258-261`), więc
  granica HTTP jest naturalnym miejscem makiety — nie trzeba mockować serwisu ani wnętrza formularza.

## Historical Context (from prior changes)

- `context/archive/2026-11-13-frontend-unit-tests/plan.md:63` — faza 1 świadomie wyłączyła testy
  komponentów (supported: dalej brak `*.spec.ts` przy komponentach).
- `context/archive/2026-11-13-frontend-unit-tests/plan.md:67` i `plan-brief.md:37` — „`skipTests` bez zmian,
  wygenerowane specy nie dają sygnału”. Current verdict: partial — trafne jako argument przeciw samemu
  »should create«, ale §3 fazy 2 zmienia decyzję, a ta research pokazuje sygnał (brakujący provider).
- `context/archive/2026-11-13-frontend-unit-tests/plan.md:273-274` — wydzielenie
  `toCreateSubscriptionRequest`, „żeby wartość wysłana do API dała się sprawdzić bez testu komponentu”.
  Current verdict: partial — sprawdza budowę ciała, nie okablowanie pola z adapterem (sekcja 4).
- `context/archive/2026-11-11-first-subscription-in-list/plan.md:341` — błąd regexu kwoty wyszedł
  dopiero w teście ręcznym (supported; naprawiony i pokryty w fazie 1, `decimal.ts:9-12`).
- `context/foundation/test-plan.md` §6.6 — `parseDecimal(x, 0)` rzucał `SyntaxError`; zestaw biegnie
  w dwóch strefach.

## Related Research

- `context/archive/2026-11-13-frontend-unit-tests/research.md` (faza 1 planu testów)
- `context/archive/2026-11-11-first-subscription-in-list/research.md`

## Open Questions

1. **Błąd pola własnej kategorii po próbie zapisu** — czy `mat-error` samodzielnej kontrolki
   `categoryName` pojawia się po `ngSubmit` rodzica (`form.submitted`)? Z kodu Material wynika, że tak;
   plan powinien zacząć od testu, który to rozstrzygnie. Jeśli nie — to realny błąd #7, nie problem testu.
2. **Animacje w jsdom** — czy `mat-select` otwierany harnessem działa bez `MATERIAL_ANIMATIONS`
   `animationsDisabled`; rekomendacja: dodać provider od razu.
3. **Gdzie trzymać wspólne providery testowe** (locale, animacje, HTTP testowy) — lokalnie w każdym
   specu czy przez `providersFile` buildera `unit-test`; decyzja dla `/10x-plan`.
4. **Zakres #7 poza formularzem subskrypcji** — `register` ma własne komunikaty checkboxów zależne od
   `submitted` (`register.html:25-42`); czy faza 2 obejmuje je testem zachowania, czy tylko
   »should create«? Wywiad (§2 #7, Q4) stawia formularz subskrypcji na pierwszym miejscu.
5. **Wariant telefonu** (`stickyActions`, ukrywanie listy) — wymaga podmiany `BreakpointObserver`; poza
   minimum, chyba że plan uzna inaczej. To wygląd/układ, częściowo objęty §7.
