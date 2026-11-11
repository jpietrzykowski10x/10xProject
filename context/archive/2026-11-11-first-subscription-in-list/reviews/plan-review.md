<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Dodanie pierwszej subskrypcji i lista subskrypcji (S-02)

- **Plan**: context/changes/first-subscription-in-list/plan.md
- **Mode**: Deep
- **Date**: 2026-11-11
- **Verdict**: REVISE
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

Grounding: 10/10 paths ✓, 3/3 symbols ✓ (`isAutoSynchronization`, `provideNativeDateAdapter`, `@Index(name, { synchronize: false })`), brief↔plan ✓, Progress↔Phase 27/27 ✓.

Verified by codebase check (typeorm 1.1.2, pg-types 2.2.0, @angular/material 22.2.6): `@Index('…', { synchronize: false })` at class level is valid and `migration:generate` neither drops nor recreates the hand-written expression index (`RdbmsSchemaBuilder.js:267-270,644`); `numeric` comes back as string and `date` as `YYYY-MM-DD` without a day shift (`PostgresDriver.js:635-638`); `onDelete: 'CASCADE'` is emitted into the migration.

## Findings

### F1 — Baza dev nie dostanie unikalnego indeksu kategorii

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details (unikalność kategorii), Phase 1 §2, §5
- **Detail**: `synchronize: true` nie tworzy indeksów z `synchronize: false` (`Table.js:320-322`, `RdbmsSchemaBuilder.js:644`). `subtracker-db-dev`, na której biegną e2e i praca lokalna, nie będzie miała ograniczenia unikalności — test konfliktu przejdzie tylko dzięki kontroli w serwisie, a równoległe `POST /categories` mogą utworzyć duplikat tylko lokalnie, nie na produkcji.
- **Fix A ⭐ Recommended**: Seeder kategorii (tylko przy `synchronize`) tworzy też indeks `CREATE UNIQUE INDEX IF NOT EXISTS …` z tą samą definicją co migracja
  - Strength: Dev i produkcja mają to samo ograniczenie; e2e sprawdzają prawdziwą ścieżkę 23505 → 409; wzór `RolesSeeder` już robi pracę tylko dla dev.
  - Tradeoff: Definicja indeksu w dwóch miejscach (migracja i seeder) — wspólna stała z SQL.
  - Confidence: HIGH — seeder działa przy starcie, po `synchronize`.
  - Blind spot: Kolejność `onApplicationBootstrap` względem synchronizacji przy pierwszym starcie na pustej bazie.
- **Fix B**: Zostawić tylko kontrolę w serwisie i zapisać wyścig jako zaakceptowane ryzyko dla dev
  - Strength: Zero dodatkowego kodu.
  - Tradeoff: Ścieżka błędu bazy (23505) nigdy nie jest testowana przed produkcją.
  - Confidence: MED — wyścig jest mało prawdopodobny, ale błąd 23505 na produkcji dałby 500 zamiast 409.
  - Blind spot: Mapowanie 23505 → 409 w serwisie bez testu.
- **Decision**: FIXED via Fix A (seeder dev tworzy indeks IF NOT EXISTS ze wspólnej stałej SQL; e2e wyścigu 23505 → 409)

### F2 — Test kaskady usunięcia użytkownika pomija blokujące FK

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §5 (e2e „usunięcie użytkownika…”), Phase 4 §1 (nowy slice)
- **Detail**: `session`, `magic_link_token` i `user_role` mają FK do `user` z `ON DELETE NO ACTION` (`src/database/migrations/1793732263880-AuthAndMailSchema.ts:26,32,35`). Usunięcie użytkownika w teście kaskady zawiedzie, jeśli test najpierw nie usunie tych wierszy. Slice „Usunięcie konta” musi to uwzględnić (kaskady lub jawne usuwanie + `mail.recipient`).
- **Fix**: W e2e kaskady najpierw usunąć sesje, tokeny i role (jak `removeTestData`), potem użytkownika; w opisie nowego slice'u wymienić te trzy FK i tabelę `mail`.
- **Decision**: SKIPPED

### F3 — Kontrakt adaptera dat nie zadziała przez `provideNativeDateAdapter()`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §2 (Daty)
- **Detail**: `provideNativeDateAdapter(formats)` na sztywno wstawia `NativeDateAdapter` (`@angular/material/fesm2022/core.mjs:401-409`), więc podklasy z `parse` dla `dd.mm.rrrr` nie da się tak podać. Domyślny format wyświetlania daje „5.01.2026” zamiast „05.01.2026”.
- **Fix**: Kontrakt: `{ provide: DateAdapter, useClass: PlDateAdapter }` (podklasa `NativeDateAdapter` z `parse`), `MAT_DATE_LOCALE = 'pl-PL'`, `MAT_DATE_FORMATS` z `display.dateInput` `{ year: 'numeric', month: '2-digit', day: '2-digit' }`.
- **Decision**: FIXED (DateAdapter useClass PlDateAdapter, MAT_DATE_LOCALE, MAT_DATE_FORMATS 2-digit)

### F4 — CLI `admin:grant` ma własną listę encji

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §2 (Encje)
- **Detail**: `src/cli/admin-grant.ts:22-27` buduje DataSource z `[User, Role, UserRole]`. Relacja odwrotna `@OneToMany` z `User` do nowych encji zepsułaby budowę metadanych w CLI.
- **Fix**: Kontrakt: bez relacji odwrotnych na `User` (relacje tylko po stronie `subscription` i `category`).
- **Decision**: SKIPPED

### F5 — Faza 2: martwy przycisk i dane do testu ręcznego

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §3, Manual 2.3
- **Detail**: Przycisk „Dodaj subskrypcję” w fazie 2 otwiera panel, który powstaje dopiero w fazie 3. Test 2.3 wymaga subskrypcji „dodanych przez API”, a plan nie mówi jak (sesja, nagłówki).
- **Fix**: Przycisk i dolny pasek dochodzą w fazie 3; w 2.3 dane z krótkiego skryptu w scratchpadzie (sesja testowa w bazie dev jak przy SSR, potem `POST /subscriptions` curlem) albo wpisane w bazie dev.
- **Decision**: FIXED (przycisk i dolny pasek w fazie 3; przepis na dane do testu 2.3)

### F6 — Brak limitów liczby kategorii i subskrypcji

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §3, Performance Considerations
- **Detail**: Jedno konto może dodać dowolnie wiele własnych kategorii i subskrypcji, a lista nie ma paginacji. Przy skali MVP to bez znaczenia, ale nie jest zapisane jako świadoma decyzja.
- **Fix**: Zapisać w „What We're NOT Doing”: limity liczby i paginacja poza MVP.
- **Decision**: FIXED (limity i paginacja w What We're NOT Doing)
