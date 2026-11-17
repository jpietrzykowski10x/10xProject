# Ostrzeżenie o duplikatach w kategorii (S-07): plan implementacji

## Overview

Użytkownik ustawia dla każdej kategorii próg aktywnych subskrypcji (0–99, domyślnie 2). System porównuje go z liczbą aktywnych subskrypcji w kategorii i pokazuje ostrzeżenie w dwóch stanach:

- **pomarańczowy, „osiągnięto próg”**: liczba aktywnych subskrypcji równa się progowi i wynosi co najmniej 1;
- **czerwony, „przekroczono próg”**: liczba aktywnych subskrypcji jest większa od progu.

Ostrzeżenie widać w kolumnie sum app-shella i na nowej stronie `/dashboard`. Progi ustawia się na nowej stronie `/budget`, na której w S-08 dojdą limity kwotowe. Przeliczanie po każdej zmianie subskrypcji (FR-005) działa bez dodatkowego kodu, bo ostrzeżenie liczy się przy odczycie `GET /subscriptions/totals`.

## Current State Analysis

- `GET /subscriptions/totals` zwraca już per kategoria `subscriptionCount`. Liczy go czysta funkcja `costTotals()` na wierszach przefiltrowanych po `COUNTED_STATUSES` = `trial`, `active`, `cancelled_pending` (`backend-subtracker/src/subscriptions/cost-totals.ts:14-18, 48-81`). Ta lista definiuje „aktywne” także dla S-07 (`context/foundation/backend-patterns.md:104`).
- Nie ma żadnych ustawień użytkownika. Kategorie domyślne to wspólne wiersze z `user_id NULL` (`entities/category.entity.ts:27,34-36`), więc progu nie można zapisać w `category`.
- `CategoriesService.list(userId)` zwraca kategorie domyślne w ustalonej kolejności, a po nich własne użytkownika. `findUsable(userId, id)` sprawdza, czy kategoria należy do tego zbioru (`services/categories.service.ts:34-49, 80-87`).
- Frontend: `<app-cost-totals>` (`frontend-subtracker/src/app/subscriptions/cost-totals/`) pokazuje stan `CostTotalsStore` w dwóch wariantach: `column` na desktopie i `bar` w nagłówku na telefonie. Kategorie leżą w domyślnie zwiniętym `<details>` (`cost-totals.html:22-41`). Sumy odświeża `totals.refresh()` po każdej akcji na subskrypcji (`pages/subscriptions/subscriptions.ts:240-368`).
- Jedyna strona w app-shellu to `/subscriptions` (`app.routes.ts:31-34`, `RenderMode.Client` w `app.routes.server.ts`). Nawigacja ma dwa miejsca: `app-shell.html:5-13` (desktop) i `mat-menu` (telefon). Pozycja „Budżet” była odłożona do czasu, aż powstanie ta strona (`context/archive/2026-11-10-ui-foundation/plan.md:38`).

## Desired End State

- `GET /budget` zwraca wszystkie kategorie użytkownika (domyślne, potem własne) z ich progami. Kategoria bez zapisanego progu ma 2.
- `PUT /budget` zapisuje progi wskazanych kategorii (0–99, liczba całkowita). Jeśli któraś kategoria jest cudza lub nieznana, cała prośba dostaje 400 i nic się nie zapisuje.
- `GET /subscriptions/totals` zwraca w każdej kategorii `duplicateThreshold` i `duplicateWarning` (`none` | `reached` | `exceeded`).
- W kolumnie sum (desktop i telefon) zwinięte „Kategorie” mają ikonę trójkąta z wykrzyknikiem w kolorze najpoważniejszego ostrzeżenia. Rozwinięty wiersz kategorii z ostrzeżeniem ma ikonę, obrys 1px i opis „Osiągnięto próg: 2 z 2” albo „Przekroczono próg: 3 z 2”.
- `/dashboard` pokazuje pełne podsumowanie: sumy miesięczną i roczną oraz każdą kategorię z kwotami, liczbą subskrypcji, progiem i statusem.
- `/budget` pokazuje formularz progów wszystkich kategorii. Po zapisie sumy i flagi odświeżają się bez przeładowania.
- Obie nawigacje (desktop i menu na telefonie) mają linki „Dashboard”, „Subskrypcje” i „Budżet”.

Weryfikacja: testy unit i e2e backendu, testy komponentów frontendu, `render-modes` e2e oraz ręczny test wyglądu flagi na granatowym tle.

### Key Discoveries:

- `costTotals()` jest czystą funkcją: progi wchodzą jako drugi argument (mapa `categoryId → threshold`), więc testy zostają tabelaryczne bez bazy (`cost-totals.spec.ts`).
- Wzorzec PUT: walidacja przez globalny `ValidationPipe` (`app.module.ts:41-48`). Nieznana kategoria w treści prośby dostaje 400, tak jak w subskrypcjach (`subscriptions.service.ts`, `usableCategory`).
- Inwentarz tras API musi się zgadzać z aplikacją: `backend-subtracker/test/routes.e2e-spec.ts:36` (`EXPECTED_ROUTES`) oraz lista w `test/subscriptions/access.e2e-spec.ts`.
- Strona chroniona `authGuard` musi mieć `RenderMode.Client` i wpis w `GUARDED_ROUTES` (`frontend-subtracker/e2e/http/render-modes.e2e-spec.ts:10`), bo inaczej `'**'` ją prerenderuje.
- Tokeny kolorów: `--st-warning-*`, `--st-error-*` i `$orange` (`frontend-subtracker/src/styles/_theme.scss:146-161`). Żaden nie jest dobrany do granatowej kolumny, dlatego dochodzą dwa nowe tokeny alertów.

## What We're NOT Doing

- Limitów kwotowych (całościowego i per kategoria) ani alertów 80/100%. To S-08, które dołoży kolumnę do `category_setting` i pola do `/budget`.
- Wykresów na `/dashboard`. Strona ma być na nie gotowa układem, ale ich nie zawiera.
- Zmiany strony startowej po zalogowaniu. Logowanie i `guestGuard` dalej przekierowują na `/subscriptions`, a wordmark prowadzi tam jak dotąd.
- Wyłączania ostrzeżeń per kategoria. Zakres to 0–99, bez stanu „wyłączone” (decyzja użytkownika).
- Zmiany definicji „aktywnych” (`COUNTED_STATUSES`). `cancelled_pending` dalej liczy się do duplikatów.
- E-maili o ostrzeżeniach (FR-015, odłożone).
- Testu przeglądarkowego Playwright dla flagi. Regułę pokrywają testy unit i e2e API, a widoczność testy komponentów (test-plan §6.5: e2e tylko, gdy nic tańszego nie wystarcza). Testy `http` dostają tylko nowe trasy w `GUARDED_ROUTES`.
- Zmiany nazwy i usuwania kategorii.

## Implementation Approach

Backend najpierw, bo frontend zależy od kształtu `/totals` i `/budget`. Progi siedzą w nowej tabeli `category_setting` z kluczem `(user_id, category_id)`. Brak wiersza oznacza próg 2, więc nie trzeba seedować wierszy dla każdego użytkownika. S-08 doda do tej tabeli kolumnę limitu kategorii, więc obie funkcje będą miały jedną tabelę i jeden ekran. Reguła ostrzeżenia to czysta funkcja domeny w module `subscriptions`. `SubscriptionsService.totals()` dociąga progi użytkownika jednym zapytaniem i podaje je `costTotals()`.

Frontend dostaje typy z backendu, a flagę rysuje z `CostTotalsStore`. Strona `/dashboard` korzysta z tego samego store'a, który ładuje shell. Strona `/budget` ma własny serwis, a po zapisie woła `CostTotalsStore.refresh()`.

## Critical Implementation Details

- **Reguła z progiem 0:** przy progu 0 i liczbie 0 nie ma ostrzeżenia, a pierwsza subskrypcja w takiej kategorii daje od razu „przekroczono” (czerwony). Warunek `count >= 1` w stanie `reached` jest celowy. `/totals` i tak nie zwraca kategorii bez subskrypcji, ale funkcja musi to obsłużyć sama, bo jest testowana niezależnie.
- **Atomowość `PUT /budget`:** najpierw sprawdzić wszystkie `categoryId` (jedno zapytanie „domyślne albo moje” z `IN`), dopiero potem zapisać wszystkie upserty w jednej transakcji. Częściowy zapis przy 400 jest błędem.
- **Kontrast na granacie:** pomarańcz i czerwień flagi muszą być czytelne na `--st-navy` (kolumna i pasek na telefonie). Kolor nie może być jedyną informacją: ikona ma `aria-label` / ukryty tekst ze stanem, a opis w wierszu mówi słowami, co się stało.

## Phase 1: Backend: progi i ostrzeżenie w sumach

### Overview

Tabela progów, `GET`/`PUT /budget`, reguła ostrzeżenia i nowe pola w `/subscriptions/totals`, z testami unit i e2e.

### Changes Required:

#### 1. Encja i migracja

**File**: `backend-subtracker/src/subscriptions/entities/category-setting.entity.ts` (nowy), `src/subscriptions/subscriptions.module.ts`, `src/database/migrations/<ts>-CategorySetting.ts` (wygenerowana)

**Intent**: Trwałe ustawienia użytkownika per kategoria. Na razie tylko próg duplikatów, w S-08 dojdzie limit kwotowy.

**Contract**:
- Tabela `category_setting`: PK `(user_id, category_id)`, `duplicate_threshold smallint NOT NULL DEFAULT 2`, `updated_at timestamptz`.
- FK `user_id` → `user` z `ON DELETE CASCADE`. FK `category_id` → `category` z `NO ACTION` i własnym `@Index()`, bo nie jest pierwszą kolumną PK (lessons.md, „Indeksy”).
- Relacje jako `Relation<T>` z `() => Entity`, importy z `.js`.
- Encja zarejestrowana w `TypeOrmModule.forFeature`.
- Migracja przez `npm run migration:generate -- CategorySetting` względem `subtracker-db`, przejrzana pod kątem indeksu na `category_id`, potem `migration:run`.

#### 2. Reguła ostrzeżenia i sumy

**File**: `backend-subtracker/src/subscriptions/duplicate-warning.ts` (nowy, z `duplicate-warning.spec.ts`), `src/subscriptions/cost-totals.ts`, `src/subscriptions/subscription.types.ts`

**Intent**: Jedno miejsce z regułą „osiągnięto / przekroczono”, użyte przez `costTotals()`. Stałe progu należą do domeny `subscriptions`, nie do `shared/` (lessons.md).

**Contract**:
- `enum DuplicateWarning { NONE = 'none', REACHED = 'reached', EXCEEDED = 'exceeded' }`.
- Stałe: `DEFAULT_DUPLICATE_THRESHOLD = 2`, `DUPLICATE_THRESHOLD_MIN = 0`, `DUPLICATE_THRESHOLD_MAX = 99`.
- `duplicateWarning(count, threshold)`: `count > threshold` → `EXCEEDED`; `count === threshold && count >= 1` → `REACHED`; w pozostałych przypadkach `NONE`.
- `costTotals(rows, thresholds: ReadonlyMap<string, number>)`: brak wpisu w mapie oznacza `DEFAULT_DUPLICATE_THRESHOLD`.
- `CategoryCostTotal` dostaje pola `duplicateThreshold: number` i `duplicateWarning: DuplicateWarning`. Kolejność i sumy bez zmian.

#### 3. Progi w `SubscriptionsService.totals()`

**File**: `backend-subtracker/src/subscriptions/services/subscriptions.service.ts`

**Intent**: `/totals` liczy ostrzeżenia przy każdym odczycie, więc spełnia FR-005 bez zapisanego stanu flagi.

**Contract**: Jedno dodatkowe zapytanie `category_setting WHERE user_id = :userId` zamienione na mapę i podane do `costTotals()`. Arytmetyki w SQL nie ma, tak jak w S-04.

#### 4. `GET` / `PUT /budget`

**File**: `backend-subtracker/src/subscriptions/controllers/budget.controller.ts`, `services/budget.service.ts`, `dtos/update-budget.dto.ts` (nowe, z `update-budget.dto.spec.ts`), `services/categories.service.ts` (ewentualnie helper „wszystkie te id są usable”)

**Intent**: Odczyt i zapis progów dla strony `/budget`. S-08 rozszerzy te same trasy o limity.

**Contract**:
- `GET /budget` (`Cache-Control: no-store`) → `BudgetResponse { categories: { category: CategoryResponse; duplicateThreshold: number }[] }` w kolejności `CategoriesService.list()`.
- `PUT /budget`, body `{ categories: { categoryId: uuid; duplicateThreshold: int 0–99 }[] }`:
  - walidacja: tablica 1–200 elementów, `categoryId` unikalne (`ArrayUnique`), `@IsUUID`, `@IsInt @Min(0) @Max(99)`;
  - upsert wymienionych kategorii, pozostałe bez zmian;
  - odpowiedź 200 z tym samym `BudgetResponse` co GET.
- Dowolny `categoryId` spoza „domyślne + moje” → 400 dla całej prośby, bez zapisu (patrz Critical Implementation Details). W odpowiedzi brak `userId`.

#### 5. Testy backendu

**File**: `backend-subtracker/src/subscriptions/duplicate-warning.spec.ts`, `cost-totals.spec.ts`, `dtos/update-budget.dto.spec.ts`, `test/subscriptions/budget.e2e-spec.ts` (nowy), `test/routes.e2e-spec.ts`, `test/subscriptions/access.e2e-spec.ts`, `test/subscriptions/cost-totals.e2e-spec.ts`

**Intent**: Pokryć regułę na granicach, kontrakt API i izolację kont (ryzyko #1) według test-plan §6.3–6.4.

**Contract**:
- Unit, `it.each`: (count, threshold) → (0,0) none, (1,0) exceeded, (1,2) none, (2,2) reached, (3,2) exceeded, (99,99) reached, (100,99) exceeded.
- `costTotals` bierze domyślne 2 przy braku wpisu w mapie i wartość z mapy przy jego obecności.
- DTO: -1, 100, 1.5, `"2"`, zduplikowane `categoryId`, pusta tablica → błąd; 0 i 99 → poprawne.
- E2E:
  - GET zwraca domyślne 2 dla kategorii domyślnych i własnej;
  - PUT, potem GET, zwraca nowe wartości;
  - `/totals` po PUT pokazuje `reached` i `exceeded` przy 2 i 3 subskrypcjach;
  - anulowanie zamknięte jobem zdejmuje ostrzeżenie (wystarczy przypadek `cancelled` z istniejących helperów);
  - test na dwóch kontach: B wysyła PUT z własną kategorią A → 400, a progi A są bez zmian;
  - 400 dla całej prośby, gdy jedna z dwóch kategorii jest nieznana, a pierwsza też nie zmienia się w bazie;
  - 401 bez sesji;
  - nowe trasy w `EXPECTED_ROUTES` i w `access.e2e-spec.ts`.

### Success Criteria:

#### Automated Verification:

- Migracja wygenerowana i zastosowana na `subtracker-db`: `npm run migration:run` (z `backend-subtracker/`), a `npm run migration:generate -- Check` kończy się „No changes in database schema were found”
- Lint backendu przechodzi: `npm run lint`
- Build backendu przechodzi: `npm run build`
- Testy unit backendu przechodzą: `npm test`
- Testy e2e API przechodzą: `npm run test:e2e`

#### Manual Verification:

- Przegląd wygenerowanej migracji: PK `(user_id, category_id)`, indeks na `category_id`, `ON DELETE CASCADE` tylko na `user_id`, domyślne 2
- `GET /budget` i `GET /subscriptions/totals` na `subtracker-db-dev` (np. przez `dev-local/test-session.mjs seed`) zwracają nowe pola z oczekiwanymi wartościami

**Implementation Note**: Po zakończeniu fazy i przejściu weryfikacji automatycznej zatrzymaj się i poczekaj, aż człowiek potwierdzi weryfikację ręczną.

---

## Phase 2: Frontend: flaga w kolumnie sum

### Overview

Kolumna sum (desktop i pasek na telefonie) pokazuje ostrzeżenia z `/totals`: ikonę na zwiniętych „Kategoriach”, a w wierszach ikonę, obrys i opis.

### Changes Required:

#### 1. Typy i tokeny

**File**: `frontend-subtracker/src/app/subscriptions/subscription.types.ts`, `src/styles/_theme.scss`

**Intent**: Lustro kontraktu backendu oraz dwa kolory alertów czytelne na granacie, wspólne z S-08.

**Contract**:
- `CategoryCostTotal` dostaje `duplicateThreshold: number` i `duplicateWarning: 'none' | 'reached' | 'exceeded'` (typ `DuplicateWarning`).
- Tokeny `--st-alert-warning` (pomarańcz) i `--st-alert-danger` (czerwień), dobrane do kontrastu na `--st-navy` i na jasnym tle strony. Jeśli jedna wartość nie wystarczy dla obu teł, osobne warianty `-on-navy`.

#### 2. Flaga w `<app-cost-totals>`

**File**: `frontend-subtracker/src/app/subscriptions/cost-totals/cost-totals.{ts,html,scss}`, opcjonalnie `subscriptions/duplicate-warning-icon/` (mały komponent z inline SVG, użyty też w fazie 3)

**Intent**: Ostrzeżenie widoczne bez rozwijania listy i opisane słowami po rozwinięciu.

**Contract**:
- `computed` z najpoważniejszym ostrzeżeniem w `totals.categories` (`exceeded` > `reached` > `none`).
- `<summary>` „Kategorie” dostaje ikonę trójkąta z wykrzyknikiem w kolorze tego ostrzeżenia oraz dostępny tekst (np. „1 kategoria przekroczyła próg”).
- Wiersz kategorii z ostrzeżeniem: ta sama ikona przy nazwie, obrys 1px w kolorze stanu oraz `dd` z opisem:
  - `reached`: „Osiągnięto próg: {count} z {threshold}”;
  - `exceeded`: „Przekroczono próg: {count} z {threshold}”.
- Ikony to inline SVG (bez fontu Material, CLAUDE.md). Oba warianty (`column`, `bar`) zachowują się tak samo.

#### 3. Testy komponentu

**File**: `frontend-subtracker/src/app/subscriptions/cost-totals/cost-totals.spec.ts`

**Intent**: Ryzyko #7: element warunkowy musi się pojawić wtedy, kiedy powinien (test-plan §6.2).

**Contract**:
- Przy samych `none` nie ma ikony ani obrysu.
- Przy `reached` jest ikona na `summary` i znacznik stanu wiersza.
- Przy jednym `reached` i jednym `exceeded` `summary` ma stan `exceeded`.
- Sprawdzamy stan przez atrybut lub klasę (np. `data-warning="exceeded"`), nie przez treść tekstu.

### Success Criteria:

#### Automated Verification:

- Testy frontendu przechodzą w obu strefach: `npm run test:ci` (z `frontend-subtracker/`)
- Build produkcyjny przechodzi (AOT, budżet stylów): `npm run build`

#### Manual Verification:

- Na desktopie i na telefonie (< 840 px) zwinięte „Kategorie” pokazują pomarańczową albo czerwoną ikonę, a po rozwinięciu wiersz ma ikonę, obrys 1px i opis
- Kolory i obrys są czytelne na granatowym tle (ocena na żywo; w razie potrzeby korekta tokenów)

**Implementation Note**: Po zakończeniu fazy i przejściu weryfikacji automatycznej zatrzymaj się i poczekaj, aż człowiek potwierdzi weryfikację ręczną.

---

## Phase 3: Frontend: strony `/budget` i `/dashboard`

### Overview

Dwie nowe strony w app-shellu, linki w obu nawigacjach, formularz progów z odświeżaniem sum.

### Changes Required:

#### 1. Trasy i nawigacja

**File**: `frontend-subtracker/src/app/app.routes.ts`, `app.routes.server.ts`, `layout/app-shell/app-shell.html`, `e2e/http/render-modes.e2e-spec.ts`

**Intent**: Strony dostępne tylko po zalogowaniu i renderowane w przeglądarce, z linkami na desktopie i telefonie.

**Contract**:
- `dashboard` i `budget`: `canActivate: [authGuard]`, `loadComponent`, wpisy `RenderMode.Client`.
- Linki „Dashboard”, „Subskrypcje”, „Budżet” w `shell__nav` i w `mat-menu`, z `routerLinkActive` i `ariaCurrentWhenActive`.
- `/dashboard` i `/budget` dopisane do `GUARDED_ROUTES`.

#### 2. Serwis budżetu

**File**: `frontend-subtracker/src/app/budget/budget.types.ts`, `budget/budget.service.ts` (nowe)

**Intent**: Klient `GET`/`PUT /budget`. S-08 rozszerzy te same typy.

**Contract**: `BudgetResponse`, `UpdateBudgetRequest` lustrzane do backendu. `get(): Observable<BudgetResponse>`, `update(body): Observable<BudgetResponse>`.

#### 3. Strona `/budget`

**File**: `frontend-subtracker/src/app/pages/budget/budget.{ts,html,scss,spec.ts}`

**Intent**: Użytkownik ustawia progi wszystkich kategorii naraz.

**Contract**:
- Strona w `<app-shell>`. Ładuje `GET /budget` i pokazuje stany: ładowanie, błąd z ponowieniem, formularz.
- Każda kategoria to jeden wiersz z nazwą i polem liczbowym progu: walidatory całkowita 0–99, wymagane, komunikat przez `mat-error`.
- Jeden przycisk „Zapisz” wysyła wszystkie kategorie. Po sukcesie pokazuje komunikat `st-notice` i woła `CostTotalsStore.refresh()`.
- Po 400 przeładowuje listę z komunikatem, bo kategoria mogła zniknąć. Inne błędy dają komunikat o niedostępności.
- Krótki opis reguły nad listą: „Ostrzeżemy Cię, gdy liczba aktywnych subskrypcji w kategorii osiągnie próg (pomarańczowe) albo go przekroczy (czerwone).”
- Na telefonie jedna kolumna.

#### 4. Strona `/dashboard`

**File**: `frontend-subtracker/src/app/pages/dashboard/dashboard.{ts,html,scss,spec.ts}`

**Intent**: Pełne podsumowanie kosztów i ostrzeżeń, miejsce na przyszłe wykresy i limity S-08.

**Contract**:
- Strona w `<app-shell>`, czyta `CostTotalsStore.state` (ładuje go shell) i pokazuje stany ładowania, błędu i braku subskrypcji.
- Sumy miesięczna i roczna.
- Tabela kategorii w kolejności API: nazwa, miesięcznie, rocznie, liczba subskrypcji, próg, status. Status to ikona z fazy 2 i opis słowny, a dla `none` „W normie”.
- Link „Zmień progi” do `/budget`.
- Na telefonie wiersze jako lista kart, przełączane media query 840 px jak w layoutach.

#### 5. Testy stron

**File**: `pages/budget/budget.spec.ts`, `pages/dashboard/dashboard.spec.ts`, `layout/app-shell/app-shell.spec.ts`

**Intent**: Ryzyko #7 i kontrakt prośby (test-plan §6.2).

**Contract**:
- Budżet:
  - pola znalezione harnessem po etykiecie;
  - wartość 100 lub pusta daje `hasErrors()` i brak prośby;
  - poprawny zapis wysyła `PUT /budget` z `request.body` równym kontraktowi, a potem `GET /subscriptions/totals`;
  - 400 przeładowuje `GET /budget`.
- Dashboard: wiersz `exceeded` ma znacznik stanu, przy pustych sumach pokazuje się stan pusty.
- Shell: trzy linki w nawigacji.

#### 6. Domyślny próg użytkownika (backend, dopisane w trakcie fazy 3, 2026-11-17)

**File**: `backend-subtracker/src/subscriptions/entities/budget-settings.entity.ts` (encja `BudgetSettings`), `src/subscriptions/duplicate-warning.ts`, `services/budget.service.ts`, `services/subscriptions.service.ts`, `services/categories.service.ts`, `dtos/update-budget.dto.ts`, migracja `<ts>-BudgetSettings.ts` (wygenerowana)

**Intent**: Każdy użytkownik ma własny domyślny próg (startowo 3), który podstawia się kategoriom bez własnej wartości. Decyzje użytkownika: tabela `budget_settings` w module `subscriptions` z kolumnami z typem (nie `jsonb`; S-08 dołoży tu limit całościowy, a preferencje konta spoza budżetu, np. motyw, trafią kiedyś do własnej tabeli w module `users`), semantyka „kopiowanie przy utworzeniu”.

**Contract**:
- Tabela `budget_settings`: PK i FK `user_id` → `user` z `ON DELETE CASCADE`, `default_duplicate_threshold smallint NOT NULL DEFAULT 3`, `updated_at timestamptz`. Brak wiersza = 3.
- `DEFAULT_DUPLICATE_THRESHOLD = 3` (było 2); domyślna kolumny `category_setting.duplicate_threshold` też 3.
- Próg kategorii = wiersz `category_setting`, a bez niego aktualny domyślny próg użytkownika (dotyczy kategorii domyślnych systemu i kategorii nigdy niezapisanych). Używa tego `/totals` i `GET /budget`.
- Utworzenie własnej kategorii (`POST /categories`) zapisuje w tej samej transakcji wiersz `category_setting` z bieżącym domyślnym progiem użytkownika (kopia; późniejsza zmiana domyślnego go nie zmienia).
- `GET /budget` → `{ defaultDuplicateThreshold: number; categories: … }`.
- `PUT /budget`: body `{ defaultDuplicateThreshold?: int 0–99; categories?: {…}[] }` (0–200 elementów), co najmniej jedno z pól wymagane (inaczej 400). Upsert ustawień i wymienionych kategorii w jednej transakcji; walidacja kategorii jak dotąd (cała prośba 400, bez zapisu).
- Migracja przez `npm run migration:generate -- BudgetSettings`, przegląd, `migration:run`.

#### 7. Strona `/budget`: domyślny próg i zapis tylko zmian

**File**: `frontend-subtracker/src/app/budget/budget.types.ts`, `budget.service.ts`, `pages/budget/budget.{ts,html,scss,spec.ts}`, `pages/dashboard/*` (jeśli pokazuje domyślne)

**Contract**:
- Nad listą kategorii pole „Domyślny próg” (te same walidatory 0–99) z opisem, że podstawia się nowym kategoriom.
- „Zapisz” jest nieaktywny, dopóki formularz nie ma zmian względem ostatnio wczytanych wartości (powrót do starej wartości = brak zmian). Po zapisie formularz przyjmuje zapisane wartości jako nowy punkt odniesienia.
- `PUT /budget` wysyła tylko zmienione pola: `defaultDuplicateThreshold` tylko gdy zmieniony, `categories` tylko zmienione kategorie.

#### 8. Izolacja testów strony `/budget`

**File**: `frontend-subtracker/src/app/pages/budget/budget.spec.ts`

**Intent**: Błąd jednego testu nie może wywracać kolejnych (break-check z usuniętym walidatorem `max` wywracał 7 testów zamiast 1).

**Contract**: Każdy test sam domyka swoje prośby (`HttpTestingController.verify()` w `afterEach` nie przenosi błędu dalej, TestBed czysty per test). Usunięcie walidatora `max` wywraca tylko test „100”.

#### 9. Testy

- Backend unit: `costTotals` bierze domyślny próg użytkownika przy braku wpisu; DTO: puste body → błąd, samo `defaultDuplicateThreshold` → poprawne, 100/-1 → błąd.
- Backend e2e: nowy użytkownik dostaje 3; zmiana domyślnego zmienia próg kategorii nigdy niezapisanej, ale nie zapisanej; nowa własna kategoria dostaje kopię bieżącego domyślnego, a późniejsza zmiana domyślnego jej nie rusza; izolacja kont dla `budget_settings`; `EXPECTED_ROUTES` bez zmian.
- Frontend: „Zapisz” nieaktywny bez zmian i po powrocie do starej wartości; PUT zawiera tylko zmienione pola (`request.body` równe kontraktowi); zmiana samego domyślnego wysyła tylko `defaultDuplicateThreshold`.

### Success Criteria:

#### Automated Verification:

- Testy frontendu przechodzą w obu strefach: `npm run test:ci`
- Build produkcyjny przechodzi: `npm run build`
- Testy e2e przechodzą na buildzie e2e (w tym `render-modes` z nowymi trasami): `npm run build:e2e && npm run e2e`
- Migracja `BudgetSettings` zastosowana na `subtracker-db`, a `npm run migration:generate -- Check` kończy się „No changes in database schema were found” (z `backend-subtracker/`)
- Backend: `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e`

#### Manual Verification:

- Przegląd migracji `BudgetSettings`: PK/FK `user_id` z `CASCADE`, domyślne 3
- Na `/budget` „Zapisz” jest nieaktywny bez zmian; zmiana domyślnego progu na 4 i dodanie nowej kategorii (formularz subskrypcji) daje tej kategorii 4

- Na `/budget` zmiana progu Streaming na 1 przy dwóch subskrypcjach zmienia flagę w kolumnie na czerwoną bez przeładowania strony
- `/dashboard` na desktopie i telefonie pokazuje kategorie, progi i statusy, a linki w obu nawigacjach podświetlają aktywną stronę
- Bezpośrednie wejście na `/dashboard` i `/budget` bez sesji przekierowuje na `/sign-in`

**Implementation Note**: Po zakończeniu fazy i przejściu weryfikacji automatycznej zatrzymaj się i poczekaj, aż człowiek potwierdzi weryfikację ręczną.

---

## Phase 4: Dokumentacja i weryfikacja

### Overview

Zapis nowych reguł i stron w dokumentach projektu, żeby S-08 i kolejne slice'y ich nie odkrywały od nowa.

### Changes Required:

#### 1. Dokumenty projektu

**File**: `context/foundation/backend-patterns.md`, `CLAUDE.md`, `context/foundation/roadmap.md`, `context/foundation/test-plan.md` (§6, jeśli wzorzec testu się zmienił)

**Intent**: Utrwalić decyzje S-07.

**Contract**:
- `backend-patterns.md`, sekcja „Dane domenowe”:
  - ustawienia per (użytkownik, kategoria) w `category_setting`, gdzie brak wiersza oznacza wartości domyślne, a S-08 dokłada kolumny;
  - reguła duplikatów: `reached` przy liczbie = próg ≥ 1, `exceeded` przy liczbie > próg;
  - `PUT /budget` jest atomowy, a nieznana kategoria daje 400.
- `CLAUDE.md` (Tripwires i Architecture): `dashboard` i `budget` mają `RenderMode.Client`; trasy `GET`/`PUT /budget`.
- Roadmapa, notatka przy S-07:
  - dostarczono `/dashboard` i `/budget`;
  - flaga ma dwa stany, a próg 0–99;
  - S-08 korzysta z `category_setting` i `/budget`.

### Success Criteria:

#### Automated Verification:

- Formatowanie dokumentów i kodu bez zmian po prettierze: `npm run format` w `backend-subtracker/` nie zmienia plików

#### Manual Verification:

- Dokumenty opisują reguły zgodnie z kodem (przegląd przy `/10x-impl-review`)

---

## Testing Strategy

### Unit Tests:

- `duplicateWarning`: tabela granic z progami 0, 2 i 99 (faza 1).
- `costTotals` z mapą progów: wartość domyślna i własna.
- DTO `PUT /budget`: zakres, typ całkowity, unikalność, pusta tablica.

### Integration Tests:

- API e2e `budget.e2e-spec.ts`:
  - odczyt wartości domyślnych;
  - zapis i ponowny odczyt;
  - ostrzeżenia w `/totals`;
  - izolacja kont;
  - atomowość przy 400;
  - 401 bez sesji.
- Testy komponentów: flaga w kolumnie, formularz budżetu (harness, `request.body`), dashboard.
- `render-modes` e2e: nowe trasy chronione renderują się po stronie klienta.

### Manual Testing Steps:

1. Zalogować się i dodać dwie subskrypcje w kategorii Streaming. Kolumna pokazuje pomarańczową ikonę na „Kategorie”, a po rozwinięciu „Osiągnięto próg: 2 z 2”.
2. Dodać trzecią subskrypcję. Ikona i obrys stają się czerwone z opisem „Przekroczono próg: 3 z 2”.
3. Na `/budget` ustawić próg Streaming na 5 i zapisać. Ostrzeżenie znika bez przeładowania.
4. Ustawić próg 0 w kategorii bez subskrypcji. Brak flagi. Dodać subskrypcję w tej kategorii. Od razu czerwona flaga.
5. Anulować subskrypcję (`cancelled_pending`). Dalej się liczy. Po zamknięciu przez job przestaje się liczyć.
6. Sprawdzić wszystko na szerokości telefonu (< 840 px).

## Performance Considerations

Jedno dodatkowe zapytanie po `category_setting` (PK zaczyna się od `user_id`) przy każdym `GET /subscriptions/totals`. Przy kilkudziesięciu kategoriach na użytkownika koszt jest pomijalny.

## Migration Notes

Nowa tabela bez danych, więc bez backfillu. Na produkcji migracja wchodzi przez `deploy.sh` w oknie przestoju po `pg_dump`. Na `subtracker-db-dev` tabelę tworzy `synchronize`.

## References

- Research: `context/changes/category-duplicate-warning/research.md`
- Sumy S-04: `context/archive/2026-11-15-dashboard-cost-totals/plan.md`
- `backend-subtracker/src/subscriptions/cost-totals.ts:14-81`
- `backend-subtracker/src/subscriptions/services/categories.service.ts:34-87`
- `frontend-subtracker/src/app/subscriptions/cost-totals/cost-totals.html:22-41`
- `frontend-subtracker/src/app/layout/app-shell/app-shell.html:1-52`
- `context/foundation/test-plan.md` §6.2–6.4
- Równoległy research S-08: `context/changes/budget-limits-and-alerts/research.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend: progi i ostrzeżenie w sumach

#### Automated

- [x] 1.1 Migracja wygenerowana i zastosowana na `subtracker-db`: `npm run migration:run` (z `backend-subtracker/`), a `npm run migration:generate -- Check` kończy się „No changes in database schema were found” — 79046fd
- [x] 1.2 Lint backendu przechodzi: `npm run lint` — 79046fd
- [x] 1.3 Build backendu przechodzi: `npm run build` — 79046fd
- [x] 1.4 Testy unit backendu przechodzą: `npm test` — 79046fd
- [x] 1.5 Testy e2e API przechodzą: `npm run test:e2e` — 79046fd

#### Manual

- [x] 1.6 Przegląd wygenerowanej migracji: PK `(user_id, category_id)`, indeks na `category_id`, `ON DELETE CASCADE` tylko na `user_id`, domyślne 2 — 79046fd
- [x] 1.7 `GET /budget` i `GET /subscriptions/totals` na `subtracker-db-dev` (np. przez `dev-local/test-session.mjs seed`) zwracają nowe pola z oczekiwanymi wartościami — 79046fd

### Phase 2: Frontend: flaga w kolumnie sum

#### Automated

- [x] 2.1 Testy frontendu przechodzą w obu strefach: `npm run test:ci` (z `frontend-subtracker/`) — dc269f2
- [x] 2.2 Build produkcyjny przechodzi (AOT, budżet stylów): `npm run build` — dc269f2

#### Manual

- [x] 2.3 Na desktopie i na telefonie (< 840 px) zwinięte „Kategorie” pokazują pomarańczową albo czerwoną ikonę, a po rozwinięciu wiersz ma ikonę, obrys 1px i opis — dc269f2
- [x] 2.4 Kolory i obrys są czytelne na granatowym tle (ocena na żywo; w razie potrzeby korekta tokenów) — dc269f2

### Phase 3: Frontend: strony `/budget` i `/dashboard`

#### Automated

- [x] 3.1 Testy frontendu przechodzą w obu strefach: `npm run test:ci`
- [x] 3.2 Build produkcyjny przechodzi: `npm run build`
- [x] 3.3 Testy e2e przechodzą na buildzie e2e (w tym `render-modes` z nowymi trasami): `npm run build:e2e && npm run e2e`
- [x] 3.7 Migracja `BudgetSettings` zastosowana na `subtracker-db`, a `npm run migration:generate -- Check` kończy się „No changes in database schema were found”
- [x] 3.8 Backend: `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e`

#### Manual

- [x] 3.4 Na `/budget` zmiana progu Streaming na 1 przy dwóch subskrypcjach zmienia flagę w kolumnie na czerwoną bez przeładowania strony
- [x] 3.5 `/dashboard` na desktopie i telefonie pokazuje kategorie, progi i statusy, a linki w obu nawigacjach podświetlają aktywną stronę
- [x] 3.6 Bezpośrednie wejście na `/dashboard` i `/budget` bez sesji przekierowuje na `/sign-in`
- [x] 3.9 Przegląd migracji `BudgetSettings`: PK/FK `user_id` z `CASCADE`, domyślne 3
- [x] 3.10 Na `/budget` „Zapisz” jest nieaktywny bez zmian; zmiana domyślnego progu na 4 i dodanie nowej kategorii (formularz subskrypcji) daje tej kategorii 4

### Phase 4: Dokumentacja i weryfikacja

#### Automated

- [ ] 4.1 Formatowanie dokumentów i kodu bez zmian po prettierze: `npm run format` w `backend-subtracker/` nie zmienia plików

#### Manual

- [ ] 4.2 Dokumenty opisują reguły zgodnie z kodem (przegląd przy `/10x-impl-review`)
