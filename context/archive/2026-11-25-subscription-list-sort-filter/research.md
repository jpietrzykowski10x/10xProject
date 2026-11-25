---
date: 2026-11-25T16:37:21+01:00
researcher: Claude (agent, /10x-research bez nadzoru)
git_commit: 2ef328e4010fe93359e8797e47674aab0dd54026
branch: change/client-and-ssr-error-visibility
repository: 10xProject
topic: "S-18 (FR-016): sortowanie i filtrowanie listy subskrypcji — gdzie, jak zachować wybór, układ kontrolek, pliki wspólne z S-15"
tags: [research, frontend, subscriptions, subscription-table, sorting, filtering, s-18, fr-016]
status: complete
last_updated: 2026-11-25
last_updated_by: Claude (agent, /10x-research bez nadzoru)
---

# Research: sortowanie i filtrowanie listy subskrypcji (S-18, FR-016)

**Date**: 2026-11-25T16:37:21+01:00
**Researcher**: Claude (agent, /10x-research bez nadzoru)
**Git Commit**: 2ef328e4010fe93359e8797e47674aab0dd54026
**Branch**: change/client-and-ssr-error-visibility (badanie uruchomione na tym branchu; bez zmian w kodzie)
**Repository**: 10xProject

## Research Question

Jak dodać do `/subscriptions` sortowanie (np. po nazwie, kwocie, dacie rozliczenia) i filtrowanie (np. po kategorii, statusie), zgodnie z FR-016 i S-18? Do rozstrzygnięcia: przeglądarka czy API, sposób zachowania wyboru (URL czy stan lokalny), układ kontrolek w trzech szerokościach; dodatkowo — które pliki S-18 dzieli z S-15 (`client-and-ssr-error-visibility`), który idzie wcześniej w tej samej kolejce.

**Założenia przyjęte bez pytania użytkownika** (przebieg bez nadzoru; do potwierdzenia przy `/10x-plan`):

- Zakres S-18 = tylko widok `/subscriptions` właściciela konta; podgląd administratora (`/admin/users/:id`) bez sortowania i filtrowania.
- Wymiary: sortowanie po nazwie, kwocie, dacie („Kolejna data”) i domyślna kolejność API; filtry po kategorii i statusie. Inne (forma płatności, cykl) poza zakresem, chyba że użytkownik zdecyduje inaczej.
- Badanie przeprowadzono lokalnie, bez podagentów (zakres to jeden widok i jedna trasa API, a host w tym przebiegu nie przewiduje delegowania bez prośby użytkownika).

## Summary

1. **Dane już są w przeglądarce w całości.** `GET /subscriptions` zwraca całą listę konta bez paginacji, w jednej stałej kolejności (`subscriptions.service.ts:105-118`, `subscription-order.ts:19-48`), a strona trzyma ją w sygnale `state` (`pages/subscriptions/subscriptions.ts:82, 161-185`). Przy `target_scale: small` (`prd.md:8-11`) i decyzji z S-02 „lista bez paginacji, kilkanaście–kilkadziesiąt subskrypcji na konto” (`context/archive/2026-11-11-first-subscription-in-list/plan.md:318`) sortowanie i filtrowanie w przeglądarce nie wymaga zmian API. Rekomendacja: przeglądarka; API bez zmian.
2. **Backend był przygotowany na rozbudowę, ale nie trzeba jej używać.** `SubscriptionSort` ma jedną wartość `status_then_date` (`backend-subtracker/src/subscriptions/subscription.types.ts:28-30`), a plan S-02 zapisał to jako „gotowe do rozbudowy” (`plan.md:35, 69`). Wariant API wymagałby DTO z query, nowych gałęzi `subscriptionOrder` z `COLLATE "pl-PL-x-icu"` dla nazwy i testów e2e na `C.UTF-8` — więcej pracy bez zysku przy tej skali.
3. **Sortowanie nazw w przeglądarce musi być polskie.** We froncie nie ma dziś żadnego `localeCompare` ani `Intl.Collator` (przeszukane `frontend-subtracker/src/**/*.ts` poza spec); w API remis nazw idzie przez `lower(name) COLLATE "pl-PL-x-icu"` (`subscription-order.ts:39-43`). Odpowiednik w przeglądarce: `Intl.Collator('pl', { sensitivity: 'base' })` w nowym helperze (np. `frontend-subtracker/src/app/shared/`), z testem jednostkowym („Ślub” przed „Zoo”). Ryzyko „C.UTF-8” z `CLAUDE.md` dotyczy tylko SQL, nie przeglądarki.
4. **Zachowanie wyboru: query params według wzorca `/admin/users`.** Jedyny istniejący wzorzec stanu listy w adresie to `admin-users.ts:80-96` (`queryParamMap` → formularz → `router.navigate([], { queryParams })`, funkcja `listQueryParams`, `:134`). `/subscriptions` jest `RenderMode.Client` (`app.routes.server.ts:28-30`), więc query params nie zmieniają prerenderu. `localStorage` nie ma w aplikacji żadnego użycia (sprawdzone `src/**/*.ts`).
5. **Układ: tabela zmienia kolumny przy 840 px, a na telefonie nie ma wiersza nagłówka** (`subscription-table.ts:76-79`, `subscription-table.html:379`), więc samo `matSort` w nagłówkach nie działa na telefonie. Kontrolki trzeba umieścić nad tabelą w stronie (`subscriptions.html:436-450`), poza wspólnym komponentem `SubscriptionTable`, którego używa też podgląd admina (`pages/admin/admin-user/admin-user.html:92`). Trzy makiety ASCII do wyboru są niżej.
6. **Pliki wspólne z S-15:** realna kolizja kodu dotyczy `pages/subscriptions/subscriptions.ts` (gałąź `error:` w `load()`, `:176-183`, i w `resume()`, `:341-350` — ustalenie S7 audytu) oraz jego speca; reszta plików S-18 nie dotyka obszaru S-15. Szczegóły w sekcji „Pliki wspólne z S-15”.

## Detailed Findings

### Strona `/subscriptions` (lista, panel, stan „dodawanie”)

- Stan listy: `ListState = loading | error | ready(subscriptions)` (`subscriptions.ts:44-45`); `load(quiet)` czyta listę od nowa po każdym zapisie, usunięciu, anulowaniu i przywróceniu (`:245-257, 272-297, 357-368`). Komentarz `:166` mówi wprost: „The API returns the list in display order; it is not sorted again here.” — S-18 zmieni tę zasadę (sort/filtr jako `computed` na `state`), komentarz do aktualizacji.
- Auto-otwarcie panelu przy pustej liście liczy się z surowej długości odpowiedzi (`:174, 396-405`). Wniosek: filtr nie może wpływać na ten warunek (pusta lista po filtrze ≠ brak subskrypcji). Podobnie stan „Nie masz jeszcze żadnych subskrypcji.” (`subscriptions.html:481-482`) potrzebuje osobnego wariantu „Brak subskrypcji spełniających filtr” z akcją wyczyszczenia filtrów.
- Panel dodawania/edycji: jeden element, od 1200 px kolumna obok listy, 840–1199 px szuflada nad listą (lista `inert`), poniżej 840 px zastępuje listę (`subscriptions.ts:114-120`, `subscriptions.scss:106-160`). Kontrolki sortowania/filtrowania w `subscriptions__main` znikną razem z listą na telefonie i będą `inert` pod szufladą — bez dodatkowej logiki.
- Po zapisie nowa subskrypcja może zostać ukryta przez aktywny filtr: komunikat „Dodano …” (`showStatus`, `:372-375`) pojawi się, a wiersza nie będzie. To decyzja UX (pytanie 4 niżej).
- Fokus po zamknięciu wraca do przycisku „Edytuj” albo „Dodaj subskrypcję” (`:410-429`); przy filtrze ukrywającym wiersz `trigger.isConnected` będzie fałszem i fokus pójdzie na „Dodaj” — obecna logika to już obsługuje.
- Nagłówek strony: tytuł + przycisk „Dodaj subskrypcję” w `subscriptions__header` z `flex-wrap: wrap` (`subscriptions.scss:20-27`); na telefonie przycisk przenosi się do stałego paska na dole (`:178-197`).

### Komponent `SubscriptionTable`

- Wejście `subscriptions` (`subscription-table.ts:51`), kolumny desktopu `name, payment, status, date, amount, actions` (`:24`), na telefonie jedna kolumna `summary` i pusty nagłówek (`:27, 76-79`).
- Używany w dwóch miejscach: strona `/subscriptions` i podgląd admina `admin-user.html:92` (z `readOnly`). Kontrolki w stronie, nie w tabeli, zostawiają admina bez zmian (założenie zakresu).
- Kolumna „Kolejna data” pokazuje `referenceDate()` — koniec triala dla triala, inaczej `nextBillingDate` (`subscription-labels.ts:65-72`); to ta sama data, po której sortuje API (`subscription-order.ts:33-37`). Sortowanie „po dacie rozliczenia” powinno używać `referenceDate`, nie surowego `nextBillingDate`, żeby zgadzało się z tym, co widać.
- Kolumna „Kwota” pokazuje kwotę za cykl i, dla rocznych, kwotę miesięczną (`subscription-table.html:175-193`, `subscription-amounts.ts` — `monthlyAmount`). Sortowanie po kwocie: za cykl czy w przeliczeniu na miesiąc — pytanie 2 niżej (rekomendacja: miesięcznie, bo FR-008 porównuje koszty na wspólnym mianowniku). `amount` to string `"43.00"` (`subscription.types.ts:30-37`); do porównania istnieje `shared/grosze.ts`.
- `trackBy` po `id` (`subscription-table.ts:94-95`) — zmiana kolejności nie odtwarza wierszy; rozwinięty wiersz na telefonie (`expandedId`) przetrwa zmianę sortu, ale może zostać odfiltrowany.

### Typy, serwis i API

- Front: `Subscription` (`subscription.types.ts:32-43`), statusy `trial | active | cancelled_pending | cancelled` (`:4`), etykiety PL w `subscription-labels.ts:23-29` (`STATUS_LABELS`). Kategoria siedzi w każdym wierszu (`category: { id, name, isDefault }`), więc listę kategorii do filtra można wyprowadzić z wczytanej listy bez `GET /categories` (wtedy filtr pokazuje tylko kategorie z subskrypcjami — sensowne dla filtra).
- `SubscriptionsService.list()` bez parametrów (`frontend-subtracker/src/app/subscriptions/subscriptions.service.ts:19-22`; komentarz „Already in display order”).
- API: `GET /subscriptions` → `SubscriptionsService.list(userId, sort = STATUS_THEN_DATE)` (`backend-subtracker/src/subscriptions/controllers/subscriptions.controller.ts:27-31`, `services/subscriptions.service.ts:105-118`); kolejność: grupa statusu (aktywne i trial → kończące się → zakończone, `subscription-order.ts:4-10`), data referencyjna, nazwa bez wielkości liter w polskiej kolacji, `createdAt`. Ta sama metoda zasila podgląd admina (`admin/services/admin-users.service.ts:148`).
- Domyślna kolejność („Domyślna” / „Najbliższe najpierw”) powinna zostać kolejnością API: przy sortowaniu w przeglądarce wystarczy nie sortować, gdy wybrano domyślną.
- Remisy przy sortowaniu w przeglądarce: `Array.prototype.sort` jest stabilny, więc remis zostaje w kolejności API (wniosek z kontraktu JS, nie z kodu repo).

### Polska kolejność i zasady sortowania

- SQL: `POLISH_COLLATION = 'pl-PL-x-icu'` (`backend-subtracker/src/shared/database/polish-collation.ts`), test e2e „Ślub” przed „Zoo” (`backend-subtracker/test/subscriptions/subscriptions.e2e-spec.ts:165-167`).
- Przeglądarka: brak helpera; `LOCALE_ID = 'pl-PL'` jest ustawiony w `app.config.ts:18`. Zgodnie z `lessons.md` („Kod ogólny w `shared/`”) porównywarka polskich nazw to kod ogólny — `frontend-subtracker/src/app/shared/` z własnym specem. Testy frontu działają w dwóch strefach czasowych (`npm run test:ci`), co ma znaczenie dla sortowania dat tylko, gdy porównuje się obiekty `Date`; dni `YYYY-MM-DD` porównywane jako stringi są od strefy niezależne.

### Wzorce stanu w adresie (query params)

- `admin-users.ts:80-96, 134`: odczyt `queryParamMap`, walidacja wartości (`toStatusFilter`), zapis przez `router.navigate([], { relativeTo, queryParams })`. Ten sam wzorzec pasuje do `?sort=name&dir=asc&category=<uuid>&status=active`; nieznane wartości → domyślne (jak `toStatusFilter`).
- Przekierowanie po wygaśnięciu sesji idzie zawsze na `/sign-in` bez adresu powrotu (`auth/session-expired.interceptor.ts:24-27`), więc query params przepadną po 401 — akceptowalne.
- Linki do `/subscriptions` w aplikacji nie niosą parametrów (`app-shell.html:3, 38`, `dashboard.html:77`); otwarcie z menu daje domyślny widok. Możliwe rozszerzenie (poza zakresem): link z dashboardu do listy przefiltrowanej po kategorii.
- Do decyzji w planie: `replaceUrl: true` przy zmianie sortu/filtra, żeby każdy klik nie dodawał wpisu historii (w `admin-users` jest zwykły `navigate`, bo tam zmiana to wysłanie formularza).

### Istniejące testy

- Jednostkowe/komponentowe: `pages/subscriptions/subscriptions.spec.ts` (518 linii), `subscription-table/subscription-table.spec.ts` (`:54-234`, w tym tryb telefonu i read-only), `subscriptions/subscriptions.service.spec.ts`. Jak dodać test: `context/foundation/test-plan.md` §6.1–6.2.
- Browser e2e: `e2e/browser/subscriptions-flow.e2e-spec.ts`, `subscription-edit-delete`, `subscription-cancel`; dane przez API z `e2e/support/subscriptions.ts` (`createSubscriptionThroughApi` — aktywna miesięczna 25 zł; do testu sortowania potrzebny wariant z kwotą/nazwą/statusem). `e2e/http/render-modes.e2e-spec.ts:12` ma już `/subscriptions` — bez zmian, bo trasa się nie zmienia.
- Backend: `subscription-order.spec.ts`, `test/subscriptions/subscriptions.e2e-spec.ts:135-167` — przy wariancie przeglądarkowym bez zmian.

### Makiety ASCII do wyboru (lessons.md: „najpierw 2–3 makiety”)

Wszystkie warianty: kontrolki w `subscriptions__main`, między nagłówkiem a tabelą; pola `mat-select` o gęstości z `_theme.scss` (48 px); od 840 px wiersz się nie zawija (`min-width: 0`), poniżej 840 px elementy jeden pod drugim albo jeden przycisk (lessons.md „Przyciski i pola formularzy tylko z tokenów motywu”).

**A — pasek trzech selectów (sort, kategoria, status)**

```
Pełny desktop (≥1200, z panelem albo bez)
Twoje subskrypcje                                   [Dodaj subskrypcję]
[Sortuj: Najbliższa data ▾] [Kategoria: Wszystkie ▾] [Status: Wszystkie ▾]
┌ Nazwa ─────────── Forma płatności ─ Status ─ Kolejna data ─ Kwota ─┐

Wąski desktop (840–950, obok granatowej kolumny): te same 3 pola, zwężone
[Sortuj: Najbl…▾] [Kategoria: Wsz…▾] [Status: Wsz…▾]

Telefon (<840): pola jedno pod drugim, na całą szerokość
[Sortuj: Najbliższa data      ▾]
[Kategoria: Wszystkie         ▾]
[Status: Wszystkie            ▾]
```

**B — sort w nagłówkach tabeli (matSort) na desktopie, select na telefonie; filtry jako selecty**

```
Desktop: [Kategoria ▾] [Status ▾]            (bez pola sortowania)
┌ Nazwa ▲ ─ Forma płatności ─ Status ─ Kolejna data ↕ ─ Kwota ↕ ─┐
Telefon (brak nagłówka tabeli):
[Sortuj: Nazwa A–Ż            ▾]
[Kategoria ▾] / [Status ▾] jedno pod drugim
```

**C — jeden przycisk „Sortuj i filtruj” otwierający panel/arkusz, aktywne filtry jako chipy**

```
Desktop: Twoje subskrypcje         [Sortuj i filtruj (2)] [Dodaj subskrypcję]
         Kategoria: Streaming ✕   Status: Aktywna ✕
Telefon: [Sortuj i filtruj (2)] na całą szerokość → arkusz z 3 polami
```

Ocena agenta: A jest najprostsze i jednolite we wszystkich szerokościach; B daje dwa różne mechanizmy sortowania (ryzyko niespójności i dodatkowy test telefonu); C oszczędza miejsce na telefonie, ale dodaje nowy wzorzec (arkusz), którego aplikacja nie ma. Rekomendacja: A, do potwierdzenia przez użytkownika.

## Pliki wspólne z S-15

Zakres S-15 do porównania (z zadania, `roadmap.md` S-15, PRD FR-023 i audytu `context/audits/observability/2026-11-22_sign-in-subscriptions-jobs-account-admin.md`): interceptory w `src/app/auth/` i inne miejsca obsługi błędów; strony i formularze zamieniające nieznany błąd w ogólny komunikat bez zapisu przyczyny (audyt S7 wymienia wprost gałęzie `error:` w `subscription-form.ts`, `subscriptions.ts` i dialogach usuwania/anulowania, `:105`; S6 — `cost-totals.store.ts:45`; S8 — `subscriptions.service.ts` i `subscriptions.ts`, `:106`); `src/server.ts`, `src/server-log.ts`; błąd nawigacji SSR jako 404 (P7); przeładowanie po błędzie ładowania chunka (`app.config.ts`, `app.routes.ts`, P8).

Pliki, które S-18 najpewniej zmieni (wariant przeglądarkowy, rekomendowany):

| Plik (`frontend-subtracker/` jeśli nie zaznaczono) | Co zmienia S-18 | Werdykt |
| --- | --- | --- |
| `src/app/pages/subscriptions/subscriptions.ts` | `computed` widocznej listy z sortem i filtrami, odczyt/zapis query params (`ActivatedRoute`, `Router`), komentarz `:166` | **kolizja możliwa** — S-15 (S7, S8) zmienia gałęzie `error:` w `load()` (`:176-183`) i `resume()` (`:341-350`) w tym samym pliku; konflikty lokalne, ale prawdopodobne przy rebase |
| `src/app/pages/subscriptions/subscriptions.spec.ts` | testy sortu, filtrów, pustego wyniku filtra, query params | **kolizja możliwa** — S-15 dopisze tu testy logowania przyczyny błędu wczytania/przywrócenia |
| `src/app/pages/subscriptions/subscriptions.html` | kontrolki nad tabelą (`:436-450`), stan „brak wyników filtra” obok `:481-482` | **kolizja możliwa** (mała) — S-15 może zmienić bloki błędu `:465-480`, sąsiednie wobec zmian S-18 |
| `src/app/pages/subscriptions/subscriptions.scss` | układ paska kontrolek w trzech szerokościach | brak kolizji |
| `src/app/subscriptions/subscription-labels.ts` | etykiety opcji sortu, komunikat pustego wyniku filtra | **kolizja możliwa** (mała) — S-15 może zmienić komunikaty błędów (`resumeFailedMessage`, `:136`) w tym pliku |
| nowy helper widoku listy, np. `src/app/subscriptions/subscription-list-view.ts` + `.spec.ts` (sort/filtr jako czyste funkcje, parsowanie query params) | nowe pliki | brak kolizji |
| nowy helper polskiego porównania, np. `src/app/shared/polish-compare.ts` + `.spec.ts` | nowe pliki | brak kolizji |
| `src/app/subscriptions/subscription.types.ts` | ewentualne typy `SubscriptionListSort`/filtrów (mogą też żyć w nowym helperze) | brak kolizji |
| `src/app/subscriptions/subscriptions.service.ts` | tylko komentarz `:19` (albo nic); parametry tylko w wariancie API | brak kolizji w wariancie przeglądarkowym; **kolizja możliwa** w wariancie API (S-15/S8 dotyka tego serwisu) |
| `src/app/pages/subscriptions/subscription-table/*` | raczej bez zmian przy wariancie A/C; przy B — `matSort` w nagłówkach | brak kolizji (S-15 nie dotyka tabeli) |
| `e2e/browser/` nowy spec, np. `subscription-sort-filter.e2e-spec.ts` | test w przeglądarce trzech szerokości / query params | brak kolizji |
| `e2e/support/subscriptions.ts` | wariant `createSubscriptionThroughApi` z nazwą, kwotą, statusem, cyklem | brak kolizji (S-15 nie potrzebuje tworzenia subskrypcji; do sprawdzenia w jego planie) |
| `src/app/app.routes.ts`, `src/app/app.routes.server.ts`, `src/app/app.config.ts` | bez zmian (query params nie wymagają nowej trasy ani trybu renderu) | brak kolizji, o ile S-18 ich nie rusza; to pliki S-15 (P8) |
| `src/server.ts`, `src/server-log.ts`, `src/app/auth/*.interceptor.ts`, `cost-totals.store.ts`, `subscription-form.ts`, dialogi | bez zmian | brak kolizji (wyłącznie obszar S-15) |
| backend (`subscription.types.ts`, `subscription-order.ts`, kontroler, DTO, `test/subscriptions/subscriptions.e2e-spec.ts`) | tylko w wariancie API | brak kolizji (S-15 bez endpointu raportów błędów, dopóki PRD Open Questions #2 jest otwarte) |
| `CLAUDE.md` (opis `/subscriptions` w Architecture), `context/foundation/roadmap.md` (status S-18), ewentualnie `context/foundation/test-plan.md` | dokumentacja na koniec slice'u | **kolizja możliwa** — S-15 też zaktualizuje `CLAUDE.md` i `roadmap.md`; konflikty tekstowe, łatwe do scalenia |

Werdykt: jedyny plik kodu z prawdopodobnym konfliktem to `pages/subscriptions/subscriptions.ts` (+ spec, w mniejszym stopniu `.html` i `subscription-labels.ts`). Skoro S-15 idzie pierwszy, plan S-18 powinien zaczynać się od świeżego `origin/main` po merge'u S-15 i nie przenosić logiki obsługi błędów — sort/filtr najlepiej umieścić w osobnym czystym helperze, a w `subscriptions.ts` zostawić tylko podpięcie (`computed` + query params), co minimalizuje powierzchnię konfliktu.

## Code References

- `frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts:44-45, 82, 161-185` — stan listy i wczytywanie; `:166` komentarz „nie sortujemy ponownie”
- `frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts:114-120, 396-405` — panel nad listą (`inert`), auto-otwarcie przy pustej liście
- `frontend-subtracker/src/app/pages/subscriptions/subscriptions.html:436-450, 465-494` — nagłówek, błędy, tabela
- `frontend-subtracker/src/app/pages/subscriptions/subscriptions.scss:20-27, 106-197` — nagłówek, układy 1200/840 px, pasek telefonu
- `frontend-subtracker/src/app/pages/subscriptions/subscription-table/subscription-table.ts:24-27, 76-79` — kolumny desktop/telefon, brak nagłówka na telefonie
- `frontend-subtracker/src/app/pages/admin/admin-user/admin-user.html:92` — drugi użytkownik `SubscriptionTable`
- `frontend-subtracker/src/app/subscriptions/subscription-labels.ts:23-29, 65-72` — etykiety statusów, `referenceDate`
- `frontend-subtracker/src/app/subscriptions/subscription.types.ts:4, 32-43` — typy listy
- `frontend-subtracker/src/app/pages/admin/admin-users/admin-users.ts:80-96, 134` — wzorzec query params
- `frontend-subtracker/src/app/app.routes.server.ts:28-30` — `/subscriptions` jako `RenderMode.Client`
- `frontend-subtracker/src/app/shared/breakpoints.ts` — `PHONE_MEDIA_QUERY` (839.98 px), `WIDE_MEDIA_QUERY` (1200 px)
- `backend-subtracker/src/subscriptions/subscription-order.ts:4-48` — kolejność API i polska kolacja
- `backend-subtracker/src/subscriptions/subscription.types.ts:28-30` — `SubscriptionSort` z jedną wartością
- `backend-subtracker/src/subscriptions/services/subscriptions.service.ts:105-118` — zapytanie listy bez paginacji

## Architecture Insights

- Lista jest „głupia”: API ustala kolejność, strona ją pokazuje, tabela tylko emituje akcje (`subscription-table.ts:29-33`). S-18 dodaje warstwę widoku między `state` a tabelą; najczystsze miejsce to czysta funkcja `(subscriptions, query) => Subscription[]` testowana jednostkowo, a w stronie `computed`.
- Jeden element panelu i `inert` na liście już rozwiązują dostępność kontrolek przy otwartym panelu — kontrolki trzeba tylko postawić wewnątrz `subscriptions__main`.
- Lista ma własny obszar przewijania (`CLAUDE.md`: strona `flex: 1 1 0; min-height: 0`); pasek kontrolek musi być poza ramką przewijania tabeli, żeby nie odjeżdżał.

## Historical Context (from prior changes)

- `context/archive/2026-11-11-first-subscription-in-list/plan.md:35, 69` — sortowanie przez użytkownika (FR-016) świadomie poza S-02; `SubscriptionSort` jako enum gotowy do rozbudowy. Werdykt dziś: nadal prawda (jedna wartość).
- `context/archive/2026-11-11-first-subscription-in-list/plan.md:318` — lista bez paginacji przy skali MVP. Werdykt: nadal prawda (`subscriptions.service.ts:105-118` bez limitu).
- `context/archive/2026-11-11-first-subscription-in-list/plan.md:339` — remis nazw w `COLLATE "pl-PL-x-icu"`, bo produkcja ma `C.UTF-8`. Werdykt: nadal prawda (`subscription-order.ts:39-43`).
- `context/foundation/lessons.md` — „Widok listy sprawdzamy w trzech szerokościach…” (wzorzec `pages/admin/admin-users/`), „Przyciski i pola formularzy tylko z tokenów motywu”, „Kod ogólny w `shared/`”, „Trasy zapisujemy po angielsku” (dotyczy też nazw i wartości query params: `sort`, `category`, `status`).

## Related Research

- `context/archive/2026-11-11-first-subscription-in-list/research.md` — pierwsza lista i jej kolejność.
- `context/archive/2026-11-15-dashboard-cost-totals/research.md` — przeliczenie kwot na miesiąc (podstawa sortowania po kwocie miesięcznej).
- S-15 (`client-and-ssr-error-visibility`): folderu zmiany nie było w `context/changes/` na początku badania (pojawił się w trakcie, równolegle; jego treści tu nie uwzględniono) — porównanie oparte na roadmapie, PRD i audycie; warto je powtórzyć po `research.md`/`plan.md` S-15.

## Open Questions

1. **Układ kontrolek: makieta A, B czy C?** (rekomendacja agenta: A). Owner: user.
2. **Sortowanie po kwocie: za cykl czy w przeliczeniu na miesiąc?** (rekomendacja: miesięcznie, zgodnie z FR-008). Owner: user.
3. **Zachowanie wyboru: query params (rekomendacja, wzorzec `/admin/users`) czy tylko stan w pamięci strony?** Przyjęte założenie: query params z `replaceUrl`; `localStorage` odrzucone (brak wzorca w aplikacji). Owner: user.
4. **Co, gdy zapisana/edytowana subskrypcja nie pasuje do aktywnego filtra?** Opcje: komunikat „Dodano X (ukryta przez filtr)”, automatyczne wyczyszczenie filtrów po dodaniu, albo nic. Owner: user.
5. **Filtr: jedna wartość czy wiele (np. kilka statusów naraz)?** Przyjęte założenie: jedna wartość na filtr + „Wszystkie”. Owner: user.
6. **Lista kategorii w filtrze: tylko kategorie obecne na liście (z wczytanych danych) czy wszystkie kategorie konta (`GET /categories`)?** Przyjęte założenie: tylko obecne, bez dodatkowego zapytania. Owner: agent (`/10x-plan`).
7. **Czy podgląd administratora (`/admin/users/:id`) też dostaje sortowanie/filtrowanie?** Przyjęte założenie: nie. Owner: user.
8. **Kolejność wdrożenia względem S-15:** S-18 startuje z `origin/main` po merge'u S-15 (rekomendacja), bo dzielą `subscriptions.ts`. Owner: user.

## Aktualizacja po decyzji użytkownika (2026-11-25, /10x-plan)

Rekomendacja z Summary pkt 1–2 (sortowanie i filtrowanie w przeglądarce, API bez zmian) została odrzucona: użytkownik wybrał sortowanie, filtrowanie i numerowane strony po stronie API, bo konta używane latami będą miały dużo wpisów. Rozstrzygnięcia pytań otwartych i nowy kontrakt `GET /subscriptions` (`{ items, total, page, pageSize }`) są w `plan.md` i `plan-brief.md`. Tabela „Pliki wspólne z S-15” nadal obowiązuje dla frontu; w wariancie API dochodzą `subscriptions.service.ts` frontu i backend (bez kolizji z S-15).

## Weryfikacja po merge'u S-15 (2026-11-25, `origin/main` 8f45ddd)

Powtórzone porównanie z faktycznym kodem S-15 (`git diff 2ef328e..8f45ddd`), zamiast z roadmapą i audytem:

- `pages/subscriptions/subscriptions.ts`: S-15 dodało tylko `inject(ErrorReporter)` (`reporter`) i dwa wywołania `report('Subscriptions', error)`, w `load()` (gałąź `error:`, `:178-179`) i w `resume()` (gałąź „reszta”, `:351`). Linie przesunęły się o 2–3: `list()` jest teraz w `:170`, komentarz „display order” w `:168`, `autoOpen` w `:176`. Plan S-18 zakłada te wywołania i ich nie rusza, więc nic w nim nie trzeba zmieniać.
- `subscriptions.spec.ts`: S-15 dopisało testy spy na `ErrorReporter` (wzorzec z `test-plan.md` §6.2). Przy zmianie `ready` na `{ items, total }` w fazie 2 te testy trzeba przenieść na nowy kształt odpowiedzi; nowy test błędu `categories()` używa tego samego wzorca.
- Bez zmian w S-15: `subscriptions.html`, `subscriptions.scss`, `subscription-labels.ts`, `subscriptions.service.ts` frontu, `subscription-table/*`, `e2e/support/subscriptions.ts`, cały backend. Tabela „Pliki wspólne z S-15” jest zamknięta: konfliktów nie ma, bo S-18 startuje z `main` po S-15.
- Nowe od S-15 i istotne dla S-18: zmiana sortu, filtra i strony to `router.navigate([], …)` na tej samej trasie, więc nie ładuje leniwego modułu i nie dotyczy jej przeładowanie po nieaktualnym pliku (`shared/chunk-reload.ts`). Nieznany błąd nowego zapytania (`categories()` dla filtra) idzie przez `ErrorReporter.report`, a rozpoznany 400 nie (CLAUDE.md, „Errors (S-15)”). W Migration Notes planu nieaktualny front po wdrożeniu przeładowuje się sam przy nawigacji, ale nie na samej liście; ten zapis jest poprawny.
