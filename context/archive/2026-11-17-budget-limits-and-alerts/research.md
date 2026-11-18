---
date: 2026-11-17T13:21:44+01:00
researcher: Jakub Pietrzykowski (z Claude Code)
git_commit: 7a9c7144022b1b30fe6c7432acc93d4a88517a86
branch: main
repository: 10xProject (SubTracker)
topic: "S-08 budget-limits-and-alerts — na czym oprzeć limity budżetu (całościowy i per kategoria) i alerty 80% / 100%"
tags: [research, backend-subtracker, frontend-subtracker, cost-totals, budget, s-08]
status: complete
last_updated: 2026-11-17
last_updated_by: Jakub Pietrzykowski (z Claude Code)
---

# Research: S-08 — limity budżetu i alerty 80% / 100%

**Date**: 2026-11-17T13:21:44+01:00
**Researcher**: Jakub Pietrzykowski (z Claude Code)
**Git Commit**: 7a9c7144022b1b30fe6c7432acc93d4a88517a86
**Branch**: main
**Repository**: 10xProject (SubTracker)

## Research Question

Roadmap S-08 (FR-010, FR-011, FR-005): użytkownik ustawia miesięczny limit całościowy i limity per kategoria, a dashboard pokazuje alert przy 80% i 100% limitu, przeliczany po dodaniu lub edycji subskrypcji. Co już istnieje w kodzie i w decyzjach z archiwum, gdzie trzeba zapisać limity, jak liczyć procent i gdzie pokazać alert? Które decyzje są jeszcze otwarte?

## Summary

- **Sumy, do których porównujemy limit, już są.** `GET /subscriptions/totals` zwraca `monthly` (całość) i `categories[].monthly` jako stringi z dwoma miejscami (`"43.00"`) (`backend-subtracker/src/subscriptions/subscription.types.ts:55-68`). Liczy je `costTotals()` w groszach w JS (`cost-totals.ts:48-81`) po `COUNTED_STATUSES` = `trial`, `active`, `cancelled_pending` (`cost-totals.ts:10-18`). `backend-patterns.md:104` zapisuje, że ta definicja „aktywnych” obowiązuje też w S-08.
- **Kwota miesięczna subskrypcji rocznej jest już ustalona:** grosze / 12, zaokrąglone per subskrypcja, połówka w górę. Suma miesięczna to suma tych kwot, nigdy roczna / 12 (`backend-patterns.md:105`, `cost-totals.ts:22-24`). Miesięczny limit porównany z `monthly` z `/totals` dziedziczy tę regułę bez nowego kodu.
- **Nie ma miejsca na limity.** Nie ma ustawień użytkownika (encje `user`, `role`, `user_role` ich nie mają), a kategorie domyślne to wspólne wiersze z `user_id NULL` (`category.entity.ts:27`). Limit całościowy to jedna wartość na użytkownika, limity per kategoria to wartości per (użytkownik, kategoria). Obie wymagają nowych tabel lub kolumn. To wniosek z modelu danych.
- **Kwoty mają gotowy wzorzec:** `numeric(10,2)`, w encji string, wejście jako liczba z `@IsNumber({ maxDecimalPlaces: 2 })` + `@Min`/`@Max`, zapis `toFixed(2)`, arytmetyka w groszach (`backend-patterns.md` „Dane domenowe”; `create-subscription.dto.ts:67-70`; `src/shared/money/grosze.ts`). Nie ma współdzielonego dekoratora kwoty. Reguły siedzą w DTO subskrypcji, więc wspólny `IsAmount` trzeba by dopisać w `src/shared/validation/` (lessons.md, „Kod ogólny w `shared/`”).
- **Przeliczanie po zmianie (FR-005) już działa,** jeśli alert przyjdzie z `/totals`, bo frontend woła `CostTotalsStore.refresh()` po każdej akcji na subskrypcji (`pages/subscriptions/subscriptions.ts:247-257, 295, 358-368`). Po zmianie limitu trzeba dodać ten sam `refresh()`.
- **Wygląd jest ustalony w F2:** limetkowy `#D6F25E` tylko na pasku limitu (jeszcze nie jest tokenem), ostrzeżenia na `--st-warning-bg`/`--st-warning-text`. Makieta: „Limit 200,00 zł” z paskiem 85% (`frontend-subtracker/src/app/pages/home/home.html:146-153`).
- **Do decyzji w `/10x-plan`:** granice 80/100 (≥ czy >), wartość 0 lub brak limitu, czy suma limitów kategorii może przekroczyć limit całościowy, gdzie limity się ustawia. Szczegóły w Open Questions.

## Detailed Findings

### Backend: sumy

- `GET /subscriptions/totals`: `controllers/subscriptions.controller.ts:34-38`, `Cache-Control: no-store`, wymaga sesji (`test/routes.e2e-spec.ts:49`).
- `SubscriptionsService.totals(userId)` (`services/subscriptions.service.ts:112-130`): SQL filtruje po użytkowniku i `COUNTED_STATUSES`. Grupowanie i sumy liczy `costTotals()` w JS.
- `monthlyGrosze` (`cost-totals.ts:22-24`): roczna → `Math.round(grosze / 12)`, miesięczna bez zmian. `yearlyGrosze` (:27-29): miesięczna × 12.
- Kategorie z zerową sumą nie trafiają do odpowiedzi (`context/archive/2026-11-15-dashboard-cost-totals/plan.md:20,45`). Kategoria z limitem, ale bez aktywnych subskrypcji (0% wykorzystania), nie ma więc dziś wiersza w `/totals`.
- Pomocniki pieniędzy: `toGrosze("43.00") → 4300` (rzuca wyjątek przy innym formacie), `fromGrosze(4300) → "43.00"`, `formatPln` (`src/shared/money/grosze.ts:6-29`).

### Model danych i wzorce zapisu

- Kategorie: jedna tabela, `user_id NULL` = domyślna (9 stałych UUID, `subscriptions/default-categories.ts:4-18`), własne mają `user_id` (`category.entity.ts:17-54`). Nie ma tras zmiany nazwy ani usuwania kategorii. FK `subscription.category_id` ma `NO ACTION` (migracja `1794406389791-SubscriptionsSchema.ts:29`).
- Użytkownik (`users/entities/user.entity.ts`): bez kolumn ustawień. Limit całościowy może być kolumną nullable na `user` albo wierszem w nowej tabeli ustawień. Kolumna nullable nie wymaga backfillu (reguła „nowa kolumna NOT NULL” z `backend-patterns.md` jej nie dotyczy).
- Sprawdzenie kategorii przy zapisie limitu: `CategoriesService.findUsable` (`services/categories.service.ts:80-87`). Cudza lub nieznana kategoria dostaje 400, tak jak przy subskrypcjach.
- Wzorzec aktualizacji: `PUT /subscriptions/:id` z pełnym DTO i `update({ id, userId })`, 404 dla cudzego zasobu (`subscriptions.service.ts:149-171`). Dla ustawień per użytkownik albo upsertu per kategoria nie ma wzorca w repo, więc kształt tras to nowa decyzja.
- Walidacja: globalny `ValidationPipe` (`app.module.ts:41-48`). CSRF jest globalny (`config/http-security.ts:14`).

### Frontend

- `CostTotalsStore` (`subscriptions/cost-totals.store.ts`): root, `load`/`refresh`/`clear`, anuluje starsze żądanie. Naturalne źródło alertów, jeśli przyjdą z `/totals`.
- Miejsca w `cost-totals.html`: suma całościowa miesięczna i roczna (:8-19) to miejsce na pasek i alert limitu całościowego. Wiersz kategorii (:26-37) to miejsce na alert limitu kategorii, ale leży w zwiniętym `<details>` (:22-24).
- Ten sam komponent renderuje się jako kolumna (desktop) i pasek (telefon, < 840 px): `layout/app-shell/app-shell.html:15,33`. W F2 nagłówek na telefonie zawiera „kwota, rocznie, limit, kategorie rozwijane” (`context/archive/2026-11-10-ui-foundation/change.md:19`).
- Kwoty na froncie: `parseDecimal` (`shared/decimal.ts:7`), `parseAmount`/`amountValidator` (`subscriptions/subscription-validators.ts:7,12`) można wykorzystać w formularzu limitu.
- Nie ma strony ustawień ani budżetu. Nowa trasa wymaga `RenderMode.Client` w `app.routes.server.ts` i wpisu w `GUARDED_ROUTES` (`e2e/http/render-modes.e2e-spec.ts`). W nawigacji link trzeba dodać w dwóch miejscach (`app-shell.html:5-13` i :36-42). Pozycja „Budżet” była odłożona „dopóki nie ma tej strony” (`ui-foundation/plan.md:38`).
- Budżet stylów komponentu: 10/25 kB (`ui-foundation/plan.md:456`).

### Testy (test-plan.md)

- Ryzyko #4 (sumy niezgodne z ręcznym wyliczeniem) wymienia S-08 jako źródło (`test-plan.md:45`). Procent wykorzystania i granice 80/100 testujemy unitowo tabelą z wyroczniami liczonymi ręcznie (§6.3, wzór `cost-totals.spec.ts`), z przypadkami na granicy: dokładnie 80%, 79,99%, dokładnie 100% i reszta z dzielenia przez 12.
- Ryzyko #7 (komponent albo komunikat walidacji się nie pokazuje) wymienia S-08 (`test-plan.md:48`): formularz limitu testujemy harnessami (§6.2).
- Ryzyko #1 (IDOR): każda trasa z id kategorii ma test na dwóch kontach. Nowe trasy trafiają do `EXPECTED_ROUTES` i `access.e2e-spec.ts` (§6.4).
- Bramki §5: lint backendu, build AOT frontendu, unit na obu (frontend w dwóch strefach), `backend-e2e` na `C.UTF-8`, `browser-e2e` (`test-plan.md:98-106`).

## Code References

- `backend-subtracker/src/subscriptions/cost-totals.ts:10-29` — `COUNTED_STATUSES`, `monthlyGrosze`, `yearlyGrosze`
- `backend-subtracker/src/subscriptions/cost-totals.ts:48-81` — `costTotals()`
- `backend-subtracker/src/subscriptions/subscription.types.ts:32,55-68` — `AMOUNT_MAX`, kształt `/totals`
- `backend-subtracker/src/subscriptions/dtos/create-subscription.dto.ts:67-70` — walidacja kwoty (wzór dla limitu)
- `backend-subtracker/src/shared/money/grosze.ts:6-29` — `toGrosze`, `formatPln`, `fromGrosze`
- `backend-subtracker/src/subscriptions/services/categories.service.ts:80-87` — `findUsable`
- `backend-subtracker/src/users/entities/user.entity.ts` — brak ustawień użytkownika
- `frontend-subtracker/src/app/subscriptions/cost-totals/cost-totals.html:8-41` — suma całościowa i wiersze kategorii
- `frontend-subtracker/src/app/subscriptions/cost-totals.store.ts` — store sum
- `frontend-subtracker/src/app/pages/home/home.html:137-153` — makieta alertu i paska limitu

## Architecture Insights

- Procent wykorzystania i stan alertu (poniżej 80, ≥80, ≥100 albo inny wybór granic) to czysta funkcja na groszach. Wynik powinien być stanem (enum), nie liczbą zmiennoprzecinkową w odpowiedzi API. Porównanie w liczbach całkowitych (`spent * 100 >= limit * 80`) omija błędy zaokrągleń floatów. To wniosek; żadna istniejąca reguła tego nie zapisuje.
- Limity w groszach obok sum: obie strony porównania liczy ta sama ścieżka (`costTotals`), więc alert nie rozjedzie się z kwotą widoczną w kolumnie (ryzyko #4).
- Nowa tabela limitów per (user, category): `user_id` z `ON DELETE CASCADE`, `category_id` z `@Index()` (lessons.md), `Relation<T>`, migracja wygenerowana na koniec względem `subtracker-db`.
- Wspólny zasób z S-07: obie zmiany rozszerzają `/totals`, `CategoryCostTotal`, `cost-totals.html` i być może wspólną stronę ustawień. Jeśli progi duplikatów i limity kategorii trafią do jednej tabeli per (user, category) z kolumnami nullable, wystarczy jedna tabela i jeden ekran. To opcja do decyzji w planie, nie ustalenie.

## Historical Context (from prior changes)

- `context/archive/2026-11-15-dashboard-cost-totals/plan.md:21` — „aktywne” = `trial`, `active`, `cancelled_pending`, ta sama definicja dla S-08. Stan: obowiązuje (`cost-totals.ts:10-18`, `backend-patterns.md:104`).
- `context/archive/2026-11-15-dashboard-cost-totals/plan-brief.md:68` — zaakceptowane ryzyko: `cancelled_pending` liczy się do daty rozliczenia, a roczna w całości. Wpływa na alert limitu tak samo jak na sumy.
- `context/archive/2026-11-15-dashboard-cost-totals/plan.md:47`, `plan-brief.md:42` — limit budżetu i limetkowy pasek świadomie odłożone do S-08.
- `context/archive/2026-11-15-edit-and-delete-subscription/plan.md:48` — „tamte slice'y liczą przy odczycie”, czyli FR-005 spełnione przez liczenie przy odczycie. Stan: obowiązuje.
- `context/archive/2026-11-10-ui-foundation/change.md:15,19` i `plan.md:85` — kolory (limetka tylko na pasku limitu, ostrzeżenia `#FDF1DC`/`#6B4100`), limit w nagłówku na telefonie.
- `context/foundation/prd.md:89,92` i `roadmap.md:228` — progi 80/100 stałe w MVP. Konfigurowalne progi (FR-017) i prognoza przed dodaniem (FR-012) są odłożone (`roadmap.md:291,294`).

## Related Research

- `context/archive/2026-11-15-dashboard-cost-totals/research.md`
- `context/changes/category-duplicate-warning/research.md` (S-07, równoległy research z tego samego dnia)

## Open Questions

1. **Granice alertu:** FR-011 mówi „przy przekroczeniu progów” (`prd.md:88`), a makieta „przy 80% i 100% limitu” (`home.html:140`). Czy 80% oznacza ≥ czy >? Czy dokładnie 100% to „osiągnięty” (alert 100%), czy jeszcze nie „przekroczony”? Business Logic rozróżnia „zbliżanie się” od „przekroczenia” (`prd.md:113`).
2. **Brak limitu i zero:** czy limit można usunąć (null = brak alertu)? Czy 0 jest dozwolone (dzielenie przez zero, każda subskrypcja = 100%)? Jakie maksimum (np. `AMOUNT_MAX = 99999.99`, `subscription.types.ts:32`)?
3. **Czy suma limitów kategorii może przekroczyć limit całościowy?** PRD tego nie określa.
4. **Limit kategorii bez aktywnych subskrypcji:** `/totals` pomija takie kategorie. Czy dashboard ma pokazywać „0 / 50 zł”, czy tylko kategorie z wydatkami? Na pewno dotyczy to ekranu ustawień, który potrzebuje pełnej listy kategorii (`GET /categories`).
5. **Gdzie ustawia się limity?** Osobna strona „Budżet” (wspólna z progami S-07) czy edycja w kolumnie. Jak alert wygląda na telefonie i w zwiniętym `<details>`?
6. **Trial w budżecie:** trial liczy się do sum zgodnie z decyzją S-04, więc może wywołać alert, zanim użytkownik cokolwiek zapłaci. Decyzja jest zapisana; tu tylko przypomnienie, że wpływa na alerty.
7. **Kolejność z S-07:** obie zmiany dotykają tych samych plików (`costTotals`, `subscription.types.ts`, `cost-totals.html`). Lepiej dostarczyć je po kolei albo wcześniej ustalić wspólny kształt.
