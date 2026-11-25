# Zmiana nazwy i usuwanie własnych kategorii — plan implementacji

## Overview

Użytkownik zmienia nazwę własnej kategorii w dialogu albo usuwa ją, jeśli nie ma w niej subskrypcji. Akcje są ikonami w wierszu kategorii na `/budget` i są wyłączone, dopóki formularz progów i limitów ma niezapisane zmiany. Kategorie predefiniowane nie mają akcji, a API ich nie zmienia. Usunięcie zdejmuje w tej samej transakcji próg i limit kategorii (`category_setting`), a próba usunięcia niepustej kończy się czytelnym komunikatem (409), nie błędem serwera. Przy okazji wyścig „kategoria znika w trakcie zapisu subskrypcji albo budżetu” daje 400 zamiast 500.

Plan realizuje PRD v2 FR-025 (z FR-009, FR-010) i roadmapę S-17.

## Current State Analysis

Pełne kotwice: `context/changes/own-category-rename-and-delete/research.md`. Ścieżki API względne do `backend-subtracker/src/subscriptions/`, frontendu do `frontend-subtracker/src/app/`.

- **Model**: `entities/category.entity.ts` — predefiniowane `user_id NULL` (9, `default-categories.ts:4-18`), własne z `user_id`; `name` varchar(50), `name_key` = `toNameKey(name)` zapisywany razem z nazwą; indeks `UQ_category_owner_name_key` na `(COALESCE(user_id, zero), name_key)` — nie blokuje nazwy własnej równej predefiniowanej, robi to wyszukanie w serwisie.
- **FK `NO ACTION`**: `subscription.category_id` (`FK_e7ddc1213ce93c60338e6da254d`) i `category_setting.category_id` (`FK_228db5ea674f274f52ee203d326`). Każda własna kategoria ma wiersz `category_setting`.
- **API**: tylko `GET`/`POST /categories` (`controllers/categories.controller.ts:20-34`); tworzenie: wyszukanie konfliktu po `nameKey` wśród własnych i predefiniowanych → 409, wyścig `isUniqueViolation(…, CATEGORY_OWNER_NAME_INDEX)` → 409 (`services/categories.service.ts:55-95`). Brak wyszukania „tylko własna”. Brak helpera 23503.
- **Wyścig**: `usableCategory` w `services/subscriptions.service.ts:237-248` i `allUsable` w `services/budget.service.ts:106-110` sprawdzają kategorię poza transakcją; kategoria usunięta między sprawdzeniem a zapisem daje dziś 23503 → 500.
- **Frontend**: `/budget` (`pages/budget/`) ma formularz reaktywny z wierszem na każdą kategorię (siatka `minmax(0,1fr) 140px 200px`), przycisk „Zapisz” wyłączony przy `changes() === null` (`budget.ts:194`, `budget.html:115`), przebudowę z `GET /budget` przy wczytaniu (`budget.ts:270-284`). Klient kategorii: `subscriptions/subscriptions.service.ts:55-59` (tylko lista i tworzenie). `Category.isDefault` istnieje (`subscriptions/subscription.types.ts:24-28`), nikt go nie czyta. Wzorzec dialogu usuwania: `subscriptions/delete-subscription-dialog/`.

## Desired End State

- **`PATCH /categories/:id`** `{ name }` (`@TrimmedString(50)`): 200 `{ id, name, isDefault: false }`; 409 bez treści, gdy `toNameKey(name)` zajmuje inna kategoria własna użytkownika albo predefiniowana (własne id pominięte, więc zmiana samej wielkości liter przechodzi); 404 `Category not found` dla nieznanego id, cudzej i predefiniowanej; 400 dla id nie-UUID i złej nazwy. Próg i limit kategorii zostają.
- **`DELETE /categories/:id`**: 204; w jednej transakcji: `SELECT … FOR UPDATE` własnej kategorii (brak → 404), istnieje subskrypcja → 409 `The category has subscriptions`, usunięcie wiersza `category_setting`, usunięcie kategorii; `23503` na którymkolwiek z dwóch FK → ten sam 409.
- **Wyścig**: `23503` na `FK_e7ddc…` przy tworzeniu/edycji subskrypcji → ten sam 400 co dziś (`categoryId does not name a usable category`); na `FK_228db…` w `PUT /budget` → ten sam 400 (`categories must name only usable categories`).
- **`/budget`**: przy nazwie własnej kategorii dwa `mat-icon-button` 32 px: „Zmień nazwę kategorii <nazwa>” (✎) i „Usuń kategorię <nazwa>” (🗑), z `matTooltip`; predefiniowane bez ikon. Gdy `changes() !== null`, ikony są `disabledInteractive` z podpowiedzią „Najpierw zapisz albo cofnij zmiany progów i limitów.”.
- **Dialog zmiany nazwy**: pole „Nazwa kategorii” z bieżącą nazwą, maks. 50, „Anuluj” / „Zapisz” (wyłączony, gdy nazwa po przycięciu pusta albo niezmieniona); 409 → błąd pola „Taka kategoria już istnieje.”; 404 → zamknięcie z wynikiem `missing`; inny błąd → `st-notice--error` w dialogu.
- **Dialog usuwania**: „Usunąć kategorię <nazwa>?” z informacją, że jej próg i limit też znikną; 409 → komunikat w dialogu „Ta kategoria ma subskrypcje. Przenieś je do innej kategorii albo usuń, a potem usuń kategorię.” (przycisk „Usuń” wyłączony po tym komunikacie); 404 → wynik `missing`; inny błąd → `st-notice--error`.
- **Po sukcesie lub `missing`**: `/budget` przeładowany z `GET /budget`, `totals.refresh()`, komunikat w istniejącym `role="status"` („Zmieniono nazwę kategorii.”, „Usunięto kategorię.”, „Kategoria już nie istnieje.”), fokus na nagłówku sekcji kategorii.
- **Widok** sprawdzony w trzech zakresach (telefon < 840 px, 840–950 px, pełny desktop) z 50-znakową nazwą (`lessons.md`).
- **Testy**: e2e API (zmiana nazwy, konflikt, wielkość liter, izolacja, predefiniowana, usuwanie pustej i niepustej, wyścig 23503), testy jednostkowe helpera, serwisów i komponentów, e2e przeglądarki.
- **Dokumenty**: `backend-patterns.md` („Dane domenowe”), `CLAUDE.md` (lista tras `subscriptions/`), PRD FR-009 z domyślnym progiem 3 (już naniesione, commit z tą zmianą).

### Key Discoveries:

- Wiersz `category_setting` istnieje dla każdej własnej kategorii (`categories.service.ts:80-84`, backfill `1794951132638-BackfillOwnCategorySettings.ts`), więc bez jego usunięcia FK zablokuje usunięcie kategorii.
- Kolejność INSERT subskrypcji przed DELETE kategorii (READ COMMITTED, FK bierze `FOR KEY SHARE` na kategorii) kończy DELETE błędem 23503 → 409; odwrotna kolejność kończy INSERT/UPDATE subskrypcji albo upsert `category_setting` błędem 23503 → 400.
- Własne kategorie są sortowane w JS (`localeCompare(…, 'pl')`, `categories.service.ts:36-51`), więc zmiana nazwy nie wymaga `POLISH_COLLATION`.
- Odmowy 404/409 nie dostają `withDenial` (`backend-patterns.md`, „Logi błędów i odmów”).

## What We're NOT Doing

- Przenoszenie subskrypcji przy usuwaniu kategorii ani usuwanie kategorii razem z subskrypcjami (PRD Open Question #1: tylko pusta).
- Zmiana nazwy albo usunięcie kategorii predefiniowanych, także przez admina.
- Akcje kategorii w formularzu subskrypcji, na dashboardzie, w granatowej kolumnie i na liście subskrypcji.
- Osobna strona kategorii.
- Zachowywanie niezapisanych progów przy zmianie nazwy/usunięciu (akcje są wyłączone przy niezapisanych zmianach).
- Zmiana FK na `CASCADE` (bez migracji; jawne usunięcie w transakcji).
- Zmiana domyślnego progu w kodzie (zostaje 3; PRD wyrównany do kodu).
- Pliki S-14 (logi, `server.ts`, `/health`), które zmienia równoległa gałąź.

## Implementation Approach

Najpierw API z pełnym kontraktem i testami, potem UI na gotowych trasach, na końcu dokumenty i produkcja. Bez zmian schematu bazy. Ogólny helper błędu FK w `src/shared/database/` (`lessons.md`), logika domeny w module `subscriptions`.

## Critical Implementation Details

- **Nazwy FK jako stałe.** Nazwy `FK_e7ddc1213ce93c60338e6da254d` i `FK_228db5ea674f274f52ee203d326` pochodzą z migracji (`1794406389791-SubscriptionsSchema.ts`, `1794927874576-CategorySetting.ts:17`); trzymać je jako eksportowane stałe obok encji (jak `CATEGORY_OWNER_NAME_INDEX`) i przypiąć testem e2e, który wywołuje prawdziwy 23503 na każdym FK (pozwala wykryć rozjazd nazwy w CI na bazie z migracji).
- **Kolejność w transakcji usuwania**: blokada wiersza kategorii przed sprawdzeniem subskrypcji, żeby równoległe żądanie zmiany nazwy/usunięcia czekało; usunięcie `category_setting` przed `category`.

## Phase 1: API kategorii

### Overview

Trasy zmiany nazwy i usuwania własnej kategorii oraz mapowanie wyścigu 23503.

### Changes Required:

#### 1. Helper błędu FK

**File**: `backend-subtracker/src/shared/database/foreign-key-violation.ts` (+ `foreign-key-violation.spec.ts`)

**Intent**: Rozpoznanie naruszenia klucza obcego o danej nazwie, wzorem `unique-violation.ts`.

**Contract**: `isForeignKeyViolation(error: unknown, constraint: string): boolean` — `QueryFailedError` z `driverError.code === '23503'` i `driverError.constraint === constraint`; testy: zgodny, inna nazwa, 23505, zwykły `Error`, wartość niebędąca błędem.

#### 2. Stałe FK

**File**: `backend-subtracker/src/subscriptions/entities/subscription.entity.ts`, `backend-subtracker/src/subscriptions/entities/category-setting.entity.ts`

**Intent**: Jedno źródło nazw ograniczeń używanych w mapowaniu.

**Contract**: `export const SUBSCRIPTION_CATEGORY_FK = 'FK_e7ddc1213ce93c60338e6da254d'`, `export const CATEGORY_SETTING_CATEGORY_FK = 'FK_228db5ea674f274f52ee203d326'` (sprawdzone w `1794406389791-SubscriptionsSchema.ts` i `1794927874576-CategorySetting.ts`).

#### 3. Serwis i kontroler kategorii

**File**: `backend-subtracker/src/subscriptions/services/categories.service.ts`, `backend-subtracker/src/subscriptions/controllers/categories.controller.ts`, `backend-subtracker/src/subscriptions/dtos/rename-category.dto.ts` (nowy), `backend-subtracker/src/subscriptions/subscription.types.ts` (jeśli potrzebny typ)

**Intent**: Zmiana nazwy i usunięcie własnej kategorii zgodnie z Desired End State.

**Contract**:
- `@Patch(':id')` z `ParseUUIDPipe` i `RenameCategoryDto { @TrimmedString(CATEGORY_NAME_MAX_LENGTH) name }` → `rename(userId, id, name): Promise<CategoryResponse>`:
  - konflikt: kategoria predefiniowana albo własna tego użytkownika z tym samym `nameKey` i `id <> :id` → `ConflictException()`;
  - `update({ id, userId }, { name, nameKey })` → `affected === 0` → `NotFoundException('Category not found')` (predefiniowana ma `userId NULL`, więc też 404);
  - `isUniqueViolation(…, CATEGORY_OWNER_NAME_INDEX)` → 409;
- `@Delete(':id')`, `@HttpCode(204)`, `ParseUUIDPipe` → `remove(userId, id): Promise<void>` w `manager.transaction`:
  1. `findOne({ where: { id, userId }, lock: { mode: 'pessimistic_write' } })` → brak → 404;
  2. `manager.exists(Subscription, { where: { categoryId: id } })` → `ConflictException('The category has subscriptions')`;
  3. `delete(CategorySetting, { userId, categoryId: id })`;
  4. `delete(Category, { id, userId })`;
  - `isForeignKeyViolation` na `SUBSCRIPTION_CATEGORY_FK` albo `CATEGORY_SETTING_CATEGORY_FK` → ten sam 409;
- odpowiedzi bez `withDenial`.

#### 4. Wyścig w subskrypcjach i budżecie

**File**: `backend-subtracker/src/subscriptions/services/subscriptions.service.ts`, `backend-subtracker/src/subscriptions/services/budget.service.ts`

**Intent**: Kategoria usunięta między sprawdzeniem a zapisem daje 400 jak nieużywalna, nie 500.

**Contract**: zapis subskrypcji (tworzenie `save`, edycja `update`) łapie `isForeignKeyViolation(error, SUBSCRIPTION_CATEGORY_FK)` → `BadRequestException('categoryId does not name a usable category')`; transakcja `PUT /budget` łapie `isForeignKeyViolation(error, CATEGORY_SETTING_CATEGORY_FK)` → `BadRequestException('categories must name only usable categories')`; pozostałe błędy bez zmian.

#### 5. Testy e2e API

**File**: `backend-subtracker/test/subscriptions/categories.e2e-spec.ts`, `backend-subtracker/test/subscriptions/subscriptions-e2e.ts` (pomocniki `patchCategory`, `deleteCategory`), `backend-subtracker/test/subscriptions/account-isolation.e2e-spec.ts`

**Intent**: Przypiąć kontrakt i przypadki brzegowe.

**Contract**:
- zmiana nazwy: 200 i nowa nazwa na `GET /categories` (kolejność własnych alfabetyczna z polskimi literami); „praca” → „Praca” przechodzi; nazwa innej własnej i predefiniowanej w dowolnej wielkości liter → 409; predefiniowana i cudza → 404; pusta i 51-znakowa → 400; próg i limit kategorii na `GET /budget` bez zmian po zmianie nazwy;
- usunięcie: pusta → 204, znika z `GET /categories` i `GET /budget`, brak wiersza `category_setting`; z subskrypcją → 409 z `The category has subscriptions` i subskrypcja nietknięta; drugi `DELETE` → 404; predefiniowana i cudza → 404; nie-UUID → 400;
- wyścig: subskrypcja z `categoryId` kategorii usuniętej bezpośrednio w bazie po sprawdzeniu (spy na `CategoriesService.prototype.findUsable` zwracający kategorię) → 400; `PUT /budget` z `allUsable` podmienionym na `true` i kategorią nieistniejącą → 400; `DELETE` przy istniejącej subskrypcji z krokiem 2 pominiętym (`vi.spyOn(EntityManager.prototype, 'exists').mockResolvedValueOnce(false)`) → 409 przez 23503 na `SUBSCRIPTION_CATEGORY_FK`.

#### 6. Pliki planowania poza folderem zmiany

**File**: `context/foundation/prd.md`, `context/foundation/roadmap.md`

**Intent**: Zmiany naniesione podczas planowania (FR-009 „domyślnie: 3”, S-17 → `planning`/`in-progress`) trafiają do commita fazy 1, a nie zostają brudne w drzewie.

**Contract**: oba pliki dopisane do zbioru plików fazy 1 przy stagingu; bez innych edycji.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe kategorii i helpera: `cd backend-subtracker && npx vitest run src/shared/database src/subscriptions`
- E2E kategorii: `cd backend-subtracker && npx vitest run --config ./vitest.config.e2e.ts test/subscriptions`
- Celowe uszkodzenie: usunięcie kroku z `category_setting` albo brak pominięcia własnego id przy konflikcie czerwieni test
- Pełne testy backendu: `cd backend-subtracker && npm test`
- Testy e2e backendu: `cd backend-subtracker && npm run test:e2e`
- Lint i build backendu: `cd backend-subtracker && npm run lint && npm run build`

#### Manual Verification:

- Lokalnie `curl` z sesją z `dev-local/test-session.mjs`: `PATCH` i `DELETE` własnej kategorii działają, `DELETE` kategorii z subskrypcją zwraca 409 z komunikatem

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 2.

---

## Phase 2: UI na `/budget`

### Overview

Ikony przy własnych kategoriach na `/budget` z dialogami zmiany nazwy i usuwania.

### Changes Required:

#### 1. Klient

**File**: `frontend-subtracker/src/app/subscriptions/subscriptions.service.ts` (+ spec)

**Intent**: Wywołania nowych tras.

**Contract**: `renameCategory(id: string, name: string): Observable<Category>` (`PATCH /categories/:id`), `deleteCategory(id: string): Observable<void>` (`DELETE /categories/:id`).

#### 2. Dialogi

**File**: `frontend-subtracker/src/app/pages/budget/rename-category-dialog/` (nowy: `.ts`, `.html`, `.scss`, `.spec.ts`), `frontend-subtracker/src/app/pages/budget/delete-category-dialog/` (nowy, jak wyżej)

**Intent**: Zmiana nazwy i usunięcie z obsługą 409/404, wzorem `subscriptions/delete-subscription-dialog/`.

**Contract**:
- funkcje `openRenameCategoryDialog(dialog, category)` → `'renamed' | 'missing' | undefined`, `openDeleteCategoryDialog(dialog, category)` → `'deleted' | 'missing' | undefined`; ustawienia jak w dialogu usuwania subskrypcji (`role: 'alertdialog'` tylko dla usuwania, `autoFocus: 'first-tabbable'`, 480 px, `maxWidth: calc(100vw - 32px)`); dialog sam wysyła żądanie i ma `disableClose` w trakcie;
- teksty i zachowanie z Desired End State; przyciski: „Anuluj” `mat-stroked-button` pierwszy, „Zapisz”/„Usuń” `mat-flat-button disabledInteractive`;
- spec każdego dialogu: sukces, 409, 404, inny błąd, przycięcie nazwy, przycisk wyłączony przy niezmienionej nazwie.

#### 3. Strona `/budget`

**File**: `frontend-subtracker/src/app/pages/budget/budget.ts`, `budget.html`, `budget.scss`, `budget.spec.ts`

**Intent**: Akcje przy własnych kategoriach, zablokowane przy niezapisanych zmianach.

**Contract**:
- wiersz kategorii bierze `isDefault` z `CategoryBudget.category` w odpowiedzi `GET /budget` (`budget/budget.types.ts:10-15`; API zwraca pełny `CategoryResponse`, `budget.service.ts:90-94`) — bez nowego pola i bez dodatkowego zapytania;
- przy własnej kategorii w kolumnie nazwy dwa `mat-icon-button` (ikony SVG jak w `subscription-table.html`), etykiety z nazwą: od 840 px kompaktowe 32 px (gęstość z `_theme.scss`), poniżej 840 px 40 px (cel dotyku); nazwa zawija się (`overflow-wrap: anywhere`), ikony nie zawijają się do osobnej linii; na telefonie nazwa i ikony w jednym wierszu nad polami;
- `disabledInteractive` gdy `changes() !== null`, z `matTooltip` „Najpierw zapisz albo cofnij zmiany progów i limitów.”;
- po wyniku dialogu: przeładowanie jak przy wczytaniu, `totals.refresh()`, komunikat w `role="status"`, fokus na legendzie/nagłówku sekcji kategorii;
- spec: ikony tylko przy własnych, wyłączone przy zmianach, każdy wynik dialogu (przeładowanie, komunikat, odświeżenie sum).

#### 4. E2E przeglądarki

**File**: `frontend-subtracker/e2e/browser/category-rename-delete.e2e-spec.ts` (nowy), `frontend-subtracker/e2e/support/` (pomocnik tworzenia własnej kategorii przez API, jeśli brak)

**Intent**: Przepływ użytkownika end-to-end.

**Contract**: konto z własną kategorią bez subskrypcji i drugą z subskrypcją; na `/budget`: zmiana nazwy pierwszej (nowa nazwa w wierszu), próba usunięcia drugiej (komunikat o subskrypcjach), usunięcie pierwszej (wiersz znika); ikony wyłączone po zmianie pola progu.

### Success Criteria:

#### Automated Verification:

- Testy frontendu: `cd frontend-subtracker && npm run test:ci`
- Celowe uszkodzenie: ikony przy predefiniowanej albo brak blokady przy zmianach czerwieni test
- E2E przeglądarki: `cd frontend-subtracker && npm run build:e2e && npm run e2e` (API z `cd backend-subtracker && npm run build`)

#### Manual Verification:

- `/budget` w trzech zakresach szerokości (telefon < 840 px, 840–950 px, pełny desktop) z 50-znakową nazwą własnej kategorii: nazwa się zawija, ikony nie spadają do osobnej linii, pola wyrównane
- Dialogi działają z klawiatury (fokus, Escape, ogłoszenie komunikatu statusu)

**Implementation Note**: Po fazie i zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed fazą 3.

---

## Phase 3: Dokumenty i produkcja

### Overview

Dokumenty opisują nowe trasy i reguły, zmiana trafia na serwer.

### Changes Required:

#### 1. Dokumenty

**File**: `context/foundation/backend-patterns.md`, `CLAUDE.md`, `context/foundation/prd.md`

**Intent**: Kolejne slice'y znają kontrakt kategorii.

**Contract**:
- `backend-patterns.md`, „Dane domenowe”: zmiana nazwy (`name_key`, pominięcie własnego id, 404 dla predefiniowanych), usunięcie (transakcja, `category_setting`, 409), `isForeignKeyViolation` i stałe FK, 23503 → 400 w subskrypcjach i `PUT /budget` (punkt o walidacji `PUT /budget` przed transakcją zaktualizowany);
- `CLAUDE.md` (poza blokiem 10x): `PATCH/DELETE /categories/:id` w opisie modułu `subscriptions/`;
- `prd.md`: FR-009 „domyślnie: 3” — naniesione podczas planowania i commitowane w fazie 1 (zob. punkt 6 fazy 1); tu już bez zmian.

### Success Criteria:

#### Automated Verification:

- Pełne testy obu aplikacji: `cd backend-subtracker && npm test && npm run lint && npm run build` oraz `cd frontend-subtracker && npm run test:ci`
- CI zielone na PR (`backend`, `backend-e2e`, `frontend`, `browser-e2e`, `deploy-scripts`)

#### Manual Verification:

- Na produkcji: zmiana nazwy własnej kategorii na `/budget`, próba usunięcia niepustej (komunikat), usunięcie pustej (znika też z formularza subskrypcji)

**Implementation Note**: Po wdrożeniu i ręcznym teście na produkcji zatrzymaj się na potwierdzenie przed `/10x-impl-review` i `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- `isForeignKeyViolation`: zgodny kod i nazwa, inna nazwa, 23505, zwykły błąd, nie-błąd.
- Dialogi: sukces, 409, 404, inny błąd, przycięcie, przycisk przy niezmienionej nazwie.
- `/budget`: ikony tylko przy własnych, blokada przy zmianach, obsługa wyników dialogów.

### Integration Tests:

- E2E API: zmiana nazwy (konflikty, wielkość liter, 404), usunięcie (pusta, niepusta, 404), izolacja kont, wyścig 23503 w trzech miejscach.
- E2E przeglądarki: zmiana nazwy, odmowa usunięcia niepustej, usunięcie pustej, blokada przy zmianach.

### Manual Testing Steps:

1. `curl` na nowe trasy z sesją testową.
2. `/budget` w trzech szerokościach z 50-znakową nazwą.
3. Dialogi z klawiatury.
4. Produkcja: zmiana nazwy, odmowa, usunięcie.

## Performance Considerations

- Usunięcie to jedna krótka transakcja z blokadą jednego wiersza kategorii; `exists` po indeksie `subscription.category_id`.

## Migration Notes

- Bez zmian schematu i bez migracji. Wydanie wstecz działa na tych samych danych (usunięte kategorie po prostu nie istnieją).

## References

- Research: `context/changes/own-category-rename-and-delete/research.md`
- PRD: FR-025, FR-009, FR-010; Open Question #1
- Roadmapa: `context/foundation/roadmap.md`, S-17
- Wzorce: `backend-subtracker/src/shared/database/unique-violation.ts`, `backend-subtracker/src/subscriptions/services/subscriptions.service.ts:156-185`, `frontend-subtracker/src/app/subscriptions/delete-subscription-dialog/`, `frontend-subtracker/src/app/pages/admin/admin-users/` (trzy szerokości)
- Poprzednie decyzje: `context/archive/2026-11-11-first-subscription-in-list/reviews/impl-review-phase-1.md` (F5), `context/archive/2026-11-17-category-duplicate-warning/reviews/impl-review.md` (F5/F6)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: API kategorii

#### Automated

- [x] 1.1 Testy jednostkowe kategorii i helpera — 1ed1ba7
- [x] 1.2 E2E kategorii — 1ed1ba7
- [x] 1.3 Celowe uszkodzenie `category_setting` albo pominięcia własnego id czerwieni test — 1ed1ba7
- [x] 1.4 Pełne testy backendu — 1ed1ba7
- [x] 1.5 Testy e2e backendu — 1ed1ba7
- [x] 1.6 Lint i build backendu — 1ed1ba7

#### Manual

- [x] 1.7 Lokalnie `curl` na `PATCH`/`DELETE` i 409 dla niepustej — 1ed1ba7

### Phase 2: UI na `/budget`

#### Automated

- [x] 2.1 Testy frontendu
- [x] 2.2 Celowe uszkodzenie ikon przy predefiniowanej albo blokady czerwieni test
- [x] 2.3 E2E przeglądarki

#### Manual

- [x] 2.4 `/budget` w trzech szerokościach z 50-znakową nazwą
- [x] 2.5 Dialogi z klawiatury

### Phase 3: Dokumenty i produkcja

#### Automated

- [ ] 3.1 Pełne testy obu aplikacji
- [ ] 3.2 CI zielone na PR

#### Manual

- [ ] 3.3 Na produkcji zmiana nazwy, odmowa usunięcia niepustej, usunięcie pustej
