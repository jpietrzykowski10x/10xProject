# Sortowanie, filtrowanie i strony listy subskrypcji — plan implementacji

## Overview

S-18 (FR-016). Użytkownik sortuje listę `/subscriptions` po nazwie, kwocie miesięcznej i dacie, filtruje ją po kategorii i statusie oraz przechodzi między numerowanymi stronami. Sortowanie, filtrowanie i dzielenie na strony robi API, a nie przeglądarka. Konto używane latami będzie miało dużo wpisów, więc mechanizm od razu ma działać na porcjach.

**Start implementacji: z `origin/main` po merge'u S-15** (`client-and-ssr-error-visibility`). Oba slice'y dotykają `pages/subscriptions/subscriptions.ts`, a S-15 wpina tam `ErrorReporter` w `load()` i `resume()`. Ten plan zakłada te wywołania i ich nie usuwa.

## Current State Analysis

- `GET /subscriptions` (`subscriptions.controller.ts:27-31`) → `SubscriptionsService.list(userId, sort = STATUS_THEN_DATE)` (`services/subscriptions.service.ts:105-118`). Zwraca całą listę jako tablicę, bez limitu.
- Kolejność: `subscriptionOrder()` (`subscription-order.ts:19-48`), czyli grupa statusu, data referencyjna (koniec triala albo `nextBillingDate`), `lower(name) COLLATE "pl-PL-x-icu"`, `createdAt`. `SubscriptionSort` ma jedną wartość (`subscription.types.ts:28-30`), przygotowaną na rozbudowę.
- Ta sama metoda `list()` zasila podgląd admina (`admin/services/admin-users.service.ts:148`).
- Wzorzec DTO zapytania: `admin/dtos/search-users.dto.ts` (`@Query()`, `class-validator`, `IsEnum`, wartości domyślne).
- Indeksy: `user_id`, `category_id`, `(status, next_billing_date)`, `(status, trial_end_date)` (`subscription.entity.ts:29-50`).
- Front: jedynym odbiorcą trasy jest `pages/subscriptions/subscriptions.ts:168` (`SubscriptionsService.list()`, `subscriptions/subscriptions.service.ts:19-22`). Stan listy to `loading | error | ready(subscriptions)` (`subscriptions.ts:44-45`), a `load(quiet)` czyta listę od nowa po każdym zapisie. Gdy lista jest pusta, panel dodawania otwiera się sam (`:174, 396-405`). Kategorie są dostępne z `SubscriptionsService.categories()` (`subscriptions.service.ts:55`).
- `SubscriptionTable` nie ma wiersza nagłówka na telefonie (`subscription-table.ts:76-79`) i jest współdzielona z podglądem admina (`admin-user.html:92`).
- Wzorzec stanu w adresie: `admin-users.ts:80-96, 134` (`queryParamMap` → `router.navigate([], { queryParams })`).
- Pełny opis: `research.md`. Wariant „w przeglądarce”, który rekomenduje research, został odrzucony decyzją użytkownika (patrz Key Decisions w briefie).

## Desired End State

- `GET /subscriptions?sort=&category=&status=&page=&pageSize=` zwraca `{ items: SubscriptionResponse[], total, page, pageSize }`. Lista jest ograniczona do konta, posortowana w SQL, a kolejność jest jednoznaczna (na końcu `id`). Błędne parametry dają 400.
- `/subscriptions` ma nad tabelą trzy pola: „Sortuj”, „Kategoria”, „Status” (układ A). Pod tabelą jest paginator Material po polsku („1–25 z 80”). Wybór żyje w `?sort=&category=&status=&page=`. Odświeżenie strony albo link z parametrami odtwarza widok.
- Przy pustym wyniku filtra widać „Brak subskrypcji spełniających filtry” z przyciskiem „Wyczyść filtry”. Konto bez subskrypcji zachowuje się jak dziś: panel dodawania otwiera się sam, ale tylko bez filtrów.
- Po zapisie, usunięciu, anulowaniu i przywróceniu strona wczytuje bieżącą stronę od nowa. Gdy strona wyszła poza zakres, przechodzi na ostatnią. Po zapisie widać tylko zwykły komunikat „Dodano X”, także gdy wiersz jest na innej stronie albo poza filtrem.
- Podgląd admina i sumy (`/subscriptions/totals`) są bez zmian.

### Key Discoveries:

- Polska kolejność w SQL wymaga `COLLATE "pl-PL-x-icu"` (`POLISH_COLLATION`); lokalnie baza ma `Polish_Poland.1250`, więc błąd złapie tylko CI `backend-e2e` na `C.UTF-8` (CLAUDE.md).
- Kwota miesięczna w sumach: `cost-totals.ts` (roczna /12 na groszach, z zaokrągleniem). Do kolejności w SQL wystarcza dokładne `amount / 12`. Zaokrąglone kwoty mogą wyglądać na równe, a mimo to stać w kolejności dokładnej wartości.
- `subscriptionOrder` jest czystą funkcją z testem (`subscription-order.spec.ts`), więc nowe warianty dochodzą tam bez zmiany wzorca.
- Strony z offsetem muszą mieć pełny porządek. Bez `id` na końcu remis (`createdAt` w tej samej mikrosekundzie przy seedzie) może pokazać wiersz na dwóch stronach.

## What We're NOT Doing

- Sortowania i filtrowania w przeglądarce (research je rekomendował; odrzucone).
- Wielu wartości w filtrze (np. `status=active,trial`) i wyszukiwania po nazwie.
- Wyboru rozmiaru strony w UI (stałe 25) i stron opartych na kursorze (keyset).
- Zmian w podglądzie admina (`/admin/users/:id`), w sumach i w `SubscriptionTable` (poza ewentualnym przekazaniem wejść).
- Specjalnej obsługi wiersza, który po zapisie nie pasuje do filtra albo trafił na inną stronę: tylko zwykły komunikat.
- Zgodności wstecznej trasy: przez około minutę wdrożenia stary front może pokazać „Nie udało się wczytać” (decyzja użytkownika; patrz Migration Notes).
- Nowych indeksów: sortowanie po wyrażeniach na kilkuset wierszach konta nie potrzebuje indeksu (lessons.md: indeks tylko pod zapytanie, które go używa).

## Implementation Approach

Najpierw API z pełnymi testami, w tym e2e na `C.UTF-8` w CI. Potem front: najpierw dane i stan w adresie, na końcu kontrolki i wygląd. Logika parametrów (adres ↔ zapytanie) siedzi w czystej funkcji z testem. W `subscriptions.ts` zostaje tylko jej podpięcie, co zmniejsza powierzchnię konfliktu z S-15.

## Critical Implementation Details

- **Kolejność terminów**: każdy wariant sortowania zaczyna się od własnego klucza, potem dokłada pełną kolejność domyślną (grupa statusu, data referencyjna, nazwa, `createdAt`), a na końcu `id ASC`. Tylko tak strony 1 i 2 się nie nakładają.
- **Strona poza zakresem** (np. `page=4` przy `total=60`): API zwraca puste `items` z prawdziwym `total`, bez 400. Front przechodzi wtedy na ostatnią stronę (`replaceUrl`). Przy `total=0` zostaje na stronie 1.
- **Auto-otwarcie panelu**: warunek to `total === 0` *i* brak aktywnych filtrów (`category`, `status`). Pusty wynik filtra nie otwiera panelu.

## Phase 1: API — sortowanie, filtry, strony

### Overview

`GET /subscriptions` przyjmuje parametry i zwraca stronę. Podgląd admina dalej czyta całą listę przez `list()`.

### Changes Required:

#### 1. Warianty sortowania

**File**: `backend-subtracker/src/subscriptions/subscription.types.ts`, `subscription-order.ts` (+ `subscription-order.spec.ts`)

**Intent**: Wybrane przez użytkownika klucze sortowania, każdy z pełną, jednoznaczną kolejnością.

**Contract**: `SubscriptionSort` dostaje wartości (w adresie po angielsku, lessons.md):
- `status_then_date` (domyślna, bez zmian),
- `name_asc`, `name_desc`: `lower(name) COLLATE "pl-PL-x-icu"`,
- `amount_desc`, `amount_asc`: `CASE billing_cycle WHEN 'yearly' THEN amount / 12 ELSE amount END`,
- `date_asc`, `date_desc`: data referencyjna jak w domyślnej, bez grupy statusu.

Po kluczu idą terminy domyślne, a na końcu `${alias}.id ASC` (także w `status_then_date`, co nie zmienia dzisiejszej kolejności poza remisem). Testy: lista terminów każdego wariantu i `id` zawsze na końcu.

#### 2. DTO zapytania i typ odpowiedzi

**File**: `backend-subtracker/src/subscriptions/dtos/list-subscriptions.dto.ts` (nowy, + spec), `subscription.types.ts`

**Intent**: Walidacja parametrów jak w `SearchUsersDto`.

**Contract**: `ListSubscriptionsDto`:
- `sort?: SubscriptionSort = STATUS_THEN_DATE` (`IsEnum`);
- `category?: string` (`IsUUID`);
- `status?: SubscriptionStatus` (`IsEnum`);
- `page: number = 1` (`Type(() => Number)`, `IsInt`, `Min(1)`);
- `pageSize: number = 25` (`IsInt`, `Min(1)`, `Max(100)`).

Stałe `SUBSCRIPTION_PAGE_SIZE = 25` i `SUBSCRIPTION_PAGE_SIZE_MAX = 100`. Nieznane parametry dają 400, jeśli tak działa globalny `ValidationPipe` (`forbidNonWhitelisted`); ADAPT, jeśli nie. Typ `SubscriptionPageResponse { items: SubscriptionResponse[]; total: number; page: number; pageSize: number }`.

#### 3. Serwis i kontroler

**File**: `backend-subtracker/src/subscriptions/services/subscriptions.service.ts` (+ spec), `controllers/subscriptions.controller.ts`

**Intent**: Jedno zapytanie ograniczone do konta, z filtrami, kolejnością i stroną.

**Contract**: Nowa metoda `page(userId, query: ListSubscriptionsDto): Promise<SubscriptionPageResponse>`. Buduje ten sam query builder co `list()` (wspólny prywatny helper) i dokłada:
- `andWhere category.id = :category` przy `category`,
- `andWhere status = :status` przy `status`,
- `skip((page-1)*pageSize).take(pageSize)` i `getManyAndCount()`.

Kategoria innego konta albo nieznana daje pustą stronę z `total: 0`, bo zapytanie i tak jest ograniczone do `userId`. `list()` zostaje dla admina bez zmian w kontrakcie. `@Get()` w kontrolerze bierze `@Query() query: ListSubscriptionsDto` i zwraca `page(...)`.

#### 4. Testy e2e API

**File**: `backend-subtracker/test/subscriptions/subscriptions.e2e-spec.ts` (lub nowy `subscriptions-list.e2e-spec.ts`), `test/subscriptions/account-isolation.e2e-spec.ts`, `test/subscriptions/subscriptions-e2e.ts` (helper `getSubscriptions` zwraca `body.items`)

**Intent**: Dowód kolejności w prawdziwym Postgresie (w CI na `C.UTF-8`), filtrów, stron i walidacji.

**Contract**: Testy:
- `name_asc`: „Ślub” przed „Zoo”, „żagiel” po „Zoo” (bez wielkości liter);
- `amount_desc`: roczna 240 zł (20 zł/mies.) po miesięcznej 25 zł, a przed miesięczną 10 zł;
- `date_asc` i `date_desc`;
- filtr kategorii i statusu, także oba naraz;
- strony: 30 wierszy i `pageSize=25` dają 25 i 5 wierszy, bez powtórzeń, z `total` 30; `page=3` daje puste `items` i `total` 30;
- 400 przy `sort=x`, `page=0`, `pageSize=101`, `category=nie-uuid`, `status=x`;
- izolacja kont: `category=<kategoria innego konta>` daje `total: 0`, a cudze subskrypcje nie trafiają do `total`.

Istniejące testy listy przechodzą na `body.items`.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe API: `cd backend-subtracker && npm test`
- Lint: `cd backend-subtracker && npm run lint`
- Build: `cd backend-subtracker && npm run build`
- E2E API: `cd backend-subtracker && npm run test:e2e`
- Kontrola uszkodzenia: bez `COLLATE` w `name_asc` test jednostkowy terminów jest czerwony; bez `id` na końcu test stron (bez powtórzeń) jest czerwony albo niestabilny

#### Manual Verification:

- `curl` z ciasteczkiem sesji (dev-local `test-session.mjs`): `?sort=amount_desc&page=1&pageSize=2` zwraca dwie najdroższe miesięcznie i poprawne `total`.

**Implementation Note**: Po zielonych bramkach zatrzymaj się na ręczne potwierdzenie przed fazą 2. Lista na froncie jest między fazami zepsuta (oczekuje tablicy); merge dopiero po fazie 3.

---

## Phase 2: Front — dane, stan w adresie, strony

### Overview

Strona czyta parametry z adresu, prosi API o stronę i trzyma `total`. Po każdej zmianie wczytuje dane od nowa.

### Changes Required:

#### 1. Typy i serwis

**File**: `frontend-subtracker/src/app/subscriptions/subscription.types.ts`, `subscriptions.service.ts` (+ spec)

**Intent**: Kontrakt API po stronie frontu.

**Contract**: Typy `SubscriptionSort` (te same wartości co w API), `SubscriptionListQuery { sort; category: string | null; status: SubscriptionStatus | null; page: number }` i `SubscriptionPage { items; total; page; pageSize }`. `list(query): Observable<SubscriptionPage>` wysyła tylko parametry różne od domyślnych (`HttpParams`). Komentarz „Already in display order” zostaje zaktualizowany.

#### 2. Adres ↔ zapytanie (czysta funkcja)

**File**: `frontend-subtracker/src/app/subscriptions/subscription-list-query.ts` (+ spec)

**Intent**: Jedno miejsce, które czyta i pisze parametry adresu, testowane bez komponentu.

**Contract**:
- `queryFromParams(params: ParamMap): SubscriptionListQuery`: nieznany `sort` albo `status` daje wartość domyślną, a `page` niebędące liczbą całkowitą ≥ 1 daje 1. `category` przechodzi bez zmian i API je waliduje; niepoprawne UUID → `null`, żeby nie dostać 400.
- `paramsFromQuery(query): Params`: pomija wartości domyślne, więc czysty widok ma adres `/subscriptions` bez parametrów.
- `hasFilters(query): boolean`.

Spec: tabela przypadków w obie strony.

#### 3. Strona `/subscriptions` (logika)

**File**: `frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts` (+ `subscriptions.spec.ts`)

**Intent**: Lista sterowana adresem i stronami API.

**Contract**:
- `query` jako sygnał z `ActivatedRoute.queryParamMap` (`toSignal` + `queryFromParams`). Każda zmiana `query` wywołuje `load()`.
- `ListState.ready` niesie `{ items, total }`.
- `setQuery(patch)` robi `router.navigate([], { queryParams: paramsFromQuery(...), replaceUrl: true })`. Zmiana sortu albo filtra zeruje `page` do 1.
- Po wczytaniu: `items.length === 0 && total > 0` daje `setQuery({ page: lastPage })`. Auto-otwarcie panelu tylko gdy `total === 0 && !hasFilters(query)`.
- `load(quiet)` po zapisie, usunięciu, anulowaniu i przywróceniu prosi o bieżące `query`.
- Wywołania `ErrorReporter` z S-15 zostają w gałęziach błędu.
- `categories` dla filtra przychodzą z `SubscriptionsService.categories()` raz przy wejściu. Błąd tego zapytania daje filtr kategorii z samym „Wszystkie”, a lista działa dalej, zapis przez `ErrorReporter`.

Testy komponentu (`HttpTestingController`):
- parametry adresu trafiają do żądania;
- zmiana sortu zeruje stronę;
- strona poza zakresem przechodzi na ostatnią;
- panel otwiera się przy pustym koncie, ale nie przy pustym wyniku filtra;
- odświeżenie po zapisie prosi o tę samą stronę;
- adres bez parametrów daje domyślne zapytanie.

#### 4. Polskie etykiety paginatora

**File**: `frontend-subtracker/src/app/shared/pl-paginator-intl.ts` (+ spec), podany w providerach strony

**Intent**: Paginator Material po polsku, zgodnie z wzorcem `pl-datepicker-intl.ts`.

**Contract**: `MatPaginatorIntl` z polskimi etykietami („Następna strona”, „Poprzednia strona”, „Pierwsza strona”, „Ostatnia strona”) i `getRangeLabel` → `1–25 z 80`, `0 z 0`. Spec dla zakresów (pusta lista, ostatnia niepełna strona).

### Success Criteria:

#### Automated Verification:

- Testy frontu w obu strefach: `cd frontend-subtracker && npm run test:ci`
- Build: `cd frontend-subtracker && npm run build`
- Kontrola uszkodzenia: warunek auto-otwarcia bez `hasFilters` daje czerwony test „pusty wynik filtra nie otwiera panelu”

#### Manual Verification:

- `npm start` z API z fazy 1: `/subscriptions?sort=name_desc&page=2` pokazuje drugą stronę w kolejności Ż–A, a odświeżenie zostawia ten sam widok.

**Implementation Note**: Po zielonych bramkach zatrzymaj się na ręczne potwierdzenie przed fazą 3.

---

## Phase 3: Front — kontrolki, stany puste, e2e, dokumentacja

### Overview

Widoczne pola i paginator w trzech szerokościach, stan „brak wyników”, test w przeglądarce i opis w dokumentacji.

### Changes Required:

#### 1. Kontrolki i paginator

**File**: `frontend-subtracker/src/app/pages/subscriptions/subscriptions.html`, `subscriptions.scss`, `subscriptions/subscription-labels.ts`

**Intent**: Układ A: trzy `mat-select` nad tabelą i `mat-paginator` pod nią.

**Contract**:
- Pola siedzą w `subscriptions__main` między nagłówkiem a obszarem przewijania tabeli, czyli poza nim, i znikają razem z listą pod panelem i szufladą (`inert`). Od 840 px stoją w jednym wierszu bez zawijania (`min-width: 0`, pola się zwężają); poniżej 840 px jedno pod drugim na całą szerokość. Gęstość i wysokość z `_theme.scss` (pole 48 px), wyliczenie w komentarzu (lessons.md).
- Etykiety sortowania w `subscription-labels.ts`: „Najbliższe najpierw” (domyślna), „Nazwa A–Ż”, „Nazwa Ż–A”, „Najdroższe miesięcznie”, „Najtańsze miesięcznie”, „Data rosnąco”, „Data malejąco”.
- Status używa `STATUS_LABELS` plus „Wszystkie”, a kategoria „Wszystkie” plus kategorie konta.
- `mat-paginator` z `[length]="total"`, `[pageSize]="25"`, `[pageIndex]="page - 1"`, `hidePageSize`, `showFirstLastButtons`. Ukryty, gdy `total <= 25`. `(page)` → `setQuery({ page })`.

#### 2. Stan „brak wyników filtra”

**File**: `subscriptions.html`, `subscription-labels.ts`

**Intent**: Pusty wynik filtra wygląda inaczej niż puste konto.

**Contract**: Gdy `total === 0 && hasFilters(query)`, strona pokazuje „Brak subskrypcji spełniających filtry.” i `mat-stroked-button` „Wyczyść filtry”, który robi `setQuery({ category: null, status: null, page: 1 })` i zostawia sortowanie. Gdy `total === 0` bez filtrów, zostaje dotychczasowe „Nie masz jeszcze żadnych subskrypcji.”. Test komponentu dla obu wariantów.

#### 3. Test e2e w przeglądarce

**File**: `frontend-subtracker/e2e/browser/subscription-sort-filter.e2e-spec.ts` (nowy), `e2e/support/subscriptions.ts`

**Intent**: Dowód na buildzie e2e z prawdziwym API.

**Contract**: `createSubscriptionThroughApi` dostaje opcje: nazwa, kwota, cykl, status, kategoria. Test na nowym koncie z 27 subskrypcjami (różne nazwy, kwoty i jedna roczna):
- sortowanie „Nazwa A–Ż” daje pierwszy wiersz zgodny z polską kolejnością i adres `?sort=name_asc`;
- filtr statusu zawęża listę;
- paginator przechodzi na stronę 2 (2 wiersze), a odświeżenie zostawia stronę 2;
- filtr bez wyników pokazuje „Brak subskrypcji spełniających filtry”, a „Wyczyść filtry” przywraca listę.

Na telefonie (viewport 390 px) pola stoją jedno pod drugim i są widoczne.

#### 4. Dokumentacja

**File**: `CLAUDE.md` (Architecture: `GET /subscriptions` i opis `/subscriptions`), `context/foundation/backend-patterns.md` (sekcja „Dane domenowe”: strony z offsetem wymagają pełnej kolejności z `id` na końcu), `context/changes/subscription-list-sort-filter/follow-ups/` (nowy plik, jeśli w trakcie wyjdzie coś odłożonego)

**Intent**: Następny slice zna kontrakt listy i zasadę jednoznacznej kolejności.

**Contract**: W CLAUDE.md: `GET /subscriptions` z parametrami `sort|category|status|page|pageSize` i odpowiedzią `{ items, total, page, pageSize }`; podgląd admina czyta całą listę przez `list()`. Dla `/subscriptions`: stan w adresie, 25 na stronę.

### Success Criteria:

#### Automated Verification:

- Testy frontu: `cd frontend-subtracker && npm run test:ci`
- Build produkcyjny i e2e: `cd frontend-subtracker && npm run build && npm run build:e2e`
- Typy e2e: `cd frontend-subtracker && npm run typecheck:e2e`
- Playwright: `cd frontend-subtracker && npm run e2e`
- Kontrola uszkodzenia: `paramsFromQuery` bez `page` daje czerwony test e2e „odświeżenie zostawia stronę 2”

#### Manual Verification:

- Trzy szerokości (telefon < 840, 840–950 obok granatowej kolumny, pełny desktop) z najdłuższą nazwą kategorii i etykietą sortowania: pola się nie zawijają ani nie nachodzą, a paginator mieści się w wierszu (lessons.md).
- Panel dodawania (≥ 1200 px) i szuflada (840–1199 px): pola są nieaktywne razem z listą, a po zamknięciu fokus wraca jak dziś.
- Po wdrożeniu na produkcję: lista z filtrami działa; podgląd admina pokazuje całą listę konta.

---

## Testing Strategy

### Unit Tests:

- `subscriptionOrder`: terminy każdego wariantu, `id` na końcu, `COLLATE` w nazwie, kwota roczna/12.
- `ListSubscriptionsDto`: domyślne, granice `page` i `pageSize`, błędne wartości.
- `SubscriptionsService.page`: filtry i strona w query builderze.
- `queryFromParams` i `paramsFromQuery`: tabela w obie strony.
- Polski `MatPaginatorIntl`: zakresy.
- Strona: auto-otwarcie, przejście na ostatnią stronę, odświeżenie po zapisie, „Wyczyść filtry”.

### Integration Tests:

- API e2e: kolejność na `C.UTF-8` (CI), filtry, strony bez powtórzeń, 400, izolacja kont.
- Browser e2e: sortowanie, filtr, strona 2 po odświeżeniu, pusty wynik, telefon.

### Manual Testing Steps:

1. `node --env-file=.env ../dev-local/test-session.mjs seed` (z `backend-subtracker/`) → `/subscriptions`: sortowanie, filtry i strony.
2. Trzy szerokości z najdłuższą treścią.
3. Produkcja po wdrożeniu: lista, filtr, strona 2, podgląd admina.

## Performance Considerations

Jedno zapytanie z `COUNT` (`getManyAndCount`) na konto. Filtrowanie idzie po `user_id` (indeks), a sortowanie po wyrażeniach na wierszach jednego konta. Indeks nie jest potrzebny, dopóki konto ma setki, a nie dziesiątki tysięcy wierszy. Strona 25 wierszy zmniejsza odpowiedź względem dzisiejszej całej listy.

## Migration Notes

- Bez migracji schematu.
- **Zmiana kontraktu `GET /subscriptions`** (tablica → `{ items, … }`) bez okresu zgodności, zgodnie z decyzją użytkownika. API i front wdrażają się osobno po tym samym merge'u, więc przez około minutę stary front pokazuje „Nie udało się wczytać subskrypcji”. Pomaga odświeżenie po wdrożeniu frontu. Od S-15 nieaktualne pliki frontu przeładowują się same przy nawigacji.
- Cofnięcie: revert merge'u przywraca oba kontrakty naraz.

## References

- Research: `context/changes/subscription-list-sort-filter/research.md` (makiety A/B/C, pliki wspólne z S-15)
- Plan S-15: `context/changes/client-and-ssr-error-visibility/plan.md`
- Wzorzec DTO zapytania: `backend-subtracker/src/admin/dtos/search-users.dto.ts`
- Wzorzec stanu w adresie: `frontend-subtracker/src/app/pages/admin/admin-users/admin-users.ts:80-96, 134`
- Kolejność listy: `backend-subtracker/src/subscriptions/subscription-order.ts`
- Lekcje: `context/foundation/lessons.md` (trzy szerokości, tokeny motywu, trasy po angielsku, indeksy)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: API — sortowanie, filtry, strony

#### Automated

- [x] 1.1 Testy jednostkowe API
- [x] 1.2 Lint
- [x] 1.3 Build
- [x] 1.4 E2E API
- [x] 1.5 Kontrola uszkodzenia: bez COLLATE i bez id na końcu testy są czerwone

#### Manual

- [x] 1.6 curl z sesją: sort=amount_desc i pageSize=2 zwraca dwie najdroższe miesięcznie i poprawne total

### Phase 2: Front — dane, stan w adresie, strony

#### Automated

- [ ] 2.1 Testy frontu w obu strefach
- [ ] 2.2 Build
- [ ] 2.3 Kontrola uszkodzenia: auto-otwarcie bez hasFilters daje czerwony test

#### Manual

- [ ] 2.4 npm start: sort=name_desc&page=2 pokazuje drugą stronę Ż–A, a odświeżenie zostawia widok

### Phase 3: Front — kontrolki, stany puste, e2e, dokumentacja

#### Automated

- [ ] 3.1 Testy frontu
- [ ] 3.2 Build produkcyjny i e2e
- [ ] 3.3 Typy e2e
- [ ] 3.4 Playwright
- [ ] 3.5 Kontrola uszkodzenia: paramsFromQuery bez page daje czerwony test e2e

#### Manual

- [ ] 3.6 Trzy szerokości z najdłuższą treścią: pola i paginator bez zawijania i nachodzenia
- [ ] 3.7 Panel i szuflada: pola nieaktywne z listą, fokus wraca jak dziś
- [ ] 3.8 Po wdrożeniu na produkcję: lista z filtrami działa, podgląd admina pokazuje całą listę
