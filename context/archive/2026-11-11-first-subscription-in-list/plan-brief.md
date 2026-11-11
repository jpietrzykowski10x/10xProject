# Dodanie pierwszej subskrypcji i lista subskrypcji (S-02) — Plan Brief

> Full plan: `context/changes/first-subscription-in-list/plan.md`
> Research: `context/changes/first-subscription-in-list/research.md`

## What & Why

Zalogowany użytkownik dodaje subskrypcję (nazwa, kategoria, kwota w PLN, cykl, forma płatności, status, daty) i od razu widzi ją na liście. To gwiazda przewodnia roadmapy i pierwsze kryterium sukcesu PRD: od wejścia na stronę do pierwszej subskrypcji na liście w mniej niż 3 minuty. Model danych musi od razu nadawać się pod sumy, cykl życia, przypomnienia, duplikaty i limity (S-04–S-08).

## Starting Point

Działa logowanie magic linkiem, motyw F2 i pusta strona `/subscriptions`. API ma globalną autoryzację, CSRF i walidację, ale żadnej encji domenowej; frontend nie ma locale `pl`, adaptera dat ani panelu bocznego.

## Desired End State

Na `/subscriptions` tabela (desktop) albo lista z rozwijanymi wierszami (telefon), posortowana od subskrypcji płatnych teraz. Panel „Nowa subskrypcja” otwiera się sam przy pustej liście; na telefonie dodawanie na `/subscriptions/new`. Kategorie: 9 domyślnych plus własne. Kwoty „1 233,87 zł”, daty „15.11.2026”. Usunięcie konta usuwa jego dane.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Model kategorii | Jedna tabela `category`: domyślne z `user_id NULL`, własne z `user_id` | Stabilne id pod duplikaty i limity, zmiana domyślnych dociera do wszystkich. | Plan |
| Kategorie domyślne | Streaming, Gry, Oprogramowanie i narzędzia, Chmura i dane, Edukacja, Zdrowie i sport, Prasa i książki, Dom i usługi, Inne | Pokrywają typowe subskrypcje; „Inne” jako wyjście awaryjne. | Plan |
| Statusy przy dodawaniu | Wszystkie 4 (Trial, Aktywna, W trakcie anulowania, Anulowana), domyślnie Aktywna | Pozwala zapisać także historię pod statystyki. | Plan |
| Daty | Następne rozliczenie zawsze wymagane; koniec trialu tylko i zawsze przy Trial; rozliczenie ≥ koniec trialu; przeszłość dozwolona | S-05 i S-06 mają zawsze datę do pracy. | Plan |
| Kwota | 0–99 999,99 zł, 2 miejsca, `numeric(10,2)`, w API string `"43.00"` | 0 pozwala śledzić darmowe plany; limit łapie literówki. | Plan |
| Kolejność listy | Aktywna i Trial → W trakcie anulowania → Anulowana; w grupie po najbliższej dacie, remis po nazwie | Na górze to, za co zaraz zapłacisz; enum gotowy na kolejne sortowania. | Plan |
| Usunięcie konta | Kaskada w danych teraz; funkcja z potwierdzeniem jako nowy slice | S-02 zostaje przy gwieździe przewodniej. | Plan |
| Zamknięte listy | `varchar` + enum TS | Wzorzec repo; zmiana listy bez `ALTER TYPE`. | Research |
| Telefon | Osobna trasa `/subscriptions/new` w `RenderMode.Client` | Makieta F2-Tel-Dodawanie; zgodne z regułą tras po angielsku. | Research / Plan |

## Scope

**In scope:**
- Encje, migracje (schemat + 9 kategorii), seeder bazy dev, `GET/POST /categories`, `GET/POST /subscriptions`
- Testy jednostkowe i e2e: izolacja kont, walidacja, kolejność, kaskada
- Lista (desktop/telefon), stany listy, locale `pl`
- Formularz w panelu i na `/subscriptions/new`, datepicker `dd.mm.rrrr`, własna kategoria
- Dokumentacja, nowy slice usuwania konta, deploy, testy na produkcji

**Out of scope:**
- Edycja i usuwanie subskrypcji (S-03), sumy (S-04), cykl życia i przypomnienia (S-05, S-06), duplikaty i limity (S-07, S-08)
- Sortowanie przez użytkownika, zarządzanie kategoriami, funkcja „Usuń konto”, inne waluty

## Architecture / Approach

Moduł `subscriptions` w API z dwoma encjami; każde zapytanie filtrowane po `currentUser.id`, kolejność listy liczona w SQL według enumu sortowania. Frontend: `SubscriptionsService` i słownik etykiet wspólne dla listy i formularza; jeden komponent formularza używany w panelu (desktop) i na stronie `/subscriptions/new` (telefon); przełączanie układów media query przy 840 px i ~1200 px.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend | Encje, migracje, dane startowe, 4 endpointy, testy | Indeks wyrażeniowy kategorii i `migration:generate` |
| 2. Lista | Locale `pl`, serwis, tabela/lista, stany | Budżet stylów przy dwóch układach |
| 3. Dodawanie | Formularz, panel, `/subscriptions/new`, datepicker, własna kategoria | Parsowanie dat i kwot po polsku |
| 4. Wdrożenie | Dokumentacja, nowy slice, deploy, testy prod | Pierwsze migracje domenowe na produkcji |

**Prerequisites:** lokalny PostgreSQL (`subtracker-db`, `subtracker-db-dev`), działające logowanie lokalnie; push i merge po stronie użytkownika.
**Estimated effort:** ~3–4 sesje (faza 1 i 3 największe).

## Open Risks & Assumptions

- Kategorie domyślnej nie da się zmienić ani ukryć — przy zarządzaniu kategoriami może być potrzebna tabela ukrytych domyślnych.
- Anulowane subskrypcje są na liście; S-04 musi świadomie wykluczyć je z sum.
- Wycofanie migracji na produkcji tylko przez `rollback.sh api` z kopii.

## Success Criteria (Summary)

- Nowy użytkownik dodaje pierwszą subskrypcję i widzi ją na liście w mniej niż 3 minuty od wejścia na stronę.
- Każdy widzi tylko swoje subskrypcje i kategorie; kolejność i formaty zgodne z ustaleniami.
- Na telefonie lista i dodawanie działają bez poziomego przewijania.
