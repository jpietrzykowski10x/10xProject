<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Sumy kosztów na dashboardzie (S-04)

- **Plan**: context/changes/dashboard-cost-totals/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-11-15
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

Notes:

- Plan Adherence: every planned item in both phases is MATCH.
- Scope Discipline: the EXTRA items were disclosed and accepted during implementation:
  - `shared/polish-plural.ts` and `subscriptionCountLabel`;
  - the e2e helper `getTotals`;
  - the stricter `fromGrosze`;
  - `row-reverse` in the phone header, at the user's request;
  - S-04 marked `in-progress` in `roadmap.md`.
- The "What We're NOT Doing" list was respected.
- Success Criteria: every automated command passed again during the review:
  - backend: test, lint, build, test:e2e 90, migration:generate "No changes";
  - frontend: test:ci 330 × 2, build, build:e2e, e2e 13.
- Manual checks 1.6 and 2.4–2.7 were confirmed by the user.

## Findings

### F1 — Expired session leaves the previous account's totals in memory

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/subscriptions/cost-totals.store.ts:24-29, frontend-subtracker/src/app/auth/session-expired.interceptor.ts
- **Detail**: `clear()` runs only after a successful `logout()`. When the 401 interceptor redirects to `/sign-in`, the root store keeps the `ready` state. A failed `refresh()` deliberately keeps it too. The totals are never shown, because `AppShell.ngOnInit` → `load()` resets the state to `loading` first, and the component test covers this. Still, the safety rests on one invariant: every consumer goes through `load()`.
- **Fix**: Call `CostTotalsStore.clear()` in the session-expired interceptor before the redirect to `/sign-in`. Add a test in `session-expired.interceptor.spec.ts`.
- **Decision**: FIXED — `CostTotalsStore.clear()` in the 401 interceptor + test (break-check: red without the call)

### F2 — The "Spróbuj ponownie" button on the list does not refresh the totals

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: frontend-subtracker/src/app/pages/subscriptions/subscriptions.html:33
- **Detail**: The plan lists `refresh()` only for `onSaved`, `onMissing` and `confirmRemove`. If the API was unreachable on entry, the list shows "Spróbuj ponownie" and the totals show "Nie udało się wczytać sum.". The retry reads only the list, so the totals stay in the error state until the next save or a reload.
- **Fix**: The retry buttons (`load(true)` / `load()`) also call `totals.refresh()`. A page test expects a GET of the totals after the retry.
- **Decision**: FIXED — `retry()` on the page (list + `totals.refresh()`) on both buttons + page test (break-check: red without the call)

### F3 — Polish category order depends on the full ICU in Node on MyDevil

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: backend-subtracker/src/subscriptions/cost-totals.ts (`localeCompare(..., 'pl')`)
- **Detail**: The tie-break on name is done in JS, as the plan decided. It does not depend on the database collation, but it depends on the ICU data in the Node build on the server (FreeBSD). The "Łączność" before "Zdrowie" test runs only locally and in CI on Linux. Without full ICU, "Ł" would silently sort after "Z". The same applies to the existing `categories.service.ts`.
- **Fix**: One-time check on the server: `node -e "console.log(['Zdrowie','Łączność'].sort(new Intl.Collator('pl').compare))"` should print `Łączność` first.
- **Decision**: FIXED — checked on MyDevil 2026-11-15: `[ 'Łączność', 'Zdrowie' ]`, full ICU present; no code change
