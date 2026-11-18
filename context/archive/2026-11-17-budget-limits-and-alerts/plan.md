# Limity budżetu i alerty 80% / 100% (S-08): plan implementacji

## Overview

Użytkownik ustawia na `/budget` miesięczny limit całościowy i limity poszczególnych kategorii (FR-010). `GET /subscriptions/totals` liczy przy każdym odczycie wykorzystanie każdego limitu i stan alertu (FR-011, FR-005):

- **brak alertu**: wydatki < 80% limitu (albo brak limitu, albo wydatki 0 zł);
- **pomarańczowy, „zbliżasz się do limitu”**: wydatki ≥ 80% i < 100% limitu;
- **czerwony**: wydatki ≥ 100% limitu. Dokładnie 100% to „wykorzystano limit”, powyżej 100% to „przekroczono limit”.

Kolumna sum pokazuje pod sumą miesięczną pasek wykorzystania limitu całościowego, a rozwinięty wiersz kategorii jej limit i alert. `/dashboard` pokazuje to samo w pełnej postaci.

## Current State Analysis

- `costTotals(rows, thresholds)` (`backend-subtracker/src/subscriptions/cost-totals.ts:54`) liczy w groszach miesięczną i roczną sumę całości i kategorii (roczna subskrypcja: grosze / 12 per subskrypcja, połówka w górę) po `COUNTED_STATUSES`. Kategorie z zerową sumą nie trafiają do odpowiedzi. Limit miesięczny porównujemy z tym samym `monthly`, więc alert nie rozjedzie się z kwotą w kolumnie (ryzyko #4 z test-plan).
- S-07 zostawił miejsce na limity: `budget_settings` (wiersz na użytkownika, `entities/budget-settings.entity.ts`) i `category_setting` (PK `(user_id, category_id)`, `entities/category-setting.entity.ts`), oba w module `subscriptions`. `category_setting.duplicate_threshold` jest dziś `NOT NULL`, a brak wiersza oznacza „próg = aktualny domyślny użytkownika” (`thresholdOf`, `duplicate-warning.ts:15`).
- `GET`/`PUT /budget` (`controllers/budget.controller.ts`, `services/budget.service.ts`, `dtos/update-budget.dto.ts`): PUT jest atomowy (sprawdzenie kategorii przez `CategoriesService.allUsable`, potem upserty w jednej transakcji), body wymaga co najmniej jednego pola, `null` daje 400, a każda pozycja `categories[]` wymaga `duplicateThreshold`.
- Kwoty: `numeric(10,2)`, w encji i API string `"43.00"`, wejście liczbą (`@IsNumber({ maxDecimalPlaces: 2 })`, `@Min`, `@Max(AMOUNT_MAX)`, `subscription.types.ts:34`, `create-subscription.dto.ts:67-70`), arytmetyka w groszach (`shared/money/grosze.ts`). Frontend ma `parseAmount`/`amountValidator` (`subscriptions/subscription-validators.ts`).
- Frontend z S-07: `CostTotalsStore`, `<app-cost-totals>` (kolumna i pasek na telefonie, przewijane „Kategorie”), `<app-duplicate-warning-icon>`, tokeny `--st-alert-*` i `-on-navy`, `mostSevereDuplicateWarning`, strony `/budget` (zapis tylko zmian, „Zapisz” aktywny po zmianie) i `/dashboard` (tabela na desktopie, karty na telefonie). Limetka `#D6F25E` z F2 nie jest jeszcze tokenem.

## Desired End State

- `budget_settings.monthly_limit` i `category_setting.monthly_limit`: `numeric(10,2) NULL` (null = brak limitu). `category_setting.duplicate_threshold` jest nullable (null = aktualny domyślny próg użytkownika), więc sam limit nie zamraża progu kategorii.
- `GET /subscriptions/totals` zwraca w korzeniu `monthlyLimit: string | null` i `budgetAlert`, a w każdej kategorii `monthlyLimit` i `budgetAlert` (`none` | `near` | `reached` | `exceeded`).
- `GET /budget` zwraca `monthlyLimit` oraz `monthlyLimit` każdej kategorii. `PUT /budget` przyjmuje `monthlyLimit?: number | null` w korzeniu i w pozycji kategorii (`null` usuwa limit), a `duplicateThreshold` pozycji staje się opcjonalny.
- Kolumna sum: pod sumą miesięczną pasek wykorzystania (limetka, ≥80% pomarańczowy, ≥100% czerwony) i tekst „170,00 z 200,00 zł (85%)” z ikoną przy alercie. Bez limitu brak paska. Rozwinięty wiersz kategorii z limitem ma linię „Limit: 90,00 z 80,00 zł” i przy alercie ikonę, obrys i opis. Ikona na zwiniętych „Kategoriach” pokazuje najpoważniejszy stan z duplikatów i limitów.
- `/budget`: pole limitu całościowego i pole limitu przy każdej kategorii (puste = brak), podpowiedź, gdy suma limitów kategorii przekracza limit całościowy. `/dashboard`: limit całościowy z paskiem, kolumny limitu i statusu limitu.

Weryfikacja: testy unit i e2e backendu, testy komponentów frontendu, ręczny test paska i alertów na granatowym tle i na `/dashboard`.

### Key Discoveries:

- Alert z `/totals` daje FR-005 bez nowego kodu: frontend woła `CostTotalsStore.refresh()` po każdej akcji na subskrypcji i po zapisie `/budget`.
- `PUT /budget` z samym limitem kategorii tworzy wiersz `category_setting`. Przy `duplicate_threshold NOT NULL` trzeba by wpisać próg i zamrozić go dla kategorii domyślnej, wbrew regule S-07. Stąd nullable.
- `toGrosze` rzuca wyjątek przy formacie innym niż `"x.yy"`, a node-pg zwraca `numeric` jako string w tym formacie.

## What We're NOT Doing

- Konfigurowalnych progów 80/100 (FR-017) ani prognozy przed dodaniem subskrypcji (FR-012).
- E-maili o alertach (FR-015).
- Limitów rocznych. Limit jest miesięczny i porównywany z sumą miesięczną.
- Pokazywania w kolumnie i na `/dashboard` kategorii z limitem, ale bez aktywnych subskrypcji. `/totals` nadal pomija kategorie z zerową sumą, a taki limit widać tylko na `/budget` (decyzja użytkownika).
- Blokowania zapisu, gdy suma limitów kategorii przekracza limit całościowy. Jest tylko podpowiedź na `/budget`.
- Zmiany definicji „aktywnych” (`COUNTED_STATUSES`). Trial i `cancelled_pending` liczą się do limitu jak do sum.
- Nowego testu Playwright. Reguła w unit i API e2e, widoczność w testach komponentów (test-plan §6.5).
- Osobnej ikony dla limitów. Ikona z S-07 jest wspólna.

## Implementation Approach

Ten sam rytm co S-07: najpierw backend (schemat, czysta reguła, `/totals`, `/budget`), potem kolumna, potem strony, na końcu dokumenty. Reguła alertu to czysta funkcja domeny na groszach w module `subscriptions`, porównująca liczby całkowite (`spent * 100 >= limit * 80`), bez floatów. Wynikiem jest enum, procent liczy frontend do wyświetlenia.

## Critical Implementation Details

- **Reguła 0 zł:** wydatki 0 zł dają `none` przy każdym limicie, także przy limicie 0. Przy limicie 0 każdy wydatek > 0 to `exceeded` (kategoria „szkodliwa”, jak próg 0 w S-07). Funkcja nie dzieli przez limit.
- **Granice:** `near` gdy `spent * 100 >= limit * 80` i `spent < limit`; `reached` gdy `spent === limit` (i `spent > 0`); `exceeded` gdy `spent > limit`. Przykład dla limitu 100,00 zł: 79,99 → `none`, 80,00 → `near`, 99,99 → `near`, 100,00 → `reached`, 100,01 → `exceeded`.
- **Częściowy zapis pozycji kategorii:** pole pominięte = bez zmian, `monthlyLimit: null` = usuń limit, `duplicateThreshold` nadal nie przyjmuje `null`. Pozycja bez żadnego z dwóch pól to 400. Upsert nowego wiersza z samym limitem zostawia `duplicate_threshold` jako null.

## Phase 1: Backend: limity i alerty w sumach

### Overview

Kolumny limitów, reguła alertu, nowe pola w `/subscriptions/totals` i w `/budget`, testy unit i e2e.

### Changes Required:

#### 1. Schemat

**File**: `backend-subtracker/src/subscriptions/entities/budget-settings.entity.ts`, `entities/category-setting.entity.ts`, `src/database/migrations/<ts>-BudgetLimits.ts` (wygenerowana)

**Intent**: Miejsce na limit całościowy i limity kategorii oraz próg kategorii, który może podążać za domyślnym mimo istnienia wiersza.

**Contract**:
- `budget_settings.monthly_limit numeric(10,2) NULL`, `category_setting.monthly_limit numeric(10,2) NULL`; w encjach `string | null`.
- `category_setting.duplicate_threshold` nullable, bez wartości domyślnej w kolumnie; `thresholdOf` traktuje null jak brak wiersza.
- Kopia przy utworzeniu własnej kategorii i backfill S-07 bez zmian (zapisują wartość).
- `npm run migration:generate -- BudgetLimits`, przegląd, `migration:run`. Nullable kolumny nie potrzebują backfillu.

#### 2. Reguła alertu

**File**: `backend-subtracker/src/subscriptions/budget-alert.ts` (nowy, z `budget-alert.spec.ts`)

**Intent**: Jedno miejsce z regułą 80/100, użyte przez `costTotals()`.

**Contract**: `enum BudgetAlert { NONE = 'none', NEAR = 'near', REACHED = 'reached', EXCEEDED = 'exceeded' }`, stała `BUDGET_ALERT_NEAR_PERCENT = 80`, `budgetAlert(spentGrosze: number, limitGrosze: number | null): BudgetAlert` wg „Critical Implementation Details”.

#### 3. Sumy z limitami

**File**: `backend-subtracker/src/subscriptions/cost-totals.ts`, `subscription.types.ts`, `services/subscriptions.service.ts`, `services/budget.service.ts`

**Intent**: `/totals` zwraca limity i alerty liczone przy odczycie.

**Contract**:
- `costTotals(rows, settings)`: drugi argument rozszerza dzisiejsze `DuplicateThresholds` o limit całościowy i mapę limitów kategorii (jeden obiekt „ustawienia budżetu użytkownika”, pobierany jednym odczytem obu tabel jak dziś progi).
- `CostTotalsResponse` dostaje `monthlyLimit: string | null` i `budgetAlert: BudgetAlert`; `CategoryCostTotal` dostaje `monthlyLimit: string | null` i `budgetAlert: BudgetAlert`. Kolejność i sumy bez zmian.

#### 4. `GET` / `PUT /budget`

**File**: `backend-subtracker/src/subscriptions/dtos/update-budget.dto.ts` (z `.spec.ts`), `services/budget.service.ts`, `subscription.types.ts`

**Intent**: Odczyt i zapis limitów na tej samej stronie i w tym samym atomowym zapisie co progi.

**Contract**:
- `BudgetResponse` dostaje `monthlyLimit: string | null`, a `CategoryBudget` dostaje `monthlyLimit: string | null`.
- `UpdateBudgetDto`: `monthlyLimit?: number | null` (`@IsNumber({ maxDecimalPlaces: 2 })`, `@Min(0)`, `@Max(AMOUNT_MAX)`, null dozwolony); co najmniej jedno z `defaultDuplicateThreshold`, `monthlyLimit`, `categories`.
- `CategoryBudgetDto`: `duplicateThreshold?` (int 0–99, bez null), `monthlyLimit?: number | null`; co najmniej jedno z dwóch.
- Walidator kwoty wydzielony do `src/shared/validation/` (np. `IsAmount`), jeśli używany w dwóch DTO (lessons.md, „Kod ogólny w `shared/`”); `create-subscription.dto.ts` może z niego skorzystać.
- Zapis: upsert tylko podanych pól; pozostała atomowość i 400 dla cudzej lub nieznanej kategorii bez zmian. Kwota zapisana przez `toFixed(2)`.

#### 5. Testy backendu

**File**: `budget-alert.spec.ts`, `cost-totals.spec.ts`, `dtos/update-budget.dto.spec.ts`, `test/subscriptions/budget.e2e-spec.ts`, `test/subscriptions/cost-totals.e2e-spec.ts`, `test/subscriptions/account-isolation.e2e-spec.ts`

**Intent**: Granice reguły i kontrakt API według test-plan §6.3–6.4, ryzyka #1 i #4.

**Contract**:
- Unit `it.each` (spent, limit) w groszach → stan: (0, null) none, (5000, null) none, (0, 0) none, (1, 0) exceeded, (7999, 10000) none, (8000, 10000) near, (9999, 10000) near, (10000, 10000) reached, (10001, 10000) exceeded, (0, 10000) none.
- `costTotals`: limit całościowy porównany z sumą miesięczną, w której roczna subskrypcja wchodzi jako /12 zaokrąglone per subskrypcja (przypadek z resztą z dzielenia przez 12 na granicy 80%).
- DTO: `monthlyLimit` -1, 100000, 1.001, `"10"` → błąd; 0, 99999.99, null → poprawne; pozycja kategorii bez pól → błąd; sam `monthlyLimit` w pozycji → poprawne.
- E2E:
  - nowy użytkownik: `monthlyLimit` null wszędzie, `budgetAlert` none;
  - PUT limitu całościowego, potem `/totals` pokazuje near / reached / exceeded przy odpowiednich subskrypcjach;
  - limit kategorii z samym limitem nie zmienia jej progu duplikatów (kategoria domyślna dalej podąża za domyślnym progiem);
  - `monthlyLimit: null` usuwa limit;
  - dwa konta: B nie widzi i nie zmienia limitów A, a PUT z kategorią A daje 400;
  - `EXPECTED_ROUTES` bez zmian.

### Success Criteria:

#### Automated Verification:

- Migracja wygenerowana i zastosowana na `subtracker-db`: `npm run migration:run`, a `npm run migration:generate -- Check` kończy się „No changes in database schema were found” (z `backend-subtracker/`)
- Lint backendu przechodzi: `npm run lint`
- Build backendu przechodzi: `npm run build`
- Testy unit backendu przechodzą: `npm test`
- Testy e2e API przechodzą: `npm run test:e2e`

#### Manual Verification:

- Przegląd migracji: dwie kolumny `numeric(10,2) NULL`, `duplicate_threshold` nullable, bez zmian kluczy i indeksów
- `GET /budget` i `GET /subscriptions/totals` na `subtracker-db-dev` po `PUT /budget` z limitem zwracają nowe pola z oczekiwanymi wartościami

**Implementation Note**: Po zakończeniu fazy i przejściu weryfikacji automatycznej zatrzymaj się i poczekaj, aż człowiek potwierdzi weryfikację ręczną.

---

## Phase 2: Frontend: limit w kolumnie sum

### Overview

Pasek wykorzystania limitu całościowego, limit i alert w wierszu kategorii, wspólna ikona na „Kategoriach”.

### Changes Required:

#### 1. Typy, tokeny i reguły pomocnicze

**File**: `frontend-subtracker/src/app/subscriptions/subscription.types.ts`, `src/styles/_theme.scss`, `subscriptions/budget-alert.ts` (nowy, z `.spec.ts`), `subscriptions/subscription-labels.ts`, `subscriptions/duplicate-warning.ts`

**Intent**: Lustro kontraktu `/totals`, kolor paska i jedno miejsce mapowania obu rodzajów alertów na poziom ikony.

**Contract**:
- `BudgetAlert` i nowe pola `monthlyLimit`/`budgetAlert` w `CostTotalsResponse` i `CategoryCostTotal`.
- Token `--st-lime` (`#D6F25E`) dla paska limitu.
- Poziom ikony: `near` → poziom pomarańczowy, `reached`/`exceeded` → czerwony; najpoważniejszy stan kategorii liczony z duplikatów i limitów razem (rozszerzenie `mostSevereDuplicateWarning` albo nowa funkcja obok, ikona dalej przyjmuje poziom pomarańczowy/czerwony).
- Etykiety: „Zbliżasz się do limitu”, „Wykorzystano limit”, „Przekroczono limit”; tekst wykorzystania „X z Y zł (N%)” (procent zaokrąglony w dół, żeby 99,9% nie pokazało się jako 100%); podsumowanie dla czytników łączy liczby kategorii z alertami duplikatów i limitów.

#### 2. Kolumna sum

**File**: `frontend-subtracker/src/app/subscriptions/cost-totals/cost-totals.{ts,html,scss,spec.ts}`

**Intent**: Limit widoczny bez rozwijania (pasek pod sumą), limit kategorii po rozwinięciu.

**Contract**:
- Gdy `monthlyLimit` nie jest null: pod sumą miesięczną pasek (`role="progressbar"` albo `<meter>` z wartością i etykietą), wypełnienie do 100% maksymalnie, kolor limetka / `--st-alert-warning` / `--st-alert-danger` (na granacie wariant `-on-navy`), tekst „X z Y zł (N%)” i ikona przy alercie. Bez limitu brak paska i tekstu.
- Wiersz kategorii z limitem: linia „Limit: X z Y zł”; przy alercie obrys w kolorze najpoważniejszego stanu wiersza i opis limitu (obok opisu duplikatów, jeśli oba).
- Ikona na zwiniętych „Kategoriach”: najpoważniejszy stan z obu rodzajów alertów.
- Kolor nie jest jedyną informacją: tekst stanu słowami.

### Success Criteria:

#### Automated Verification:

- Testy frontendu przechodzą w obu strefach: `npm run test:ci` (z `frontend-subtracker/`)
- Build produkcyjny przechodzi (AOT, budżet stylów): `npm run build`

#### Manual Verification:

- Na desktopie i telefonie pasek limitu pod sumą jest czytelny na granacie w trzech kolorach (poniżej 80%, 80–99%, ≥100%), a bez limitu go nie ma
- Rozwinięty wiersz kategorii z limitem pokazuje „Limit: …” i alert; kategoria z oboma alertami ma jeden obrys i dwa opisy

**Implementation Note**: Po zakończeniu fazy i przejściu weryfikacji automatycznej zatrzymaj się i poczekaj, aż człowiek potwierdzi weryfikację ręczną.

---

## Phase 3: Frontend: `/budget` i `/dashboard`

### Overview

Ustawianie limitów na `/budget` i pełny obraz limitów na `/dashboard`.

### Changes Required:

#### 1. Serwis i typy budżetu

**File**: `frontend-subtracker/src/app/budget/budget.types.ts`, `budget/budget.service.ts`

**Intent**: Lustro rozszerzonego `GET`/`PUT /budget`.

**Contract**: `monthlyLimit: string | null` w odpowiedzi (korzeń i kategoria), `monthlyLimit?: number | null` w żądaniu, `duplicateThreshold?` w pozycji kategorii.

#### 2. Strona `/budget`

**File**: `frontend-subtracker/src/app/pages/budget/budget.{ts,html,scss,spec.ts}`

**Intent**: Użytkownik ustawia limit całościowy i limity kategorii w tym samym formularzu i jednym zapisie co progi.

**Contract**:
- Pole „Miesięczny limit całościowy” (kwota, puste = brak limitu) przy polu domyślnego progu.
- Przy każdej kategorii obok progu pole „Limit miesięczny” (puste = brak). Walidacja: kwota 0–99 999,99 zł z dwoma miejscami, wspólny `amountValidator`, komunikat przez `mat-error`.
- Zapis tylko zmian jak dziś: zmieniony limit wysyła liczbę, wyczyszczony `null`, niezmieniony nie trafia do żądania; pozycja kategorii zawiera tylko zmienione pola.
- Podpowiedź (nie błąd), gdy suma wpisanych limitów kategorii przekracza limit całościowy: „Suma limitów kategorii (X zł) przekracza limit całościowy (Y zł).”
- Na telefonie dalej jedna kolumna.

#### 3. Strona `/dashboard`

**File**: `frontend-subtracker/src/app/pages/dashboard/dashboard.{ts,html,scss,spec.ts}`

**Intent**: Pełne podsumowanie limitów obok progów.

**Contract**:
- Przy sumach limit całościowy z paskiem i tekstem jak w kolumnie (jasne tło, jasne tokeny), bez limitu „Brak limitu” z linkiem do `/budget`.
- Tabela i karty: kolumny „Limit” (kwota albo „—”) i „Limit — status” (ikona i opis, dla `none` z limitem „W normie”).

#### 4. Testy stron

**File**: `pages/budget/budget.spec.ts`, `pages/dashboard/dashboard.spec.ts`

**Intent**: Ryzyko #7 i kontrakt prośby (test-plan §6.2).

**Contract**:
- Budżet: pola limitu znalezione harnessem po etykiecie; 100000 i -1 dają `hasErrors()` i brak prośby; wyczyszczony limit wysyła `null`; zmiana samego limitu kategorii wysyła pozycję bez `duplicateThreshold`; podpowiedź sumy pojawia się i znika.
- Dashboard: wiersz z `exceeded` limitu ma znacznik stanu; bez limitu całościowego brak paska.

### Success Criteria:

#### Automated Verification:

- Testy frontendu przechodzą w obu strefach: `npm run test:ci`
- Build produkcyjny przechodzi: `npm run build`
- Testy e2e przechodzą na buildzie e2e: `npm run build:e2e && npm run e2e`

#### Manual Verification:

- Na `/budget` ustawienie limitu całościowego poniżej sumy miesięcznej zmienia pasek w kolumnie na czerwony bez przeładowania strony; wyczyszczenie limitu usuwa pasek
- Limit kategorii ustawiony na `/budget` widać w rozwiniętym wierszu i na `/dashboard`; podpowiedź o sumie limitów pojawia się, gdy suma przekracza limit całościowy
- `/dashboard` na desktopie i telefonie pokazuje limit całościowy z paskiem oraz kolumny limitu

**Implementation Note**: Po zakończeniu fazy i przejściu weryfikacji automatycznej zatrzymaj się i poczekaj, aż człowiek potwierdzi weryfikację ręczną.

---

## Phase 4: Dokumentacja i weryfikacja

### Overview

Zapis reguł S-08 w dokumentach projektu.

### Changes Required:

#### 1. Dokumenty projektu

**File**: `context/foundation/backend-patterns.md`, `CLAUDE.md`, `context/foundation/roadmap.md`, `context/foundation/test-plan.md` (§6, jeśli wzorzec testu się zmienił)

**Intent**: Utrwalić decyzje S-08.

**Contract**:
- `backend-patterns.md`, „Ustawienia budżetu”: kolumny limitów (null = brak), nullable `duplicate_threshold`, reguła `budgetAlert` z granicami i regułą 0 zł, częściowy zapis pozycji kategorii (pominięte = bez zmian, `null` = usuń limit).
- `CLAUDE.md`: `/budget` obsługuje też limity.
- Roadmapa, notatka przy S-08: granice ≥80 / ≥100, limit 0 dozwolony, kategorie bez wydatków tylko na `/budget`, suma limitów kategorii bez blokady.

### Success Criteria:

#### Automated Verification:

- Formatowanie kodu bez zmian treści po prettierze: `npm run format` w `backend-subtracker/` nie zmienia treści plików

#### Manual Verification:

- Dokumenty opisują reguły zgodnie z kodem (przegląd przy `/10x-impl-review`)

**Implementation Note**: Po zakończeniu fazy i przejściu weryfikacji automatycznej zatrzymaj się i poczekaj, aż człowiek potwierdzi weryfikację ręczną.

---

## Testing Strategy

### Unit Tests:

- `budgetAlert` na granicach 80/100, limit 0, brak limitu, wydatki 0 zł.
- `costTotals` z limitami: suma z subskrypcją roczną (reszta z dzielenia przez 12) na granicy 80%.
- DTO `/budget`: zakres i format kwoty, `null`, puste pozycje.
- Frontend: mapowanie stanów na poziom ikony, tekst wykorzystania (procent w dół), podsumowanie dla czytników.

### Integration Tests:

- API e2e: zapis i odczyt limitów, alerty w `/totals`, usunięcie limitu, limit bez zmiany progu, dwa konta.
- Testy komponentów: kolumna (pasek, wiersz, ikona), `/budget` (pola, walidacja, treść prośby), `/dashboard`.

### Manual Testing Steps:

1. `test-session.mjs create` i `seed`, potem na `/budget` limit całościowy np. 10 zł poniżej sumy miesięcznej → czerwony pasek w kolumnie.
2. Limit całościowy tak, żeby wykorzystanie wyniosło 80–99% → pomarańczowy; wyczyszczenie → brak paska.
3. Limit kategorii Streaming poniżej jej sumy → alert w rozwiniętym wierszu i na `/dashboard`; ikona na „Kategoriach” czerwona.
4. Suma limitów kategorii powyżej limitu całościowego → podpowiedź na `/budget`.

## Performance Considerations

`/totals` czyta już ustawienia obu tabel jednym zestawem zapytań (S-07). Limity to dodatkowe kolumny w tych samych wierszach, bez nowych zapytań.

## Migration Notes

Nowe kolumny są nullable, więc migracja nie wymaga backfillu ani okna na danych. `duplicate_threshold DROP NOT NULL` nie zmienia istniejących wartości. Bazę dev zaktualizuje `synchronize`.

## References

- Research: `context/changes/budget-limits-and-alerts/research.md` (sprzed S-07; miejsce na limity i strona `/budget` są już rozstrzygnięte przez S-07)
- S-07: `context/archive/2026-11-17-category-duplicate-warning/plan.md`, `context/foundation/backend-patterns.md` („Ustawienia budżetu”)
- Makieta paska: `frontend-subtracker/src/app/pages/home/home.html:137-153`
- PRD: FR-010, FR-011, FR-005 (`context/foundation/prd.md:70,86,88`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend: limity i alerty w sumach

#### Automated

- [x] 1.1 Migracja wygenerowana i zastosowana na `subtracker-db`: `npm run migration:run`, a `npm run migration:generate -- Check` kończy się „No changes in database schema were found” (z `backend-subtracker/`) — 198e870
- [x] 1.2 Lint backendu przechodzi: `npm run lint` — 198e870
- [x] 1.3 Build backendu przechodzi: `npm run build` — 198e870
- [x] 1.4 Testy unit backendu przechodzą: `npm test` — 198e870
- [x] 1.5 Testy e2e API przechodzą: `npm run test:e2e` — 198e870

#### Manual

- [x] 1.6 Przegląd migracji: dwie kolumny `numeric(10,2) NULL`, `duplicate_threshold` nullable, bez zmian kluczy i indeksów — 198e870
- [x] 1.7 `GET /budget` i `GET /subscriptions/totals` na `subtracker-db-dev` po `PUT /budget` z limitem zwracają nowe pola z oczekiwanymi wartościami — 198e870

### Phase 2: Frontend: limit w kolumnie sum

#### Automated

- [x] 2.1 Testy frontendu przechodzą w obu strefach: `npm run test:ci` (z `frontend-subtracker/`) — e632db9
- [x] 2.2 Build produkcyjny przechodzi (AOT, budżet stylów): `npm run build` — e632db9

#### Manual

- [x] 2.3 Na desktopie i telefonie pasek limitu pod sumą jest czytelny na granacie w trzech kolorach (poniżej 80%, 80–99%, ≥100%), a bez limitu go nie ma — e632db9
- [x] 2.4 Rozwinięty wiersz kategorii z limitem pokazuje „Limit: …” i alert; kategoria z oboma alertami ma jeden obrys i dwa opisy — e632db9

### Phase 3: Frontend: `/budget` i `/dashboard`

#### Automated

- [x] 3.1 Testy frontendu przechodzą w obu strefach: `npm run test:ci` — 89e89a5
- [x] 3.2 Build produkcyjny przechodzi: `npm run build` — 89e89a5
- [x] 3.3 Testy e2e przechodzą na buildzie e2e: `npm run build:e2e && npm run e2e` — 89e89a5

#### Manual

- [x] 3.4 Na `/budget` ustawienie limitu całościowego poniżej sumy miesięcznej zmienia pasek w kolumnie na czerwony bez przeładowania strony; wyczyszczenie limitu usuwa pasek — 89e89a5
- [x] 3.5 Limit kategorii ustawiony na `/budget` widać w rozwiniętym wierszu i na `/dashboard`; podpowiedź o sumie limitów pojawia się, gdy suma przekracza limit całościowy — 89e89a5
- [x] 3.6 `/dashboard` na desktopie i telefonie pokazuje limit całościowy z paskiem oraz kolumny limitu — 89e89a5

### Phase 4: Dokumentacja i weryfikacja

#### Automated

- [x] 4.1 Formatowanie kodu bez zmian treści po prettierze: `npm run format` w `backend-subtracker/` nie zmienia treści plików — 0becc81

#### Manual

- [x] 4.2 Dokumenty opisują reguły zgodnie z kodem (przegląd przy `/10x-impl-review`) — cec2c9d
