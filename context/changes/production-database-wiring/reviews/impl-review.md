# Implementation review — production-database-wiring

- **Date:** 2026-10-28
- **Reviewed phases:** 1, 2, 3 (full plan)
- **Reviewer:** Claude Code, the same agent that implemented the change. This is a self-review against `plan.md`, not an independent review: `/10x-impl-review` is not installed in this repository (lesson 3). Treat it as a checklist pass, not a second opinion.
- **Scope:** commits `267a2f8`, `e0a381a` (phase 1), `92923bd`, `569ef7b` (phase 2), `0b9db12`, `f6a1760`, `43a18cf`, `605086f`, `983a8e2`, `7386516` (phase 3, CI and follow-ups), as merged into `origin/main` @ `7386516`.
- **Verdict:** approved. The plan's end state holds in production. Two low-severity follow-ups remain (below).

## Phase 1 — Backend: TypeORM, config, `/health`, CORS

All nine "Changes Required" items are implemented. Lessons respected: no `any`; `synchronize` only with `MODE=DEV` (enforced in the options and rejected by env validation in `PROD`); `.js` import extensions. The CLI always targets `POSTGRES_DATABASE` (verified locally in 1.6: `migration_history` only in `subtracker-db`).

Deviations from the plan, all minor and recorded during implementation:

- `scripts/migration-file.mjs generate|create` instead of `scripts/migration-generate.mjs`: one script serves both `migration:generate` and `migration:create`.
- The app reads config through `envFromConfig(ConfigService)`. With `validate`, `ConfigModule` does not copy the `CORS_ORIGINS` array to `process.env`; the first start failed on that. The CLI still validates `process.env` after `loadEnvFile`.
- `vitest.config.e2e.ts` loads `.env` through `loadEnv`, because Vitest's own `MODE=test` shadowed `MODE` from `.env`.

Findings:

- Fixed (`e0a381a`): the e2e test configured CORS itself instead of using the production setup. Now `applyCors()` is shared by `main.ts` and the test; a deliberate break of `credentials` turned the e2e test red.
- Accepted: a foreign origin gets `Access-Control-Allow-Credentials: true` (the `cors` package always sends it) but no `Access-Control-Allow-Origin`, so browsers reject the response. 3.9 checks only `Allow-Origin`.

## Phase 2 — Frontend: API URL and status

- `environment.ts` / `environment.development.ts` with `fileReplacements` in the development build; the production bundle contains only the production URL (checked: no `localhost:3000`).
- `provideHttpClient(withFetch())`; `api-status` calls `GET {apiUrl}/health` with `withCredentials: true` inside `afterNextRender`, so prerendering never calls the API (2.2: prerendered HTML holds the `checking` state, `class="api-status api-status--checking"`).
- State is a typed signal union, the response a typed interface; no `any`. 503 with `db: "error"` → "baza niedostępna", any other error → "API niedostępne" (2.5 confirmed both).
- Observation, no action: the browser gets `304` on repeated `/health` calls because Express sends an ETag. The server still runs `SELECT 1` on every request, so the status is never stale.

## Phase 3 — Deploy: downtime, backup, migrations, restore, health-check

- `deploy.sh` follows the planned order for the api (stop, `pg_dump -Fc` under `umask 077` with `PGPASSWORD`, `migration:run` from the new release, `.deploy-info`, swap, health-check on `/health`) and all three failure paths. The frontend keeps `/`.
- `restore-db.sh` deviates from the plan for the better: `pg_restore` writes SQL to a private temp file, then one `psql --single-transaction` drops/recreates `public` and replays it, so a failed restore changes nothing (the plan's two separate calls could leave an empty schema).
- `rollback.sh api` restores the database from `.deploy-info` together with the code, after typing `TAK`; it refuses without `.deploy-info` or the dump.
- Verified in production: deploy with backup and `Init` (3.6, 3.10), `/health` and CORS (3.7–3.9), and the rollback drill with schema wipe plus re-deploy (3.11).

Findings:

- Fixed (`43a18cf`): `forever stop` hung for hours on a crash-looping app in the premature deploy of `e0a381a`. `stop-app.sh` caps it at 30 s and falls back to killing this app's processes by path; every script stops apps through it. Exercised on the server before the merge.
- Fixed (`7386516`): `rollback.sh` said "restored" before the confirmation; `restore-db.sh` echoed `set_config` and "drop cascades" notices.
- Follow-up, low: release directories are named with the SHA of the deploy that *replaced* them (`RELEASE="$RELEASES/${STAMP}_$SHORT_SHA"` uses the new SHA for the old version). This was confusing during the manual clean-up and the rollback drill. Worth renaming to the outgoing release's SHA (from its `.deploy-info`) in a later change.
- Follow-up, low: on a *first* api deploy (`had_live=0`) whose health-check fails, the database is restored and the new code is stopped but left in `public_nodejs`; a server reboot (`start-all.sh`) would start it on the pre-migration schema. Only reachable on the very first deploy, which has already happened.

## Process notes

- Phase 1 reached `main` and was pushed before the server was prepared, so the first api deploy failed (env validation) and exposed the `forever stop` hang. Since then work happens on `change/<id>` branches, `ci.yml` checks branches and PRs, and deploys run only after a merge to `main`.
- `restore-db.sh` was not exercised against a local database (the run was declined); its first real run was the production drill 3.11, which passed.
