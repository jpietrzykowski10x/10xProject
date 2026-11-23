<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Kontekst żądania i przyczyny odmów w logu API

- **Plan**: `context/changes/request-context-and-denial-reasons/plan.md`
- **Mode**: Deep
- **Date**: 2026-11-23
- **Verdict**: SOUND
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

10/10 paths ✓, 5/5 symbols ✓ (`MAGIC_LINK_TTL`, `isValid`, `CANNOT_MANAGE_MESSAGE`, `enableCsrfProtection`, `describeError`), brief↔plan ✓. Sprawdzone założenia:
- `@CurrentUser()` występuje tylko na trasach chronionych (`/auth/me`, `/auth/delete-account`), więc P5 nie zmienia żadnej działającej trasy;
- spy na `warn` w `test/jobs/job-run.e2e-spec.ts:173` tylko wycisza log;
- testy postarzają tokeny przez `PAST`, więc L1 ich nie rusza.

## Findings

### F1 — Nazwy pól spoza DTO to dane od klienta

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — #4 Walidacja; Desired End State
- **Detail**: Plan wpisywał pole spoza DTO (`forbidNonWhitelisted`) do `fields` jako „nazwę, nie wartość”. Klucz JSON wybiera jednak klient, więc `{"jan.kowalski@gmail.com": 1}` wpisałby adres do logu. Planowany test e2e tego nie wykrywał. Origin w CSRF nie miał limitu długości.
- **Fix A ⭐ Recommended**: nazwy z DTO wprost, pola spoza DTO tylko w kształcie identyfikatora (`^[a-zA-Z][a-zA-Z0-9]{0,39}$`), reszta jako `unknown=N`; origin przycięty do 100 znaków.
  - Strength: zachowuje diagnozę rozjazdu frontu i API (audyt S1), a odcina adresy i dowolny tekst.
  - Tradeoff: ciąg identyfikatoropodobny nadal przejdzie.
  - Confidence: HIGH — błąd whitelist ma osobny klucz `whitelistValidation`.
  - Blind spot: None significant.
- **Fix B**: pola spoza DTO tylko jako liczba.
  - Strength: zero danych od klienta w `fields`.
  - Tradeoff: brak nazwy pola przy rozjeździe front–API.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A). Zmienione w planie: Desired End State, fazy 2 #3, #4 i #6, Testing Strategy; w briefie: Open Risks.

### F2 — Limiter wspólny dla całego pliku e2e

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — #6 Testy e2e odmów przekrojowych
- **Detail**: Filtr z limiterem żyje przez cały plik e2e. Test „11 odmów → 10 linii” mógłby wyciszyć asercje innych testów zależnie od kolejności.
- **Fix**: Limit tylko w teście jednostkowym ze wstrzykniętym czasem; testy e2e sprawdzają po jednej linii na kod.
- **Decision**: FIXED (faza 2 #6, brief: Open Risks).

### F3 — Kolejność przyczyn przy tokenie zużytym i wygasłym

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — #1 Weryfikacja linku: klasyfikacja
- **Detail**: Token zużyty i wygasły pasował do dwóch kodów, a plan nie ustalał kolejności.
- **Fix**: `link_used` przed `link_expired`, przypadek w teście jednostkowym.
- **Decision**: FIXED (faza 3 #1, Testing Strategy).
