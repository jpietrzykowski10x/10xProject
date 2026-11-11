<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Fundament interfejsu (ui-foundation)

- **Plan**: context/changes/ui-foundation/plan.md
- **Scope**: Phase 1 of 5
- **Reviewed phases**: 1
- **Date**: 2026-11-10
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

Kryteria automatyczne uruchomione ponownie: `npm run prepare-mydevil` (z buildem) przechodzi, initial 302 kB bez ostrzeżeń; 24 pliki `.woff2` w `browser/` i `.mydevil/public/`; 0 odwołań do Google Fonts. 1.4 potwierdzone przez użytkownika. Adaptacje subagenta (brak tokenu kształtu w `select-overrides`, czcionka przez `angular.json`, token `shape` w button-toggle) są uzasadnione. Diff przeczytany bezpośrednio, bez subagentów, ze względu na mały zakres (6 plików kodu + 1 wygenerowany).

## Findings

### F1 — Globalny :focus-visible zdubluje fokus Materiala

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: frontend-subtracker/src/styles.scss:11-14
- **Detail**: Reguła `:focus-visible { outline: 2px solid var(--st-navy) }` obejmuje też `input` w `mat-form-field` i przyciski Materiala, które mają własny wskaźnik fokusu; od fazy 3 pole z fokusem pokaże drugi prostokąt.
- **Fix**: Zawęzić regułę do elementów spoza Materiala (`a:focus-visible`, `button:not(.mat-mdc-button-base):focus-visible`), fokus komponentów zostawić Materialowi.
- **Decision**: FIXED — reguła zawężona w `styles.scss`.

### F2 — Tokeny pochodne primary zostają z wygenerowanej palety

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: frontend-subtracker/src/styles/_theme.scss:27-32
- **Detail**: `theme-overrides` przypina tylko `primary`/`on-primary`; `primary-container`, `secondary-container` (zaznaczony przełącznik) i `surface-tint` są z palety, więc kolory zaznaczenia mogą odbiegać od makiety (`#DCE3F0`).
- **Fix**: Sprawdzić wizualnie przy pierwszym użyciu przełącznika (S-02) i w razie różnicy dopisać `secondary-container` do `theme-overrides`.
- **Decision**: FIXED (inaczej, na prośbę użytkownika) — pełna paleta systemowa M3 przypięta w `theme-overrides` z kolorów makiety F2 (49 tokenów kolorów: primary/secondary/tertiary/error z kontenerami, powierzchnie, outline, inverse); zmienne `--st-*` korzystają z tych samych zmiennych Sass. Sprawdzone w zbudowanym CSS: `primary #14284b`, `secondary-container #dce3f0`, `tertiary #0b6b4d`, `error #a1191a`, `surface-container #ffffff`.

### F3 — Paczka zawiera wszystkie zestawy znaków czcionki

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/angular.json:56-59
- **Detail**: `400.css`–`700.css` dokładają cyrylicę, grekę, wietnamski i `.woff`: 48 plików, 752 KB w `media/` każdego deployu; przeglądarka pobiera tylko potrzebne zakresy.
- **Fix**: Zamienić na `latin-<waga>.css` i `latin-ext-<waga>.css` (8 wpisów).
- **Decision**: FIXED — `angular.json` ładuje tylko łacinę i latin-ext; `media/` ma 16 plików (8 `.woff2` + 8 `.woff`) i 336 KB zamiast 48 plików i 752 KB.
