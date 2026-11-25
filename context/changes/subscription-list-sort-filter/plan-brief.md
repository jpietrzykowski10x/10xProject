# Sortowanie, filtrowanie i strony listy subskrypcji — Plan Brief

> Full plan: `context/changes/subscription-list-sort-filter/plan.md`
> Research: `context/changes/subscription-list-sort-filter/research.md`

## What & Why

S-18 (FR-016). Użytkownik sortuje listę subskrypcji (nazwa, kwota miesięczna, data), filtruje ją (kategoria, status) i przechodzi między stronami. Robi to API, bo konto używane latami będzie miało dużo wpisów. Mechanizm sortowania w przeglądarce trzeba by wtedy przebudować pod porcje, więc od razu budujemy go na backendzie.

## Starting Point

`GET /subscriptions` zwraca całą listę konta jako tablicę w jednej kolejności (`subscriptionOrder`). Strona `/subscriptions` pokazuje ją bez kontrolek. `SubscriptionSort` ma jedną wartość, przygotowaną na rozbudowę.

## Desired End State

Nad tabelą stoją trzy pola: „Sortuj”, „Kategoria”, „Status”, a pod nią numerowane strony po polsku („1–25 z 80”). Wybór jest w adresie strony, więc odświeżenie i link go zachowują. Pusty wynik filtra ma własny komunikat i „Wyczyść filtry”. Podgląd admina i sumy działają jak dziś.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Gdzie sortować i filtrować | API (SQL), nie przeglądarka | Lista będzie rosła latami, a porcje wymagają sortowania po stronie API | Plan (użytkownik; research rekomendował przeglądarkę) |
| Porcje | Numerowane strony, 25 na stronę, `mat-paginator`, `?page=` | Wybór użytkownika: łatwo wrócić do konkretnej strony | Plan |
| Kontrakt | Ta sama trasa, odpowiedź `{ items, total, page, pageSize }` | Jedna trasa; krótkie okno błędu przy wdrożeniu zaakceptowane | Plan |
| Sortowanie po kwocie | Miesięcznie (roczna /12 w SQL) | Porównuje rzeczywisty koszt, zgodnie z FR-008 | Research / Plan |
| Układ | A: trzy `mat-select` nad tabelą, jeden pod drugim < 840 px | Jeden mechanizm we wszystkich szerokościach, tokeny motywu | Research / Plan |
| Filtry | Jedna wartość + „Wszystkie” | Prosty kontrakt API i adresu | Plan |
| Wiersz poza filtrem po zapisie | Tylko zwykły komunikat | Wybór użytkownika: bez dodatkowej logiki | Plan |
| Jednoznaczna kolejność | Każdy wariant + kolejność domyślna + `id` | Strony z offsetem nie mogą się nakładać | Plan |
| Kategorie w filtrze | `GET /categories` | Strona nie ma już wszystkich wierszy, z których można by je wyprowadzić | Plan |
| Podgląd admina | Bez zmian, `list()` zwraca całą listę | Poza zakresem FR-016 | Research / Plan |

## Scope

**In scope:** parametry `sort|category|status|page|pageSize` z walidacją, sortowanie w SQL z polską kolacją, `{ items, total }`; front: serwis, stan w adresie, odświeżanie bieżącej strony, przejście na ostatnią stronę, polski paginator, trzy pola, stan „brak wyników”; testy unit, e2e API (`C.UTF-8` w CI) i browser e2e; CLAUDE.md i `backend-patterns.md`.

**Out of scope:** sortowanie w przeglądarce; filtry wielowartościowe i wyszukiwanie po nazwie; wybór rozmiaru strony i kursory; podgląd admina; zgodność wsteczna trasy; nowe indeksy.

## Architecture / Approach

Adres `?sort&category&status&page` przechodzi przez `queryFromParams` do sygnału `query`. Ten sygnał trafia do `SubscriptionsService.list(query)` i dalej do `GET /subscriptions`. Tam działa `ListSubscriptionsDto`, potem `SubscriptionsService.page()`: query builder ograniczony do konta, z filtrami, `subscriptionOrder(sort)` z `id` na końcu, `skip`/`take` i `getManyAndCount`. Odpowiedź `{ items, total }` wraca do tabeli i paginatora. Zmiana pola albo strony to `router.navigate(..., replaceUrl)`, po której dane wczytują się od nowa.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. API | Sortowanie, filtry i strony z testami e2e | Polska kolejność wychodzi tylko na `C.UTF-8` (CI) |
| 2. Front: dane i adres | Lista sterowana adresem i stronami API | Konflikt z S-15 w `subscriptions.ts` (start po merge'u S-15) |
| 3. Front: kontrolki i e2e | Układ A w trzech szerokościach, „brak wyników”, dokumentacja | Wąski desktop 840–950 px z długimi etykietami |

**Prerequisites:** merge S-15; nowa gałąź `change/subscription-list-sort-filter` z `origin/main`.
**Estimated effort:** ~2–3 sesje, 3 fazy.

## Open Risks & Assumptions

- Przez około minutę wdrożenia stary front dostaje nowy kształt odpowiedzi i pokazuje błąd listy; odświeżenie pomaga.
- Faza 1 bez faz 2 i 3 psuje listę na froncie, więc merge następuje dopiero po całości.
- Kolejność po kwocie miesięcznej liczy dokładne `amount/12`, więc zaokrąglone kwoty mogą wyglądać na równe mimo różnej pozycji.

## Success Criteria (Summary)

- Lista sortuje się po nazwie (polska kolejność), kwocie miesięcznej i dacie oraz filtruje po kategorii i statusie, a wybór przetrwa odświeżenie.
- Strony się nie nakładają i nie gubią wierszy; po usunięciu ostatniego wiersza strony widok przechodzi na ostatnią istniejącą.
- Konto bez subskrypcji i podgląd admina działają jak przed zmianą.
