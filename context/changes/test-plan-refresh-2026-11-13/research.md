---
date: 2026-11-13T16:10:00+01:00
researcher: Claude (Opus 5.5) — /10x-research
git_commit: bf7c89f
branch: change/frontend-unit-tests
repository: 10xProject
topic: "Ugruntowanie refreshu planu testów: testy komponentów frontendu (ryzyko #7, nowa faza 2)"
tags: [research, test-plan, frontend-subtracker, component-tests, angular-material, harness, jsdom]
status: complete
last_updated: 2026-11-13
last_updated_by: Claude (Opus 5.5) — /10x-research
---

# Research: Ugruntowanie refreshu planu testów — testy komponentów frontendu

**Date**: 2026-11-13T16:10:00+01:00
**Researcher**: Claude (Opus 5.5) — /10x-research
**Git Commit**: bf7c89f (w working tree niezacommitowane SHA fazy 1 w `context/changes/frontend-unit-tests/plan.md`)
**Branch**: change/frontend-unit-tests
**Repository**: 10xProject

## Research Question

Brief refreshu (`change.md`) zakłada nowe ryzyko #7 („komponent się nie renderuje albo element warunkowy /
komunikat walidacji nie pojawia się, kiedy powinien”) i nową fazę 2 „Frontend component tests”. Do
ugruntowania: (1) kiedy Material pokazuje błędy w formularzu subskrypcji i jak działa zapis z błędami,
(2) jak pola warunkowe są pokazywane i włączane, (3) czy harnessy Angular Material działają w tym
stosie (zoneless, jsdom, builder `@angular/build:unit-test`), (4) czego wymaga utworzenie każdego z 12
komponentów („should create”), (5) wcześniejsze decyzje i miejsca w `test-plan.md` do zmiany.

## Summary

- **Komunikaty walidacji**: aplikacja nie ma własnego `ErrorStateMatcher` (grep po `src/` pusty), więc w
  formularzu subskrypcji działa domyślna reguła Materiala — błąd widać, gdy kontrolka jest niepoprawna i
  dotknięta albo formularz wysłany (komentarz `subscription-form.html:1-2`). `submit()` woła
  `form.markAllAsTouched()`, a przy błędnych danych tylko `focusFirstInvalid()` i wraca, bez zmiany
  stanu (`subscription-form.ts:242-251`). Obserwowalna wyrocznia „po próbie zapisu przy błędnym polu
  widać komunikat” jest więc dobrze zdefiniowana.
- **Pola warunkowe**: pole końca trialu jest renderowane przez `@if (isTrial())`
  (`subscription-form.html:117-131`) i osobno włączane/wyłączane subskrypcją `status.valueChanges`
  (`subscription-form.ts:163-169`) — dwa mechanizmy, które mogą się rozjechać. Pole nowej kategorii
  pojawia się przez `@if (addingOwnCategory())` po wybraniu opcji `'new'` (`subscription-form.html:39-71`,
  `subscription-form.ts:147-150`).
- **Narzędzia**: harnessy Materiala dla form-field (z `hasErrors()`/`getTextErrors()`), input, select,
  datepicker, button-toggle i button są w zainstalowanym Material 22.2.6; `TestbedHarnessEnvironment`
  w sprawdzonym pliku `testing-testbed.mjs` nie wymaga zone.js (użycia `Zone` w l. 27-31, 596-597,
  620-622 i 665-670 są strzeżone `typeof Zone` albo `?.`). jsdom 31 nie ma
  `window.matchMedia`, ale CDK spada wtedy do `noopMatchMedia` (wszystkie breakpointy „nie pasują”).
  Bez wyłączenia animacji Materiala zamknięcie panelu `mat-select` czeka na `animationend`, którego jsdom
  nie emituje (fallback 200 ms) — testy powinny podać `MATERIAL_ANIMATIONS` z `animationsDisabled: true`.
  Działanie harnessów w praktyce nie zostało uruchomione w tym researchu (zob. Open Questions).
- **„Should create”**: 5 z 12 komponentów to statyczny markup; 7 ma stany warunkowe. Wymagania przy
  tworzeniu różnią się: `SubscriptionTable` ma `input.required`, `VerifyLink` czyta fragment z
  `ActivatedRoute`, `Subscriptions` i `SubscriptionForm` wołają API w `ngOnInit`, a `Subscriptions` i
  `SubscriptionTable` potrzebują `LOCALE_ID` `pl-PL` z `registerLocaleData`, bo inaczej kwoty i daty
  wyjdą w formacie en-US.
- **Plan testów**: refresh dotyka §2, §3, §4, §5, §6, §7 i §8 `test-plan.md`; przenumerowanie faz 2–4
  na 3–5 zmienia 9 odwołań w samym planie testów i 3 w folderze `frontend-unit-tests`.

## Detailed Findings

### 1. Kiedy w formularzu subskrypcji widać komunikaty walidacji

- Brak własnego matchera: `FORM_FIELD_DEFAULTS` ustawia tylko `appearance: 'outline'`
  (`shared/form-field-defaults.ts:10-13`), podpięte w komponencie (`subscription-form.ts:93`).
- Komunikaty na pole (każdy w `<mat-error>`):
  - nazwa — `trimmedRequired` (`subscription-form.ts:121`), „Podaj nazwę.” (`subscription-form.html:19`);
  - kategoria — `required` + `notNewCategory` (`{required}` także przy wybranym „Dodaj własną…”,
    `subscription-form.ts:62-63,122`), `subscription-form.html:30`;
  - kwota — `amountValidator` (`subscription-form.ts:123`), `subscription-form.html:82`;
  - forma płatności — `required`, wartość startowa `''` (`subscription-form.ts:125`), `subscription-form.html:105`;
  - koniec trialu — `required` + błąd `matDatepickerParse` z datepickera (adapter zwraca nieprawidłową
    datę zamiast `null`, `shared/pl-date-adapter.ts:15-18`), jeden komunikat (`subscription-form.html:129`);
  - następne rozliczenie — `required` + `notBeforeDate` (tylko dla `trial`, `subscription-form.ts:130-133`);
    `@if hasError('notBeforeDate')` ma osobny komunikat, `@else` ogólny (`subscription-form.html:144-148`);
    walidator jest przeliczany przy każdej zmianie statusu i końca trialu (`subscription-form.ts:171-173`);
  - nazwa nowej kategorii — osobna kontrolka spoza `form` (`subscription-form.ts:135`), związana przez
    `[formControl]` (`subscription-form.html:45`); `conflict` (409) albo pusta nazwa
    (`subscription-form.html:50-54`).
- Sekwencja `submit()` (`subscription-form.ts:242-265`): przy stanie `sending` wraca; `markAllAsTouched()`;
  `request()` zwraca `null` przy `form.invalid` (i przy kontrolach obronnych, l. 269-283); wtedy
  `focusFirstInvalid()` (`querySelector('[formcontrolname].ng-invalid')`, l. 298-300) i powrót. Przy
  poprawnych danych: `sending` → `POST /subscriptions` → `idle` + `saved.emit` albo `invalid` (400) /
  `unavailable` (inne błędy) (l. 253-263).
- Wniosek (niezweryfikowany): `focusFirstInvalid` pomija pole nowej kategorii (brak `formcontrolname`) i
  wyłączone pole końca trialu. Wniosek (niezweryfikowany): błąd nazwy nowej kategorii pokazuje się po
  jej opuszczeniu albo po `addCategory()` (`markAsTouched`, l. 198); czy wysłanie całego formularza też
  go pokazuje, zależy od tego, czy domyślny matcher widzi nadrzędny `FormGroupDirective`.

### 2. Elementy warunkowe formularza

- **Koniec trialu**: widoczność — `isTrial = computed(statusValue() === 'trial')` na `toSignal(status.valueChanges)`
  (`subscription-form.ts:143-146`) i `@if (isTrial())` (`subscription-form.html:117-131`); włączanie —
  osobna subskrypcja w konstruktorze (`subscription-form.ts:163-169`). Wyłączona kontrolka nie jest
  walidowana ani wysyłana (komentarz l. 127).
- **Własna kategoria**: opcja `mat-option [value]="newCategory"` (`'new'`, `subscription-form.html:28`);
  `addingOwnCategory = computed(categoryValue() === 'new')` (`subscription-form.ts:147-150`); blok
  `.form__new-category` z polem i przyciskiem „Dodaj” (`type="button"`, `[disabled]="addingCategory()"`)
  (`subscription-form.html:39-65`); Enter w polu woła `addCategory()` bez wysłania formularza
  (`subscription-form.ts:192-195`). Po sukcesie: `GET /categories` ponownie, wybór nowej kategorii tylko
  gdy wciąż wybrane `'new'`, fokus na select (`subscription-form.ts:209-229`) — blok znika. Błąd inny niż
  409 → `categoryFailed` i komunikat `role="alert"` w bloku (`subscription-form.html:66-70`). Brak przycisku
  „Anuluj”; wybór innej kategorii ukrywa blok.
- **Wczytywanie kategorii**: `ngOnInit` → `GET /categories`; błąd → `categoriesFailed` i komunikat z
  przyciskiem „Spróbuj ponownie” (`subscription-form.ts:176-189`, `subscription-form.html:32-37`).
- **Stan zapisu**: `sending` blokuje przycisk (`subscription-form.html:163`); `invalid` i `unavailable`
  pokazują komunikaty `role="alert"` (`subscription-form.html:151-160`).

### 3. Narzędzia testów komponentów w tym stosie

- Wersje: `@angular/material` i `@angular/cdk` 22.2.6, vitest 4.1.12, jsdom 31.0.1; zone.js nie jest
  zainstalowany, builder ładuje go tylko gdy jest obecny
  (`node_modules/@angular/build/src/builders/unit-test/runners/vitest/build-options.js:41-48`).
- Harnessy (eksporty pakietów): `@angular/material/form-field/testing` (`MatFormFieldHarness` z
  `hasErrors()` i `getTextErrors()`, `MatErrorHarness`), `/input/testing`, `/select/testing`,
  `/datepicker/testing`, `/button-toggle/testing`, `/button/testing`; `@angular/cdk/testing/testbed`
  (`TestbedHarnessEnvironment`, `@angular/cdk/fesm2022/testing-testbed.mjs:690`).
- Zoneless: w `testing-testbed.mjs` użycia `Zone` są strzeżone (`:27-31`, `:596-597`, `:620-622`,
  `:665-670`); stabilizacja to `fixture.detectChanges()` + `fixture.whenStable()` (`:599-605`). `fakeAsync`
  jest niedostępny bez zone.js — czas sterują fake timery Vitest albo realne oczekiwanie.
- `window.matchMedia`: brak w `jsdom/lib/jsdom/browser/Window.js` (grep pusty); CDK używa wtedy
  `noopMatchMedia`, które zwraca `matches: false` dla każdego zapytania poza `'all'`/`''`
  (`@angular/cdk/fesm2022/_breakpoints-observer-chunk.mjs:17,71-78`). Skutek: układ telefonu i logika
  „automatycznie otwórz panel na desktopie” są w jsdom zawsze w gałęzi „nie pasuje”, chyba że test
  podmieni `BreakpointObserver` albo `window.matchMedia`.
- Animacje: Material 22 nie importuje `@angular/animations` (pakiet nie jest zainstalowany ani w
  peerDependencies); stan animacji to `di-disabled` przy `MATERIAL_ANIMATIONS.animationsDisabled`,
  w przeciwnym razie zależy od `(prefers-reduced-motion)`, które w jsdom daje `false` → `enabled`
  (`@angular/material/fesm2022/_animation-chunk.mjs:6-16`). Przy `enabled` zamknięcie `mat-select`
  czeka na `animationend` z fallbackiem 200 ms (`@angular/material/fesm2022/select.mjs:394-418`).
- Overlay: `showPopover` (brak w jsdom) jest w `try/catch` (`@angular/cdk/fesm2022/_overlay-module-chunk.mjs:965-969`);
  pozycjonowanie dostaje zera z `getBoundingClientRect` (wniosek: bez wpływu na logikę testów).

### 4. Utworzenie każdego komponentu („should create”)

Ścieżki względem `frontend-subtracker/src/app/`. Providery testowe to wniosek z kodu, nieuruchomione.

| Komponent | Co jest potrzebne przy tworzeniu | Stany warunkowe |
|---|---|---|
| `App` (`app.ts:4-9`) | `<router-outlet>` → `provideRouter([])` | brak |
| `PublicLayout` (`layout/public-layout/public-layout.ts:6-13`) | `routerLink` → `provideRouter([])` | brak |
| `Home` (`pages/home/home.ts:24-30`) | `provideRouter([])`; daty liczone od `new Date()` przy tworzeniu (`:10-16,25-29`) | brak (tylko daty) |
| `PrivacyPolicy`, `ServiceUnavailable` | `provideRouter([])` (przez `PublicLayout`) | brak |
| `AppShell` (`layout/app-shell/app-shell.ts:12-31`) | `AuthService` (HTTP), `Router`; `MatMenu` | `loggingOut`, `logoutFailed` |
| `Register` (`pages/register/register.ts:32-56`) | `AuthService` (HTTP), `provideRouter([])` | `idle/sending/sent/invalid/unavailable`, błędy zgód po wysłaniu |
| `SignIn` (`pages/sign-in/sign-in.ts:30-50`) | jak `Register` | `idle/sending/sent/invalid/unavailable` |
| `VerifyLink` (`pages/verify-link/verify-link.ts:15-39`) | konstruktor czyta `ActivatedRoute.snapshot.fragment` (`:18-22`) | `ready/sending/invalid/unavailable` |
| `SubscriptionTable` (`pages/subscriptions/subscription-table/subscription-table.ts:35-67`) | `input.required` `subscriptions` (`:36`); `BreakpointObserver` (`:41-44`); `CurrencyPipe` i `DateOnlyPipe` (`LOCALE_ID`) | telefon/desktop, rozwinięty wiersz, szczegół „Miesięcznie” dla rocznych |
| `Subscriptions` (`pages/subscriptions/subscriptions.ts:43-213`) | `ngOnInit` → `GET /subscriptions` (`:104-135`); `viewChild.required` ×3 (`:50-53`); `BreakpointObserver` ×2; `window.scrollTo` tylko na telefonie (`:186`); osadza `AppShell` | `loading/error/ready-empty/ready-list`, panel dodawania, komunikaty |
| `SubscriptionForm` | `ngOnInit` → `GET /categories`; providery dat i form-field są w samym komponencie (`subscription-form.ts:92-98`) | zob. §1–2 |

- Aplikacja ustawia `LOCALE_ID` `pl-PL` i `registerLocaleData(localePl)` (`app.config.ts:13,18`); testy
  komponentów z `CurrencyPipe` / `DateOnlyPipe` muszą to powtórzyć.
- Brak `data-testid` w formularzu; stabilne punkty zaczepienia: atrybuty `formcontrolname`
  (`subscription-form.html:14,24,77,88,100,110,123,138`), klasy `.form__new-category`, `.st-notice--error`,
  `role="alert"` komunikatów (`subscription-form.html:33,67,152,157`), jedyny `button[type=submit]`
  (`subscription-form.html:163`), etykiety `mat-label`.

### 5. Plan testów i roadmapa — miejsca do zmiany

- `test-plan.md` (145 linii):
  - §2: wiersz #7 po `:44`, wiersz wskazówek #7 po `:55`;
  - §3: nowa faza 2 między `:65` i `:66`, przenumerowanie `:66-68`;
  - §4: `:75` (Phase 2→3), `:77` (Phase 3→4), `:86` (fazie 3→4); nieaktualny profil `:81` („frontend nie ma
    runnera ani testów”) i wiersz „unit (frontend)” `:76`;
  - §5: notatka przy `:96`, przenumerowanie `:97-99`;
  - §6: nowa podsekcja (wstawienie po 6.1 zmienia numery 6.2–6.5, `:110,115,119,123`, chyba że dopisana
    na końcu), przenumerowanie `:117` i `:121`;
  - §7: dwa punkty po `:132`; „(Source: Phase 2 interview Q5.)” w `:129-130` to faza wywiadu, nie
    wdrożenia — bez zmian;
  - §8: daty `:136-138`.
- Poza planem testów nieaktualne staną się odwołania „faza 3 planu testów” (= e2e przeglądarki, po zmianie
  faza 4): `context/changes/frontend-unit-tests/plan-brief.md:49`, `plan.md:65`, `research.md:159`.
- Roadmapa: F-03 wyklucza testy komponentów (`roadmap.md:122`). Kolejne slice'y dodające komponenty
  frontu: S-03 (edycja i usuwanie — formularz), S-04 (dashboard sum), S-05 (akcja anulowania), S-07
  (próg duplikatów), S-08 (formularz limitów i alerty), S-09 (ekrany admina), S-10 (usuwanie konta)
  (`roadmap.md:174-271`) — dowód prawdopodobieństwa dla „nowe komponenty będą dochodzić”.
- `angular.json:13-37`: `skipTests: true` dla wszystkich schematów (komponenty, serwisy, guardy, …).

## Code References

- `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts:92-98` — providery dat i form-field w komponencie
- `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts:143-150,163-173` — sygnały warunkowe i włączanie końca trialu
- `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts:197-240` — `addCategory()`
- `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.ts:242-265,298-300` — `submit()` i `focusFirstInvalid()`
- `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.html:1-2,39-71,117-160` — reguła błędów, blok kategorii, pole trialu, komunikaty stanu
- `frontend-subtracker/src/app/shared/form-field-defaults.ts:10-13` — domyślne opcje pól
- `frontend-subtracker/src/app/app.config.ts:13,18` — locale `pl-PL`
- `frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts:69-78,104-135,186` — breakpointy, ładowanie listy, `scrollTo`
- `frontend-subtracker/src/app/pages/verify-link/verify-link.ts:18-22` — token z fragmentu URL
- `frontend-subtracker/node_modules/@angular/cdk/fesm2022/_breakpoints-observer-chunk.mjs:17,71-78` — fallback `noopMatchMedia`
- `frontend-subtracker/node_modules/@angular/material/fesm2022/_animation-chunk.mjs:6-16` — stan animacji Materiala
- `frontend-subtracker/node_modules/@angular/material/fesm2022/select.mjs:394-418` — zamykanie panelu select
- `frontend-subtracker/node_modules/@angular/cdk/fesm2022/testing-testbed.mjs:27-31,599-605,690` — harness bez zone.js
- `frontend-subtracker/angular.json:13-37` — `skipTests`
- `context/foundation/test-plan.md:39-44,46-55,63-68,75-99,104-132` — sekcje do zmiany

## Architecture Insights

- Formularze mają providery Materiala na poziomie komponentu, nie aplikacji — test komponentu dostaje
  je razem z komponentem i nie musi ich powtarzać; musi natomiast powtórzyć `LOCALE_ID` i dane locale.
- Najtańsza warstwa dla ryzyka #7 to test komponentu w tym samym runnerze co faza 1 (TestBed + jsdom),
  z `provideHttpClientTesting()` na granicy HTTP — tak jak testy guardów w fazie 1 planu
  `frontend-unit-tests`.
- Harnessy Materiala dają asercje „pole ma błąd” (`hasErrors()`) bez odwoływania się do treści i klas
  wewnętrznych — pasują do decyzji z wywiadu „treść może ewoluować, ma być widoczna”.
- Dwa niezależne mechanizmy dla pola trialu (widoczność przez `@if`, aktywność przez `enable/disable`)
  to konkretna ścieżka regresji dla ryzyka #7: pole widoczne, ale wyłączone (albo odwrotnie).

## Historical Context (from prior changes)

- `context/archive/2026-11-10-ui-foundation/plan.md:184` — błędy pól według domyślnej reguły Materiala
  („po opuszczeniu pola albo po wysłaniu formularza”). Supported: brak własnego matchera w `src/`.
- `context/archive/2026-11-10-ui-foundation/reviews/impl-review.md:53-55,73-75` — dodanie `role="alert"`
  i usunięcie martwego sygnału `submitted` po przejściu na `mat-error`. Supported dla formularza
  subskrypcji: komunikaty stanu mają `role="alert"` (`subscription-form.html:152,157`).
- `context/archive/2026-11-11-first-subscription-in-list/plan.md:204,244` — komunikaty przy polach
  sprawdzane ręcznie (`abc`, `-1`, `100 000`, `31.02.2026`, rozliczenie przed końcem trialu).
  Supported: w repo nie ma testu komponentu formularza (3 pliki `*.spec.ts` frontu, wszystkie czyste
  funkcje lub strażnik strefy).
- `context/archive/2026-11-11-first-subscription-in-list/reviews/impl-review-phase-2-3.md:80-81` — wybór
  nowej kategorii tylko, gdy wciąż wybrane `'new'`. Supported: `subscription-form.ts:225-229`.
- `context/foundation/roadmap.md:122` i `context/changes/frontend-unit-tests/plan-brief.md:49` — testy
  komponentów wykluczone z F-03; refresh nie zmienia zakresu F-03, dodaje osobną fazę.

## Related Research

- `context/changes/frontend-unit-tests/research.md` — runner, CI, czyste funkcje i guardy (faza 1).
- `context/archive/2026-11-11-first-subscription-in-list/research.md` — format kwot i dat.

## Open Questions

1. **Harness w praktyce** — eksporty i kod źródłowy wskazują, że `TestbedHarnessEnvironment` działa bez
   zone.js, ale żaden test z harnessem nie został uruchomiony. Pierwszy krok fazy powinien to potwierdzić
   jednym testem (np. `MatFormFieldHarness.hasErrors()` po próbie zapisu).
2. **Numer podsekcji cookbooka** — wstawić „Adding a component test” jako 6.2 (przenumerowanie 6.2–6.5)
   czy dopisać na końcu; decyzja redakcyjna dla `/10x-plan`.
3. **`skipTests`** — przełączyć tylko dla komponentów (nowy komponent dostaje spec „should create”) czy
   zostawić `true` i opisać wymóg w §6; decyzja dla `/10x-plan` (brief, punkt 7).
4. **Zakres „should create”** w nowej fazie — wszystkie 12 komponentów czy 7 z logiką warunkową;
   decyzja dla `/10x-plan`. Brief mówi „minimum dla każdego nowego komponentu”.
5. **Błąd nazwy nowej kategorii po wysłaniu całego formularza** — zachowanie domyślnego matchera dla
   kontrolki `[formControl]` wewnątrz `<form [formGroup]>` nie zostało sprawdzone (§1, wniosek).
6. **Kolejność wdrożenia względem fazy 1** — refresh zmienia tylko plan testów; faza 1
   (`frontend-unit-tests`) ma jeszcze fazy 2–4 swojego planu. Czy implementacja refreshu czeka na koniec
   fazy 1 — decyzja użytkownika.
