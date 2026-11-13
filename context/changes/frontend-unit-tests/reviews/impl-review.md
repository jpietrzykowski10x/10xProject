<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Testy jednostkowe frontendu — faza 1 planu testów (F-03)

- **Plan**: context/changes/frontend-unit-tests/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Kryteria automatyczne uruchomione ponownie 2026-11-13: `npm test -- --watch=false` (233 passed, 2 skipped — strażnik strefy bez `TZ`), `npm run test:ci` (235/235 w `Europe/Warsaw` i `America/New_York`), `npm run build` (exit 0), §6.1 bez „TBD — see §3 Phase 1”. CI na `83a9905` zielone (joby backend, deploy-scripts, frontend). Refaktor `subscription-form.ts` → `toCreateSubscriptionRequest` zachowuje zachowanie (logika przeniesiona 1:1). Wszystkie przypadki z tabel kontraktu planu są w testach; każdy plik testów ma wpis w `sabotage-log.md`.

## Findings

### F1 — `verify()` przed `useRealTimers()` w afterEach guardów

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/auth/auth.guard.spec.ts:119-122
- **Detail**: Gdy test z fake timerami padnie przed upływem limitu, żądanie zostaje otwarte, `verify()` rzuca, a `vi.useRealTimers()` się nie wykona. Runner Angulara działa z `isolate: false`, więc fałszywe timery mogą przeciec do kolejnych plików testów i jeden prawdziwy błąd pokaże się jako kilka mylących.
- **Fix**: Najpierw `vi.useRealTimers()`, potem `verify()` (albo `try/finally`).
- **Decision**: FIXED — `vi.useRealTimers()` przed `verify()`, z komentarzem

### F2 — `toEqual` nie wykrywa `trialEndDate: undefined`, a komentarz twierdzi inaczej

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/subscriptions/subscription-request.spec.ts:6,74
- **Detail**: Komentarz mówi „an extra field fails too”, ale `toEqual` pomija klucze o wartości `undefined`. Regresja do `trialEndDate: undefined` dla statusu innego niż trial przeszłaby (bez skutku na API, bo JSON go gubi).
- **Fix**: `toStrictEqual` w linii 74.
- **Decision**: FIXED — `toStrictEqual`; kontrola: `trialEndDate: undefined` czerwieni testy

### F3 — Wiersze zmiany czasu w `daysFromToday` łapią tylko `floor`/`ceil`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/shared/date-only.spec.ts:116-123
- **Detail**: Naiwna wersja (różnica lokalnych północy, `Math.round`) też daje 1 dla nocy 23 h i 25 h, więc te wiersze nie dowodzą potrzeby normalizacji do UTC — chronią przed `Math.floor`/`Math.ceil`. Komentarz tego nie mówi.
- **Fix**: Doprecyzować komentarz: wiersze pilnują zaokrąglenia przy nocy 23 h / 25 h.
- **Decision**: FIXED — komentarz doprecyzowany

### F4 — Poprawka `decimal.ts` nie jest odnotowana w planie

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: frontend-subtracker/src/app/shared/decimal.ts:10-12
- **Detail**: Plan dopuszczał poprawkę błędu znalezionego testem w tej samej fazie. Poprawka `{1,0}` jest w commicie `bf7c89f` i w §6.6 `test-plan.md`, ale nie w `plan.md`.
- **Fix**: Bez zmian — ślad w commicie i §6.6 wystarcza (albo jednolinijkowy dopisek w planie).
- **Decision**: FIXED — addendum w plan.md (Phase 1, sekcja 6)

### F5 — `TZ` spoza listy daje czerwony zwykły `npm test`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/test-time-zone.spec.ts:21-27
- **Detail**: Strażnik działa, gdy `TZ` jest ustawione. Osoba z np. `TZ=UTC` w powłoce dostanie czerwony `npm test` lokalnie — zamierzone dla CI, ale zaskakujące; §6.1 tego nie mówi.
- **Fix**: Jedno zdanie w §6.1 „Run locally”: przy ustawionym `TZ` musi to być jedna z dwóch stref.
- **Decision**: FIXED — zdanie w §6.1 Run locally

### F6 — `test-time-zones.mjs` przerywa na pierwszej czerwonej strefie

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/scripts/test-time-zones.mjs:20-23
- **Detail**: Błąd w `Europe/Warsaw` ukrywa wynik `America/New_York`. Kody wyjścia są poprawnie przekazywane; to tylko wygoda diagnozy.
- **Fix**: Bez zmian albo uruchomić obie strefy i zakończyć kodem ≠ 0 na końcu.
- **Decision**: FIXED — obie strefy zawsze uruchamiane, kod 1 na końcu; kontrola: uszkodzony parseDateOnly → obie strefy czerwone, exit 1

### F7 — Zachowanie `parseDateOnly` dla nieistniejącej daty i część wyroczni z kodu

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/shared/date-only.spec.ts:76
- **Detail**: `parseDateOnly('2026-02-30')` przechodzi na 2 marca i żaden test tego nie ustala. Z drugiej strony odrzucenie `' 2026-11-15'` i `'2026-11-15T00:00:00Z'` nie wynika z wymagań, tylko z obecnej ścisłości kodu. Wejście pochodzi z API, które waliduje daty — ryzyko niskie.
- **Fix**: Bez zmian teraz; rozstrzygnąć przy najbliższej zmianie dat.
- **Decision**: SKIPPED — rozstrzygnąć przy następnej zmianie dat
