<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Rejestracja i logowanie magic linkiem

- **Plan**: `context/changes/magic-link-sign-in/plan.md`
- **Mode**: Deep
- **Date**: 2026-11-03
- **Verdict**: REVISE → SOUND po poprawkach
- **Findings**: 0 critical, 4 warnings, 2 observations

## Verdicts

Werdykty sprzed poprawek.

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

8/8 paths ✓, 4/4 symbols ✓, brief↔plan ✓

Weryfikację kodu wykonano w głównej sesji, bez osobnego sub-agenta. Nie sprawdzano działania `RenderMode.Client` w samym buildzie; obejmuje to kryterium 4.3.

## Findings

### F1 — Zgody może złożyć ktoś inny niż właściciel skrzynki

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3 — register
- **Detail**: Osoba A rejestruje adres osoby B i zaznacza oświadczenie 18+ oraz akceptację polityki. Wiersz `user` zapisuje zgody, a B po kliknięciu linku ma konto, choć nigdy ich nie widziała. Gdy B sama się zarejestruje, plan każe zostawić istniejące zgody, więc jej własna akceptacja przepada.
- **Fix**: Rejestracja na niepotwierdzone konto odświeża zgody, a mail do niepotwierdzonego konta mówi, że użycie linku potwierdza oświadczenie 18+ i akceptację polityki.
  - Strength: Zgodę potwierdza osoba z dostępem do skrzynki, bez nowych pól i ekranów.
  - Tradeoff: Dwa warianty treści maila zależne od `email_verified_at`.
  - Confidence: MED — logika jest prosta, ale wystarczalność takiej zgody to kwestia prawna.
  - Blind spot: Nie oceniono tego prawnie; to sprawa do tekstu polityki.
- **Decision**: FIXED

### F2 — Równoległe e2e na jednej bazie z synchronizacją

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 / Testing Strategy — `test/auth.e2e-spec.ts`
- **Detail**: Plan dodaje drugi plik e2e, a `vitest.config.e2e.ts` nie wyłącza równoległości plików. Oba pliki uruchomią `AppModule` i synchronizację na tej samej bazie dev, więc na pustej bazie lub po zmianie encji mogą kolidować przy tworzeniu tabel.
- **Fix**: Dodać `fileParallelism: false` w `vitest.config.e2e.ts`.
- **Decision**: FIXED

### F3 — Import grantAdmin uruchomi skrypt CLI w teście

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Skrypt `admin:grant`; Phase 3 — e2e
- **Detail**: `src/cli/admin-grant.ts` miał być punktem wejścia i jednocześnie eksportować `grantAdmin`, który importuje test e2e. Import wykonałby kod startowy skryptu: czytanie argumentów, połączenie z bazą i wyjście z procesu.
- **Fix**: Przenieść `grantAdmin` do `src/users/grant-admin.ts`, a w `src/cli/admin-grant.ts` zostawić samo uruchomienie.
- **Decision**: FIXED

### F4 — Frontend nie ma opisanych ścieżek błędu sesji

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 — `authGuard`; Phase 2 — `POST /auth/logout`
- **Detail**: Guard opisywał tylko `401`. W czasie deployu API zalogowana osoba, która odświeży `/subskrypcje`, nie miała określonego zachowania, a przekierowanie na logowanie sugerowałoby utratę sesji. Logout wymaga sesji, więc „Wyloguj” na wygasłej sesji zwróci `401` i może utknąć bez przejścia dalej.
- **Fix**: Błąd sieci lub `5xx` w guardzie pokazuje komunikat o niedostępności bez przekierowania, a `401` przy wylogowaniu traktujemy jak udane wylogowanie.
- **Decision**: FIXED

### F5 — Dwa niedookreślone kontrakty

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — seed ról; Phase 3 — register
- **Detail**: Seed ról w bazie dev nie miał wskazanego pliku ani sposobu uniknięcia kolizji przy równoczesnym starcie. Rejestracja na istniejący adres wysyłała „zwykły link”, bez rozstrzygnięcia `is_active = false`, choć `requestLink` taki przypadek pomija.
- **Fix**: Dodać `RolesSeeder` w `src/users` z `OnApplicationBootstrap` i `ON CONFLICT DO NOTHING`, a rejestrację na istniejący adres przekazać do tej samej logiki co `requestLink`.
- **Decision**: FIXED

### F6 — Nieaktualne odwołania i tytuł w Progress; mail bez retencji

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Key Discoveries; Progress 3.2; What We're NOT Doing
- **Detail**: Trzy odwołania wskazywały złe wiersze: `database.options.ts:30` (powinno być `:45`), `database.options.ts:61` (`:58`) oraz `database.options.spec.ts:13` (`:14`). Tytuł 3.2 w Progress skracał kryterium z fazy. Tabela `mail` zapisuje adresy bez klucza obcego, więc przyszłe usuwanie konta (NFR: 30 dni) nie obejmie ich automatycznie.
- **Fix**: Poprawić odwołania, wyrównać tytuł 3.2 i dopisać w „What We're NOT Doing”, że usuwanie konta musi objąć też `mail`.
- **Decision**: FIXED
