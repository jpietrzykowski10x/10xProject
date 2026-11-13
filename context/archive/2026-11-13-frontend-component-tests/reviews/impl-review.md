<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Testy komponentów frontendu

- **Plan**: context/changes/frontend-component-tests/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Evidence: every planned item MATCH (Phase 1 tests a–i, Phase 2 all 9 table rows with whole-body `toEqual`, Phase 3 all 11 specs with `whenStable` and the planned providers, Phase 4 §4/§6.2/§6.6). Only EXTRA: `register.html` Prettier reflow, requested by the user, formatting only. Automated criteria re-run 2026-11-13: `test:ci` 270/270 in Europe/Warsaw and America/New_York, build OK, Prettier on changed files OK, component schematic dry-run creates a spec, no TBD left in test-plan.md. Manual rows backed by the sabotage log in `change.md` Notes and §6.6. No raw U+00A0/U+202F in sources; no `any`; no service mocks; no real network. Note (not a finding): the plan's Phase 3 sabotage example „usunięcie `RouterLink`" cannot go red (static `routerLink` attribute); the `@if` alternative covered the check and §6.6 records the limitation. §3 status in test-plan.md is still `planned` — the orchestrator marks it `complete` after archive.

## Findings

### F1 — `afterEach` czyta modułową zmienną `httpTesting`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.spec.ts:178-180; frontend-subtracker/src/app/pages/register/register.spec.ts:78-80
- **Detail**: `afterEach(() => httpTesting.verify())` używa `let` przypisywanego w `createForm()`/`createRegister()`. Gdy test padnie przed przypisaniem, hook rzuca dodatkowy TypeError (pierwszy test) albo weryfikuje kontroler z poprzedniego testu. Pozostałe specy (`auth.guard.spec.ts:123`, `sign-in`, `verify-link`, `app-shell`, `subscriptions`) używają `TestBed.inject(HttpTestingController).verify()`.
- **Fix**: W obu hookach użyć `TestBed.inject(HttpTestingController).verify()`.
- **Decision**: FIXED

### F2 — Odpowiedź na `POST /auth/register` po asercjach

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: frontend-subtracker/src/app/pages/register/register.spec.ts:134-143
- **Detail**: `request.flush(null)` stoi po `expect`; gdy asercja padnie, żądanie zostaje otwarte i `verify()` dokłada drugi błąd. `expectSavedBody()` w specu formularza najpierw odpowiada, potem sprawdza.
- **Fix**: Odczytać ciało, odpowiedzieć `flush(null)`, potem asercje.
- **Decision**: FIXED

### F3 — Jeden test sprawdza dwa zachowania

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: frontend-subtracker/src/app/subscriptions/subscription-form/subscription-form.spec.ts:268-284
- **Detail**: Test widoczności pola własnej kategorii (0/1/0) sprawdza też, że ukryta pusta nazwa nie blokuje zapisu. Dla pola trialu te dwa zachowania są w osobnych testach (:194-204 i :206-213).
- **Fix**: Wydzielić „ukryta pusta nazwa kategorii nie blokuje zapisu” do osobnego `it`.
- **Decision**: FIXED
