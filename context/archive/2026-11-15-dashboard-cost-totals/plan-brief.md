# Sumy kosztów na dashboardzie (S-04) — Plan Brief

> Full plan: `context/changes/dashboard-cost-totals/plan.md`
> Research: `context/changes/dashboard-cost-totals/research.md`

## What & Why

Użytkownik ma widzieć, ile łącznie kosztują go subskrypcje miesięcznie i rocznie, z podziałem na kategorie. Kwoty muszą się zgadzać co do grosza z ręcznym wyliczeniem (FR-008, US-01, kryterium sukcesu PRD, ryzyko #4 w test-planie). Te same sumy i ta sama definicja „aktywnych” posłużą S-07 (duplikaty) i S-08 (limity budżetu).

## Starting Point

Nic dziś nie liczy sum. Istnieje tylko frontendowe `monthlyAmount` (roczna / 12 w groszach, połówka w górę) z ręczną wyrocznią w teście, używane w dopisku na liście. Powłoka zalogowanego ma granatową kolumnę z samą nawigacją.

## Desired End State

W granatowej kolumnie na desktopie i w nagłówku na telefonie widać „Miesięcznie” i „Rocznie” oraz rozwijany podział na kategorie (kwota miesięczna, roczna, liczba subskrypcji). Po dodaniu, edycji i usunięciu subskrypcji sumy przeliczają się same. Przykład z makiety: active 43,00/mies., trial 23,99/mies., cancelled_pending 429,99/rok i cancelled 50,00/mies. dają **102,82 zł miesięcznie i 1 233,87 zł rocznie**.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Zaokrąglenie roczna → miesięczna | grosze / 12 per subskrypcja, połówka w górę | Decyzja z 2026-11-13; suma musi zgadzać się z dopiskami na liście | Research |
| Wliczane statusy („aktywne”) | trial, active, cancelled_pending (wszystko poza cancelled) | Wybór użytkownika; zapisane jako definicja dla S-07 i S-08 | Plan |
| Suma roczna | realny wydatek: miesięczne × 12 + roczne bez zmian | Kwoty finalne mają odpowiadać realnie wydanej kwocie | Plan |
| Suma miesięczna | suma kwot zaokrąglonych per subskrypcja | Zgodna z listą; dopuszczamy, że × 12 różni się od rocznej o kilka groszy | Plan |
| Miejsce obliczeń | API `GET /subscriptions/totals`, JS na całkowitych groszach | Jedno źródło dla S-07 i S-08; bez zależności od kolacji i zaokrąglania w SQL | Plan |
| Miejsce na ekranie | powłoka wg F2: kolumna desktopu i nagłówek telefonu | Wybrany kierunek projektu; sumy widoczne na każdej stronie zalogowanego | Plan |
| Podział na kategorie | miesięcznie, rocznie, liczba; malejąco po kwocie, remis po polskiej nazwie; bez kategorii zerowych | Zgodne z makietą i od razu daje dane S-07 i S-08 | Plan |
| Pusty stan | „0,00 zł”, bez listy kategorii | Układ nie skacze, a od pierwszego logowania widać, co tu się pojawi | Plan |
| Kod ogólny i domenowy | `shared/money/` (string ↔ grosze), reguła sum w `subscriptions/cost-totals.ts` | Reguła z lessons: `shared/` bez wiedzy o domenie | Research |

## Scope

**In scope:**
- `GET /subscriptions/totals` z testami jednostkowymi (wyrocznia) i e2e (rejestr tras, 401, izolacja, statusy)
- Reguła sum w `backend-patterns.md`
- Serwis stanu sum, komponent sum w powłoce (desktop i telefon), odświeżanie po zmianach, testy komponentów

**Out of scope:**
- Trasa `/dashboard`, zmiana przekierowań i trybów renderowania
- Sumy w SQL, migracje, indeksy
- Limity budżetu, pasek limitu, ostrzeżenia o duplikatach (S-07, S-08)
- Dopisek „korekta zaokrągleń”, kategorie z zerową sumą
- Nowy test przeglądarkowy e2e

## Architecture / Approach

```
GET /subscriptions/totals ─► SubscriptionsService.totals(userId)
   SQL: user_id = :id AND status IN (COUNTED_STATUSES)   (bez SUM/ORDER BY)
   JS : costTotals(rows) — shared/money (grosze) + /12 per wiersz + grupy + kolejność
Front: CostTotalsStore (signal, root) ◄─ AppShell.load() / subscriptions page refresh()
       <app-cost-totals variant="column|bar"> w kolumnie i nagłówku telefonu
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. API sum kosztów | Przetestowany kontrakt `GET /subscriptions/totals` z wyrocznią i regułą w dokumentacji | Wzór rozjedzie się z `monthlyAmount`; ochrona: ta sama wyrocznia po obu stronach |
| 2. Sumy w powłoce zalogowanego | Sumy w kolumnie i w nagłówku telefonu, odświeżane po zmianach | Istniejące testy powłoki i strony zakładają brak żądania sum; dane poprzedniego konta w singletonie |

**Prerequisites:** S-02 i S-03 zrobione (są); lokalny PostgreSQL i `backend-subtracker/.env` do e2e.
**Estimated effort:** ~2 sesje, po jednej na fazę.

## Open Risks & Assumptions

- `cancelled_pending` wlicza się do sumy rocznej jako pełen rok, choć płatności po dacie rozliczenia nie będzie. To świadomy wybór użytkownika. Po S-05 (automatyczne przejście w `cancelled`) zawyżenie trwa najwyżej do daty rozliczenia.
- Suma miesięczna × 12 może różnić się od sumy rocznej o kilka groszy. Tak ma być, ale przy ręcznym sprawdzaniu może zdziwić.
- Wzór /12 żyje w dwóch bazach kodu. Spójność trzyma tylko wspólna wyrocznia w testach obu stron.

## Success Criteria (Summary)

- Dla dowolnego zestawu subskrypcji sumy na ekranie zgadzają się z ręcznym wyliczeniem co do grosza; `cancelled` nie są wliczane.
- Sumy są widoczne na desktopie i na telefonie i odświeżają się po każdej zmianie bez przeładowania strony.
- Inne konto nigdy nie widzi cudzych sum, ani w API, ani po zmianie konta w tej samej karcie.
