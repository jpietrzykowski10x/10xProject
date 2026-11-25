---
date: 2026-11-24T20:32:58Z
researcher: Claude (Opus 5.5) z trzema sub-agentami badawczymi
git_commit: 7589765
branch: change/own-category-rename-and-delete
repository: 10xProject (SubTracker)
topic: "S-17 (FR-025, FR-009, FR-010): zmiana nazwy i usuwanie własnych kategorii; predefiniowane bez zmian; próg i limit usuwanej kategorii nie zostają osierocone; miejsce w UI"
tags: [research, categories, budget, backend-subtracker, frontend-subtracker]
status: complete
last_updated: 2026-11-24
last_updated_by: Claude (Opus 5.5)
---

# Research: S-17 — zmiana nazwy i usuwanie własnych kategorii

**Date**: 2026-11-24T20:32:58Z
**Researcher**: Claude (Opus 5.5) z trzema sub-agentami (backend, UI, decyzje historyczne)
**Git Commit**: 7589765
**Branch**: change/own-category-rename-and-delete
**Repository**: 10xProject (SubTracker)

## Research Question

Co trzeba zmienić, żeby użytkownik mógł zmienić nazwę własnej kategorii albo usunąć ją, gdy nie ma w niej subskrypcji (przy niepustej: czytelny komunikat, nie błąd serwera), przy niezmiennych kategoriach predefiniowanych i bez osieroconego progu duplikatów i limitu budżetu; oraz gdzie to umieścić w UI (dane do makiet). S-14 biegnie równolegle w innym worktree (logi, `server.ts`, `/health`) — tych plików ta zmiana nie dotyka.

## Summary

- **Model**: jedna tabela `category`: predefiniowane mają `user_id NULL` i stałe UUID (9 sztuk, `backend-subtracker/src/subscriptions/default-categories.ts:4-18`), własne `user_id` z FK `ON DELETE CASCADE` (`entities/category.entity.ts:34-40`). `name` varchar(50), `name_key` varchar(100) = `toNameKey(name)` (`shared/text/name-key.ts:5`, `toLocaleLowerCase('pl')`), zapisywany przy każdym insercie (`category.entity.ts:45-52`) — zmiana nazwy musi przepisać też `name_key`. Brak `updated_at`.
- **Unikalność**: indeks `UQ_category_owner_name_key` na `(COALESCE(user_id, '0000…'), name_key)` (`category.entity.ts:17-29`, migracja `1794424078141-CategoryNameKey.ts:26`, seeder dev `services/categories-seeder.ts:52`). Predefiniowane są osobnym „właścicielem”, więc indeks nie blokuje nazwy własnej równej predefiniowanej — robi to tylko wyszukanie w serwisie przy tworzeniu (`categories.service.ts:57-66`, 409 bez treści); wyścig 23505 na indeksie też daje 409 (`:89-93`, `shared/database/unique-violation.ts:7-16`).
- **FK `NO ACTION`**: `subscription.category_id` (`SubscriptionsSchema.ts:29`, `FK_e7ddc1213ce93c60338e6da254d`) i `category_setting.category_id` (`entities/category-setting.entity.ts:32-35`, `1794927874576-CategorySetting.ts:17`, `FK_228db5ea674f274f52ee203d326`). Każda własna kategoria ma wiersz `category_setting` (zapis przy tworzeniu `categories.service.ts:80-84`, backfill `1794951132638-BackfillOwnCategorySettings.ts`), więc usunięcie musi najpierw usunąć ten wiersz w tej samej transakcji — to jest „bez osieroconego progu i limitu”. Helpera dla 23503 nie ma (jedyne trafienie: przypadek negatywny w `unique-violation.spec.ts:23`).
- **API dziś**: tylko `GET /categories` (`no-store`) i `POST /categories` (`controllers/categories.controller.ts:20-34`); odpowiedź `{ id, name, isDefault }` (`subscription.types.ts:37-41`). Własne sortowane w JS `localeCompare(…, 'pl')` (`categories.service.ts:36-51`), więc zmiana nazwy nie wymaga zmian sortowania SQL. DTO `@TrimmedString(50)` (`dtos/create-category.dto.ts:5`, `shared/validation/trimmed-string.ts:8-15`) można użyć ponownie. Brak wyszukania „tylko własna” (`findUsable`/`allUsable` biorą własne i predefiniowane, `:99-124`).
- **Wzorce**: DELETE `@Delete(':id')` + `@HttpCode(204)` + `ParseUUIDPipe`, cudze/nieznane id → 404 tym samym komunikatem (`subscriptions.controller.ts:59-66`, `subscriptions.service.ts:31-32, 180-185`); edycja przez `update()` i 404 przy `affected === 0` (`:156-178`); 409 stanu z komunikatem (`:35-36, 222`). Odmowy 404/409 nie dostają `withDenial` (`context/foundation/backend-patterns.md`, „Logi błędów i odmów”).
- **Wyścig**: walidacja kategorii przy tworzeniu/edycji subskrypcji (`subscriptions.service.ts:237-248`) jest poza transakcją; jedyną ochroną jest FK. Usunięcie kategorii po insercie subskrypcji kończy się 23503 (do zamiany na 409), a insert/update subskrypcji albo `PUT /budget` po usunięciu kategorii — 23503 dziś niemapowanym, czyli 500. `PUT /budget` sprawdza kategorie (`allUsable`) przed transakcją (`services/budget.service.ts:106-110`) — zapisane w `backend-patterns.md` jako dług dla slice'u usuwania (S-07 F5/F6, `context/archive/2026-11-17-category-duplicate-warning/reviews/impl-review.md:81-93`).
- **UI**: kategorie są w selekcie formularza subskrypcji z opcją „Dodaj własną…” (`frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.html:22-71`, 409 → „Taka kategoria już istnieje.”), na `/budget` (każda kategoria, także pusta, w wierszu z progiem i limitem: `pages/budget/budget.html`, siatka `minmax(0,1fr) 140px 200px`), na dashboardzie i w granatowej kolumnie (`subscriptions/cost-totals/cost-totals.html:51-107`) — dwa ostatnie pokazują tylko kategorie z subskrypcjami, więc nie pokażą kategorii do usunięcia. Żaden komponent nie czyta `isDefault` (`subscription.types.ts:24-28`). Brak metod klienta dla zmiany nazwy i usunięcia (`subscriptions/subscriptions.service.ts:55-59`).

## Detailed Findings

### Backend — budżet i sumy

- `BudgetService.budgetSettings` czyta `budget_settings` i wszystkie wiersze `category_setting` użytkownika (`budget.service.ts:50-79`); `get` iteruje `categories.list()` (`:82-96`), więc usunięta kategoria znika z `/budget` sama. `update` (`:103-136`) sprawdza `allUsable` przed transakcją, potem upsert (`:141-157`).
- `/subscriptions/totals` łączy subskrypcje z kategorią (`subscriptions.service.ts:117-137`, `cost-totals.ts:94, 106`); kategoria bez subskrypcji nie występuje, więc pozostawiony wiersz ustawień nie zmieniłby odpowiedzi, ale byłby sierotą w danych (i blokuje usunięcie przez FK).
- Odwołania do `categoryId`/`category_id` w `src` (bez specs i migracji) są tylko w: encjach `subscription` i `category-setting`, DTO `create-subscription` i `update-budget`, `duplicate-warning.ts`, `budget.service.ts`, `categories.service.ts`, `subscriptions.service.ts`. Moduły `admin/`, `auth/`, `users/`, `mail/` nie dotykają kategorii.
- E2E: `test/subscriptions/categories.e2e-spec.ts` (409 bez względu na wielkość liter, polskie litery, wyścig `:64-79`, surowy 23505 `:81-96`); pomocniki `test/subscriptions/subscriptions-e2e.ts:31-47` (tylko `postCategory`); wzorzec DELETE `subscriptions.e2e-spec.ts:308-334`, izolacja kont `account-isolation.e2e-spec.ts:116-138`.

### Frontend — wzorce

- Dialog usuwania: `subscriptions/delete-subscription-dialog/` (`role: 'alertdialog'`, `autoFocus: 'first-tabbable'`, 480 px, dialog sam wysyła DELETE, `disableClose` w trakcie, wynik `'deleted' | 'missing'`, inny błąd → `st-notice--error` w dialogu; „Anuluj” stroked pierwszy, „Usuń” `mat-flat-button disabledInteractive`). 409 jako wynik `'conflict'` ma dialog anulowania (`pages/subscriptions/subscriptions.ts:314-321`).
- Komunikaty: `styles/_notices.scss`; `/budget` ma stały `role="status"` z ponownym ogłoszeniem przez `afterNextRender` (`budget.ts:287-290`) i błąd `role="alert"`. Brak MatSnackBar.
- Akcje w wierszu: na desktopie `mat-icon-button` z `aria-label`/`matTooltip` i ikonami SVG z szablonu (`subscription-table.html:92-154, 293`), na telefonie rozwijany wiersz z przyciskami tekstowymi (`:220-267`). Brak wzorca edycji nazwy w miejscu.
- `/budget`: formularz reaktywny przebudowywany z `GET /budget` przy każdym wczytaniu (`budget.ts:270-284`); 400 („kategoria zniknęła w innej karcie”) przeładowuje formularz (`:270-272, 378-382`). Strona `max-width: 960px`, przewija się w obszarze treści.
- Testy: `pages/budget/budget.spec.ts` (16 przypadków), `subscription-form.spec.ts` (własna kategoria `:187, 272, 284, 296`), e2e przeglądarki nie testują kategorii ani budżetu; sprzątanie e2e usuwa subskrypcje przed kategoriami (`e2e/support/accounts.ts:164-176`).
- Reguły widoku listy (`context/foundation/lessons.md`): trzy szerokości z najdłuższą nazwą (50 znaków), akcja nie szersza niż treść (w wąskim zakresie ikona), przyciski tylko z tokenów motywu, wysokości 48/40/32 px; przy nowym wariancie wyglądu najpierw 2–3 makiety ASCII. Wzorzec: `pages/admin/admin-users/`.

## Code References

- `backend-subtracker/src/subscriptions/entities/category.entity.ts:17-52` — kolumny, indeks unikalności
- `backend-subtracker/src/subscriptions/entities/category-setting.entity.ts:18-51` — PK, FK `NO ACTION`, próg i limit
- `backend-subtracker/src/subscriptions/services/categories.service.ts:19-124` — lista, tworzenie, `findUsable`/`allUsable`
- `backend-subtracker/src/subscriptions/controllers/categories.controller.ts:20-34` — trasy
- `backend-subtracker/src/subscriptions/services/budget.service.ts:50-157` — ustawienia, `update` z walidacją przed transakcją
- `backend-subtracker/src/subscriptions/services/subscriptions.service.ts:31-36, 156-185, 237-248` — wzorce PUT/DELETE, walidacja kategorii
- `backend-subtracker/src/shared/database/unique-violation.ts:7-16` — wzór helpera błędu PG
- `backend-subtracker/src/subscriptions/default-categories.ts:4-18` — 9 kategorii predefiniowanych
- `frontend-subtracker/src/app/pages/budget/budget.html`, `budget.ts:270-290`, `budget.scss` — strona budżetu
- `frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.html:22-71` — selekt i „Dodaj własną…”
- `frontend-subtracker/src/app/subscriptions/delete-subscription-dialog/` — wzorzec dialogu usuwania
- `frontend-subtracker/src/app/subscriptions/subscriptions.service.ts:55-59` — klient kategorii

## Architecture Insights

- Usunięcie w jednej transakcji: `SELECT … FOR UPDATE` własnej kategorii po `{ id, userId }` (brak → 404), `EXISTS` subskrypcji → 409 z komunikatem, usunięcie wiersza `category_setting`, usunięcie kategorii; 23503 na którymkolwiek FK jako siatka → 409. Z drugiej strony 23503 przy tworzeniu/edycji subskrypcji i w `PUT /budget` → 400 jak „nieużywalna kategoria”, zamiast 500.
- Zmiana nazwy: wyszukanie konfliktu jak przy tworzeniu, ale z pominięciem własnego id (zmiana samej wielkości liter „praca” → „Praca” musi przejść), plus 23505 na `CATEGORY_OWNER_NAME_INDEX` → 409. Wiersz `category_setting` zostaje (klucz to id).
- Helper `isForeignKeyViolation(error, constraint)` w `src/shared/database/` obok `unique-violation.ts`, z własnym testem (`lessons.md`: kod ogólny w `shared/`).

## Historical Context (from prior changes)

- `context/foundation/prd.md:86-87` — FR-025: zmiana nazwy i usunięcie własnej; predefiniowane bez zmian; usunąć można tylko pustą, próba usunięcia niepustej kończy się czytelnym komunikatem i nie rusza subskrypcji; unikalność, progi (FR-009) i limity (FR-010) spójne. Open Question #1 (`:161`) rozstrzygnięte 2026-11-22: tylko pusta.
- `context/foundation/roadmap.md:160-171` — S-17: miejsce w UI otwarte (makiety ASCII), ryzyka 23503 → 409, `toNameKey`, `POLISH_COLLATION`.
- `context/archive/2026-11-11-first-subscription-in-list/` — S-02: zmiana nazwy i usuwanie poza zakresem (`plan.md:36`); przegląd fazy 1 F5 (`reviews/impl-review-phase-1.md:75-83`) to źródło ostrzeżenia o FK `NO ACTION` i propozycji `isForeignKeyViolation`; przegląd faz 2–3 F4 (`reviews/impl-review-phase-2-3.md:74-80`): dodanie kategorii nadpisywało wybór w formularzu — uważać przy przeładowaniu listy po zmianie nazwy.
- `context/archive/2026-11-17-category-duplicate-warning/` — S-07: kopia domyślnego progu przy tworzeniu (`plan.md:297`), backfill wartością 3; przegląd F5/F6 (`reviews/impl-review.md:81-93`): walidacja `PUT /budget` przed transakcją do poprawy przy usuwaniu, a frontend mógłby zachować wpisane wartości przy 400.
- `context/archive/2026-11-17-budget-limits-and-alerts/plan.md:27, 42` — S-08: pole limitu przy każdej kategorii na `/budget`; kategoria z limitem bez subskrypcji widoczna tylko tam.

## Related Research

- `context/archive/2026-11-11-first-subscription-in-list/research.md` — wprowadzenie kategorii (S-02)
- `context/archive/2026-11-17-budget-limits-and-alerts/research.md` — limity (S-08)

## Open Questions

Decyzje dla `/10x-plan`:

1. **Miejsce w UI** (właściciel: użytkownik, makiety): akcje przy wierszach własnych kategorii na `/budget` (jedyne miejsce, które dziś pokazuje każdą kategorię, także pustą), w formularzu subskrypcji, albo osobna strona listy kategorii (nowa trasa angielska, `RenderMode.Client`, `GUARDED_ROUTES`).
2. **Kontrakt trasy**: `PATCH` czy `PUT /categories/:id` dla nazwy; odpowiedź dla kategorii predefiniowanej: 404 (jak „nie Twoja”) czy 403/409 („nie można zmienić”).
3. **Forma edycji nazwy**: dialog czy pole w miejscu; zachowanie niezapisanych zmian w formularzu `/budget` przy zmianie nazwy/usunięciu (formularz jest przebudowywany z `GET /budget`).
4. **Zakres poprawek wyścigu**: czy w tym slice mapować 23503 → 400 przy tworzeniu/edycji subskrypcji i w `PUT /budget` (zalecane w `backend-patterns.md`).
5. **Rozjazd domyślnego progu**: PRD (FR-009) mówi 2, kod i S-07 używają 3 — poza zakresem S-17, do odnotowania.
