<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Zarządzanie kontami przez administratora (S-09)

- **Plan**: context/changes/admin-account-management/plan.md
- **Scope**: Full plan (phases with Progress fully checked)
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-21
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Phase 5 (documentation committed in b9328ff; 5.2 and 5.3 need the production deploy) is not in this review's coverage.

Scope Discipline WARNING: unplanned but harmless additions — `shared/database/like-pattern.ts` (+ spec, `ILIKE` escaping, follows the `shared/` lesson), `subscriptions/active-owner.ts` (`OWNER_IS_ACTIVE`, now also used by the trial reminder job), `admin/admin-user.types.ts` (status filter and limits), `test/admin/admin-e2e.ts` (`fileSuperAdmin(skip)`). User-approved deviations: `status=all|active|blocked` instead of `blocked`, the `AccountAccessService` hook, `lockActiveUser` → `lockUser`, the clickable result rows with three width tiers. All "What We're NOT Doing" boundaries held.

Success Criteria: every Automated command passed in this session on the final code (backend lint, build, 490 unit, 189 e2e + both superadmin tests run separately; frontend test:ci 611, build, build:e2e, Playwright 17). Manual 1.5, 2.3, 3.3 and 4.4 were confirmed by the user in the conversation.

## Findings

### F1 — Repeated "account blocked" mail on every link request

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/auth/services/auth.service.ts (requestLink → sendBlockedMail)
- **Detail**: Each `POST /auth/request-link` for a blocked address sends another `ACCOUNT_BLOCKED` mail, and the API has no throttling. Anyone who knows a blocked address can flood its inbox (the owner is someone already in conflict with the service). The magic link mail has the same exposure for active addresses, but here every probe of the accepted enumeration exception also mails the owner.
- **Fix A ⭐ Recommended**: Resend the block mail at most once per hour: skip when the newest `mail` row of type `ACCOUNT_BLOCKED` for that recipient is younger than 1 h (the 403 with the contact is still returned).
  - Strength: Uses the existing `mail` audit and its `recipient` index; no schema change; the page message still tells the user everything.
  - Tradeoff: A short window in which a lost first mail is not resent.
  - Confidence: HIGH — `mail.recipient` is indexed since S-10 and rows are written for every send.
  - Blind spot: Failed sends (`FAILED` rows) — should count only `SENT`.
- **Fix B**: Accept as a known risk alongside the general lack of rate limiting.
  - Strength: No code.
  - Tradeoff: Leaves an easy annoyance vector against blocked users.
  - Confidence: MEDIUM — depends on how many accounts get blocked.
  - Blind spot: No monitoring would show the abuse.
- **Decision**: FIXED via Fix A — mail about the block resent at most once per BLOCKED_MAIL_RESEND_INTERVAL (1 h, newest SENT ACCOUNT_BLOCKED row of the recipient); e2e and unit tests, break-check red

### F2 — Extra VIEW audit rows after every admin action

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/app/pages/admin/admin-user/admin-user.ts:84-89
- **Detail**: After each action (also a refused 403/404/409) the page reloads `GET /admin/users/:id`, which writes another `VIEW` row; one block leaves BLOCK + VIEW. Acceptable if VIEW means "data was shown", but it inflates the trail.
- **Fix**: Update the profile from the action's response (`AdminUserSummary`) instead of reloading the whole detail; reload only after 404/409.
- **Decision**: FIXED — the detail page takes the profile from the action answer (dialog closes with { kind: done, user }); full reload only after 404/409; spec asserts no second GET, break-check red

### F3 — Any admin can view the superadmin's and other admins' data

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/admin/services/admin-users.service.ts:127-152
- **Detail**: Only actions check rank; `GET /admin/users/:id` lets any ADMIN read the full data (subscriptions, amounts) of other admins and of the superadmin. Matches the decision "admin widzi wszystko", but the superadmin's own data was not discussed explicitly.
- **Fix**: Confirm as intended, or require `canManage || viewer is superadmin` for viewing accounts of equal or higher rank.
- **Decision**: ACCEPTED — intended: every admin sees every account, including admins and the superadmin (decision 2026-11-21 „admin widzi wszystko”)

### F4 — Fire-and-forget mail calls without a catch

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/auth/services/account-access.service.ts:171; auth.service.ts (sendBlockedMail)
- **Detail**: `void this.mail.sendToUser(...)` relies on `sendToUser` never rejecting. True today, but a future throw (e.g. in `mayReceive` or a template) would become an unhandled rejection that can crash the process.
- **Fix**: Add `.catch((error) => logger.error(message))` at both call sites (same as the magic link call, if it has one).
- **Decision**: FIXED — .catch with a log of the message only at the fire-and-forget mail calls (AuthService.fireAndForget, AccountAccessService.notify)

### F5 — SeedSuperAdminRole down() fails when a superadmin exists

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/database/migrations/1795264077307-SeedSuperAdminRole.ts
- **Detail**: `user_role.role_id` references `role` with `ON DELETE NO ACTION` (AuthAndMailSchema:29), so `down()` deleting the role fails once the role was granted. Revert is local-only by team rule.
- **Fix**: In `down()`, `DELETE FROM "user_role" WHERE "role_id" = '<uuid>'` before deleting the role.
- **Decision**: FIXED — down() deletes the role's user_role rows before the role
