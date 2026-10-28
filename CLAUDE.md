# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository notes (not synced by 10x-cli — safe to edit)

Everything between the `BEGIN`/`END @przeprogramowani/10x-cli` markers below is overwritten by `10x get` / `10x sync`; put project-specific guidance here instead.

### Tripwires

- **No root `package.json`.** Two independent apps, no monorepo tooling — run every `npm` command from inside `frontend-subtracker/` or `backend-subtracker/`.
- **Node 24 is required** (Angular CLI 22 refuses Node < 22.22.3 / 24.15.0). The machine uses `fnm`, not `nvm`.
- **The backend is native ESM** (`"type": "module"`, `module: nodenext`). Relative imports must carry the `.js` extension (`import { AppModule } from './app.module.js'`), and `src/main.ts` uses top-level `await`.
- **Every frontend route is prerendered at build time** — `src/app/app.routes.server.ts` maps `'**'` to `RenderMode.Prerender`. Routes that depend on the logged-in user or live data need an explicit `RenderMode.Server` (or `Client`) entry, or they will ship stale HTML.
- **Recurring rules live in @context/foundation/lessons.md** — follow them when planning and implementing.
- **Backend auth, roles, CORS and mail patterns live in `context/foundation/backend-patterns.md`** — read it before planning or implementing any slice that touches sign-in, sessions, guards, roles, CORS or e-mail (S-01, S-09 first). Roles are a separate `role` + `user_role` table pair, not a column on `user`.
- **`.claude/skills/` and `.agents/skills/` are generated** by the `10x` CLI and git-ignored; don't hand-edit them. `skills-lock.json` and `.claude/.10x-cli-manifest.json` track their provenance. Behaviour changes belong upstream in `przeprogramowani/10x-cli`.

### Project

**SubTracker** — a web app for tracking personal subscriptions, with duplicate detection, budget alerts, and a subscription lifecycle state machine. The root `README.md` is a placeholder; the real specs live in `context/foundation/`:

- `prd.md` — requirements (structure defined by `.claude/skills/10x-shape/references/prd-schema.md`)
- `tech-stack.md` — stack decisions and the deployment plan; source of truth when this file and it disagree
- `context/changes/bootstrap-verification/verification.md` — how the apps were scaffolded and the audit at the time

### Architecture

- `frontend-subtracker/` — Angular 22, standalone components, SSR via `@angular/ssr`. `src/server.ts` is an Express server (port `PORT`, default 4000) that serves `dist/.../browser` and renders everything else through `AngularNodeAppEngine`; `app.config.server.ts` merges server providers onto `app.config.ts` (which enables client hydration). Styles are SCSS.
- `backend-subtracker/` — NestJS 12, strict TypeScript, listens on `PORT` (default 3000), PostgreSQL via TypeORM (`src/database/`), env validated at startup (`src/config/env.ts`), `GET /health` checks the database, CORS from `CORS_ORIGINS` with credentials. Still planned per `tech-stack.md`: magic-link auth, the admin role, the subscription state machine, and scheduled jobs (`@nestjs/schedule`) for trial reminders.
- The two apps run as separate Node processes on separate subdomains of MyDevil (FreeBSD), so the API needs CORS and a session cookie scoped to the parent domain. GitHub Actions: `ci.yml` checks every branch except `main` and PRs into `main`; `deploy-*.yml` deploy on push to `main` (i.e. after a merge) by piping the `.mydevil/` package over SSH to `deploy/mydevil/deploy.sh`, which runs `npm ci --omit=dev` on the server (never ship Linux-built `node_modules` to FreeBSD). Work on a `change/<change-id>` branch, never commit straight to `main`.
- **API deploy has a short downtime**: stop the API, `pg_dump`, `migration:run`, swap, health-check on `/health`; on failure the database is restored from the dump and the previous version starts. Details and manual restore: `deploy/mydevil/README.md`. The server scripts are uploaded by hand (`scp`), not by CI.
- **Config files**: `backend-subtracker/.env` (local dev) and `.env.mydevil` (template for the server's `~/apps/subtracker/api/shared/.env`) are both git-ignored; `.env.example` documents the keys.

### Commands

Frontend (`cd frontend-subtracker`):

- `npm start` — dev server (`ng serve`)
- `npm run build` — production build to `dist/frontend-subtracker/` (browser + server bundles)
- `npm run serve:ssr:frontend-subtracker` — run the built SSR server
- No lint or test target exists yet — the app was scaffolded with `--skip-tests`, so `ng test` has no builder.

Backend (`cd backend-subtracker`):

- `npm run start:dev` — dev server with watch; `npm run build` then `npm run start:prod` for the built app
- `npm run lint` — oxlint (type-aware); `npm run format` — prettier
- `npm test` — vitest unit tests (`src/**/*.spec.ts`); `npm run test:e2e` — e2e tests in `test/`; `npm run test:cov` — coverage
- Single test file: `npx vitest run src/app.controller.spec.ts`
- `start:dev` and `test:e2e` need the local PostgreSQL (`database/create-local-databases.sql`) and `.env`.

Database (`cd backend-subtracker`) — two local databases with the same owner:

- `subtracker-db-dev`: the app's database in `MODE=DEV`; `DATABASE_AUTO_SYNCHRONIZATION=true` lets TypeORM rebuild the schema from entities.
- `subtracker-db`: reference database, changed only by migrations; every `migration:*` script targets it (`POSTGRES_DATABASE`).
- `npm run migration:generate -- <Name>` — diff entities vs `subtracker-db` into `src/database/migrations/` (exit 1 with "No changes in database schema were found" when nothing changed); `npm run migration:create -- <Name>` — empty migration
- `npm run migration:run` / `migration:show` — apply / list on `subtracker-db`; `migration:revert` locally only, never in production

Formatting: @frontend-subtracker/.prettierrc, @backend-subtracker/.prettierrc.

### Skills installed here beyond the synced block

- `/10x-idea-check` (`.claude/skills/`) — pre-shaping check of whether an idea is worth shaping at all.
- `/10x-cli-setup` (`.agents/skills/`) — installs and troubleshoots the `10x` CLI itself; only relevant when downloads or auth misbehave.

### Known drift vs. the synced block

When the synced block and an installed `SKILL.md` disagree, the `SKILL.md` wins.

- `/10x-init` creates only `context/{changes,archive,foundation}/` with a `README.md` in each. `docs/reference/contract-surfaces.md` does not exist and nothing here creates it; `context/foundation/lessons.md` is created by `/10x-lesson`.
- `/10x-bootstrapper` scaffolds a single starter into the repo root; SubTracker's two sibling apps were an adaptation made during the run.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 2

Turn one roadmap item into the first implementation cycle with the **change planning chain**:

```
/10x-roadmap -> /10x-new -> /10x-plan -> /10x-plan-review -> /10x-implement
```

`/10x-new`, `/10x-plan`, `/10x-plan-review`, and `/10x-implement` are the lesson focus. `/10x-frame` and `/10x-research` are not required rituals here; they are escalation paths introduced in the next lesson.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Change setup (lesson focus)** | |
| `/10x-new <change-id>` | You selected a roadmap item and need a stable change folder. Creates `context/changes/<change-id>/change.md` so planning, implementation, progress, commits, and later review all share one identity. Use AFTER roadmap selection, BEFORE `/10x-plan`. |
| **Planning (lesson focus)** | |
| `/10x-plan <change-id>` | You have a change folder and need a reviewable implementation plan. Reads roadmap context, foundation docs, codebase evidence, and any existing change notes; writes `plan.md` and `plan-brief.md` with phases, file contracts, success criteria, and `## Progress`. |
| **Plan readiness (lesson focus)** | |
| `/10x-plan-review <change-id>` | You have `plan.md` and need a light pre-code readiness check. Use it to catch missing end state, weak contracts, malformed progress, scope drift, or blind spots before code changes begin. |
| **Implementation (lesson focus)** | |
| `/10x-implement <change-id> phase <n>` | You have an approved plan and want to execute one phase with verification, manual gate, commit ritual, and SHA write-back to `## Progress`. |
| **Lifecycle closure** | |
| `/10x-archive <change-id>` | A change is merged or intentionally closed. Move it out of active `context/changes/` into archive state. |

### How the chain hands off

- `/10x-new` creates the durable change identity.
- `/10x-plan` turns that identity into an implementation contract.
- `/10x-plan-review` checks the plan before the agent mutates code.
- `/10x-implement` executes one planned phase, verifies, asks for manual confirmation when needed, commits, and records progress.

### Lesson boundaries

- Plan is the default router after roadmap selection. Start with `/10x-plan` unless the problem is unclear or external evidence is blocking.
- Do not run `/10x-frame + /10x-research` as ceremony for every change.
- Do not turn this lesson into a full end-to-end product build. A checkpoint with a planned and partially or fully implemented stream is valid.
- Code review of the implemented diff belongs to Lesson 3 via `/10x-impl-review`.
- Lifecycle closure via `/10x-archive` after a change is merged or intentionally closed.

### Paths used by this lesson

- `context/foundation/roadmap.md` - upstream roadmap
- `context/changes/<change-id>/change.md` - change identity
- `context/changes/<change-id>/plan.md` - implementation contract
- `context/changes/<change-id>/plan-brief.md` - compressed handoff
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
