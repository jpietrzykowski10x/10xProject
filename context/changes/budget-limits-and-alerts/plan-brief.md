# Limity budżetu i alerty 80% / 100% (S-08): plan brief

> Full plan: `context/changes/budget-limits-and-alerts/plan.md`
> Research: `context/changes/budget-limits-and-alerts/research.md`

## What & Why

Użytkownik ustawia miesięczny limit całościowy i limity poszczególnych kategorii (FR-010). System porównuje je z miesięczną sumą aktywnych subskrypcji i pokazuje alert: pomarańczowy od 80% limitu, czerwony od 100% (FR-011). Alert przelicza się po każdej zmianie subskrypcji albo limitu (FR-005), bo liczy się przy odczycie sum.

## Starting Point

S-04 liczy w groszach sumy miesięczne całości i kategorii (`/subscriptions/totals`). S-07 dodał tabele `budget_settings` i `category_setting`, stronę `/budget` z atomowym zapisem tylko zmian, stronę `/dashboard` i wzorzec alertu (ikona, obrys, opis, kolory na granat). Limitów nie ma nigdzie.

## Desired End State

Na `/budget` są pola limitu całościowego i limitów kategorii (puste = brak limitu). W kolumnie sum pod sumą miesięczną widać pasek wykorzystania „170,00 z 200,00 zł (85%)” w kolorze stanu. Rozwinięty wiersz kategorii pokazuje „Limit: X z Y zł” i alert. `/dashboard` pokazuje limit całościowy z paskiem i kolumny limitu.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Granice alertu | ≥ 80% pomarańczowy; ≥ 100% czerwony (= 100% „wykorzystano”, > 100% „przekroczono”) | Dosłownie „przy 80% i 100%” z PRD i makiety; wyczerpany limit to już problem | Plan |
| Brak limitu i 0 | puste = brak limitu (null, bez alertu); 0 dozwolone; zakres 0–99 999,99 zł | 0 oznacza kategorię „szkodliwą” jak próg 0 w S-07 | Plan |
| Wydatki 0 zł | zawsze brak alertu, także przy limicie 0 | Pusta kategoria nie powinna świecić | Plan |
| Podstawa porównania | suma miesięczna z `/totals` (roczna /12 per subskrypcja) | Alert zgodny z kwotą widoczną w kolumnie (ryzyko #4) | Research |
| Suma limitów kategorii > całościowy | dozwolone, podpowiedź na `/budget` | Limity są niezależne; blokada utrudniałaby zapis częściowy | Plan |
| Kategoria z limitem bez wydatków | widoczna tylko na `/budget` | Kontrakt `/totals` z S-04 zostaje bez zmian | Plan |
| Wygląd w kolumnie | limetkowy pasek pod sumą (pomarańcz/czerwień przy alercie) + tekst; limit kategorii w rozwiniętym wierszu | Makieta F2 i wzorce S-07 | Plan |
| Ikona na „Kategoriach” | wspólna: najpoważniejszy stan z duplikatów i limitów | Jedno miejsce uwagi w wąskim pasku na telefonie | Plan |
| Model danych | `monthly_limit numeric(10,2) NULL` w `budget_settings` i `category_setting`; `duplicate_threshold` nullable | Sam limit nie może zamrozić progu kategorii domyślnej | Plan |
| API | pola w `/totals`; `PUT /budget` z `monthlyLimit` (null usuwa), pozycja kategorii z opcjonalnymi polami | Ten sam atomowy zapis i ten sam ekran co progi | Plan |

## Scope

**In scope:**
- kolumny limitów, nullable próg, migracja;
- reguła `budgetAlert` i pola w `/totals`;
- `GET`/`PUT /budget` z limitami;
- pasek i alerty w kolumnie sum (desktop i telefon), wspólna ikona;
- pola limitów na `/budget`, podpowiedź sumy, limity na `/dashboard`;
- testy i dokumenty.

**Out of scope:**
- konfigurowalne progi (FR-017) i prognoza przed dodaniem (FR-012);
- e-maile (FR-015);
- limity roczne;
- kategorie z limitem bez wydatków w kolumnie i na `/dashboard`;
- blokada sumy limitów kategorii;
- zmiana definicji „aktywnych”;
- nowy test Playwright.

## Architecture / Approach

Backend: czysta funkcja `budgetAlert(spentGrosze, limitGrosze)` w module `subscriptions`, porównanie na liczbach całkowitych. `costTotals()` dostaje obok progów limity użytkownika (te same odczyty `budget_settings` i `category_setting`). `/budget` rozszerza DTO i upsert. Frontend: `<app-cost-totals>` i `/dashboard` czytają `CostTotalsStore`, `/budget` po zapisie woła `refresh()`, jak w S-07.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend: limity i alerty w sumach | kolumny, migracja, reguła, `/totals`, `/budget`, testy | błąd granicy 80/100 albo rozjazd z sumą miesięczną |
| 2. Frontend: limit w kolumnie sum | pasek, wiersz kategorii, wspólna ikona | czytelność paska na granacie, miejsce na telefonie |
| 3. Frontend: `/budget` i `/dashboard` | pola limitów, podpowiedź, kolumny dashboardu | zapis tylko zmian przy polach opcjonalnych (null vs brak) |
| 4. Dokumentacja | reguły w `backend-patterns.md`, `CLAUDE.md`, roadmapa | rozjazd dokumentów z kodem |

**Prerequisites:** S-04 i S-07 (zrobione), lokalny PostgreSQL z `subtracker-db` i `subtracker-db-dev`, Node 24.
**Estimated effort:** ok. 3 sesje w 4 fazach, najwięcej w fazie 1 i 3.

## Open Risks & Assumptions

- Trial i `cancelled_pending` liczą się do limitu jak do sum (decyzja S-04). Alert może pojawić się, zanim użytkownik cokolwiek zapłacił.
- Limit kategorii bez wydatków nie jest widoczny w kolumnie ani na `/dashboard`. Użytkownik może się tego spodziewać.
- Pasek dokłada wysokość w nagłówku na telefonie. Ocena na żywo.

## Success Criteria (Summary)

- Przy limicie 100 zł i wydatkach 80 zł użytkownik widzi pomarańczowy pasek, a przy 100 zł i więcej czerwony, w kolumnie i na `/dashboard`.
- Zmiana albo usunięcie limitu na `/budget` od razu zmienia pasek i alerty, bez przeładowania strony.
- Inne konto nie może odczytać ani zmienić limitów (testy e2e na dwóch kontach).
