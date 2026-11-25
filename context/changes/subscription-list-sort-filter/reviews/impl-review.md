<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Sortowanie, filtrowanie i strony listy subskrypcji

- **Plan**: context/changes/subscription-list-sort-filter/plan.md
- **Scope**: Full plan (3.8 — kontrola na produkcji po wdrożeniu — oczekuje)
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-11-25
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated (końcowy kod): backend `npm test` (827), `npm run lint`, `npm run build`, `npm run test:e2e` (260) na 816af07, bez zmian backendu później; front `npm run test:ci` (809 × 2 strefy), `npm run build`, `npm run build:e2e`, `npm run typecheck:e2e`, `npm run e2e` (24/24) na c615be6. Kontrole uszkodzenia 1.5, 2.3, 3.5 — czerwone na zepsutym kodzie. Manual: 1.6, 2.4, 3.6, 3.7 potwierdzone przez użytkownika; 3.8 oczekuje na wdrożenie. Nic z „What We're NOT Doing” nie weszło (bez wielowyboru, bez wyboru rozmiaru strony, bez zmian w `SubscriptionTable`, podglądzie admina, sumach i indeksach).

## Findings

### F1 — „Wyczyść filtry” gubi pola, fokus i pokazuje zły komunikat

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/subscriptions/subscriptions.html:26, :90-98; subscriptions.ts:144, :282-284
- **Detail**: Pola i wariant pustego stanu zależą od `filtered()`, liczonego z adresu (`query()`), a dane z `state()` są jeszcze z poprzedniego zapytania. Po „Wyczyść filtry” (albo wyborze „Wszystkie” przy pustym wyniku) adres jest już bez filtrów, a stan nadal `total: 0`: blok pól znika, fokus z `#categorySelect` spada na `body`, a do odpowiedzi API widać „Nie masz jeszcze żadnych subskrypcji.”. Testy komponentu i e2e tego stanu pośredniego nie sprawdzają.
- **Fix**: stan `ready` pamięta, czy wczytany wynik był filtrowany (`filtered: hasFilters(query)` w chwili wczytania), i szablon używa tego zamiast `filtered()`; test komponentu: po „Wyczyść filtry”, przed odpowiedzią, pola i fokus zostają, a komunikatu o pustym koncie nie ma.
- **Decision**: FIXED

### F2 — Ogromne `page` daje 500 zamiast 400

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/subscriptions/dtos/list-subscriptions.dto.ts:31-34
- **Detail**: `page` ma `@IsInt() @Min(1)` bez `@Max`. `?page=1e20` przechodzi walidację, offset `2.5e21` trafia do SQL jako `OFFSET 2.5e+21` i Postgres odpowiada „bigint out of range” → 500 i linia 5xx w logu. Front takiej wartości nie wyśle (`toPage` bierze tylko bezpieczne liczby całkowite), więc dotyczy bezpośrednich wywołań API.
- **Fix**: `@Max(SUBSCRIPTION_PAGE_MAX)` (np. 1 000 000) + przypadek w `list-subscriptions.dto.spec.ts` i wiersz `page=1e20` w tabeli 400 e2e; front: `toPage` powyżej limitu → 1.
- **Decision**: FIXED

### F3 — backend-patterns.md i plan mówią `skip`/`take`, kod używa `offset`/`limit`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/backend-patterns.md:144; plan.md Phase 1 §3
- **Detail**: Kod celowo używa `offset`/`limit` (`skip`/`take` opakowuje zapytanie w podzapytanie `DISTINCT`, które gubi `ORDER BY` po wyrażeniach `CASE`/`COLLATE`). Dokument wzorców opisuje odwrotnie, a to dokładnie pułapka, w którą wpadnie następna lista ze stronami. Plan nie zapisuje też odstępstw: `offset`/`limit`, pominięcie powtórzonego terminu domyślnego (mapa `ORDER BY` w TypeORM), pola tylko przy liście albo filtrze, wartość `'all'` w selectach, ciche przeładowanie przy zmianie zapytania.
- **Fix**: poprawić punkt w backend-patterns.md (offset/limit z powodem; powtórzone wyrażenie w `ORDER BY` nadpisuje kierunek) i dopisać w planie notę „Odstępstwa”.
- **Decision**: FIXED

### F4 — Przekierowanie na ostatnią stronę może zostawić „Wczytywanie…”

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts (`load()`, gałąź `items.length === 0 && total > 0`)
- **Detail**: Pętli nie ma (`sameQuery`). Gdy jednak wyliczona ostatnia strona równa się bieżącej (wiersze usunięte w tej samej chwili), `setQuery` idzie na ten sam adres, efekt nie startuje, a pierwsze wczytanie zostaje na „Wczytywanie…”.
- **Fix**: przekierowywać tylko, gdy wyliczona strona różni się od bieżącej; inaczej ustawić `ready` z pustymi `items`.
- **Decision**: FIXED

### F5 — Nieznane id kategorii w adresie daje puste pole

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/subscriptions/subscriptions.ts (`categoryValue`)
- **Detail**: Poprawne UUID spoza kategorii konta (usunięta, cudza) daje pusty tekst pola „Kategoria”. Lista pokazuje „Brak subskrypcji spełniających filtry.” z „Wyczyść filtry”, więc da się wyjść.
- **Fix**: po wczytaniu kategorii nieznane id pokazuje „Wszystkie”-podobny tekst albo zostaje jak jest (akceptowalne).
- **Decision**: FIXED

### F6 — Brak sygnału wczytywania przy cichym przeładowaniu

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/subscriptions/subscriptions.html (lista)
- **Detail**: Po zmianie sortu, filtra albo strony stara tabela zostaje do odpowiedzi bez znaku, że trwa wczytywanie (czytnik ekranu też nie wie).
- **Fix**: `aria-busy="true"` na obszarze listy w trakcie cichego wczytania.
- **Decision**: FIXED

### F7 — Daty w fixture'ach e2e API w przeszłości

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/test/subscriptions/subscriptions-list.e2e-spec.ts
- **Detail**: Część dat (np. koniec triala `2026-11-20`) jest już w przeszłości. Działa, bo wiersze powstają po przebiegu startowym jobu cyklu życia, ale gdyby job przeszedł później (np. cron w trakcie testów), statusy by się zmieniły.
- **Fix**: daty liczone względem dziś (np. helper `futureDay`) zamiast stałych.
- **Decision**: FIXED
