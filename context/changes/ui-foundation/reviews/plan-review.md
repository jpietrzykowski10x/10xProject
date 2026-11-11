<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Fundament interfejsu (ui-foundation)

- **Plan**: context/changes/ui-foundation/plan.md
- **Mode**: Deep (weryfikacja w kodzie i paczkach bez subagenta)
- **Date**: 2026-11-10
- **Verdict**: REVISE → SOUND po triage
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
Grounding: 11/11 paths ✓, 6/6 symbols ✓ (`REQUEST` w @angular/core 22.2, `MAT_FORM_FIELD_DEFAULT_OPTIONS`, `filled-container-color`/`-height`, schemat `theme-color`, `guestGuard`, `serverRoutes`), brief↔plan ✓ poza zdaniem o pomiarze (F1). Progress: 31 wierszy, 1:1 z kryteriami.

## Findings

### F1 — Lokalnego pomiaru przekierowania nie da się wykonać

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Faza 4, kryterium 4.7; brief, Open Risks
- **Detail**: `npm run build` używa `environment.ts` z produkcyjnym API. Lokalny `serve:ssr` na localhost:4000 woła produkcyjne API, które nie wpuszcza localhost w CORS i nie widzi lokalnej sesji, więc `guestGuard` przepuszcza i pomiar nic nie mierzy. Lokalne `CORS_ORIGINS` to tylko `http://localhost:4200`.
- **Fix A ⭐ Recommended**: Lokalnie tylko działanie przekierowania przez `npm start`, czas 1 s mierzony na produkcji (5.6)
  - Strength: Bez zmian w konfiguracji; liczy się wynik produkcyjny.
  - Tradeoff: Decyzja o SSR po deployu, możliwy drugi deploy.
  - Confidence: HIGH — wynika z plików środowisk i CORS.
  - Blind spot: `ng serve` nie prerenderuje.
- **Fix B**: Lokalny build development z `serve:ssr` i localhost:4000 w lokalnym CORS
  - Strength: Sprawdza prerender i hydratację przed deployem.
  - Tradeoff: Czas zawyżony przez brak optymalizacji, zmiana lokalnego `.env`.
  - Confidence: MEDIUM — prerender w konfiguracji development niesprawdzony.
  - Blind spot: Lokalny czas nie odpowiada produkcji.
- **Decision**: FIXED (Fix A) — Critical Implementation Details, kryterium 4.7 i Progress 4.7, Manual Testing Steps, brief (Open Risks, tabela faz).

### F2 — Budżet stylów komponentu kontra strona startowa

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 2 (2.1), Faza 4
- **Detail**: `anyComponentStyle` 4 kB ostrzeżenie / 8 kB błąd; strona startowa może przekroczyć 8 kB, a 2.1 nie mówił, czy chodzi o ostrzeżenie, czy o błąd.
- **Fix**: Kryterium „bez błędów budżetu”; style komponentu poniżej 8 kB, nadmiar strony startowej do `src/styles/_home.scss`, bez podnoszenia limitu.
- **Decision**: FIXED — kryterium 2.1 i Progress 2.1, kontrakt strony startowej w fazie 4.

### F3 — Wysokość 48 px bez mechanizmu

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 1, motyw
- **Detail**: Gęstość w `mat.theme` zmieniłaby wszystkie komponenty, także przyciski i checkboxy.
- **Fix**: `mat.form-field-density(-2)` dla pól, `button-overrides` z `filled-container-height: 48px` dla przycisków.
- **Decision**: FIXED — kontrakt motywu w fazie 1.

### F4 — Wariant SSR może zapisać sesję w HTML

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 4, punkt 3 (wariant awaryjny)
- **Detail**: Transfer cache z `provideClientHydration()` zapisuje w HTML odpowiedzi GET z serwera; wyjątek obejmuje nagłówki `Authorization`, nie ciasteczka.
- **Fix**: Wyłączyć transfer cache dla `/auth/session` (`withHttpTransferCacheOptions` z `filter`), `Cache-Control: private, no-store` dla `/`.
- **Decision**: FIXED — kontrakt wariantu SSR w fazie 4.
