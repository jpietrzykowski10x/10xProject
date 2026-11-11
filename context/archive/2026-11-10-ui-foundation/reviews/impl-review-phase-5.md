<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Fundament interfejsu (ui-foundation)

- **Plan**: context/changes/ui-foundation/plan.md
- **Scope**: Phase 5 of 5 (commits fcd49d9 docs, f677ed3 SSR fallback from Phase 4 §3)
- **Reviewed phases**: 5
- **Date**: 2026-11-11
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Success criteria: CI on PR #8 and PR #10 green (`frontend`, `backend`, `deploy-scripts`), both frontend deploys succeeded; production `/` answers 200 with `Cache-Control: private, no-store`, no Google Fonts references. Manual 5.3–5.6 confirmed by the user; signed-in redirect checked locally (302 in 0.11 s, no loop).

Verified as fine: the 302 carries `Cache-Control: private, no-store`; session data cannot reach SSR HTML or transfer state (cookie header, `withCredentials`, `no-store` and the custom filter each block caching); per-request `AuthService` state; no header injection or SSRF (static `apiUrl`); API down → pass after ≤3 s with the pending task released; expired cookie → 200; protected-route HTML on the redirect path is discarded (empty 302 body); CLAUDE.md edits stay outside the synced block; no `deploy/` or `.env` changes.

## Findings

### F1 — authGuard przepuszcza na serwerze także przy prerenderze

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/auth/auth.guard.ts:39-45
- **Detail**: Dziś bezpieczne, bo wszystkie chronione trasy są `RenderMode.Client`. Ale nowa chroniona trasa, której ktoś zapomni dopisać do `serverRoutes`, wpadnie w `'**' → Prerender`, a `authGuard` przy buildzie zwróci `true` i jej szkielet trafi do statycznego HTML dla każdego (bez danych użytkownika). Przed zmianą ten sam błąd kończył się bezpiecznie przekierowaniem na `/unavailable`.
- **Fix A ⭐ Recommended**: Na serwerze `true` tylko przy żądaniu (`inject(REQUEST)` nie jest null), przy prerenderze `router.parseUrl('/sign-in')`.
  - Strength: Jedna linia, zamyka pułapkę i zachowuje brak dodatkowego wywołania API na ścieżce przekierowania z `/`.
  - Tradeoff: Wyjątek dla serwera zostaje, tylko węższy.
  - Confidence: HIGH — `REQUEST` jest null przy prerenderze (tak już działa guestGuard).
  - Blind spot: None significant.
- **Fix B**: Przekazywać ciasteczko także w `authGuard` (jak w guestGuard) i usunąć wyjątek.
  - Strength: Brak specjalnego przypadku; guard robi na serwerze to samo co w przeglądarce.
  - Tradeoff: Drugie wywołanie `/auth/session` na serwerze przy każdym przekierowaniu zalogowanego (dłuższe 302).
  - Confidence: MED — pętla znika, ale koszt czasu nie był mierzony na produkcji.
  - Blind spot: Zachowanie przy wolnym API (dwa limity 3 s i 10 s po sobie).
- **Decision**: FIXED via Fix B (authGuard przekazuje ciasteczko na serwerze; bez żądania → /sign-in)

### F2 — Wyjątek authGuard i nowe limity stylów nie są opisane w planie

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/ui-foundation/plan.md (## Follow-ups), frontend-subtracker/angular.json:85-86
- **Detail**: Krótkie spięcie `authGuard` na serwerze i podniesienie `anyComponentStyle` z 4/8 kB do 10/25 kB są tylko w opisie commita. Plan mówi 4/8 kB (linie 30, 155) i „bez podnoszenia limitu w angular.json” (linia 253).
- **Fix**: Dopisać oba punkty do `## Follow-ups` (budżet: decyzja użytkownika 2026-11-11).
- **Decision**: FIXED (## Follow-ups w plan.md)

### F3 — Nieaktualne „prerenderowane” w komentarzu i roadmapie

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: frontend-subtracker/src/app/pages/home/home.ts:5-7, context/foundation/roadmap.md:97
- **Detail**: Komentarz mówi, że HTML z prerenderu ma datę builda; teraz HTML ma datę żądania. Roadmapa opisuje `/` jako prerenderowaną. `change.md:24` to zapis historyczny i zostaje.
- **Fix**: Poprawić komentarz w `home.ts` i zdanie w roadmapie na „renderowana na serwerze”.
- **Decision**: FIXED (komentarz w home.ts, roadmap.md:97; change.md zostaje jako zapis historyczny)

### F4 — Do API idzie cały nagłówek Cookie, a wykrywanie ciasteczka to `includes`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/auth/auth.guard.ts:24-25
- **Detail**: Przekazywane są też ewentualne ciasteczka domeny frontendu (dziś żadnych); `includes('subtracker_session=')` złapie np. `xsubtracker_session=` — skutkiem jest tylko jedno zbędne wywołanie API.
- **Fix**: Wyciągnąć z nagłówka tylko `subtracker_session=<wartość>` i przekazywać samą tę parę.
- **Decision**: FIXED (do API idzie tylko para subtracker_session=…, dokładne dopasowanie nazwy)

### F5 — Limit błędu 25 kB nie złapie przypadkowego motywu w komponencie

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/angular.json:85-86
- **Detail**: Największy plik stylów komponentu to `home.scss` (~5,7 kB). Przypadkowe `@use` motywu Materiala w komponencie zmieści się w 25 kB. Limity ustalił użytkownik.
- **Fix**: Zostawić (decyzja użytkownika) albo zejść do 10 / 15 kB.
- **Decision**: SKIPPED (limity 10 / 25 kB to decyzja użytkownika)

### F6 — Nazwa ciasteczka zdublowana z backendem bez odsyłacza

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: frontend-subtracker/src/app/auth/auth.guard.ts:10
- **Detail**: `SESSION_COOKIE_NAME` jest też w `backend-subtracker/src/auth/auth.constants.ts:1`; brak wspólnej paczki, więc duplikat jest uzasadniony, ale zmiana nazwy w jednym miejscu po cichu zepsuje SSR.
- **Fix**: Komentarz przy stałej wskazujący stałą w backendzie.
- **Decision**: FIXED (komentarz-odsyłacz do auth.constants.ts)
