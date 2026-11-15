# Edycja i usuwanie subskrypcji — Plan Brief

> Full plan: `context/changes/edit-and-delete-subscription/plan.md`
> Research: `context/changes/edit-and-delete-subscription/research.md`

## What & Why

Slice S-03 (PRD FR-005, FR-006): użytkownik poprawia dane istniejącej subskrypcji albo trwale usuwa błędnie dodaną. Bez tego każda pomyłka z formularza dodawania zostaje na liście na zawsze i blokuje testowanie kolejnych slice'ów. Usunięcie jest odrębne od anulowania usługi, które należy do cyklu życia (FR-013, S-05).

## Starting Point

API ma tylko `GET` i `POST /subscriptions`, bez żadnej trasy po id. Formularz na `/subscriptions` umie tylko tworzyć, tabela nie ma akcji w wierszu, a w aplikacji nie ma dialogów. CSRF, CORS i bramka testu dwóch kont (`routes.e2e-spec.ts`) są już gotowe na trasy po id.

## Desired End State

Każda subskrypcja na liście ma „Edytuj” i „Usuń” (na desktopie w kolumnie, na telefonie w rozwiniętych szczegółach). Edycja otwiera ten sam panel co dodawanie, wypełniony danymi, i zapisuje przez `PUT`. Usunięcie wymaga potwierdzenia w dialogu i kasuje wiersz przez `DELETE`. Cudze konto dostaje 404 na oba żądania, a dane właściciela zostają nienaruszone.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Kontrakt edycji | `PUT /subscriptions/:id`, pełne ciało jak `POST`, odpowiedź 200 | Reguły dat w DTO czytają `status` z tego samego obiektu, więc DTO tworzenia działa bez zmian | Research + Plan |
| Kody dla id | Cudze i nieistniejące → to samo 404; id, które nie jest UUID → 400; `DELETE` → 204, powtórny → 404 | Nie ujawnia istnienia cudzych danych (jak precedens kategorii), a 400 chroni zapytanie przed 500 z Postgresa | Plan |
| Status przy edycji | Dowolny z 4, reguły dat jak przy dodawaniu, wyjście z trialu czyści datę | FR-005 to poprawianie pomyłek; maszyna stanów zostaje w S-05 | Plan |
| Miejsce edycji | Ten sam panel co dodawanie, tryb „Nowa”/„Edycja” | Zgodne z ui-foundation (link „Edytuj” w rozwiniętym wierszu) i używa układu, fokusu, Escape i `inert` | Plan |
| Potwierdzenie usunięcia | Dialog Material z nazwą, bez czerwonego przycisku | Dostępny wzorzec na desktopie i telefonie; czerwień zostaje tylko dla błędów | Plan |
| URL i e2e | Bez parametru URL; jeden test Playwright (edycja i usunięcie) | Spójne z dodawaniem; reszta pokryta tańszymi warstwami (§6.5) | Plan |
| Usunięta w innej karcie | Edycja i usunięcie przy 404: komunikat „Tej subskrypcji już nie ma na liście.” i odświeżenie listy | Użytkownik nie dostaje ogólnego „serwis niedostępny” dla zrozumiałej sytuacji | Plan |

## Scope

**In scope:**
- `PUT` i `DELETE /subscriptions/:id`:
  - testy API, w tym test dwóch kont;
  - rejestr tras i przypadki 401.
- Formularz w trybie edycji i mapowanie API → formularz (z testem jednostkowym).
- Akcje w tabeli, tryb panelu na stronie, dialog usunięcia, komunikaty.
- Jeden test Playwright i uzupełnienie cookbooka (§6.2, §6.4, §6.5).

**Out of scope:**
- `PATCH`, ograniczenia przejść statusu i wersjonowanie.
- Parametr URL i obsługa przycisku „wstecz”.
- Przeliczanie sum, budżetu i duplikatów (S-04, S-07, S-08).
- Edycja i usuwanie kategorii.
- Cofnięcie usunięcia i miękkie usuwanie.
- Zmiany schematu bazy.

## Architecture / Approach

Backend: kontroler z `ParseUUIDPipe` → serwis szukający po `{ id, userId }` (404) → `findUsable` dla kategorii (400) → wspólna funkcja budująca pola wiersza z DTO dla `create` i `update`. Frontend: tabela emituje `edit` i `remove`. Strona trzyma tryb panelu `closed | add | edit(subscription)` i tworzy formularz od nowa przy zmianie celu. Formularz z wejściem `subscription` wysyła `PUT` zamiast `POST`. Dialog sam wysyła `DELETE` i zwraca `'deleted' | 'missing'`. Po każdej zmianie lista odświeża się z API.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. API edycji i usuwania | `PUT`/`DELETE /subscriptions/:id` z izolacją kont i testami | IDOR: brak filtra `userId` (pilnuje test dwóch kont i sabotaż) |
| 2. Edycja w panelu | Edytuj z wiersza → wypełniony formularz → `PUT` → odświeżona lista | Przeciek danych między dodawaniem a edycją w jednym panelu |
| 3. Usuwanie z dialogiem | Usuń → dialog → `DELETE` → komunikat | Pierwszy `MatDialog`: fokus i działanie na telefonie |
| 4. Test przeglądarkowy i cookbook | Playwright edycja + usunięcie; §6 test-planu | Test na starym buildzie (wymaga `build:e2e`) |

**Prerequisites:** lokalny PostgreSQL i `backend-subtracker/.env` z `MODE=DEV` oraz `http://localhost:4000` w `CORS_ORIGINS` (dla faz 1 i 4); branch `change/edit-and-delete-subscription`.
**Estimated effort:** ~3–4 sesje, po jednej na fazę (fazy 2 i 3 najcięższe).

## Open Risks & Assumptions

- Zakładamy, że `@IsUUID()` w DTO i `ParseUUIDPipe` przyjmują te same id (oba bez ograniczenia wersji). Id z bazy to UUID v4.
- Przy dwóch równoczesnych edycjach wygrywa ostatni zapis, co dla aplikacji jednego użytkownika jest akceptowalne.
- S-05 może później ograniczyć zmiany statusu i zmienić kontrakt `PUT`.

## Success Criteria (Summary)

- Użytkownik poprawia dowolne pole subskrypcji i widzi zmianę na liście na desktopie i telefonie.
- Użytkownik usuwa subskrypcję po potwierdzeniu i nie ma jej po przeładowaniu.
- Inne konto nie zmienia ani nie usuwa cudzej subskrypcji (404, dane nienaruszone). Pilnuje tego test w CI.
