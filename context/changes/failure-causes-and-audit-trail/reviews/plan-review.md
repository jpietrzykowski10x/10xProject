<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Przyczyny porażek jobów i maili oraz ślad audytowy

- **Plan**: context/changes/failure-causes-and-audit-trail/plan.md
- **Mode**: Deep (weryfikacja kodu bezpośrednio, bez sub-agenta)
- **Date**: 2026-11-24
- **Verdict**: REVISE → SOUND po poprawkach
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | PASS |
| Plan Completeness | WARNING |

## Grounding
28/28 paths ✓, 7/7 symbols ✓ (withDenial/denialOf, isUniqueViolation, OWNER_IS_ACTIVE, at(), REMIND_EVERY_HOURS, flaga running w 3 schedulerach, 5 jobów CI), brief↔plan ✓, Progress↔Phase ✓

## Findings

### F1 — Zapis do admin_audit spoza modułu admin nie ma ustalonego sposobu

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Faza 3, punkty 1, 3, 5
- **Detail**: Usunięcie konta (auth/) i role-grants (users/) miały pisać w tej samej transakcji przez `AdminAuditService.record`. `AdminModule` importuje `AuthModule` (wstrzyknięcie do auth = cykl modułów), DataSource CLI ma `entities: [User, Role, UserRole]` bez `AdminAudit`, a `grantRole`/`revokeRole` nie mają transakcji.
- **Fix**: Funkcja bez DI `insertAdminAudit(manager, entry)` w `admin/admin-audit-insert.ts` dla `record`, usunięcia konta i role-grants; `AdminAudit` w encjach CLI; `dataSource.transaction` wokół grant/revoke.
  - Strength: Jeden punkt zapisu, bez cyklu modułów.
  - Tradeoff: auth/ i users/ importują plik z admin/.
  - Confidence: HIGH — `autoLoadEntities: true`, encja zarejestrowana przez admin.module.
  - Blind spot: None significant.
- **Decision**: FIXED

### F2 — Nie wiadomo, jak testy wywołają trzy nowe przypadki

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 2, punkty 3–5; Testing Strategy; ręczny 2.6
- **Detail**: `billingRollFailed` bez testu automatycznego i bez konkretnej wartości w teście ręcznym; e2e `trial_to_active: <kod>` z podmianą `advance` omija `inStep`; blokada przed rezerwacją przypomnienia daje `null`, nie `usersSkipped`.
- **Fix**: Test jednostkowy lifecycle (2. z 3 wierszy rzuca `QueryFailedError`), spy na `execute` kroku 1 z `57014`, spy na `sendToUser` blokujący konto przed oryginałem, konkretna wartość `'0001-01-01 BC'` w 2.6.
- **Decision**: FIXED

### F3 — Wiersz `lookup_failed` przy prawdziwej awarii bazy prawie nigdy nie powstanie

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 1, punkt 2; Critical Implementation Details
- **Detail**: Drugi odczyt konta w `saveAudit` loguje własny `error`, a przy awarii bazy `mails.save` też pada: alarm z „brak”, bez wiersza.
- **Fix**: Zapisać, że wiersz jest najlepszą próbą; drugi odczyt bez osobnej linii `error`.
- **Decision**: FIXED
