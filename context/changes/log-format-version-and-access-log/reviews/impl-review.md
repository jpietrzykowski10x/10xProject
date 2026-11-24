<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Format logu, wersja i access log

- **Plan**: context/changes/log-format-version-and-access-log/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-11-25
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 6 observations

Automated criteria re-run on HEAD `e399997`: backend `npm test` (775), `npm run lint`, `npm run build`, frontend `npm run test:ci` (635 × 2 time zones): PASS. During the run (phase gates): backend `test:e2e` 232 + 2 skipped, frontend `build:e2e && e2e` 17/17: PASS. 5.2 (CI on the PR) pending until the push. Manual rows 1.6, 2.6, 3.6, 4.5, 5.3, 5.4 unchecked = pending (none ticked without evidence).

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — An Error passed as the log message bypasses safeStack

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/shared/logging/app-logger.ts:19
- **Detail**: `AppLogger` cleans only the `printStackTrace(stack: string)` path. When an Error object is the message (`ExceptionHandler.logger.error(exception)` in `@nestjs/core/errors/exception-handler.js:5` on a bootstrap failure, `this.logger.error(error)` in `@nestjs/schedule/dist/schedule.explorer.js:124` for a cron handler that throws), `ConsoleLogger.stringifyMessage` writes `util.inspect(error)`: the full stack with the `QueryFailedError: <message>` header and the enumerable fields `query`, `parameters`, `driverError`, `detail`, which can hold e-mail addresses. Today's schedulers never reject (`track()` catches), so the risk is low, but the guarantee in the plan ("stos `QueryFailedError` ma pierwszą linię `QueryFailedError: <message omitted>`") is not complete.
- **Fix**: Override `stringifyMessage` in `AppLogger`: a `QueryFailedError` message becomes `QueryFailedError (code: <failureCodeOf>)` plus the frames of its `safeStack`; add a spec with `logger.error(new QueryFailedError(...))`.
- **Decision**: FIXED — `AppLogger.stringifyMessage` writes a QueryFailedError message as `QueryFailedError (code: X)` + safeStack frames; spec in app-logger.spec.ts (red without the override)

### F2 — SSR access log writes the raw path, also for unknown URLs

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/server-log.ts:117, deploy/mydevil/README.md (paragraph „Wdrożona wersja i logi” / “Deployed version and logs”)
- **Detail**: The API logs a route template or `(unrouted)`, the SSR server logs `req.path` (without the query, as the plan decided). A mistyped or hand-crafted URL such as `/sign-in/anna@example.com` lands in `out.log` as is. The README paragraph says no line carries an address, which is not strictly true for the frontend.
- **Fix A ⭐ Recommended**: Accept the plan's decision and correct the README wording (the SSR path is logged as the client sent it, without the query).
  - Strength: Matches the approved plan; the app's own links never put an address in a path (addresses travel only in `?q=`, which is dropped).
  - Tradeoff: A crafted URL can still write an address into `out.log`.
  - Confidence: MED — depends on how strict the owner wants the log rule to be for paths typed by hand.
  - Blind spot: Not checked whether any external link (mail) ever carries personal data in the path.
- **Fix B**: Mask path segments that contain `@` (e.g. replace them with `(masked)`) in `safePath`, with a spec.
  - Strength: Keeps the "no address in logs" rule literal for both processes.
  - Tradeoff: A design change beyond the plan; a heuristic (only `@`).
  - Confidence: MED — simple to implement, but the rule is a heuristic.
  - Blind spot: Other personal data in paths (names) is not covered either way.
- **Decision**: PENDING — owner decision (Fix A: correct the README wording / Fix B: mask `@` segments)

### F3 — Other TypeORM errors still put data into the 5xx line

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/shared/filters/safe-logging-exception.filter.ts:46-56
- **Detail**: `describeError` hides only `QueryFailedError`. `EntityNotFoundError` builds a multi-line message with `JSON.stringify(criteria, null, 4)` (`EntityNotFoundError.js:15`); its only use today (`auth.service.ts:203`, `findOneOrFail({ where: { id } })`) quotes a uuid, but the line breaks the one-line format, and a future criterion with an address would leak it.
- **Fix A ⭐ Recommended**: Treat every `TypeORMError` as code-only in `describeError` (`<name> (code: X)`), with a spec for `EntityNotFoundError`.
  - Strength: Closes the class, not one error; TypeORM messages are the ones that quote data.
  - Tradeoff: Messages of harmless TypeORM errors (e.g. metadata errors) also disappear from the line; the stack (under `LOG_ERROR_STACKS`) still names them.
  - Confidence: HIGH — `failureCodeOf` already gives the class name for non-PG errors.
  - Blind spot: Not checked which other TypeORM error classes the code can raise at runtime.
- **Fix B**: Collapse whitespace in `describeError` (as `fatalLine` does), keep the message.
  - Strength: Smallest change, keeps the one-line format.
  - Tradeoff: Data in the criteria still reaches the log.
  - Confidence: HIGH
  - Blind spot: None significant.
- **Decision**: PENDING — owner decision (Fix A: every TypeORMError code-only / Fix B: collapse whitespace)

### F4 — backend-patterns.md still gives the old 503 shape of /health

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/backend-patterns.md, bullet „`GET /health` a joby (S-11)”
- **Detail**: It says 503 returns `{ status: 'error', db: 'error' }`; the code returns `{ status, db, version }` (`health.controller.ts`). The new bullet „Format linii (od S-14)” already has the right shape.
- **Fix**: Add `version` to the 503 shape in that bullet.
- **Decision**: FIXED — 503 shape with `version` in backend-patterns.md

### F5 — A new Intl.DateTimeFormat on every log line

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/shared/logging/log-format.ts:26, frontend-subtracker/src/server-log.ts:38
- **Detail**: Measured ~86 µs per call, nearly all of it the constructor; with the access log that is at least one call per request in both processes.
- **Fix**: Cache one formatter per time zone (module-level `Map`) in both files.
- **Decision**: FIXED — formatter cached per time zone in log-format.ts and server-log.ts

### F6 — `aborted` also covers a server that never answered

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/shared/logging/access-log.ts:31-32, frontend-subtracker/src/server.ts (access-log middleware)
- **Detail**: A handler that hangs gets its line only when the socket closes (client gives up or Node's `requestTimeout`, 300 s), labelled `aborted`, so a server hang looks like a client abort. Behaviour is fine; the comment says only "the request was cut off".
- **Fix**: Say in the comments (and in backend-patterns.md) that `aborted` = the connection closed before the response finished, whoever closed it.
- **Decision**: FIXED — comments in access-log.ts and server.ts and the access-log bullet in backend-patterns.md say what `aborted` covers

### F7 — Access log grows out.log, which is not rotated

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend-subtracker/src/config/http-security.ts:15
- **Detail**: Every request gets a `log` line (no cap, unlike `Denials`), including the watchdog every 5 min. Rotation is explicitly out of scope (plan „What We're NOT Doing”, roadmap Open Question #3); the weekly `truncate` > 20 MB stays.
- **Fix**: None in S-14; owner question already open in the roadmap.
- **Decision**: SKIPPED — rotation is out of S-14 scope (plan „What We're NOT Doing”, roadmap Open Question #3)

### F8 — SSR request errors are not in the new format

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend-subtracker/src/server.ts (`angularApp.handle(...).catch(next)`)
- **Detail**: Errors go to Express's default handler, which prints `err.stack` with `console.error`, outside the new format. SSR error visibility is S-15 (plan „What We're NOT Doing”).
- **Fix**: None in S-14; belongs to S-15 (error middleware in `server.ts`).
- **Decision**: SKIPPED — SSR error handling belongs to S-15
