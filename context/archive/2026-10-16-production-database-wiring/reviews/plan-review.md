<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Produkcyjna baza i połączenie frontend → API

- **Plan**: context/changes/production-database-wiring/plan.md
- **Mode**: Deep
- **Date**: 2026-10-21
- **Verdict**: REVISE → SOUND po poprawkach
- **Findings**: 0 critical, 4 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

7/7 ścieżek ✓, 4/4 symboli ✓, brief↔plan ✓. Sprawdzone:
- `health_check` i zarezerwowany krok bazy w `deploy.sh:46-47`;
- `deleteOutDir` w `nest-cli.json`;
- `rootDir: ./src` w `tsconfig.build.json`, więc build zapisuje do `dist/database/`;
- `rollback.sh` cofa tylko kod.

## Findings

### F1 — Glob encji CLI przeszukuje node_modules w paczce

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1, punkt 3
- **Detail**: W spłaszczonej paczce `.mydevil/` wzorzec `<dir>/../**/*.entity.js` obejmuje `node_modules`.
- **Fix**: `<dir>/../!(node_modules)/**/*.entity.js` + sprawdzenie w 1.7.
- **Decision**: FIXED

### F2 — Pusty katalog migrations/ nie trafi do dist

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1, kryterium 1.3
- **Detail**: tsc nie tworzy pustych katalogów, więc krok 1.3 nie przeszedłby bez żadnej migracji.
- **Fix B**: pusta migracja `Init` w F-01. Dzięki niej pierwszy deploy przećwiczy pełną ścieżkę migracji. Kryteria 1.3, 1.6, 3.10 i Migration Notes zaktualizowane.
- **Decision**: FIXED (Fix B)

### F3 — Kopie bazy bez ustalonych uprawnień

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3, punkt 1
- **Detail**: Kopie z danymi użytkowników leżą na serwerze współdzielonym, a plan nie ustala dla nich uprawnień.
- **Fix**: `backups/` z `chmod 700`, `umask 077`; bramka 3.10 sprawdza `drwx------` i `-rw-------`.
- **Decision**: FIXED

### F4 — rollback.sh po migracji stawia stary kod na nowym schemacie

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3
- **Detail**: Migracje mogą być niezgodne wstecz, a `rollback.sh` przywracał tylko kod.
- **Fix (decyzja użytkownika)**:
  - `rollback.sh api` po cofnięciu kodu przywraca bazę z kopii sprzed deployu cofanego wydania;
  - `deploy.sh` zapisuje wskazanie tej kopii w `.deploy-info`;
  - przed zmianą skrypt wymaga potwierdzenia `TAK` albo `--yes`.
  
  Przy okazji poprawione ćwiczenie 3.11: kopia z pierwszego deployu odpowiada pustej bazie, więc po przywróceniu `migration_history` znika, a ponowny deploy ją odtwarza.
- **Decision**: FIXED (fix differently)

### F5 — Kolejność punktów 8a / 8 i nieaktualne komentarze skryptów

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1, Phase 3
- **Detail**: Punkt „8a” stał przed „8”, a nagłówki `deploy.sh` i `rollback.sh` opisują stare zachowanie.
- **Fix**: Punkty przenumerowane na 8 i 9. Plan każe zaktualizować nagłówki obu skryptów.
- **Decision**: FIXED
