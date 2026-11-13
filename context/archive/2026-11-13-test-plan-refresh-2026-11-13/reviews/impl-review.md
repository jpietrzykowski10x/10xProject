<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Refresh planu testów (2026-11-13)

- **Plan**: context/changes/test-plan-refresh-2026-11-13/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-11-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

Zakres: commity 240188a, 4629405, 5481f46 (diff 817ceff..HEAD). Zmiana obejmuje tylko dokumenty: `context/foundation/test-plan.md`, 3 pliki w `context/changes/frontend-unit-tests/` oraz `plan.md` i `change.md` tej zmiany. Kod aplikacji i roadmapa bez zmian (zgodnie z „What We're NOT Doing”). Przegląd wykonany w kontekście głównym, bez subagentów, bo diff to ok. 60 linii dokumentacji.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Kryteria automatyczne powtórzone na HEAD: §2 ma 7 ryzyk i 7 wierszy wskazówek, §3 ma 5 faz; §6 ma 6 podsekcji z „Adding a component test” jako 6.2; brak „faza 3 planu” i „§6.5” w `frontend-unit-tests`; 0 zmienionych plików w `backend-subtracker/`, `frontend-subtracker/` i `roadmap.md`. Kryteria ręczne 1.5 i 2.3 potwierdzone przez użytkownika.

## Findings

### F1 — Ryzyko #7 (High × High) stoi za #6 (High × Low)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md:32 (zdanie o kolejności) i :45 (wiersz #7)
- **Detail**: Wstęp §2 mówi, że ryzyka są „uporządkowane wg ryzyka = wpływ × prawdopodobieństwo”, a nowy wiersz #7 (High × High) dopisano na końcu, po #6 (High × Low). Przenumerowanie ryzyk zmieniłoby odwołania „#N” w §3 i w researchu fazy 1, więc dopisanie na końcu jest rozsądne, ale zdanie wstępu przestało być dosłownie prawdziwe.
- **Fix**: Dopisać we wstępie §2, że numery są stałymi identyfikatorami, a kolejność wg ryzyka dotyczy wierszy #1–#6; nowe ryzyka dostają kolejny numer.
- **Decision**: FIXED — dopisane zdanie we wstępie §2 `test-plan.md`
