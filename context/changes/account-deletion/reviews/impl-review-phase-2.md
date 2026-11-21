<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Usuwanie konta (S-10)

- **Plan**: context/changes/account-deletion/plan.md
- **Scope**: Phase 2 of 3
- **Reviewed phases**: 2
- **Date**: 2026-11-20
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence

- Changes Required 1–7 match the plan:
  - `AuthService.deleteAccount` sends `POST /auth/delete-account` and clears the user on success.
  - The dialog has `role: 'alertdialog'` and opens with focus on „Anuluj”. The button is enabled only for the account's own address after trim + lowercase, it locks while the request is in flight (`disableClose`), and there are 3 error variants. On 401 the dialog closes, the totals are cleared and the app goes to `/sign-in`.
  - The page clears the totals after `true` and navigates with `{ accountDeleted: true }`.
  - Routes: `account` with `authGuard`, `RenderMode.Client` before `'**'`, and `/account` in `GUARDED_ROUTES`.
  - The notice on `/` uses `role="status"`.
- Automated checks, run again during the review after commit 40e14a7:
  - `npm run test:ci`: 541/541 in both time zones.
  - `npm run build`: no warnings.
  - `npm run build:e2e` + `playwright --project=http`: 8/8; `--project=chromium`: 6/6.
- Manual checks 2.4–2.6 were done by the owner: the e-mail link on desktop and phone, the dialog, the notice gone after a reload. The notice strip on `/` is OK visually.

## Findings

### F1 — Changes after phase 2 at the owner's request

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: frontend-subtracker/src/app/layout/app-shell/app-shell.html:20
- **Detail**: The owner decided that the e-mail address itself is the link to `/account`, with no separate „Konto” link. Commit 40e14a7 makes this change, and the plan and brief describe it (section 5, Phase 3 e2e, manual steps).
- **Fix**: None needed.
- **Decision**: ACCEPTED — the owner's decision

### F2 — The router restored the notice flag after a reload (fixed)

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: frontend-subtracker/src/app/pages/home/home.ts:31
- **Detail**: The plan assumed that a reload loses the navigation state. The Angular router, however, restores it from the history entry on its initial navigation, so the notice came back. The owner's manual check 2.6 found this. In 40e14a7, `Home` removes the flag from the history entry once the notice is shown (`afterNextRender`, `Location.replaceState`), and a test covers it; that test fails without the fix. The plan now describes this in "State sequencing (front)".
- **Fix**: None needed.
- **Decision**: FIXED — 40e14a7
