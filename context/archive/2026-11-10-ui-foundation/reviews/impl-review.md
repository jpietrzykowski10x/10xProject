<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Fundament interfejsu (ui-foundation)

- **Plan**: context/changes/ui-foundation/plan.md
- **Scope**: Full plan (phases completed so far; phase 5 not implemented)
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-11
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Automated criteria re-run on 6bb7046: `npm run prepare-mydevil` (build, 3 prerendered routes, no budget warnings), 8 `.woff2` in `.mydevil/`, 0 Google Fonts references in `dist/` and `.mydevil/`, column present in prerendered `/privacy-policy`, headline in prerendered `/`, no old classes in `src/app/`. Manual rows 1.4–4.8 confirmed by the user in session.

Verified as fine: no XSS surface or open redirect; no session data in prerendered HTML or transfer cache (`ng-state` holds only hydration data); `guestGuard` re-runs in the browser on initial navigation and redirects a signed-in visitor; home dates are text bindings, so they cannot trigger NG0500; logout logic moved unchanged; focus outlines on navy surfaces; fonts limited to latin/latin-ext 400–700.

## Findings

### F1 — Teksty stron publicznych odbiegają od planu i nie są opisane w plan.md

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: frontend-subtracker/src/app/pages/sign-in/sign-in.html:33-39, frontend-subtracker/src/app/pages/verify-link/verify-link.html:3-30, frontend-subtracker/src/app/layout/public-layout/public-layout.scss:10
- **Detail**: Plan (faza 2 §3) chce w kolumnie „Bez hasła” i zdania o linku ważnym 15 minut, którego można użyć raz; faza 3 §2 mówi „te same teksty” na potwierdzeniu linku. Jest: notka pod formularzem (umiejscowienie opisane w change.md), na `/sign-in` nagłówek „Link zamiast hasła” bez informacji o jednorazowości; `/auth/verify` ma h1 „Logowanie” zamiast „Potwierdzenie logowania”, nowe h2 „Ostatni krok” i notkę „Dlaczego trzeba kliknąć”, bez zdania o 15 minutach. Kolumna ma `flex: 0 0 var(--st-column-width)` zamiast `1 1 300px` (opisane w change.md). Zmiany przeszły testy ręczne 2.3 i 3.4, ale plan.md nie ma `## Follow-ups`, więc przyszły przegląd uzna je za dryf.
- **Fix A ⭐ Recommended**: Dopisać `## Follow-ups` w plan.md z tymi odstępstwami i dodać do notki na `/sign-in` „Link można użyć raz.”
  - Strength: Zachowuje teksty zaakceptowane w testach; ten sam wzorzec co w S-01 (Follow-ups w planie).
  - Tradeoff: Plan staje się nieco ruchomym celem.
  - Confidence: HIGH — change.md już zapisuje część tych decyzji.
  - Blind spot: Nie wiadomo, czy zmiana tytułu na verify-link była świadomą decyzją, czy inicjatywą agenta w fazie 2.
- **Fix B**: Przywrócić teksty z planu (h1 „Potwierdzenie logowania”, „Bez hasła” i 15 min / jednorazowo na wszystkich trzech stronach).
  - Strength: Ścisła zgodność z planem.
  - Tradeoff: Cofa teksty, które przeszły testy; notka o skanerach poczty ma realną wartość.
  - Confidence: MED — zależy od intencji.
  - Blind spot: Makieta F2-Rejestracja może mieć własne brzmienie.
- **Decision**: FIXED via Fix A (## Follow-ups w plan.md; „Linku można użyć raz.” na /sign-in)

### F2 — Błędy zgód nie są ogłaszane, checkboxy straciły aria-invalid

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/register/register.html:17-37
- **Detail**: Na `main` checkboxy miały `aria-invalid`; `mat-checkbox` nie ma takiego wejścia. Akapity `.st-control-error` nie są regionem live, więc po wysłaniu formularza czytnik ich nie odczyta (w odróżnieniu od `mat-error` pola e-mail); usłyszy je dopiero po wejściu fokusem na checkbox. Przy braku błędu renderuje się puste `aria-describedby=""` (nieszkodliwe; `null` nie przechodzi typów, `$any()` łamie regułę no-any).
- **Fix**: Dodać `role="alert"` do obu akapitów `.st-control-error` (pojawiają się warunkowo, więc zostaną ogłoszone).
- **Decision**: FIXED (role="alert" na obu .st-control-error)

### F3 — tech-stack.md: gęstość „w mat.theme” i dokumentacja przed fazą 5

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/tech-stack.md:33
- **Detail**: Sekcja „UI” weszła w fazie 1 (plan: faza 5) i mówi, że `mat.theme` ustawia kolory, typografię i gęstość; plan i kod ustawiają gęstość tylko dla pól (`form-field-density(-2)`).
- **Fix**: Poprawić zdanie przy dokumentacji w fazie 5.
- **Decision**: FIXED (zdanie w tech-stack.md poprawione od razu)

### F4 — Martwy sygnał `submitted` na stronie logowania

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: frontend-subtracker/src/app/pages/sign-in/sign-in.ts:35,38
- **Detail**: Po przejściu na `mat-error` szablon nie czyta `submitted`; sygnał jest tylko ustawiany.
- **Fix**: Usunąć sygnał i jego ustawianie w `submit()`.
- **Decision**: FIXED (sygnał submitted usunięty)

### F5 — `<p>` z e-mailem wewnątrz `mat-menu`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/layout/app-shell/app-shell.html:36
- **Detail**: `role="menu"` powinno zawierać tylko pozycje menu; axe może zgłosić `aria-required-children`. Czytniki zwykle i tak to odczytają.
- **Fix**: Zostawić albo przenieść e-mail do paska nad przyciskiem menu.
- **Decision**: SKIPPED

### F6 — Kolory poza tokenami motywu

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: frontend-subtracker/src/app/layout/app-shell/app-shell.scss:30, frontend-subtracker/src/app/pages/home/home.scss:77
- **Detail**: `#33486c` (linia w nawigacji) i `#e3e9f2` (tekst wstępu) nie są w palecie `_theme.scss`; po F2 z fazy 1 motyw miał być jedynym źródłem kolorów. Do tego powtarzane `#fff`.
- **Fix**: Dodać tokeny (np. `--st-navy-line`, `--st-on-navy-soft`) w `_theme.scss` i użyć ich w obu plikach.
- **Decision**: FIXED (tokeny --st-navy-line, --st-on-navy-soft). Skutek: home.scss przekracza ostrzeżenie budżetu 4 kB o 7 B; poniżej błędu 8 kB, plan to dopuszcza

### F7 — Zduplikowane style granatowej kolumny w dwóch układach

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: frontend-subtracker/src/app/layout/app-shell/app-shell.scss:8-25, frontend-subtracker/src/app/layout/public-layout/public-layout.scss:140-156
- **Detail**: To samo tło, padding, znak słowny i biały fokus w obu plikach; wspólna jest tylko `--st-column-width`.
- **Fix**: Przy dwóch układach zostawić; przy trzecim wydzielić `_layout.scss`.
- **Decision**: SKIPPED

### F8 — `target="_blank"` bez `rel`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/register/register.html:33
- **Detail**: Link do polityki prywatności (ta sama domena; przeglądarki domyślnie dają `noopener`). Istniał już na `main`.
- **Fix**: Dodać `rel="noopener"`.
- **Decision**: FIXED (rel="noopener")
