# Sumy kosztów na dashboardzie (S-04) — plan implementacji

## Overview

Użytkownik widzi w powłoce zalogowanego łączny koszt subskrypcji: sumę miesięczną, sumę roczną i podział na kategorie. Kwoty mają się zgadzać z ręcznym wyliczeniem co do grosza (FR-008, US-01, ryzyko #4 w `test-plan.md`). Sumy liczy API: nowa trasa `GET /subscriptions/totals`. Front pokazuje je w granatowej kolumnie na desktopie i w nagłówku na telefonie (kierunek F2), a po każdym zapisie i usunięciu odświeża.

## Current State Analysis

- Nic nie liczy sum. Ani w backendzie, ani na froncie nie ma zapytania agregującego, helpera sum ani miejsca na sumy w UI (research, Summary).
- Reguła zaokrąglenia jest ustalona od 2026-11-13 i obowiązuje w test-planie §2. Kwota miesięczna subskrypcji rocznej to grosze / 12, zaokrąglone do grosza per subskrypcja, połówka w górę. Tak liczy frontendowe `monthlyAmount` (`frontend-subtracker/src/app/subscriptions/subscription-amounts.ts:8-16`), a jego test ma wyrocznię policzoną ręcznie (`subscription-amounts.spec.ts:7-29`).
- Kwoty są stringami `numeric(10,2)` („43.00”). Backend nie liczy kwot na liczbach i nie ma helpera pieniędzy w `src/shared/` (research, Architecture Insights).
- Lista `GET /subscriptions` zwraca także `cancelled`, więc sumy muszą filtrować statusy świadomie (`roadmap.md`, S-04 „Ustalenia z S-02”).
- `app-shell` renderuje tylko strona `/subscriptions` (`pages/subscriptions/subscriptions.html:1`). Jego test sprawdza, że render nie wysyła żądań (`layout/app-shell/app-shell.spec.ts:7-13`). Strona przeładowuje listę w `onSaved`, `onMissing` i po usunięciu (`pages/subscriptions/subscriptions.ts`, metody `onSaved`, `onMissing`, `confirmRemove`).

## Desired End State

- `GET /subscriptions/totals` (sesja, `Cache-Control: no-store`) zwraca dla zalogowanego konta:
  - `monthly` — suma kwot miesięcznych per subskrypcja (roczne podzielone przez 12 i zaokrąglone każda osobno);
  - `yearly` — realny wydatek roczny: miesięczne × 12 + roczne bez zmian;
  - `categories` — kategorie z co najmniej jedną wliczaną subskrypcją, każda z `monthly`, `yearly` i `subscriptionCount`; malejąco po `monthly`, remis po nazwie w polskiej kolejności.
- Wliczane statusy to `trial`, `active` i `cancelled_pending` (wszystko poza `cancelled`). Ta sama lista jest odtąd definicją „aktywnych” dla S-07 i S-08, zapisaną w `backend-patterns.md`.
- Powłoka zalogowanego pokazuje sumy:
  - na desktopie w granatowej kolumnie, na telefonie w nagłówku;
  - podział na kategorie jest rozwijany;
  - przy pustej liście sumy wynoszą „0,00 zł”, a rozwijanych kategorii nie ma.
- Po dodaniu, edycji i usunięciu subskrypcji sumy odświeżają się bez przeładowania strony.
- Weryfikacja na przykładzie z makiety: active 43,00 zł/mies. (Streaming), trial 23,99 zł/mies. (Muzyka), cancelled_pending 429,99 zł/rok (Praca) i cancelled 50,00 zł/mies. (Streaming) dają:
  - **Miesięcznie 102,82 zł, Rocznie 1 233,87 zł**;
  - kategorie: Streaming 43,00 / 516,00 / 1, Praca 35,83 / 429,99 / 1, Muzyka 23,99 / 287,88 / 1.

### Key Discoveries:

- `monthlyAmount` liczy na całkowitych groszach (`Math.round(grosze / 12)`, `subscription-amounts.ts:13-14`). Backend powtarza ten wzór i tę samą wyrocznię, inaczej dopisek na liście i suma się rozjadą (research, Architecture Insights).
- Kontroler `subscriptions` ma tylko `@Put(':id')` i `@Delete(':id')` (`controllers/subscriptions.controller.ts:40,49`). Statyczny `@Get('totals')` nie zderza się z parametrem.
- `list` filtruje `subscription.userId = :userId` i robi `innerJoinAndSelect` kategorii (`services/subscriptions.service.ts:88-91`). Ten sam wzorzec obowiązuje dla sum.
- Kolejność kategorii po nazwie liczona w JS (`localeCompare(..., 'pl')`, jak `categories.service.ts:33-49`) nie zależy od kolacji bazy. Pułapka `C.UTF-8` jej nie dotyczy.
- Rejestry tras w e2e: `EXPECTED_ROUTES` (`test/routes.e2e-spec.ts:36-63`), lista 401 (`test/subscriptions/access.e2e-spec.ts`), izolacja dwóch kont (`account-isolation.e2e-spec.ts`), pomocnik GET (`test/subscriptions/subscriptions-e2e.ts:59-75`).
- Kwoty na froncie formatuje `currency: 'PLN' : 'symbol-narrow' : '1.2-2'` przy `LOCALE_ID 'pl-PL'` (`subscription-table.html:78`).

## What We're NOT Doing

- Osobnej trasy `/dashboard`. Sumy żyją w powłoce zalogowanego (F2), więc przekierowania po logowaniu, `RenderMode` i `GUARDED_ROUTES` zostają bez zmian.
- Liczenia sum w SQL (`SUM`, `GROUP BY`). Liczymy w JS na groszach, a SQL tylko filtruje po użytkowniku i statusie.
- Nowych kolumn, indeksów i migracji. Zapytanie korzysta z istniejącego indeksu `user_id`, a liczba wierszy na konto jest mała.
- Pokazywania kategorii z zerową sumą.
- Dopisku „korekta zaokrągleń” przy sumie rocznej. Różnica „miesięcznie × 12 ≠ rocznie” jest zamierzona (decyzja z planu).
- Limitu budżetu, paska limitu (limonka) i ostrzeżeń o duplikatach. To S-07 i S-08.
- Zwijania kolumny zalogowanego i zmian na stronie startowej `/` (makieta zostaje, łącznie z nieaktualnym komentarzem w `home.html:1`).
- Testu przeglądarkowego e2e dla sum. Ryzyko #4 pokrywa unit z wyrocznią, kontrakt API pokrywa e2e backendu, a odświeżanie pokrywa test komponentu na granicy HTTP.

## Implementation Approach

Backend najpierw. Faza 1 kończy się przetestowanym kontraktem `GET /subscriptions/totals`, z wyrocznią policzoną ręcznie i sprawdzoną na prawdziwej bazie. Faza 2 tylko go wyświetla.

Rachunek siedzi w czystej funkcji domenowej modułu `subscriptions`: lista wliczanych statusów, /12 per subskrypcja, sumy i kolejność. Ogólna konwersja „string ↔ grosze” trafia do `src/shared/money/` (lessons: „Kod ogólny w `shared/`”). Front trzyma sumy w jednym serwisie ze stanem (signal), z którego czyta powłoka. Strona `/subscriptions` woła jego odświeżenie tam, gdzie dziś przeładowuje listę.

## Critical Implementation Details

- **Sumy z grosza zaokrąglonego per subskrypcja.** Suma miesięczna jest sumą zaokrąglonych kwot miesięcznych, nigdy `round(suma_rocznych / 12)`. Dwie roczne po 12,06 zł dają 1,01 + 1,01 = **2,02 zł** miesięcznie, a nie 2,01. Suma roczna nie przechodzi przez /12 wcale. Suma całkowita miesięczna i roczna to suma odpowiednich wartości kategorii, więc wiersze kategorii zawsze sumują się do kwot w nagłówku.
- **Dane poprzedniego konta.** Serwis sum na froncie jest singletonem (`providedIn: 'root'`). Pierwsze ładowanie po utworzeniu powłoki ustawia stan `loading` i nie pokazuje starych wartości, a wylogowanie stan czyści. Dzięki temu po zmianie konta w tej samej karcie nie mignie suma poprzedniego użytkownika (ryzyko #1, część frontowa). Ciche odświeżenie po zapisie zachowuje bieżące wartości do czasu odpowiedzi.

## Faza 1: API sum kosztów

### Overview

Trasa `GET /subscriptions/totals` liczy sumy na całkowitych groszach z ręczną wyrocznią w testach, z izolacją kont i z regułą zapisaną w `backend-patterns.md`.

### Changes Required:

#### 1. Helper groszy w `shared/`

**File**: `backend-subtracker/src/shared/money/grosze.ts` (+ `grosze.spec.ts`)

**Intent**: Ogólna, niezależna od domeny konwersja kwoty w formacie API na całkowite grosze i z powrotem. Rachunek nie dotyka wtedy liczb zmiennoprzecinkowych.

**Contract**: `toGrosze(amount: string): number` przyjmuje `^\d+\.\d{2}$` („43.00” → 4300) i rzuca błąd dla innego formatu, bo kwota z bazy zawsze ma ten format, a inna oznacza błąd programu. `fromGrosze(grosze: number): string` zamienia nieujemną liczbę całkowitą na „102.82”. Test `it.each` obejmuje 0, jedną cyfrę groszy („0.05”), wartość maksymalną (9 999 999 → „99999.99”), sumę ponad `AMOUNT_MAX` (np. 123 456 789 → „1234567.89”) i odrzucenie „12.9”, „12”, „abc”.

#### 2. Rachunek sum w module domeny

**File**: `backend-subtracker/src/subscriptions/cost-totals.ts` (+ `cost-totals.spec.ts`)

**Intent**: Jedno miejsce z regułą biznesową sum: które statusy się wliczają, jak przeliczyć kwotę roczną na miesięczną, jak złożyć sumy i w jakiej kolejności podać kategorie.

**Contract**:
- `COUNTED_STATUSES: readonly SubscriptionStatus[] = [TRIAL, ACTIVE, CANCELLED_PENDING]`, z komentarzem, że to definicja „aktywnych” także dla S-07 i S-08. To lista włączeń, nie „≠ cancelled”, żeby nowy status nie wpadł do sum sam.
- `monthlyGrosze(grosze, cycle)`: miesięczna bez zmian, roczna `Math.round(grosze / 12)`. `yearlyGrosze(grosze, cycle)`: miesięczna × 12, roczna bez zmian.
- `costTotals(rows: { amount: string; billingCycle: BillingCycle; category: CategoryResponse }[]): CostTotalsResponse`. Funkcja dostaje już przefiltrowane wiersze, grupuje po `category.id`, sumuje w groszach i formatuje przez `fromGrosze`. Kolejność kategorii: `monthly` malejąco, przy remisie `name.localeCompare(other, 'pl')`, przy dalszym remisie `id`, żeby wynik był deterministyczny.
- Test z wyrocznią policzoną ręcznie, nie przepisaną z kodu:
  - przypadki /12 skopiowane 1:1 z `frontend-subtracker/src/app/subscriptions/subscription-amounts.spec.ts:7-29` (`12.06→1.01`, `12.05→1.00`, `0.05→0.00`, `99999.99→8333.33`, `0.18→0.02`…);
  - przykład z makiety: 102,82 / 1 233,87 oraz trzy kategorie z „Desired End State”;
  - dwie roczne po 12,06 w jednej kategorii → miesięcznie „2.02”, rocznie „24.12”, `subscriptionCount: 2`;
  - remis kwot: kategorie „Zdrowie” i „Łączność” po 10,00 → najpierw „Łączność” (polska kolejność; w kolejności kodów Unicode „Ł” byłoby za „Z”);
  - pusta lista → `{ monthly: '0.00', yearly: '0.00', categories: [] }`.

#### 3. Typy odpowiedzi

**File**: `backend-subtracker/src/subscriptions/subscription.types.ts`

**Intent**: Kontrakt API sum obok pozostałych typów odpowiedzi.

**Contract**:
```ts
export interface CategoryCostTotal {
  category: CategoryResponse;
  monthly: string; // "35.83"
  yearly: string; // "429.99"
  subscriptionCount: number;
}
export interface CostTotalsResponse {
  monthly: string;
  yearly: string;
  categories: CategoryCostTotal[]; // monthly desc, then Polish name order
}
```

#### 4. Serwis i kontroler

**File**: `backend-subtracker/src/subscriptions/services/subscriptions.service.ts`, `controllers/subscriptions.controller.ts`

**Intent**: Odczyt subskrypcji konta z wliczanymi statusami i przekazanie ich do `costTotals`, wystawiony jako `GET`.

**Contract**: `SubscriptionsService.totals(userId): Promise<CostTotalsResponse>`. Zapytanie: `createQueryBuilder` + `innerJoinAndSelect` kategorii + `userId = :userId` + `status IN (:...statuses)` z `COUNTED_STATUSES`, bez `ORDER BY`. Kategoria mapowana przez `toCategoryResponse`. Kontroler: `@Get('totals')` + `@Header('Cache-Control', 'no-store')` + `@CurrentUser()`, zapisany przed metodami z `:id`.

#### 5. Testy e2e API

**File**: `backend-subtracker/test/routes.e2e-spec.ts`, `test/subscriptions/access.e2e-spec.ts`, `test/subscriptions/account-isolation.e2e-spec.ts`, nowy `test/subscriptions/cost-totals.e2e-spec.ts`

**Intent**: Nowa trasa w rejestrach tras (cookbook §6.4) i dowód na prawdziwej bazie, że filtr statusów, izolacja i kolejność działają w całym łańcuchu.

**Contract**:
- `EXPECTED_ROUTES` dostaje `{ method: 'GET', path: '/subscriptions/totals', access: 'session' }`, bez `twoAccountTest`, bo trasa nie ma parametru.
- Wpis w liście 401 w `access.e2e-spec.ts`.
- W `account-isolation.e2e-spec.ts`: konto B z własną subskrypcją dostaje sumy tylko ze swoich danych, a konto bez subskrypcji dostaje „0.00”, mimo że konto A ma dane.
- `cost-totals.e2e-spec.ts` przez API zakłada zestaw z „Desired End State” (cztery statusy, w tym `cancelled`) i porównuje całą odpowiedź z wyrocznią. Sprawdza też, że po zmianie statusu na `cancelled` (PUT) subskrypcja znika z sum i z kategorii, oraz że odpowiedź ma `no-store` (pomocnik GET z `subscriptions-e2e.ts`).

#### 6. Reguła w dokumentacji wzorców

**File**: `context/foundation/backend-patterns.md`, sekcja „Dane domenowe (od S-02)”

**Intent**: Zapisanie decyzji, z których skorzystają S-07 i S-08.

**Contract**: Nowy punkt **Sumy kosztów** mówi:
- „aktywne” = `COUNTED_STATUSES` (trial, active, cancelled_pending);
- miesięcznie = suma kwot zaokrąglonych per subskrypcja (połówka w górę);
- rocznie = realny wydatek (miesięczne × 12 + roczne bez zmian);
- liczone w JS na groszach (`shared/money/`), nie w SQL;
- kolejność kategorii w JS.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą, w tym `grosze.spec.ts` i `cost-totals.spec.ts`: `cd backend-subtracker && npm test`
- Lint przechodzi: `cd backend-subtracker && npm run lint`
- Build przechodzi: `cd backend-subtracker && npm run build`
- Testy e2e przechodzą, w tym rejestr tras, 401, izolacja i `cost-totals.e2e-spec.ts`: `cd backend-subtracker && npm run test:e2e`
- `npm run migration:generate -- CostTotalsCheck` kończy się „No changes in database schema were found” (zmiana nie dotyka schematu)

#### Manual Verification:

- Po `dev-local/test-session.mjs seed` odpowiedź `GET /subscriptions/totals` zgadza się z ręcznym przeliczeniem danych z listy

**Implementation Note**: Po fazie i zielonych testach automatycznych zatrzymaj się i poczekaj, aż człowiek potwierdzi kontrolę ręczną.

---

## Faza 2: Sumy w powłoce zalogowanego

### Overview

Powłoka pobiera sumy przy wejściu i pokazuje je w kolumnie desktopu i w nagłówku telefonu, z rozwijanym podziałem na kategorie. Strona `/subscriptions` odświeża je po każdej zmianie.

### Changes Required:

#### 1. Typy i klient API

**File**: `frontend-subtracker/src/app/subscriptions/subscription.types.ts`, `subscriptions.service.ts`

**Intent**: Kontrakt sum po stronie frontu, lustrzany wobec backendu.

**Contract**: interfejsy `CostTotals` i `CategoryCostTotal` o polach jak w fazie 1. `SubscriptionsService.totals(): Observable<CostTotals>` woła `GET ${apiUrl}/subscriptions/totals`.

#### 2. Serwis stanu sum

**File**: `frontend-subtracker/src/app/subscriptions/cost-totals.store.ts` (`@Injectable({ providedIn: 'root' })`)

**Intent**: Jedno źródło sum dla powłoki i strony, żeby odświeżenie po zapisie dotarło do kolumny i nagłówka bez przekazywania danych między komponentami.

**Contract**:
- `state: Signal<{ kind: 'loading' } | { kind: 'ready'; totals: CostTotals } | { kind: 'error' }>`.
- `load()` ustawia `loading` i pobiera sumy. `refresh()` pobiera je po cichu: przy błędzie zachowuje `ready`, a stan `error` ustawia tylko wtedy, gdy wcześniej nic nie było.
- `clear()` wraca do `loading`.
- Nowsze żądanie anuluje starsze, jak `load` na stronie (`pages/subscriptions/subscriptions.ts`, metoda `load`).
- Wylogowanie w `AppShell.logout` (gałąź `next`) woła `clear()`.

#### 3. Komponent sum

**File**: `frontend-subtracker/src/app/subscriptions/cost-totals/cost-totals.{ts,html,scss}`

**Intent**: Jeden szablon sum używany dwa razy w powłoce, w kolumnie i w nagłówku, zamiast dwóch kopii znaczników.

**Contract**:
- `input variant: 'column' | 'bar'` zmienia tylko układ i rozmiary.
- Treść: etykieta „Miesięcznie” z dużą kwotą, „Rocznie” z kwotą.
- Przy co najmniej jednej kategorii: `<details>` z `<summary>` „Kategorie”, a w środku `<dl>` z nazwą, kwotą miesięczną i drugą linią „516,00 zł rocznie · 1 subskrypcja”, z polską odmianą: 1 subskrypcja, 2–4 subskrypcje, 5+ subskrypcji, w tym 12–14 subskrypcji. Odmianę liczy czysta funkcja z testem. Przed jej napisaniem sprawdź, czy podobna nie istnieje już w `src/app/`.
- Kwoty przez `currency: 'PLN' : 'symbol-narrow' : '1.2-2'`.
- Stan `loading`: wyciszony tekst „Wczytywanie sum…”. Stan `error`: wyciszony tekst „Nie udało się wczytać sum.”.
- Kolory z tokenów `--st-*` (biały i `--st-navy-soft` na granacie), bez limonki. Fokus na `summary` z białym obrysem jak inne elementy kolumny (`app-shell.scss:64-71`).

#### 4. Powłoka

**File**: `frontend-subtracker/src/app/layout/app-shell/app-shell.{ts,html,scss}`

**Intent**: Sumy w miejscach z F2.

**Contract**:
- `AppShell` przy inicjalizacji woła `CostTotalsStore.load()`.
- Kolumna: `<app-cost-totals variant="column">` między nawigacją a blokiem konta.
- Nagłówek telefonu: `<app-cost-totals variant="bar">` jako drugi wiersz pod wordmarkiem i przyciskiem menu.
- Oba warianty zostają w DOM, CSS pokazuje jeden, jak obecny wzorzec (`app-shell.html:1`).

#### 5. Odświeżanie po zmianach na `/subscriptions`

**File**: `frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts`

**Intent**: Po dodaniu, edycji, „missing” i usunięciu sumy liczą się od nowa razem z listą.

**Contract**: wywołanie `CostTotalsStore.refresh()` obok każdego `this.load(true)` w `onSaved`, `onMissing` i `confirmRemove`.

#### 6. Testy frontu

**File**: `cost-totals/cost-totals.spec.ts`, `cost-totals.store.spec.ts` (jeśli logika nie jest w całości pokryta testem komponentu), test odmiany, `layout/app-shell/app-shell.spec.ts`, `pages/subscriptions/subscriptions.spec.ts`

**Intent**: Test komponentu na granicy HTTP (cookbook §6.2, `HttpTestingController`) dowodzi, że to, co zwraca API, trafia na ekran, i że zmiany wywołują ponowny odczyt.

**Contract**:
- `cost-totals.spec`:
  - odpowiedź z wyrocznią fazy 1 → widać „102,82 zł”, „1 233,87 zł” (spacja nierozdzielająca z `pl-PL`; porównuj tekst po normalizacji spacji) i kategorie w kolejności z API;
  - pusta odpowiedź → „0,00 zł” i brak `details`;
  - błąd 500 → komunikat o błędzie;
  - po `clear()` i ponownym `load()` stare kwoty nie są widoczne przed odpowiedzią.
- `app-shell.spec`: komentarz o „brak żądań” zastąpiony oczekiwaniem jednego `GET /subscriptions/totals`.
- `subscriptions.spec`:
  - `createPage()` (albo pomocnik obok) obsługuje żądanie sum z powłoki;
  - testy zapisu i usunięcia oczekują drugiego `GET /subscriptions/totals`;
  - `verify()` w `afterEach` zostaje.
- Test odmiany `it.each` dla 1, 2, 4, 5, 12, 14, 22, 25.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe i komponentów przechodzą w obu strefach czasowych: `cd frontend-subtracker && npm run test:ci`
- Build produkcyjny przechodzi: `cd frontend-subtracker && npm run build`
- Istniejące testy przeglądarkowe przechodzą bez zmian: `cd frontend-subtracker && npm run build:e2e && npm run e2e`

#### Manual Verification:

- Desktop (≥ 840 px): sumy w granatowej kolumnie, kategorie rozwijają się i zwijają z klawiatury, fokus widoczny
- Telefon (< 840 px): sumy w nagłówku, rozwijane kategorie nie psują menu ani układu listy
- Po dodaniu, edycji (także zmianie statusu na „Anulowana”) i usunięciu subskrypcji sumy zmieniają się bez przeładowania i zgadzają z ręcznym wyliczeniem
- Puste konto pokazuje „0,00 zł” w obu miejscach; po wylogowaniu i zalogowaniu na inne konto w tej samej karcie nie widać sum poprzedniego konta

**Implementation Note**: Po fazie i zielonych testach automatycznych zatrzymaj się i poczekaj, aż człowiek potwierdzi kontrolę ręczną.

---

## Testing Strategy

### Unit Tests:

- `shared/money/grosze.spec.ts`: konwersje, granice, odrzucenie złego formatu.
- `subscriptions/cost-totals.spec.ts`: wyrocznia /12 wspólna z frontem, przykład z makiety, zaokrąglenie per subskrypcja (2 × 12,06 → 2,02), polski remis (Łączność przed Zdrowie), pusta lista.
- Front: odmiana „subskrypcja”, komponent sum i serwis stanu na granicy HTTP.

### Integration Tests:

- e2e backendu na prawdziwej bazie (w CI Postgres `C.UTF-8`): rejestr tras, 401, izolacja kont, filtr statusów z `cancelled` i zmianą statusu przez PUT, `no-store`.
- Testy komponentu strony `/subscriptions`: po zapisie i usunięciu idzie ponowny `GET /subscriptions/totals`.

### Manual Testing Steps:

1. `node --env-file=.env ../dev-local/test-session.mjs create` i `seed`, potem otwórz `/subscriptions` na desktopie. Porównaj sumy z ręcznym przeliczeniem listy.
2. Dodaj subskrypcję roczną 12,06 zł: suma miesięczna rośnie o 1,01 zł, a roczna o 12,06 zł.
3. Zmień jej status na „Anulowana”: sumy wracają do poprzednich wartości.
4. Zwęź okno poniżej 840 px: sumy są w nagłówku, kategorie się rozwijają.
5. Usuń wszystkie subskrypcje: widać „0,00 zł”, bez listy kategorii. Na koniec `cleanup`.

## Performance Considerations

Jedno zapytanie po indeksie `user_id` i grupowanie w JS na kilkudziesięciu wierszach konta. Odświeżenie po zapisie dodaje jedno lekkie żądanie obok istniejącego przeładowania listy. Cache nie jest potrzebny.

## Migration Notes

Brak zmian schematu i danych. Deploy bez migracji.

## References

- Research: `context/changes/dashboard-cost-totals/research.md`
- Wzór zaokrąglenia i wyrocznia: `frontend-subtracker/src/app/subscriptions/subscription-amounts.ts:8-16`, `subscription-amounts.spec.ts:7-29`
- Wzorzec zapytania z filtrem użytkownika: `backend-subtracker/src/subscriptions/services/subscriptions.service.ts:84-97`
- Kolejność kategorii w JS: `backend-subtracker/src/subscriptions/services/categories.service.ts:33-49`
- Rejestry tras e2e: `backend-subtracker/test/routes.e2e-spec.ts:36-63`, `test/subscriptions/access.e2e-spec.ts`
- Makieta sum: `frontend-subtracker/src/app/pages/home/home.html:26-39,115-132`; decyzje F2: `context/archive/2026-11-10-ui-foundation/change.md:15-21`
- Ryzyko #4 i cookbook §6.1, §6.2, §6.4: `context/foundation/test-plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: API sum kosztów

#### Automated

- [x] 1.1 Testy jednostkowe przechodzą, w tym `grosze.spec.ts` i `cost-totals.spec.ts`: `cd backend-subtracker && npm test`
- [x] 1.2 Lint przechodzi: `cd backend-subtracker && npm run lint`
- [x] 1.3 Build przechodzi: `cd backend-subtracker && npm run build`
- [x] 1.4 Testy e2e przechodzą, w tym rejestr tras, 401, izolacja i `cost-totals.e2e-spec.ts`: `cd backend-subtracker && npm run test:e2e`
- [x] 1.5 `npm run migration:generate -- CostTotalsCheck` kończy się „No changes in database schema were found” (zmiana nie dotyka schematu)

#### Manual

- [x] 1.6 Po `dev-local/test-session.mjs seed` odpowiedź `GET /subscriptions/totals` zgadza się z ręcznym przeliczeniem danych z listy

### Phase 2: Sumy w powłoce zalogowanego

#### Automated

- [ ] 2.1 Testy jednostkowe i komponentów przechodzą w obu strefach czasowych: `cd frontend-subtracker && npm run test:ci`
- [ ] 2.2 Build produkcyjny przechodzi: `cd frontend-subtracker && npm run build`
- [ ] 2.3 Istniejące testy przeglądarkowe przechodzą bez zmian: `cd frontend-subtracker && npm run build:e2e && npm run e2e`

#### Manual

- [ ] 2.4 Desktop (≥ 840 px): sumy w granatowej kolumnie, kategorie rozwijają się i zwijają z klawiatury, fokus widoczny
- [ ] 2.5 Telefon (< 840 px): sumy w nagłówku, rozwijane kategorie nie psują menu ani układu listy
- [ ] 2.6 Po dodaniu, edycji (także zmianie statusu na „Anulowana”) i usunięciu subskrypcji sumy zmieniają się bez przeładowania i zgadzają z ręcznym wyliczeniem
- [ ] 2.7 Puste konto pokazuje „0,00 zł” w obu miejscach; po wylogowaniu i zalogowaniu na inne konto w tej samej karcie nie widać sum poprzedniego konta
