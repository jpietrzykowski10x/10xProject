---
date: 2026-11-17T13:21:44+01:00
researcher: Jakub Pietrzykowski (z Claude Code)
git_commit: 7a9c7144022b1b30fe6c7432acc93d4a88517a86
branch: main
repository: 10xProject (SubTracker)
topic: "S-07 category-duplicate-warning — na czym oprzeć próg aktywnych subskrypcji per kategoria i flagę na dashboardzie"
tags: [research, backend-subtracker, frontend-subtracker, cost-totals, categories, s-07]
status: complete
last_updated: 2026-11-17
last_updated_by: Jakub Pietrzykowski (z Claude Code)
---

# Research: S-07 — ostrzeżenie o duplikatach w kategorii

**Date**: 2026-11-17T13:21:44+01:00
**Researcher**: Jakub Pietrzykowski (z Claude Code)
**Git Commit**: 7a9c7144022b1b30fe6c7432acc93d4a88517a86
**Branch**: main
**Repository**: 10xProject (SubTracker)

## Research Question

Roadmap S-07 (FR-009, FR-005): użytkownik ustawia próg aktywnych subskrypcji per kategoria (domyślnie 2), a po dodaniu lub edycji subskrypcji widzi na dashboardzie flagę przy kategorii, która ten próg przekracza. Co już istnieje w kodzie i w decyzjach z archiwum, gdzie trzeba zapisać próg i gdzie pokazać flagę? Które decyzje produktowe są jeszcze otwarte?

## Summary

- **Licznik już jest.** `GET /subscriptions/totals` zwraca dla każdej kategorii `subscriptionCount` liczony po `COUNTED_STATUSES` = `trial`, `active`, `cancelled_pending` (`backend-subtracker/src/subscriptions/cost-totals.ts:10-18`). Komentarz w kodzie i `context/foundation/backend-patterns.md:104` mówią wprost, że ta lista definiuje „aktywne” także dla S-07. Do zrobienia zostaje próg i porównanie z nim, licznika nie trzeba liczyć od nowa.
- **Nie ma miejsca na ustawienia użytkownika.** W sprawdzonych encjach `user`, `role` i `user_role` nie ma kolumny ani tabeli z preferencjami. Kategorie domyślne to wspólne wiersze z `user_id NULL` (`category.entity.ts:27,34-36`), więc próg per użytkownik nie zmieści się w kolumnie `category`. Potrzebna jest nowa tabela per (użytkownik, kategoria). To wniosek z modelu danych, dokumenty go nie zapisują.
- **Przeliczanie po zmianie (FR-005) już działa.** Sumy liczą się przy odczycie, a frontend wywołuje `CostTotalsStore.refresh()` po zapisie, usunięciu, anulowaniu i wznowieniu subskrypcji (`frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts:247-257, 295, 358-368`). Jeśli flaga przyjdzie w tej samej odpowiedzi `/totals`, odświeży się bez nowego kodu. Ten sam `refresh()` trzeba też wywołać po zmianie progu.
- **„Dashboard” to komponent `<app-cost-totals>` w app-shellu**, a nie osobna trasa. Komponent jest renderowany dwa razy: jako kolumna na desktopie i pasek na telefonie (`layout/app-shell/app-shell.html:15,33`). Wiersz kategorii (`subscriptions/cost-totals/cost-totals.html:26-37`) leży w zwiniętym `<details>`, więc flaga w samym wierszu jest domyślnie niewidoczna.
- **Do decyzji w `/10x-plan`:** czy flaga pojawia się przy liczbie większej od progu, czy równej mu; gdzie użytkownik ustawia próg; zakres wartości progu. Szczegóły w Open Questions.

## Detailed Findings

### Backend: sumy i licznik per kategoria

- Endpoint `GET /subscriptions/totals`: `backend-subtracker/src/subscriptions/controllers/subscriptions.controller.ts:34-38`. Zwraca `Cache-Control: no-store` i stoi przed trasami `:id`.
- `SubscriptionsService.totals(userId)` jest w `services/subscriptions.service.ts:112-130`. SQL tylko wybiera wiersze: filtruje po `userId` i `status IN COUNTED_STATUSES` i dołącza kategorię. Nie używa SUM, GROUP BY ani ORDER BY. Resztę liczy czysta funkcja `costTotals()`.
- `costTotals()` (`cost-totals.ts:48-81`) grupuje w `Map` po `category.id`, sumuje grosze i zlicza `subscriptionCount`. Sortuje po kwocie miesięcznej malejąco, potem po nazwie (`localeCompare('pl')`), potem po id.
- Kształt odpowiedzi: `CategoryCostTotal { category: {id,name,isDefault}, monthly, yearly, subscriptionCount }` (`subscription.types.ts:55-68`). Lista zawiera tylko kategorie, które mają co najmniej jedną liczoną subskrypcję. Kategorii bez aktywnych subskrypcji nie ma w odpowiedzi, ale też nie mogą przekroczyć progu ≥ 1.

### Model kategorii

- Domyślne i własne kategorie leżą w jednej tabeli `category`: `user_id NULL` oznacza kategorię domyślną (`entities/category.entity.ts:27,34-36`). Jest 9 domyślnych z ustalonymi UUID (`subscriptions/default-categories.ts:4-18`), seedowanych migracją `1794406400550-SeedDefaultCategories.ts`.
- Nie ma tras zmiany nazwy ani usuwania kategorii (`controllers/categories.controller.ts`: tylko GET :20-24 i POST :27-34). Jeśli nowa tabela będzie miała FK do `category`, sposób kasowania trzeba dobrać do reguły z `backend-patterns.md` (FK między tabelami domeny = `NO ACTION`).
- Sprawdzenie „moja albo domyślna kategoria” robi `CategoriesService.findUsable(userId, categoryId)` (`services/categories.service.ts:80-87`). Subskrypcje zamieniają brak kategorii na 400. Ustawienie progu dla cudzej kategorii powinno dostać tę samą odpowiedź.

### Wzorce API do ponownego użycia

- Walidacja: globalny `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` (`app.module.ts:41-48`), DTO z class-validator, helpery w `src/shared/validation/` (`TrimmedString`, `IsDateOnly`).
- Aktualizacja: `PUT /subscriptions/:id` z `ParseUUIDPipe` i `update({ id, userId })`. Gdy `affected = 0`, zwraca 404 (`subscriptions.service.ts:149-171`). Cudzy zasób dostaje 404, nigdy 403 (:30). Dla singletonu ustawień per użytkownik albo upsertu per kategoria nie ma jeszcze wzorca w repo, więc kształt trasy to nowa decyzja.
- CSRF jest globalny (`config/http-security.ts:14`) i trasy nie wymagają nic dodatkowego.

### Frontend

- `CostTotalsStore` (`subscriptions/cost-totals.store.ts`, `providedIn: 'root'`) ma `load()`, `refresh()` (zostawia stare sumy do czasu odpowiedzi), `clear()` (przy wylogowaniu i 401) i anuluje starsze żądanie (:42).
- Miejsce na flagę: wiersz `div.totals__category` (`cost-totals.html:26-37`) leży w `<details class="totals__categories">` z `<summary>Kategorie</summary>` (:24). Bez znacznika na `<summary>` zwinięta flaga zostanie przeoczona.
- Kolory ostrzeżeń są już ustalone w F2: tokeny `--st-warning-bg` `#FDF1DC` i `--st-warning-text` `#6B4100` (`context/archive/2026-11-10-ui-foundation/plan.md:85`). Makieta na stronie głównej ma przykład „Streaming: 3 aktywne subskrypcje, Twój próg to 2.” (`frontend-subtracker/src/app/pages/home/home.html:144`).
- Trasy: nie ma strony ustawień ani budżetu (`app.routes.ts:4-41`). Nowa trasa wymaga wpisu `RenderMode.Client` w `app.routes.server.ts`, bo inaczej `'**'` ją prerenderuje. Trzeba ją też dopisać do `GUARDED_ROUTES` w `e2e/http/render-modes.e2e-spec.ts`. Nawigacja ma dwa miejsca: `app-shell.html:5-13` (desktop) i :36-42 (menu na telefonie).
- Kategorie pobiera dziś tylko `SubscriptionForm` (`subscription-form/subscription-form.ts:144,191-202`), do lokalnego sygnału. Nie ma współdzielonego cache.

### Testy (test-plan.md §6)

- Backend unit: wzór `src/subscriptions/cost-totals.spec.ts` (§6.3, `test-plan.md:140-148`). Porównanie licznika z progiem to czysta funkcja, którą warto testować tabelą z granicą (próg−1, próg, próg+1).
- API e2e (§6.4, `test-plan.md:150-178`): każda nowa trasa trafia do `EXPECTED_ROUTES` (`test/routes.e2e-spec.ts`) i do listy w `test/subscriptions/access.e2e-spec.ts`. Każda trasa z id kategorii potrzebuje testu na dwóch kontach (ryzyko #1, IDOR).
- Frontend: komponent testujemy harnessami, a komunikaty sprawdzamy przez `[role="alert"]` albo `hasErrors()`, nie po treści (§6.2, `test-plan.md:125-138`). `pages/subscriptions/subscriptions.spec.ts` już sprawdza ponowne pobranie `/subscriptions/totals` po każdej akcji (`:57-60` `flushTotals`).
- Browser e2e (§6.5) tylko wtedy, gdy tańsza warstwa nie pokrywa ryzyka. Dziś żaden test Playwright nie sprawdza sum.

## Code References

- `backend-subtracker/src/subscriptions/cost-totals.ts:10-18` — `COUNTED_STATUSES` i komentarz o S-07/S-08
- `backend-subtracker/src/subscriptions/cost-totals.ts:48-81` — `costTotals()`, grupowanie po id kategorii, `subscriptionCount`
- `backend-subtracker/src/subscriptions/subscription.types.ts:55-68` — `CostTotalsResponse`, `CategoryCostTotal`
- `backend-subtracker/src/subscriptions/controllers/subscriptions.controller.ts:34-38` — `GET /subscriptions/totals`
- `backend-subtracker/src/subscriptions/entities/category.entity.ts:17-54` — model kategorii, `user_id NULL` = domyślna
- `backend-subtracker/src/subscriptions/services/categories.service.ts:80-87` — `findUsable`
- `frontend-subtracker/src/app/subscriptions/cost-totals.store.ts` — store sum (load/refresh/clear)
- `frontend-subtracker/src/app/subscriptions/cost-totals/cost-totals.html:22-41` — lista kategorii w `<details>`
- `frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts:240-368` — wywołania `totals.refresh()`
- `frontend-subtracker/src/app/layout/app-shell/app-shell.html:5-42` — nawigacja i dwa egzemplarze `<app-cost-totals>`

## Architecture Insights

- Zasada S-04: SQL tylko filtruje, a całą arytmetykę i zliczanie robi JS w czystej funkcji (`backend-patterns.md:102-108`). Flaga S-07 pasuje do tego wzorca jako pole liczone w `costTotals()` albo obok, na danych z tego samego zapytania.
- Przeliczanie przy odczycie zamiast trzymania stanu flagi w bazie spełnia FR-005 bez dodatkowego kodu (`context/archive/2026-11-15-edit-and-delete-subscription/plan.md:48`).
- Nowa tabela per (user, category): `user_id` z `ON DELETE CASCADE`. FK `category_id` dostaje własny `@Index()`, chyba że jest pierwszą kolumną klucza (lessons.md, „Indeksy”). Relacje jako `Relation<T>` (lessons.md). Na końcu `migration:generate` względem `subtracker-db`. Wartość domyślną 2 lepiej trzymać jako stałą w kodzie (brak wiersza = 2) niż seedować wiersze dla każdego użytkownika.
- `subscriptionCount` w `CategoryCostTotal` jest współdzielony z S-08, więc obie zmiany prawdopodobnie rozszerzą tę samą odpowiedź `/totals`. Przy równoległej pracy grozi to konfliktem w `costTotals()`, `subscription.types.ts` i `cost-totals.html`.

## Historical Context (from prior changes)

- `context/archive/2026-11-15-dashboard-cost-totals/plan.md:21` — „aktywne” = `trial`, `active`, `cancelled_pending`, definicja dla S-07 i S-08 (wybór użytkownika: `plan-brief.md:23`). Stan: obowiązuje, potwierdzone w kodzie `cost-totals.ts:10-18`.
- `context/archive/2026-11-15-dashboard-cost-totals/plan-brief.md:26,28` — `subscriptionCount` dodany do odpowiedzi „pod S-07/S-08”. Stan: obowiązuje.
- `context/archive/2026-11-15-dashboard-cost-totals/plan.md:47` — ostrzeżenia o duplikatach świadomie odłożone do S-07.
- `context/archive/2026-11-11-first-subscription-in-list/plan-brief.md:22` — kategorie dostały stabilne id „pod duplikaty i limity”.
- `context/archive/2026-11-10-ui-foundation/plan.md:37-38` — kolumna pokazuje tylko to, co działa. Pozycji „Budżet” w nawigacji nie dodano, „dopóki nie ma tej strony”. Wynika z tego, że ustawienia miały mieć osobną stronę, ale tego nie przesądzono.
- `context/archive/2026-11-15-dashboard-cost-totals/research.md:136` — makieta F2 pomijała trial w sumie. Uznano to za treść makiety, nie decyzję produktową. Obowiązuje decyzja z planu S-04.

## Related Research

- `context/archive/2026-11-15-dashboard-cost-totals/research.md`
- `context/changes/budget-limits-and-alerts/research.md` (S-08, równoległy research z tego samego dnia)

## Open Questions

1. **Flaga przy liczbie większej od progu czy równej mu?** FR-009 mówi „po przekroczeniu” (`prd.md:82`), więc przy progu 2 flaga pojawia się od 3. Tak samo czyta się makieta „3 aktywne, próg 2” (`home.html:144`). Ale reguła z shape-notes to „2+ aktywne subskrypcje → flaga” (`shape-notes.md:43`), a nota Sokratesa (`prd.md:83`) i FR-015 (`prd.md:101`) też mówią „2+”, czyli flaga już od 2. Decyzja należy do użytkownika.
2. **Gdzie użytkownik ustawia próg?** Opcje: osobna strona ustawień lub budżetu, wspólna z S-08 (`ui-foundation/plan.md:38`), albo edycja w wierszu kategorii w kolumnie sum. Dla progów kategorii, które nie mają teraz aktywnych subskrypcji, potrzebna jest lista wszystkich kategorii użytkownika (`GET /categories`), nie tylko tych z `/totals`.
3. **Zakres progu:** minimum (1? 0 = wyłączone?) i maksimum. Brak wartości oznacza domyślne 2.
4. **Czy `cancelled_pending` liczy się jako duplikat?** Formalnie tak, bo jest na liście `COUNTED_STATUSES`. Użytkownik może się zdziwić, że anulowana subskrypcja nadal daje flagę. Zmiana tego oznacza odejście od zapisanej definicji.
5. **Widoczność flagi w zwiniętym `<details>` i na telefonie:** czy `<summary>` dostaje znacznik lub licznik ostrzeżeń.
6. **Kolejność z S-08:** obie zmiany rozszerzają `/totals` i `cost-totals.html`. Lepiej dostarczyć je po kolei albo wcześniej ustalić wspólny kształt odpowiedzi i stronę ustawień.
