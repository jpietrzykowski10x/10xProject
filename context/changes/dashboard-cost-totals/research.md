---
date: 2026-11-15T11:05:00+01:00
researcher: Claude (Opus 5.5) dla Jakub Pietrzykowski
git_commit: 7904f5e
branch: change/dashboard-cost-totals
repository: 10xProject (SubTracker)
topic: "S-04: na czym opierają się sumy kosztów (miesięczna, roczna, per kategoria) i jakie decyzje są otwarte"
tags: [research, backend-subtracker, frontend-subtracker, subscriptions, totals, rounding, test-plan]
status: complete
last_updated: 2026-11-15
last_updated_by: Claude (Opus 5.5)
---

# Research: sumy kosztów na dashboardzie (S-04)

**Date**: 2026-11-15
**Git Commit**: 7904f5e (main, merge PR #35)
**Branch**: change/dashboard-cost-totals
**Repository**: 10xProject (SubTracker)

## Research Question

Co w kodzie, dokumentach i testach wspiera lub ogranicza slice S-04: „użytkownik widzi na dashboardzie łączny koszt subskrypcji miesięcznie i rocznie, z podziałem na kategorie, zgodny z ręcznym wyliczeniem” (`context/foundation/roadmap.md:166-178`; PRD FR-008 `prd.md:76`, kryterium sukcesu `prd.md:34`)? Które decyzje zostają dla `/10x-plan`?

## Summary

- **Nic jeszcze nie liczy sum.** Ani backend, ani frontend nie ma zapytania agregującego, helpera sum ani trasy „dashboard”.
  - Przeszukane: `backend-subtracker/src` i `test` pod kątem `SUM(`, `GROUP BY`, `addGroupBy`, `getRawMany`, `setTypeParser` (0 wyników); `frontend-subtracker/src/app` pod kątem helperów sum.
  - Jedyne przeliczenie kwoty to frontendowe `monthlyAmount` (`frontend-subtracker/src/app/subscriptions/subscription-amounts.ts:3-16`), używane w jednym miejscu: dopisku przy rocznych subskrypcjach w tabeli (`subscription-table.ts:12,74`, `subscription-table.html:79-81,174-183`).
- **Reguła zaokrąglenia jest ustalona** (decyzja 2026-11-13, `test-plan.md:45,57`): kwota miesięczna subskrypcji rocznej = grosze / 12, zaokrąglone do grosza per subskrypcja, połówka w górę.
  - Tak liczy `monthlyAmount` (`Math.round(grosze / 12)`, `subscription-amounts.ts:13-14`), a test ma wyrocznię policzoną ręcznie (`subscription-amounts.spec.ts:3-32`, np. `12.06 → 1.01`, `99999.99 → 8333.33`).
  - Suma miesięczna musi powstać z kwot już zaokrąglonych per subskrypcja. Najpierw suma, potem dzielenie, nie zgodzi się z dopiskiem na liście (`roadmap.md:176`).
- **Trzy decyzje produktowe nie są nigdzie zapisane.** Wpływają na „zgodność z ręcznym wyliczeniem”:
  1. **Które statusy wchodzą do sum.**
     - Roadmapa oznacza to jako niewiadomą z właścicielem „user” (`roadmap.md:175`).
     - Jedyny ślad to makieta strony startowej: „trial nie wchodzi do sumy” (`context/archive/2026-11-10-ui-foundation/plan.md:249,254`, komentarz w `frontend-subtracker/src/app/pages/home/home.html:26-27`). To statyczny HTML, nie decyzja produktowa.
     - `cancelled` musi zostać odfiltrowany świadomie, bo lista zwraca go razem z resztą (`roadmap.md:176`).
     - O `cancelled_pending` żadne źródło nic nie mówi. FR-013 nazywa okres do następnego rozliczenia „opłaconym” (`prd.md:95`).
  2. **Jak liczyć sumę roczną.**
     - Makieta liczy z kwot surowych: miesięczne × 12 + roczne bez zmian. (43,00 + 23,99) × 12 + 429,99 = 1 233,87 zł (`ui-foundation/plan.md:254`, `home.html:26-27`).
     - Suma miesięczna × 12 dałaby 102,82 × 12 = 1 233,84 zł. Różnica to 3 grosze w tym przykładzie.
     - Test-plan wymaga zgodności „co do grosza” (`test-plan.md:57`), ale nie wskazuje wzoru.
  3. **Gdzie liczyć: API czy frontend.**
     - Roadmapa zakłada API i ostrzega, że musi liczyć tak samo jak `monthlyAmount` (`roadmap.md:176`).
     - Żadne archiwum tego nie rozstrzyga. Frontend ma pełną listę w sygnale strony i przeładowuje ją po każdym zapisie i usunięciu, więc sumy liczone z listy przeliczałyby się same (`pages/subscriptions/subscriptions.ts:143-167,221-265`).
- **„Dashboard” nie jest ekranem w żadnym dokumencie.**
  - PRD używa słowa tylko jako miejsca na sumy, flagi i podsumowanie limitów (`prd.md:34,55,76,82,115`).
  - Projekt F2 umieszcza sumy w granatowej kolumnie powłoki zalogowanego na desktopie i w nagłówku na telefonie, z rozwijanymi kategoriami (`context/archive/2026-11-10-ui-foundation/change.md:17,19,21`).
  - Dziś zalogowany trafia na `/subscriptions` (`frontend-subtracker/src/app/auth/auth.guard.ts:48`, `pages/verify-link/verify-link.ts:33`). Innej trasy dla zalogowanego nie ma (`app.routes.ts`).

## Detailed Findings

### Backend — dane i liczenie

- **Encja `Subscription`** (`backend-subtracker/src/subscriptions/entities/subscription.entity.ts`):
  - `amount` numeric(10,2), typ `string`, „cena za cykl w PLN” (:49-51);
  - `billingCycle` varchar(16) (:53-54) i `status` varchar(32) (:59-60);
  - `userId` z `@Index` (:27-29) i `categoryId` z `@Index` (:36-40); komentarz przy indeksie kategorii wymienia już „S-04 totals”.
- **Wartości pól** (`src/subscriptions/subscription.types.ts`): statusy `trial`, `active`, `cancelled_pending`, `cancelled` (:2-7); cykle `monthly`, `yearly` (:9-12); `AMOUNT_MAX = 99999.99` (:32).
- **Kategorie.** `Category` nie ma kolumny `isDefault`. Wartość wynika z `userId === null` w `toCategoryResponse` (`services/categories.service.ts:17-23`).
- **Kolejność kategorii** w `GET /categories` powstaje w JS, nie w SQL (`categories.service.ts:33-49`): najpierw domyślne w kolejności `DEFAULT_CATEGORIES` (`default-categories.ts:4-18`, „Inne” na końcu), potem własne przez `localeCompare(..., 'pl')`.
- **Precyzja liczb.**
  - Brak parserów typów pg i transformerów kolumn (`src/database/database.options.ts:25-63`), więc `numeric` wraca jako string. SQL `SUM(numeric)` i `COUNT(*)` (bigint) też wróciłyby jako stringi.
  - Backend nigdzie nie liczy kwot na liczbach JS. Jedyna konwersja to `dto.amount.toFixed(2)` przy zapisie (`services/subscriptions.service.ts:45`).
  - Maksymalnie 9 999 999 groszy na wiersz, więc suma w całkowitych groszach mieści się w bezpiecznym zakresie JS.
- **Liczenie w SQL.** `round(amount * 100 / 12)` na `numeric` zaokrągla połówki od zera. Przy kwotach nieujemnych (`@Min(0)`, `dtos/create-subscription.dto.ts:85-88`) to to samo co „połówka w górę” z `Math.round`. Jeśli plan wybierze SQL, zaokrąglenie musi być per wiersz, przed `SUM`.
- **Izolacja.** `list` filtruje `subscription.userId = :userId` (`services/subscriptions.service.ts:84-97`). Nowe zapytanie musi robić to samo (`backend-patterns.md:22`).
- **Kolejność po nazwie.** Sortowanie po nazwie kategorii w SQL wymaga `COLLATE "pl-PL-x-icu"` (`src/shared/database/polish-collation.ts:5`; reguła `backend-patterns.md:101`; CLAUDE.md). Błąd wyjdzie tylko w CI na `C.UTF-8`.
- **Wzorzec nowego endpointu `GET`:**
  - `@Get` + `@Header('Cache-Control', 'no-store')` + `@CurrentUser()` (`controllers/subscriptions.controller.ts:24-28`, `categories.controller.ts:20-24`);
  - typy odpowiedzi w `subscription.types.ts`;
  - rejestracja w `subscriptions.module.ts:11-15`.
- **Testy nowej trasy (cookbook §6.4, `test-plan.md:145-160`):**
  - wpis w `EXPECTED_ROUTES` (`test/routes.e2e-spec.ts:36-63`); `twoAccountTest` jest wymagany tylko dla tras z parametrem (:176-191);
  - wpis w ręcznej liście 401 (`test/subscriptions/access.e2e-spec.ts:28-38,42-71`);
  - test izolacji dwóch kont (`account-isolation.e2e-spec.ts`);
  - pomocnik GET w `test/subscriptions/subscriptions-e2e.ts:59-75` (sprawdza 200 i `no-store`).

### Frontend — gdzie i jak pokazać

- **Format kwot.** Wszędzie `currency: 'PLN' : 'symbol-narrow' : '1.2-2'` z `LOCALE_ID 'pl-PL'`, co daje np. „102,82 zł” (`subscription-table.html:78,81,141,180`, `app.config.ts:13,18`, `src/test-providers.ts:10,13`).
- **Strona `/subscriptions`** (`pages/subscriptions/subscriptions.html`):
  - kolejność: nagłówek z h1 (:6-20), region `role="status"` (:23-27), alert odświeżenia (:30-35), stany listy (:37-55), pasek telefonu (:58-69);
  - panel dodawania i edycji jest elementem obok (:74-109);
  - stan listy to sygnał `state` (`subscriptions.ts:37-38,74`), a `load(true)` po zapisie, `missing` i usunięciu (:221-265). Każdy `computed` nad `state()` przeliczy się bez dodatkowego kodu.
- **Powłoka zalogowanego** (`layout/app-shell/app-shell.html`):
  - granatowa kolumna z jednym linkiem „Subskrypcje” (:5-13) i menu telefonu z jedną pozycją (:33-35);
  - treść strony w `<main class="shell__content">` (:40-47);
  - powłoka jest używana przez każdą stronę z osobna (`<app-shell>` w szablonie strony), nie jako layout trasy.
- **Nowa trasa z guardem.** Musi dostać własny wpis `RenderMode.Client` w `app.routes.server.ts`, bo inaczej spada do `'**'` → Prerender (`app.routes.server.ts:16-35`, `auth.guard.ts:53-55`, CLAUDE.md). Trzeba ją też dopisać do `GUARDED_ROUTES` w `e2e/http/render-modes.e2e-spec.ts:10`.
- **Makieta sum na stronie startowej** (`pages/home/home.html`):
  - karta „Miesięcznie 102,82 zł” i „Rocznie 1 233,87 zł” (:30-39);
  - podział na kategorie z kwotami miesięcznymi, malejąco: Streaming 43,00, Praca 35,83, Muzyka 23,99, wiersz „Miesięcznie 102,82 zł” (:115-132);
  - pasek limitu (:143-154) należy do S-08.
  - Style: `.home__totals`, `.home__total` w `--st-navy` 32 px/700 (`home.scss:102-127`). Komentarz `home.html:1` „Prerendered at build time” jest nieaktualny (trasa to `RenderMode.Server`).
- **Tokeny motywu.** `--st-navy`, `--st-navy-soft`, `--st-muted`, `--st-line`, `--st-page`, `--st-status-*` (`src/styles/_theme.scss:138-163`). Limonki nie ma jako tokenu; według F2 jest zarezerwowana dla paska limitu (`ui-foundation/change.md:15`).
- **Testy.**
  - Helper sum jako czysta funkcja z testem `it.each` i ręczną wyrocznią, wzór `subscription-amounts.spec.ts` (§6.1, `test-plan.md:113-123`).
  - Komponent jako test na granicy HTTP, wzór `subscriptions.spec.ts` (§6.2, `test-plan.md:125-138`).
  - Testy przeglądarkowe na `/subscriptions`: `e2e/browser/subscriptions-flow.e2e-spec.ts`, `subscription-edit-delete.e2e-spec.ts`, `guards.e2e-spec.ts`.

### Dokumenty produktowe

- FR-008 wymaga sumy miesięcznej i rocznej z podziałem na kategorie (`prd.md:76-77`). US-01 mówi o przeliczeniu na dashboardzie (`prd.md:55`). Kryterium: zgodność z ręcznym wyliczeniem dla 100% wprowadzonych subskrypcji (`prd.md:34`).
- Waluta tylko PLN (`prd.md:68,131`).
- Słowo „aktywnych” występuje w FR-009 i FR-011 (`prd.md:82,88`) bez definicji: status `active` czy „nieanulowane”.
- Reguła biznesowa (`prd.md:111-115`): analiza na żądanie i po dodaniu lub edycji. S-03 ustaliło, że sumy liczy się przy odczycie, bez przechowywania (`context/archive/2026-11-15-edit-and-delete-subscription/plan.md:48`).
- S-07 potrzebuje liczby aktywnych subskrypcji per kategoria (`roadmap.md:207-217`). S-08 potrzebuje sumy miesięcznej całościowej i per kategoria (`roadmap.md:219-229`). Kontrakt S-04 może od razu zawierać liczbę subskrypcji per kategoria.

## Code References

- `frontend-subtracker/src/app/subscriptions/subscription-amounts.ts:3-16` — `monthlyAmount`, wzorzec zaokrąglenia
- `frontend-subtracker/src/app/subscriptions/subscription-amounts.spec.ts:3-42` — ręczna wyrocznia zaokrągleń
- `frontend-subtracker/src/app/pages/home/home.html:26-39,115-132` — makieta sum i kategorii z rachunkiem w komentarzu
- `frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts:37-38,143-167,221-265` — stan listy i ponowny odczyt
- `frontend-subtracker/src/app/layout/app-shell/app-shell.html:5-13,33-35,40-47` — kolumna, menu telefonu, treść
- `frontend-subtracker/src/app/app.routes.server.ts:16-35` — tryby renderowania (nowa trasa zalogowanego = `Client`)
- `frontend-subtracker/src/app/auth/auth.guard.ts:48`, `pages/verify-link/verify-link.ts:33` — miejsce, na które trafia zalogowany
- `backend-subtracker/src/subscriptions/entities/subscription.entity.ts:36-60` — kolumny sum i indeks kategorii
- `backend-subtracker/src/subscriptions/services/subscriptions.service.ts:84-97` — wzorzec zapytania z filtrem użytkownika
- `backend-subtracker/src/subscriptions/services/categories.service.ts:33-49` — kolejność kategorii (JS, nie SQL)
- `backend-subtracker/src/shared/database/polish-collation.ts:5` — kolacja dla sortowania nazw w SQL
- `backend-subtracker/test/routes.e2e-spec.ts:36-63`, `test/subscriptions/access.e2e-spec.ts:28-71` — rejestry tras

## Architecture Insights

- Kwoty są stringami z dwoma miejscami. Arytmetyka w całkowitych groszach jest w repo tylko w `monthlyAmount`. W backendzie brak helpera pieniędzy w `src/shared/`. Helper ogólny (string ↔ grosze) trafiłby tam z testem (`lessons.md`, „Kod ogólny w `shared/`”), a reguła „które statusy” zostaje w module subskrypcji.
- Wzór liczony w dwóch bazach kodu (API i frontend) musi mieć tę samą wyrocznię w testach obu stron, bo inaczej lista i sumy rozjadą się po cichu (ryzyko #4, `test-plan.md:45`).
- Odczyt, nie przechowywanie: sumy powstają przy każdym `GET` (S-03), więc edycja i usunięcie nie wymagają przeliczania w tle.

## Historical Context (from prior changes)

- `context/archive/2026-11-13-frontend-unit-tests/plan.md:51-52,301-305` — decyzja o zaokrągleniu per subskrypcja, połówka w górę, z przykładami. Werdykt: obowiązuje i jest w test-planie §2.
- `context/archive/2026-11-11-first-subscription-in-list/plan.md:336` — `monthlyAmount` przeniesione z S-04 do S-02. Werdykt: zgodne z kodem.
- `context/archive/2026-11-11-first-subscription-in-list/plan.md:93` — lista grupuje `active` i `trial` razem. Werdykt: zgodne z `subscription-order.ts:5-10`. To kolejność wyświetlania, nie reguła sum.
- `context/archive/2026-11-10-ui-foundation/plan.md:249,254` — przykład makiety: trial poza sumą, roczna z kwot surowych. Werdykt: rachunek się zgadza (1 233,87), ale to treść makiety, nie decyzja produktowa.
- `context/archive/2026-11-10-ui-foundation/change.md:17,19,21` — sumy w kolumnie desktopu i nagłówku telefonu, zakres S-04/S-07/S-08. Werdykt: kolumna dziś ma tylko nawigację (`app-shell.html:5-13`).
- `context/archive/2026-11-15-edit-and-delete-subscription/plan.md:48` — sumy liczone przy odczycie. Werdykt: obowiązuje.

## Related Research

- `context/archive/2026-11-13-frontend-unit-tests/research.md` (zaokrąglenie)
- `context/archive/2026-11-11-first-subscription-in-list/research.md`
- `context/archive/2026-11-15-edit-and-delete-subscription/research.md`

## Open Questions

Decyzje dla `/10x-plan`:

1. **Statusy w sumach.** `active` na pewno; `cancelled` na pewno nie. `trial`: makieta mówi nie. `cancelled_pending`: brak źródła; FR-013 nazywa ten okres opłaconym. To zarazem definicja „aktywnych” dla S-07/S-08.
2. **Suma roczna.** Z kwot surowych (miesięczne × 12 + roczne; makieta 1 233,87) czy suma miesięczna × 12 (1 233,84). Wybrany wzór trafia do wyroczni testów.
3. **Miejsce obliczeń.** API (`GET` z sumami, jedno źródło prawdy dla S-07/S-08, wzór w SQL albo w groszach w JS) czy frontend (z załadowanej listy, bez nowej trasy API, ale bez wspólnego źródła dla przyszłych alertów).
4. **Miejsce na ekranie.** Granatowa kolumna powłoki na desktopie i nagłówek na telefonie (F2), blok nad tabelą na `/subscriptions`, czy osobna trasa `/dashboard`. Osobna trasa pociąga za sobą `RenderMode.Client`, `GUARDED_ROUTES`, zmianę przekierowania po zalogowaniu i link w nawigacji.
5. **Kształt podziału na kategorie.** Tylko miesięcznie (makieta) czy też rocznie i liczba subskrypcji (pod S-07). Kolejność: malejąco po kwocie (makieta) czy jak `GET /categories`. Sortowanie po nazwie w SQL wymaga kolacji. Czy pokazywać kategorie z zerową sumą.
6. **Pusta lista i same anulowane.** Czy sumy 0,00 zł pokazują się, czy blok się chowa.
