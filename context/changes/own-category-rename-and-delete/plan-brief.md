# Zmiana nazwy i usuwanie własnych kategorii — Plan Brief

> Full plan: `context/changes/own-category-rename-and-delete/plan.md`
> Research: `context/changes/own-category-rename-and-delete/research.md`

## What & Why

FR-025 (S-17): błędnie wpisana albo niepotrzebna własna kategoria zostaje dziś na zawsze — w selekcie formularza, na dashboardzie i na `/budget`. Użytkownik ma móc zmienić jej nazwę albo usunąć pustą; przy niepustej dostaje czytelny komunikat zamiast błędu serwera, a próg duplikatów i limit budżetu usuniętej kategorii nie zostają jako sieroty.

## Starting Point

API ma tylko `GET`/`POST /categories`. Kategorie predefiniowane (`user_id NULL`, 9) i własne są w jednej tabeli z unikalnością po `name_key`. `subscription.category_id` i `category_setting.category_id` mają FK `NO ACTION`, a każda własna kategoria ma wiersz `category_setting`. `/budget` pokazuje każdą kategorię w wierszu z progiem i limitem; front nigdzie nie odróżnia własnych od predefiniowanych.

## Desired End State

Na `/budget` przy nazwie każdej własnej kategorii są ikony ✎ i 🗑 (wyłączone, gdy formularz ma niezapisane zmiany). ✎ otwiera dialog zmiany nazwy, 🗑 dialog usuwania. Usunięcie pustej znika kategorię razem z jej progiem i limitem, a niepusta daje komunikat „Ta kategoria ma subskrypcje. Przenieś je do innej kategorii albo usuń, a potem usuń kategorię.”. Kategoria znikająca w trakcie zapisu subskrypcji albo budżetu daje 400, nie 500.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Miejsce w UI | Ikony w wierszach formularza `/budget` | `/budget` jako jedyne pokazuje każdą kategorię, także pustą | Plan (użytkownik, makiety) |
| Edycja nazwy | Dialog | Ten sam wzorzec co dialog usuwania, działa tak samo na telefonie | Plan (użytkownik) |
| Niezapisane zmiany | Akcje wyłączone z podpowiedzią, gdy formularz ma zmiany | Prosto i bez rozjazdu stanu formularza | Plan (użytkownik) |
| Trasy | `PATCH /categories/:id` `{ name }`, `DELETE /categories/:id` (204) | Zmienia się jedno pole; wzorzec DELETE z subskrypcji | Plan |
| Predefiniowana / cudza | 404 jak „nie znaleziono” | Wyszukanie tylko własnych, jak `DELETE` subskrypcji; UI nie pokazuje akcji | Plan |
| Usunięcie | Jedna transakcja: blokada, sprawdzenie subskrypcji (409), `category_setting`, kategoria; 23503 → 409 | FK `NO ACTION` wymaga usunięcia ustawień; FK łapie wyścig | Research |
| Konflikt nazwy | Jak przy tworzeniu, z pominięciem własnego id | „praca” → „Praca” musi przejść | Research |
| Wyścig w zapisie | 23503 → 400 przy subskrypcjach i w `PUT /budget` | Dług z przeglądu S-07 (F5/F6) | Research |
| Domyślny próg | PRD FR-009 wyrównany do kodu: 3 | Celowa zmiana z S-07; 2 był za niski | Plan (użytkownik) |

## Scope

**In scope:**
- `PATCH`/`DELETE /categories/:id`;
- `isForeignKeyViolation` i stałe FK;
- 23503 → 400 w subskrypcjach i budżecie;
- ikony i dialogi na `/budget`;
- testy jednostkowe, e2e API i przeglądarki;
- dokumenty i poprawka PRD.

**Out of scope:**
- przenoszenie albo kasowanie subskrypcji przy usuwaniu;
- zmiany kategorii predefiniowanych;
- akcje w formularzu subskrypcji, dashboardzie i kolumnie;
- osobna strona kategorii;
- zachowywanie niezapisanych progów;
- FK `CASCADE` i migracje;
- pliki S-14.

## Architecture / Approach

API: nowy helper `isForeignKeyViolation` w `shared/database/`, metody `rename` i `remove` w `CategoriesService`, mapowanie 23503 w `SubscriptionsService` i `BudgetService`. Frontend: metody klienta, dwa dialogi w `pages/budget/`, ikony w wierszach `/budget` sterowane `isDefault` z `GET /budget` i blokowane przez istniejący sygnał `changes()`. Po każdej akcji `/budget` przeładowuje się, sumy się odświeżają, a status ogłasza wynik.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. API kategorii | Trasy, transakcja usuwania, mapowanie 23503, e2e | Nazwy FK z migracji; testy wyścigu |
| 2. UI na `/budget` | Ikony, dialogi, blokada przy zmianach, e2e przeglądarki | Układ w zakresie 840–950 px z 50-znakową nazwą |
| 3. Dokumenty i produkcja | `backend-patterns.md`, `CLAUDE.md`, PRD; deploy | — |

**Prerequisites:** lokalne bazy i `backend-subtracker/.env`; S-14 w innym worktree — bez wspólnych plików.
**Estimated effort:** ~2 sesje w 3 fazach.

## Open Risks & Assumptions

- Nazwy FK pochodzą z migracji; test e2e z prawdziwym 23503 na obu FK wychwyci rozjazd w CI (`backend-e2e` buduje schemat z migracji).
- Konflikty przy merge'u z S-14 ograniczone do `CLAUDE.md` i `backend-patterns.md`.

## Success Criteria (Summary)

- Zmiana nazwy i usunięcie pustej własnej kategorii działają na `/budget` we wszystkich szerokościach.
- Niepusta daje czytelny komunikat, predefiniowane nie mają akcji, a próg i limit usuniętej znikają razem z nią.
- Kategoria znikająca w trakcie zapisu daje 400, nie 500; CI zielone.
