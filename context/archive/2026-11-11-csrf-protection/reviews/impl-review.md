<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Ochrona CSRF w API

- **Plan**: context/changes/csrf-protection/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-11-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria re-run: `npm test` 113 passed, `npm run test:e2e` 52 passed, lint without errors, build OK. Phase 2: CI on PR #13 green (`backend`, `frontend`, `deploy-scripts`), backend deploy succeeded, production curls: foreign Origin + `cross-site` → 403, foreign Origin only → 403, frontend origin + `same-site` → 204, no browser headers → 204; full frontend flow confirmed by the user.

Verified as fine: Express order is cors → security hook (headers, then CSRF) → body parsers → routes, so a rejected request is never parsed and unknown paths get 403, not 404; all 4 state-changing routes are POSTs under the hook; Host rewriting by the MyDevil proxy cannot decide a legitimate request (the frontend always passes through `trustedOrigins`) nor fail open; every valid `CORS_ORIGINS` value is already canonical, so `normalizeTrustedOrigin` cannot crash startup; 403 goes through `SafeLoggingExceptionFilter` without a log and carries the security headers; the F1 test proves no cookie, no session row and an unused token.

## Findings

### F1 — Brak testu: zaufany origin bez Sec-Fetch-Site

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: backend-subtracker/test/app.e2e-spec.ts:103-109
- **Detail**: Starsza przeglądarka z frontendu wysyła `Origin` bez `Sec-Fetch-Site`; przechodzi tylko przez wyjątek `trustedOrigins` (Origin ≠ Host API). Test frontendu sprawdza tylko `same-site`.
- **Fix**: Dodać przypadek `POST /auth/logout` z `Origin: allowedOrigin` bez `Sec-Fetch-Site` → 204.
- **Decision**: FIXED (test „lets the frontend through without Sec-Fetch-Site”; czerwony przy pustym trustedOrigins)

### F2 — Odpowiedź 403 bez sprawdzenia nagłówków bezpieczeństwa

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: backend-subtracker/test/app.e2e-spec.ts:91-96
- **Detail**: Testy sprawdzają tylko status. Kolejność „nagłówki przed sprawdzeniem CSRF” w hooku Nesta nie jest przypięta testem; refaktor (np. przeniesienie `useSecurityHeaders`) mógłby ją zmienić bez sygnału.
- **Fix**: W teście obcej strony dodać `.expect('X-Content-Type-Options', 'nosniff')`.
- **Decision**: FIXED (403 sprawdza X-Content-Type-Options: nosniff)

### F3 — Powiązanie CORS i zaufania CSRF nie jest opisane przy zmiennej

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/.env.example (CORS_ORIGINS)
- **Detail**: Każdy origin z `CORS_ORIGINS` jest też zaufany dla żądań zmieniających stan. Ktoś, kto dopisze tymczasowy origin na produkcji (PROD wymusza https), zwolni go też z ochrony CSRF. Opisane w `backend-patterns.md`, ale nie przy samej zmiennej.
- **Fix**: Komentarz przy `CORS_ORIGINS` w `.env.example`: lista jest też listą zaufanych originów CSRF.
- **Decision**: FIXED (komentarz przy CORS_ORIGINS w .env.example)
