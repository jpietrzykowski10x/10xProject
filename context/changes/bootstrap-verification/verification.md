---
bootstrapped_at: 2026-09-30T18:35:06Z
starter_id: angular
starter_name: Angular
project_name: frontend-subtracker
language_family: js
package_manager: npm
cwd_strategy: subdir-then-move
bootstrapper_confidence: verified
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

```yaml
starter_id: angular
package_manager: npm
project_name: frontend-subtracker
hints:
  language_family: js
  team_size: solo
  deployment_target: self-host
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: verified
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: true
    docs_current: true
    can_judge_agent: true
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: true
```

### Why this stack

Solo developer building SubTracker after hours in 7 weeks rejected the Astro-based default because they don't know Astro and prefer Angular and NestJS, both of which they can judge an agent's output in; both starters pass all four agent-friendly gates and are bootstrapper-verified. Angular is the primary starter and must be scaffolded with SSR enabled (`--ssr`, overriding the card's `--ssr false`); a NestJS API sits beside it in `backend-subtracker`, added via `nest new`, in one repo without monorepo tooling. The API owns magic-link auth, the admin role, the subscription lifecycle state machine and scheduled jobs (`@nestjs/schedule`) for trial reminders, backed by PostgreSQL with TypeORM (chosen over Prisma). Both apps self-host on MyDevil as two Node processes on separate subdomains and ports, kept alive with `forever` and an `@reboot` cron, so CORS and a parent-domain session cookie are required. GitHub Actions uses per-directory path filters and auto-deploys on merge via rsync over SSH; since MyDevil runs FreeBSD, CI ships the build output and lockfile and runs `npm ci --omit=dev` on the server rather than copying Linux-built `node_modules`.

### Session overrides

- SSR enabled for the frontend (`--ssr` instead of the card's `--ssr false`), per the hand-off rationale; confirmed by the user.
- Layout: two sibling folders — Angular into `frontend-subtracker/`, NestJS (registry card `nestjs`) into `backend-subtracker/` — instead of scaffolding Angular into the repo root. Confirmed by the user.
- Toolchain: the first attempt failed because Angular CLI 22 requires Node ≥ 22.22.3 / 24.15.0 (the machine had v22.14.0). Node v24.21.0 was installed via fnm and set as the default before this run.

## Pre-scaffold verification

| Signal      | Value                                          | Severity | Notes                                                   |
| ----------- | ---------------------------------------------- | -------- | ------------------------------------------------------- |
| npm package | @angular/cli v22.2.0 published 2026-09-23      | fresh    | resolved from cmd_template (`npx @angular/cli new`)     |
| npm package | @nestjs/cli v12.0.8 published 2026-09-28       | fresh    | companion API starter (registry card `nestjs`)          |
| GitHub repo | not run                                        | —        | card `docs_url` is not a GitHub URL; `gh` not installed |

## Scaffold log

### Frontend (Angular)

**Resolved invocation**: `npx -y @angular/cli@22 new frontend-subtracker --defaults --routing --style scss --skip-tests --ssr --skip-git --package-manager npm`
**Strategy**: subdir-then-move (adapted: scaffold into a fresh `frontend-subtracker/` subfolder; it did not exist, so no move-up or conflicts were needed)
**Exit code**: 0
**Files written**: 26 (excluding `node_modules/`), plus `package-lock.json`; dependencies installed
**Notable files**: `src/server.ts`, `src/main.server.ts`, `src/app/app.config.server.ts`, `src/app/app.routes.server.ts` (SSR enabled)
**Conflicts (.scaffold siblings)**: none
**.gitignore handling**: the app ships its own `frontend-subtracker/.gitignore`; root `.gitignore` untouched by this CLI
**.bootstrap-scaffold cleanup**: not used

### Backend (NestJS)

**Resolved invocation**: `npx -y @nestjs/cli@12 new backend-subtracker -p npm --strict --skip-git`
**Strategy**: subdir-then-move (adapted: scaffold into a fresh `backend-subtracker/` subfolder)
**Exit code**: 0
**Files written**: 16 (excluding `node_modules/`), plus `package-lock.json`; dependencies installed
**Conflicts (.scaffold siblings)**: none
**.gitignore handling**: `--skip-git` means no `backend-subtracker/.gitignore` was generated; instead the CLI appended `/backend-subtracker/node_modules` to the root `.gitignore`. `dist/`, `.env`, `coverage/` for the backend are **not** ignored yet.
**.bootstrap-scaffold cleanup**: not used

## Post-scaffold audit

### Frontend

**Tool**: `npm audit --json` (run in `frontend-subtracker/`)
**Summary**: 0 CRITICAL, 0 HIGH, 0 MODERATE, 0 LOW
**Direct vs transitive**: nothing to split — clean tree (417 dependencies)

### Backend

**Tool**: `npm audit --json` (run in `backend-subtracker/`, exit code 1 — informational)
**Summary**: 0 CRITICAL, 2 HIGH, 1 MODERATE, 2 LOW
**Direct vs transitive**: 0/0/1/0 direct of total 0/2/1/2. All findings trace back to the dev dependency `@nestjs/mau` (Nest's optional Mau deployment CLI); none are in production dependencies.

#### CRITICAL findings

None.

#### HIGH findings

- **tmp** `<=0.2.5` (transitive via `@nestjs/mau` → `inquirer` → `external-editor`) — GHSA-52f5-9888-hmc6 (arbitrary temp file/dir write via symlink `dir` parameter), GHSA-ph9p-34f9-6g65 (path traversal via unsanitized prefix/postfix).
- **undici** `<=6.28.0` (transitive via `@nestjs/mau`) — 17 advisories, including GHSA-2mjp-6q6p-2qxm (request/response smuggling), GHSA-4992-7rv2-5pvq (CRLF injection via `upgrade`), GHSA-c76h-2ccp-4975 (insufficiently random values), several WebSocket/decompression DoS issues; fixed in undici ≥ 6.28.1.

#### MODERATE findings

- **@nestjs/mau** `^0.2.6` (direct, devDependency) — flagged because of its `inquirer` and `undici` chains above. npm's suggested fix is a semver-major change of `@nestjs/mau` (to 0.0.6); removing the package is the simpler option if Mau deployment is not used (it is not — the project self-hosts on MyDevil).

#### LOW / INFO findings

- **inquirer** `3.0.0 – 8.2.6 || 9.0.0 – 9.3.7` (transitive via `@nestjs/mau`) — through `external-editor`.
- **external-editor** `>=1.1.1` (transitive via `inquirer`) — through `tmp`.

## Hints recorded but not acted on

| Hint                    | Value                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| bootstrapper_confidence | verified                                                                                                |
| quality_override        | false                                                                                                   |
| path_taken              | custom                                                                                                  |
| self_check_answers      | typed: true, from_official_starter: true, conventions: true, docs_current: true, can_judge_agent: true |
| team_size               | solo                                                                                                    |
| deployment_target       | self-host                                                                                               |
| ci_provider             | github-actions                                                                                          |
| ci_default_flow         | auto-deploy-on-merge                                                                                    |
| has_auth                | true                                                                                                    |
| has_payments            | false                                                                                                   |
| has_realtime            | false                                                                                                   |
| has_ai                  | false                                                                                                   |
| has_background_jobs     | true                                                                                                    |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- The repo already has git history; review the new `frontend-subtracker/` and `backend-subtracker/` folders and commit them.
- Add a `backend-subtracker/.gitignore` (at least `node_modules/`, `dist/`, `.env`, `coverage/`) — the NestJS CLI skipped it because of `--skip-git`.
- Address audit findings per your project's risk tolerance — all backend findings sit under the unused dev dependency `@nestjs/mau`.
- Pin the Node version for the repo and CI (e.g. `.node-version` with `24`), since Angular CLI 22 needs Node ≥ 22.22.3 / 24.15.0.
