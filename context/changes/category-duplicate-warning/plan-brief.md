# Ostrzeżenie o duplikatach w kategorii (S-07): plan brief

> Full plan: `context/changes/category-duplicate-warning/plan.md`
> Research: `context/changes/category-duplicate-warning/research.md`

## What & Why

Użytkownik ustawia dla każdej kategorii próg aktywnych subskrypcji (0–99, domyślnie 2). Gdy liczba aktywnych subskrypcji ten próg osiągnie, system pokazuje pomarańczowe ostrzeżenie. Gdy go przekroczy, ostrzeżenie jest czerwone. FR-009 i FR-005: ostrzeżenie ma się przeliczać po każdej zmianie subskrypcji. Próg 0 pozwala oznaczyć kategorię jako „szkodliwą”: już pierwsza subskrypcja w niej daje czerwony alert.

## Starting Point

`GET /subscriptions/totals` (S-04) liczy już per kategoria `subscriptionCount` po statusach `trial`, `active` i `cancelled_pending`. Ustawień użytkownika nie ma w ogóle. Jedyna strona w app-shellu to `/subscriptions`, a sumy widać w kolumnie (desktop) i w pasku (telefon).

## Desired End State

Kolumna sum ma ikonę trójkąta z wykrzyknikiem przy zwiniętych „Kategoriach”. Rozwinięty wiersz ma ikonę, obrys 1px i opis „Osiągnięto próg: 2 z 2” albo „Przekroczono próg: 3 z 2”. Nowa strona `/dashboard` pokazuje pełne podsumowanie z progami i statusami. Nowa strona `/budget` pozwala zmienić progi. Po zapisie flagi odświeżają się bez przeładowania.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Definicja „aktywnych” | `trial`, `active`, `cancelled_pending` (`COUNTED_STATUSES`) | Ustalone w S-04 jako definicja dla S-07 i S-08 | Research |
| Kiedy flaga | liczba = próg (≥ 1) → pomarańczowy „osiągnięto”; liczba > próg → czerwony „przekroczono” | Użytkownik chce ostrzeżenia już przy osiągnięciu, a problemu przy przekroczeniu | Plan |
| Próg 0 i brak subskrypcji | brak flagi; pierwsza subskrypcja → od razu czerwony | Pusta „szkodliwa” kategoria nie powinna świecić bez powodu | Plan |
| Zakres progu | liczba całkowita 0–99, bez wyłączania | 0 ma sens dla kategorii szkodliwych; wysoki próg praktycznie wyłącza flagę | Plan |
| Gdzie ustawiać | nowa strona `/budget`, wspólna z limitami S-08 | Osobna strona konfiguracji, odłożona pozycja „Budżet” z F2 | Plan |
| Pełny dashboard | nowa strona `/dashboard` w ramach S-07 | Kolumna pokazuje najważniejsze, pełny obraz (w przyszłości wykresy) na osobnej stronie | Plan |
| Widoczność w kolumnie | ikona na „Kategorie” + ikona, obrys 1px i opis w wierszu | Flaga widoczna bez rozwijania; kolor nie jest jedyną informacją | Plan |
| Model danych | tabela `category_setting` (PK user_id + category_id), brak wiersza = 2 | Kategorie domyślne są wspólne; S-08 doda tu kolumnę limitu | Plan |
| API | `GET`/`PUT /budget` (zapis zbiorczy, atomowy, cudza kategoria → 400), pola ostrzeżenia w `/totals` | Jeden zapis z formularza; przeliczanie przy odczycie spełnia FR-005 | Plan |
| Test przeglądarkowy | brak nowego Playwright, tylko `GUARDED_ROUTES` | Unit, API e2e i testy komponentów pokrywają ryzyka taniej (test-plan §6.5) | Plan |

## Scope

**In scope:**
- tabela `category_setting` i migracja;
- `GET`/`PUT /budget`;
- `duplicateThreshold` i `duplicateWarning` w `/subscriptions/totals`;
- flaga w kolumnie sum (desktop i telefon);
- strony `/budget` i `/dashboard` z linkami w obu nawigacjach;
- testy;
- aktualizacja `backend-patterns.md`, `CLAUDE.md` i roadmapy.

**Out of scope:**
- limity kwotowe i alerty 80/100% (S-08);
- wykresy;
- zmiana strony startowej po zalogowaniu;
- wyłączanie ostrzeżeń;
- zmiana definicji „aktywnych”;
- e-maile (FR-015);
- zmiana nazwy i usuwanie kategorii.

## Architecture / Approach

Backend: czysta funkcja `duplicateWarning(count, threshold)` w module `subscriptions`. `costTotals(rows, thresholds)` dostaje mapę progów, którą `SubscriptionsService.totals()` pobiera jednym zapytaniem. `/budget` korzysta z `CategoriesService` (lista i sprawdzenie, czy kategoria należy do użytkownika). Frontend: `<app-cost-totals>` i `/dashboard` czytają `CostTotalsStore`. `/budget` ma własny serwis i po zapisie woła `CostTotalsStore.refresh()`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend: progi i ostrzeżenie w sumach | tabela, `/budget`, pola w `/totals`, testy unit i e2e | częściowy zapis przy 400; brak indeksu na FK |
| 2. Frontend: flaga w kolumnie sum | ikona, obrys i opis w obu wariantach kolumny | kontrast pomarańczu i czerwieni na granacie |
| 3. Frontend: `/budget` i `/dashboard` | dwie strony, nawigacja, formularz progów | trasa bez `RenderMode.Client` byłaby prerenderowana |
| 4. Dokumentacja i weryfikacja | reguły w `backend-patterns.md`, `CLAUDE.md`, roadmapa | rozjazd dokumentów z kodem |

**Prerequisites:** S-04 (zrobione), lokalny PostgreSQL z `subtracker-db` i `subtracker-db-dev`, Node 24.
**Estimated effort:** ok. 3–4 sesje w 4 fazach. Najwięcej pracy w fazie 3 (dwie nowe strony).

## Open Risks & Assumptions

- Kolory alertów na granatowym tle trzeba ocenić na żywo. Możliwe, że będą potrzebne osobne warianty tokenów dla granatu i jasnej strony.
- S-08 zakłada rozszerzenie `category_setting` i `/budget`. Jeśli S-08 zmieni ten kierunek, trzeba będzie przebudować wspólne miejsca.
- `cancelled_pending` dalej liczy się jako duplikat, zgodnie ze świadomą definicją z S-04. Użytkownik może się tego nie spodziewać.
- PRD (FR-009 „po przekroczeniu”) ma teraz doprecyzowanie: dwa stany. Zapisujemy je w roadmapie i `backend-patterns.md`, PRD zostaje bez zmian.

## Success Criteria (Summary)

- Przy dwóch subskrypcjach w kategorii z progiem 2 użytkownik widzi pomarańczową flagę, a przy trzech czerwoną, w kolumnie i na `/dashboard`.
- Zmiana progu na `/budget` od razu zmienia flagę, bez przeładowania strony.
- Inne konto nie może odczytać ani zmienić progów cudzej kategorii (testy e2e na dwóch kontach).
