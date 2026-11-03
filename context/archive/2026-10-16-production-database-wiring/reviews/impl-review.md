<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Produkcyjna baza i połączenie frontend → API

- **Plan**: context/changes/production-database-wiring/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-28
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 6 observations

Reviewed after deployment: the code has been on production since merge `413436c` (PR #1). Evidence: plan-drift subagent (every planned item MATCH; two drifts are improvements: atomic `restore-db.sh`, `stop-app.sh`), safety/quality/pattern subagent, all automated criteria re-run (1.1–1.4, 2.1–2.3, 3.1–3.2 pass), manual criteria confirmed during the session (1.5–1.10 locally, 2.4–2.5 in the browser, 3.3–3.11 on MyDevil incl. the rollback drill).

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Restore overwrites the live database without a fresh dump

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: deploy/mydevil/rollback.sh:54-55, deploy/mydevil/restore-db.sh:28-38
- **Detail**: `rollback.sh api` and a manual `restore-db.sh` replace the current database with an older dump. Data written since that dump is gone for good; if the rollback was a mistake there is no way back. The confirmation names the loss but keeps no copy. Related: `restore-db.sh` writes the full plaintext SQL to the shared `/tmp` (0600) and cleans it only on `trap … EXIT`, so an interrupted session may leave it behind.
- **Fix**: In `restore-db.sh`, before the restore, `pg_dump -Fc` the current state to `backups/<stamp>_pre-restore.dump` (same `umask 077`) and abort if that fails; create the temp SQL with `mktemp` inside `backups/` and trap `EXIT INT TERM HUP`.
  - Strength: Covers both callers (rollback and manual) in one place; any restore becomes reversible.
  - Tradeoff: One more dump per restore (seconds for this data size) and one more file kept under the existing 10-dump rotation — the rotation would need to count only deploy dumps or include these.
  - Confidence: HIGH — the same `pg_dump` call is already proven in `deploy.sh`.
  - Blind spot: Rotation interplay with `KEEP_BACKUPS=10` not designed yet.
- **Decision**: FIXED — pre-restore dump in restore-db.sh (backups/<time>_pre-restore.dump, 10 kept, deploy.sh rotation excludes them); temp SQL in backups/, trap on INT TERM HUP. User noted the automatic restore in deploy.sh is already safe (api stopped); the fix targets manual rollback/restore.

### F2 — Failures between migration and health-check skip the recovery path

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: deploy/mydevil/deploy.sh:122-127
- **Detail**: After `migration:run` has committed, `stop-app.sh`, the two `mv` and `start-app.sh` run as bare commands under `set -e`. If one fails (e.g. sourcing `.env`, `realpath`, a `mv`), the script exits immediately: no health-check, no database restore, no log line — the api stays stopped or half-swapped on the migrated schema.
- **Fix A ⭐ Recommended**: Wrap swap + start in `if ! { …; }; then` and route the failure into the same recovery as a failed health-check (stop, `restore-db.sh "$BACKUP"`, put the previous release back).
  - Strength: Reuses the existing, production-tested recovery branch; explicit control flow like the database steps above it.
  - Tradeoff: The recovery must cope with a half-done swap (check which directory is where before moving back).
  - Confidence: MED — the half-swapped states need careful handling.
  - Blind spot: Not exercised on the server; only `sh -n` and reasoning.
- **Fix B**: Track progress in variables and do recovery in a `trap … EXIT` handler.
  - Strength: Catches any unexpected exit, not only the wrapped block.
  - Tradeoff: Traps in POSIX `sh` are harder to read and test; recovery logic moves away from the steps.
  - Confidence: MED — works, but a larger change to a script that just proved itself in production.
  - Blind spot: FreeBSD `sh` trap behaviour on signals not verified.
- **Decision**: FIXED via Fix A — swap_and_start() with explicit returns; a failed swap/start takes the health-check recovery path; recovery moves only the directories that exist.

### F3 — stop-app.sh does not wait for the processes it kills

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: deploy/mydevil/stop-app.sh:22-24
- **Detail**: After the 30 s timeout, `pkill -f` sends SIGTERM and returns at once. `deploy.sh` may then `pg_dump` while the old api is still writing, or `start-app.sh` may hit EADDRINUSE and trigger a needless rollback with a database restore. `pkill` also lacks `-U`, so on the shared host it matches across users (fails with EPERM, but is imprecise).
- **Fix**: `pkill -U "$(id -u)" -f …`, then wait up to ~10 s with `pgrep -U "$(id -u)" -f …`, then `pkill -KILL`, and exit non-zero if anything survives.
- **Decision**: FIXED — pkill/pgrep scoped with -U $(id -u), wait up to 10 s, then SIGKILL, exit 1 if a process survives; deploy.sh aborts cleanly (nothing changed) when the live version cannot be stopped.

### F4 — .env is sourced as shell code; quoting rules undocumented

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: deploy/mydevil/deploy.sh:92,110; deploy/mydevil/restore-db.sh:22; deploy/mydevil/start-app.sh:23; backend-subtracker/.env.example
- **Detail**: The scripts `. .env`, so a value with `$`, a backtick, `"`, `#` or a space is expanded, truncated or executed — and because the values are exported, the app and the TypeORM CLI see the mangled value too. The deploy README mentions quoting values with spaces; `.env.example`, the template for `.env.mydevil`, says nothing. Today's production password is hex, so nothing is broken now.
- **Fix**: Document in `.env.example` (and the README) that values must be plain or single-quoted, with letters/digits recommended for passwords.
- **Decision**: FIXED — quoting rules in backend-subtracker/.env.example and deploy/mydevil/README.md (plain or single-quoted, letters/digits passwords; README also warns against duplicate keys, seen in 3.4).

### F5 — No database connect/query timeout; /health can hang

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/database/database.options.ts:21-33, backend-subtracker/src/health/health.controller.ts:22
- **Detail**: No `connectTimeoutMS` or `statement_timeout`; node-postgres waits indefinitely by default (library default, not tested here). During a database stall or with the pool of 5 exhausted, `/health` hangs instead of returning 503 — the deploy's `curl --max-time 5` masks it, but the frontend badge would stay on "sprawdzam…".
- **Fix**: Add `connectTimeoutMS: 5000` and `extra.statement_timeout: 5000` to the shared options (plus a unit-test expectation).
- **Decision**: FIXED — connectTimeoutMS 5000 for both targets (also bounds the pool wait); statement_timeout 5000 for the app target only, so migrations are never cut off; unit test added.

### F6 — Release bookkeeping: names and first-deploy failure

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: deploy/mydevil/deploy.sh:31,141-147
- **Detail**: (a) The outgoing release is stored under the *new* deploy's SHA (`RELEASE="$RELEASES/${STAMP}_$SHORT_SHA"`), which confused the manual clean-up and the rollback drill. (b) On a first api deploy (`had_live=0`) with a failed health-check, the failed build stays in `public_nodejs`; the next deploy files it as a normal release, so `rollback.sh` could pick it. (b) is only reachable on the very first deploy, which has happened.
- **Fix**: Name the outgoing release after the SHA in its own `.deploy-info` (fallback: `prev`), and on `had_live=0` failure move `public_nodejs` to `releases/<stamp>_<sha>_failed`.
- **Decision**: FIXED — outgoing release named after the SHA in its own .deploy-info (fallback prev); every release now gets .deploy-info (frontend: SHA, empty BACKUP); failed builds parked as <time>_<new sha>_failed, also on a failed first deploy (had_live=0).

### F7 — rollback.sh: no health-check, no APP guard, no lock

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: deploy/mydevil/rollback.sh:14-24,61-65; deploy/mydevil/deploy.sh:16
- **Detail**: `rollback.sh` prints success without checking that the restored release answers, unlike `deploy.sh`. `deploy.sh`/`rollback.sh` do not validate `APP` with the `case` guard used by `start-app.sh`, `stop-app.sh` and `ci-gate.sh` (ci-gate already restricts CI calls). Nothing prevents a manual rollback from running during a CI deploy (workflow `concurrency` covers only workflows).
- **Fix**: Add the `case` guard to both, a health-check after rollback, and a shared `mkdir`-based lock in `bin/` for deploy/rollback/restore.
- **Decision**: FIXED — case guard for APP in deploy.sh and rollback.sh; health-check after rollback (exit 1 if the restored release does not answer); per-app mkdir lock ($BASE/.ops.lock) shared by deploy/rollback, restore-db.sh takes the api lock unless the caller holds it (frontend and api can still deploy in parallel); _rolledback dirs named after their SHA. Not exercised locally (dry run declined) — sh -n only; first real run on the server.

### F8 — CORS origins are not format-validated

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/config/cors.ts:10-24
- **Detail**: `parseCorsOrigins` accepts any string except `*`, including `null` (sent by sandboxed iframes) and plain `http://` origins in PROD. With credentials on, this matters once the session cookie arrives in S-01.
- **Fix**: Parse each entry with `new URL()` (origin only), reject `null`, and require `https:` when `MODE=PROD`.
- **Decision**: FIXED — parseCorsOrigins validates each entry with new URL(): rejects *, null, non-http(s), non-bare origins; https required in PROD (validateEnv passes mode); unit tests added.

### F9 — Server scripts and CI: manual sync, syntax-only checks, tag-pinned actions

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml:60-70, .github/workflows/deploy-backend.yml, .github/workflows/deploy-frontend.yml
- **Detail**: `deploy/mydevil/*.sh` are copied to the server by hand, so the server can drift from the repo (it happened mid-change and was caught by size checks). CI only runs `sh -n`. Actions are pinned by tag (`@v5`) in jobs that hold the deploy key.
- **Fix**: Add `shellcheck` to the `deploy-scripts` CI job; keep the manual `scp` but add a size/sha check step to the README checklist. Pinning actions by SHA is optional for a solo project.
  - Strength: Catches real shell bugs (like F2/F3 classes) before they reach the server; cheap.
  - Tradeoff: shellcheck may flag existing intentional patterns (e.g. word splitting in ci-gate.sh) that need disable comments.
  - Confidence: MED — not run against these scripts yet.
  - Blind spot: Automating the server sync would need the CI key to write `bin/`, which the forced command deliberately forbids.
- **Decision**: FIXED — shellcheck --shell=sh -S warning in the CI deploy-scripts job (clean locally with 0.11; SC2010/SC1090 disabled per line with reasons); README upload checklist compares sha256 of all scripts. Actions stay tag-pinned (solo project, accepted).

### F10 — stop-app.sh missing from change notes

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/changes/production-database-wiring/change.md (Notes)
- **Detail**: All additions beyond the plan are justified and the CI ones are documented in change.md, but `stop-app.sh` (and `start-app.sh` calling it) is explained only in commit `43a18cf`. Other extras: `vitest.config.e2e.ts` (`loadEnv`), `app.scss`, `angular.json` analytics — harmless.
- **Fix**: Add one line to change.md Notes describing `stop-app.sh` and why it exists.
- **Decision**: FIXED — change.md Notes describe stop-app.sh and the review fixes.
