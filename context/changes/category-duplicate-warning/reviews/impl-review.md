<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Ostrzeżenie o duplikatach w kategorii (S-07)

- **Plan**: context/changes/category-duplicate-warning/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-11-17
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Kryteria automatyczne (uruchomione ponownie 2026-11-17): `migration:generate -- Check` → brak zmian; backend lint 0, build 0, unit 375/375, e2e 131/131; frontend `test:ci` 396/396 ×2 strefy, `build` bez ostrzeżeń, `build:e2e && e2e` 14/14; `npm run format` bez zmian treści. Wszystkie wiersze Manual w Progress odhaczone po potwierdzeniu użytkownika w sesji.

## Findings

### F1 — Własne kategorie sprzed S-07 dziedziczą domyślny próg, nowe dostają kopię

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/database/migrations/1794927874576-CategorySetting.ts (brak backfillu), backend-subtracker/src/subscriptions/services/categories.service.ts:68-87
- **Detail**: Nowa własna kategoria dostaje w `POST /categories` wiersz `category_setting` z kopią domyślnego progu (semantyka „kopiowanie przy utworzeniu”, decyzja użytkownika). Własne kategorie istniejące na produkcji przed wdrożeniem nie mają wiersza, więc po wdrożeniu podążają za aktualnym domyślnym. Zmiana „Domyślnego progu” przesunie stare własne kategorie, a nowe nie — niespójne z regułą w `backend-patterns.md`.
- **Fix A ⭐ Recommended**: Migracja danych (osobna, wg lessons.md) wstawiająca `(user_id, id, 3)` do `category_setting` dla każdej istniejącej własnej kategorii (`ON CONFLICT DO NOTHING`)
  - Strength: Jedna reguła dla wszystkich własnych kategorii; 3 to dokładnie wartość, którą każda z nich ma dziś (na produkcji nie ma jeszcze wierszy `budget_settings`).
  - Tradeoff: Dodatkowa migracja i test; baza dev wymaga tego samego (jednorazowo lub przez `dev-local/`).
  - Confidence: HIGH — tabela jest nowa, produkcja nie ma danych S-07.
  - Blind spot: Lokalne konta testowe z już zmienionym domyślnym dostaną 3, a nie swój domyślny (bez znaczenia poza dev).
- **Fix B**: Zostawić i opisać w `backend-patterns.md`, że własne kategorie sprzed S-07 podążają za domyślnym
  - Strength: Zero kodu.
  - Tradeoff: Trwały wyjątek w regule, który trzeba pamiętać w S-08.
  - Confidence: MED — zachowanie poprawne, ale trudne do wyjaśnienia użytkownikowi.
  - Blind spot: Nie wiadomo, ilu użytkowników produkcyjnych ma własne kategorie.
- **Decision**: FIXED (Fix A) — migracja danych BackfillOwnCategorySettings, dev-local/backfill-own-category-settings.mjs, test e2e

### F2 — Wyścig: nowa kategoria może skopiować stary domyślny próg

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/subscriptions/services/categories.service.ts:71-76
- **Detail**: Domyślny próg czytany zwykłym `findOne` w transakcji (READ COMMITTED). Równoległy `PUT /budget` zmieniający domyślny (np. druga karta) może zostawić nowej kategorii starą wartość. Jeden użytkownik, dwie karty — mało prawdopodobne.
- **Fix**: Zaakceptować i opisać jednym zdaniem w `backend-patterns.md` (blokada `FOR SHARE` i tak nic nie blokuje, gdy wiersza ustawień jeszcze nie ma).
- **Decision**: ACCEPTED — opisane w backend-patterns.md

### F3 — Plan: wiersz Manual fazy 4 przeczy decyzji o telefonie

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/category-duplicate-warning/plan.md (Phase 4, Manual Verification)
- **Detail**: Blok fazy 4 ma w Manual Verification „Telefon: zachowanie bez zmian”, a §3 i wiersz 4.6 w Progress opisują przewijanie wewnątrz także na telefonie (kod zgodny z decyzją użytkownika).
- **Fix**: Zmienić linię Manual Verification fazy 4 na brzmienie wiersza 4.6.
- **Decision**: FIXED — linia Manual fazy 4 poprawiona

### F4 — Globalny cienki pasek przewijania i podświetlenie aktywnego linku poza planem

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: frontend-subtracker/src/styles.scss:19-42, src/styles/_theme.scss (tokeny `--st-scrollbar-*`), layout/app-shell/app-shell.scss (`--active`)
- **Detail**: Styl paska działa na wszystkie elementy (także strony publiczne), a zielony pasek aktywnego linku dodano, bo klasa istniała bez stylu. Oba na prośbę/za zgodą użytkownika, ale bez zapisu w planie.
- **Fix**: Dopisać do fazy 4 w planie krótki addendum (pasek przewijania, styl aktywnego linku).
- **Decision**: FIXED — addendum w fazie 4 planu

### F5 — Sprawdzenie kategorii w `PUT /budget` poza transakcją

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/subscriptions/services/budget.service.ts:60-66
- **Detail**: `allUsable` działa przed transakcją. Dziś bezpieczne (nie ma usuwania kategorii), ale gdy usuwanie powstanie, kategoria znikająca między sprawdzeniem a zapisem da błąd FK 23503 → 500 zamiast 400.
- **Fix**: Zostawić; przy slice'ie usuwania kategorii przenieść sprawdzenie do transakcji albo mapować 23503 na 400.
- **Decision**: ACCEPTED — notatka dla slice'a usuwania kategorii w backend-patterns.md

### F6 — 400 na `/budget` kasuje wszystkie wpisane wartości

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/budget/budget.ts:453-456
- **Detail**: Po 400 strona woła `load()`, formularz znika i użytkownik traci wszystkie zmiany, nie tylko tę dla zniknętej kategorii. Zgodne z planem („przeładowuje listę z komunikatem”).
- **Fix**: Zostawić (dziś 400 praktycznie nieosiągalne z UI); ewentualnie przy usuwaniu kategorii zachować wartości kategorii, które nadal istnieją.
- **Decision**: ACCEPTED — notatka razem z F5

### F7 — `PUT /budget {categories: []}` zwraca 200 bez zmian

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: backend-subtracker/src/subscriptions/dtos/update-budget.dto.ts:42-55
- **Detail**: Pusta tablica liczy się jako obecne pole, więc prośba bez treści przechodzi jako no-op. Zgodne z literą planu (0–200), pokryte testem; frontend jej nie wysyła.
- **Fix**: Zostawić (świadoma akceptacja) albo dodać `ArrayMinSize(1)`, gdy brak `defaultDuplicateThreshold`.
- **Decision**: SKIPPED — świadomie zostawione

### F8 — Obszary przewijania na `/dashboard` zawsze są przystankiem Tab

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: frontend-subtracker/src/app/pages/dashboard/dashboard.html:534, :579
- **Detail**: `tabindex="0"` także wtedy, gdy treść się mieści (pusty przystanek Tab). Ten sam wzorzec co istniejąca ramka tabeli subskrypcji, więc spójne, nie regresja.
- **Fix**: Zostawić dla spójności.
- **Decision**: ACCEPTED — zostawione dla spójności z tabelą subskrypcji
