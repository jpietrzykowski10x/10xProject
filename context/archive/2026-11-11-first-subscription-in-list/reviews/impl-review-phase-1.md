<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Dodanie pierwszej subskrypcji i lista subskrypcji (S-02)

- **Plan**: context/changes/first-subscription-in-list/plan.md
- **Scope**: Phase 1 of 4
- **Reviewed phases**: 1
- **Date**: 2026-11-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

Zakres: commit `e905c67` (backend bez zmian do HEAD `64c5079`). Odstępstwa z `## Follow-ups` (9 kategorii, indeks na `category_id`, helpery w `src/shared/`) traktowane jako plan. Zgodność z planem: wszystkie pozycje MATCH poza dwiema drobnymi (F1, F3). Izolacja kont, parametryzacja SQL, migracje (up/down, indeks z `synchronize: false`), indeksy FK, `Relation<T>`, brak `any`, kaskada przy usunięciu użytkownika — sprawdzone, czyste. Kryteria automatyczne na HEAD: 164 testy jednostkowe, 73 e2e, lint (exit 0; 9 ostrzeżeń tylko w starszych `*.guard.spec.ts`), build, `migration:generate -- Check` → „No changes in database schema were found”. Testy ręczne 1.6–1.7 potwierdzone przy fazie 1.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — `TrimmedString` w `shared/` bez własnego testu

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend-subtracker/src/shared/validation/trimmed-string.ts
- **Detail**: Reguła z `lessons.md` („Kod ogólny w `shared/`… z własnym testem jednostkowym obok”) i Follow-up fazy 1 („każdy z testem”). `date-only` i `unique-violation` mają spec, `trimmed-string` nie — pokrycie tylko pośrednio przez spec DTO subskrypcji.
- **Fix**: Dodać `trimmed-string.spec.ts` z lokalną klasą testową: przycięcie przed walidacją, same spacje → błąd, dokładnie `maxLength` po przycięciu, `maxLength + 1`, wartość nie-string.
- **Decision**: FIXED (`src/shared/validation/trimmed-string.spec.ts`)

### F2 — Ścieżka `23505 → 409` nie jest pewnie przetestowana

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/subscriptions/services/categories.service.ts:69-77, backend-subtracker/test/subscriptions.e2e-spec.ts:364-389
- **Detail**: Test wyścigu przechodzi także wtedy, gdy drugie żądanie dostaje 409 ze sprawdzenia `getExists()` (gałąź `catch` się nie wykonuje). Test bezpośredniego insertu sprawdza tylko `code === '23505'`, a serwis mapuje na 409 wyłącznie przy nazwie ograniczenia `UQ_category_owner_name` — rozjazd nazwy dałby 500 przy prawdziwym wyścigu i nikt by tego nie wykrył.
- **Fix**: W e2e sprawdzić także `driverError.constraint === CATEGORY_OWNER_NAME_INDEX`; dodać test jednostkowy `CategoriesService.create` z atrapą repozytorium (`getExists` → false, `save` rzuca `QueryFailedError` z tym ograniczeniem → `ConflictException`; inne naruszenie unikalności → rzucone dalej).
- **Decision**: FIXED (e2e sprawdza `code` i `constraint`; `categories.service.spec.ts`: 23505 indeksu → 409, inne naruszenie → rzucone dalej)

### F3 — SQL indeksu unikalności zapisany dwa razy

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: backend-subtracker/src/database/migrations/1794406389791-SubscriptionsSchema.ts:34-36, backend-subtracker/src/subscriptions/entities/category.entity.ts:16
- **Detail**: Plan zakładał jedną stałą SQL dla migracji i seedera bazy dev; migracja ma dosłowną kopię (zgodnie z zasadą „migracje z wartościami wpisanymi wprost”, opisaną w komentarzu). Dziś identyczne; późniejsza zmiana stałej rozjedzie reguły dev i produkcji bez sygnału.
- **Fix**: Zostawić migrację dosłowną; test jednostkowy, że `up()` wykonuje dokładnie `CATEGORY_OWNER_NAME_INDEX_SQL` (atrapa `queryRunner.query`).
- **Decision**: FIXED (`1794424078141-CategoryNameKey.spec.ts`: `up()` wykonuje dokładnie `CATEGORY_OWNER_NAME_INDEX_SQL`)

### F4 — `lower()` i sortowanie zależą od locale bazy

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/subscriptions/entities/category.entity.ts:16, categories.service.ts:50,62, subscription-order.ts:72
- **Detail**: Indeks i sprawdzenie konfliktu używają `lower()` z Postgresa; przy `LC_CTYPE = C` (możliwe na MyDevil) „Życie” i „życie” przejdą jako różne kategorie (pułapka P41). Dodatkowo własne kategorie sortowane są w JS (`localeCompare('pl')`), a remis nazw subskrypcji w SQL — kolejności mogą się różnić dla polskich liter.
- **Fix A ⭐ Recommended**: Rozstrzygnąć po `SHOW lc_ctype` na produkcji (krok przed deployem w fazie 4): przy locale UTF-8 bez zmian; przy `C` zmienić indeks i porównanie na kolację ICU (`lower(name COLLATE "pl-PL-x-icu")`) nową migracją.
  - Strength: Zmiana tylko wtedy, gdy problem realnie istnieje; ICU daje poprawne polskie litery niezależnie od locale bazy.
  - Tradeoff: Przy `C` dodatkowa migracja przed deployem S-02.
  - Confidence: MED — zależy od dostępności ICU w Postgresie 16 na MyDevil.
  - Blind spot: Czy MyDevil ma kolacje ICU.
- **Fix B**: Normalizować w aplikacji (kolumna `name_key = name.toLocaleLowerCase('pl')` z indeksem).
  - Strength: Niezależne od bazy.
  - Tradeoff: Nowa kolumna, migracja danych i zmiana encji teraz.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix B — `name_key` varchar(100) = `toNameKey(name)` z `shared/text/`, indeks `UQ_category_owner_name_key`, migracja `CategoryNameKey`; dodatkowo po sprawdzeniu produkcji (C.UTF-8, ICU dostępne) remis nazw w kolejności subskrypcji sortowany `COLLATE "pl-PL-x-icu"`)

### F5 — Przyszłe usuwanie kategorii trafi w FK `NO ACTION`

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/database/migrations/1794406389791-SubscriptionsSchema.ts:53
- **Detail**: Dziś poprawne (usunięcie użytkownika kaskaduje obie tabele, potwierdzone e2e). Przyszły endpoint „usuń własną kategorię” dostanie `23503` → 500, jeśli nie przepnie subskrypcji ani nie zmapuje błędu.
- **Fix**: Zapisać w roadmapie przy pozycji, która wprowadzi usuwanie kategorii (dziś poza zakresem); helper `isForeignKeyViolation` obok `unique-violation.ts`.
- **Decision**: FIXED (wpis w `roadmap.md` → Parked: „Edycja i usuwanie własnych kategorii”)

### F6 — Zbędny odczyt po zapisie subskrypcji

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/subscriptions/services/subscriptions.service.ts (create, `findOneByOrFail` po `save`)
- **Detail**: `save()` zwraca `id` i `createdAt`, kwota zapisywana jako `toFixed(2)` odpowiada formatowi `numeric(10,2)`, więc dodatkowe zapytanie nie zmienia odpowiedzi. Koszt: jeden round-trip na zapis.
- **Fix**: Zostawić, jeśli „odpowiedź pokazuje to, co zapisane” jest celowe; inaczej usunąć odczyt.
- **Decision**: FIXED (odpowiedź budowana z zapisanej encji i wczytanej kategorii, bez dodatkowego zapytania)
