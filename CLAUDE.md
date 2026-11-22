# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository notes (not synced by 10x-cli — safe to edit)

Everything between the `BEGIN`/`END @przeprogramowani/10x-cli` markers below is overwritten by `10x get` / `10x sync`; put project-specific guidance here instead.

### Tripwires

- **No root `package.json`.** Two independent apps, no monorepo tooling — run every `npm` command from inside `frontend-subtracker/` or `backend-subtracker/`.
- **Node 24 is required** (Angular CLI 22 refuses Node < 22.22.3 / 24.15.0). The machine uses `fnm`, not `nvm`.
- **The backend is native ESM** (`"type": "module"`, `module: nodenext`). Relative imports must carry the `.js` extension (`import { AppModule } from './app.module.js'`), and `src/main.ts` uses top-level `await`.
- **Every frontend route is prerendered at build time** — `src/app/app.routes.server.ts` maps `'**'` to `RenderMode.Prerender`. Routes that depend on the logged-in user or live data need an explicit `RenderMode.Server` (or `Client`) entry, or they will ship stale HTML. Today `register`, `sign-in`, `auth/verify`, `subscriptions`, `dashboard`, `budget`, `account`, `admin/users` and `admin/users/:id` are `Client` (the admin pages sit behind `adminGuard`: `ADMIN` or `SUPER_ADMIN`; a new `authGuard` or `adminGuard` page also goes into `GUARDED_ROUTES` in `e2e/http/render-modes.e2e-spec.ts`); `/` is the exception among `guestGuard` routes: it is `RenderMode.Server` with `Cache-Control: private, no-store`; on the server `guestGuard` forwards the `subtracker_session` cookie to `GET /auth/session` and redirects a signed-in visitor before any HTML is sent (no cookie = no API call). `/auth/session` is excluded from the HTTP transfer cache in `app.config.ts`.
- **Recurring rules live in @context/foundation/lessons.md** — follow them when planning and implementing.
- **Backend auth, roles, CORS and mail patterns live in `context/foundation/backend-patterns.md`** — read it before planning or implementing any slice that touches sign-in, sessions, guards, roles, CORS or e-mail (S-01, S-09 first). Roles are a separate `role` + `user_role` table pair, not a column on `user`.
- **Production PostgreSQL is `C.UTF-8` (collate and ctype), local databases are `Polish_Poland.1250`.** Text sorted in SQL needs `COLLATE "pl-PL-x-icu"` (`POLISH_COLLATION`, `src/shared/database/`), and case-insensitive uniqueness uses an application-folded key column (`toNameKey`), not `lower()` in SQL. Local e2e tests will not catch a sorting mistake here; only the CI job `backend-e2e` (Postgres 16 on `C.UTF-8`) does.
- **The frontend turns an API 401 (outside `/auth/`) into a redirect to `/sign-in`** (`auth/session-expired.interceptor.ts`); a page never has to handle an expired session itself. Adding a subscription has no route of its own: it is one "adding" state on `/subscriptions` (panel on desktop, full content area on the phone).
- **Manual-test helpers live in `dev-local/`** (committed), never in system temp folders. No secrets or personal data in them: credentials come from `backend-subtracker/.env`, an account e-mail is an argument (or `DEV_USER_EMAIL` in `.env`), session tokens are never written to disk. E.g. `node --env-file=.env ../dev-local/test-session.mjs create|seed|cleanup [email]` (run from `backend-subtracker/`) makes a temporary session in `subtracker-db-dev` instead of signing in by e-mail, adds sample subscriptions through the API, and removes both. Every script refuses to run unless `MODE=DEV` (`dev-local/local-only.mjs`); usage and rules for new scripts: `dev-local/README.md`.
- **`.claude/skills/10x-*`, `.claude/skills/{pack-init,setup-cicd,tf-registry}` (m5l4) and `.agents/skills/` are generated** by the `10x` CLI and git-ignored; don't hand-edit them. The exception is `.claude/skills/roadmap-project/`, a project-owned, committed skill. `.claude/skills/10x-impl-review-ci/` is generated but committed (a `.gitignore` exception), because `impl-review.yml` takes it from `origin/main` with `git archive`: refresh it with `10x get m5l3`, never edit it. `skills-lock.json` and `.claude/.10x-cli-manifest.json` track their provenance. Behaviour changes belong upstream in `przeprogramowani/10x-cli`.

### Project

**SubTracker** — a web app for tracking personal subscriptions, with duplicate detection, budget alerts, and a subscription lifecycle state machine. The root `README.md` is a placeholder; the real specs live in `context/foundation/`:

- `prd.md` — requirements (structure defined by `.claude/skills/10x-shape/references/prd-schema.md`)
- `tech-stack.md` — stack decisions and the deployment plan; source of truth when this file and it disagree
- `context/changes/bootstrap-verification/verification.md` — how the apps were scaffolded and the audit at the time
- UI mockups — private claude.ai design canvas https://claude.ai/artifact/1GnVVi4MbScvb9CFMBT53J (owner-only; the chosen direction is row **F2**, other variants are rejected). The decisions taken from it are in `context/archive/2026-11-10-ui-foundation/change.md` (Notes); when the canvas and the repo disagree, the repo wins.

### Architecture

- `frontend-subtracker/` — Angular 22, standalone components, SSR via `@angular/ssr`. `src/server.ts` is an Express server (port `PORT`, default 4000) that serves `dist/.../browser` and renders everything else through `AngularNodeAppEngine`; `app.config.server.ts` merges server providers onto `app.config.ts` (which enables client hydration). Styles are SCSS. UI is Angular Material 22, installed with `npm install`, not `ng add` (which adds Google Fonts and the icon font to `index.html`). The whole theme lives in `src/styles/_theme.scss` (palette in the generated `_theme-colors.scss`, app colours as `--st-*` variables); shared partials `_forms.scss` and `_notices.scss`; layouts `layout/public-layout` and `layout/app-shell` switch to the phone layout with CSS media queries at 840px. The app-shell is exactly window-high (`100dvh`) at every width and the window never scrolls: a page's own list or table scrolls in its region (sticky column headers), and so do the expanded categories in the navy column/header — a new page with a long list gives its root `flex: 1 1 0; min-height: 0` and the list its own scroll region; a page without one (e.g. `/budget`) simply scrolls in the content area. IBM Plex Sans comes from `@fontsource` (self-hosted); icons are inline SVG — never request anything from Google.
- `backend-subtracker/` — NestJS 12, strict TypeScript, listens on `PORT` (default 3000), PostgreSQL via TypeORM (`src/database/`), env validated at startup (`src/config/env.ts`), `GET /health` checks the database, CORS from `CORS_ORIGINS` with credentials. Feature modules: `auth/`, `users/`, `mail/` and the first domain module `subscriptions/` (`GET/POST /categories`, `GET/POST /subscriptions`, `GET/PUT /budget` for the duplicate thresholds (S-07) and the monthly limits, overall and per category (S-08; per-user `budget_settings` and per-category `category_setting`; `GET /subscriptions/totals` adds each limit's `budgetAlert`, worked out on read); patterns for amounts, dates, categories and SQL sorting in `context/foundation/backend-patterns.md`, section „Dane domenowe”; lifecycle actions `POST /subscriptions/:id/cancel` and `/resume`). Scheduled jobs (`@nestjs/schedule`) run once at every start and on a daily cron in `Europe/Warsaw` (`APP_TIME_ZONE`, `src/shared/date/`). At 00:05, with the startup run awaited (a failure is only logged): the subscription lifecycle job (`trial → active`, `cancelled_pending → cancelled`, billing dates of `active` rolled forward, each the day after the date) and the auth cleanup (sign-in tokens and expired or revoked sessions older than 7 days). At 02:00, with the startup run in the background so SMTP cannot delay the deploy health-check: the trial reminder job (S-06), one mail per user listing the trials that end within 7 days, sent once per end date thanks to the `subscription.trial_reminder_sent_for` marker, released when the mail fails; a failed run mails the operator. The e2e helper's `start()` waits for that background run. Rules, the scheduler pattern and when a job needs a marker: `backend-patterns.md`, section „Cykl życia i zadania cykliczne”. `PUT /subscriptions/:id` stays a free manual correction of status and dates. `POST /auth/delete-account` (S-10, body `{ email }` = the account's own address) deletes the account in one transaction: the `user` row goes and everything else follows by `ON DELETE CASCADE`, while its `mail` rows stay as an archive with `recipient` replaced by `zanonimizowano@anonymized.invalid` (`ANONYMIZED_RECIPIENT`). Mail to a user goes out only while an active account with that address exists (`MailService.sendToUser` checks before sending and again before the audit row; the account-access mails also reach a blocked account). The `admin/` module (S-09) serves `/admin/users` for `ADMIN` and `SUPER_ADMIN`: search (`q` 3–254 chars, required unless `status=blocked`; `status=all|active|blocked`), the account's detail (read-only, every view logged in `admin_audit`), and `POST /admin/users/:id/block|unblock|reset-sessions` through `AccountAccessService` (one transaction under the user-row lock; nobody manages themselves, an admin manages only plain users, the single superadmin also admins). A blocked account (`user.is_active = false`) has its sessions and links ended, is skipped by the jobs and gets 403 `account_blocked` with the `SUPPORT_EMAIL` contact from the sign-in routes. Roles are granted and revoked only by CLI scripts (`admin:grant|revoke`, `superadmin:grant|revoke`); rules in `backend-patterns.md`.
- The two apps run as separate Node processes on separate subdomains of MyDevil (FreeBSD), so the API needs CORS and a session cookie scoped to the parent domain. GitHub Actions: `ci.yml` checks every branch except `main` and PRs into `main`; `impl-review.yml` reviews a PR labelled `impl-review` against its `plan.md` with `/10x-impl-review-ci` (Claude Code Action, secret `ANTHROPIC_API_KEY`; commits `reviews/impl-review.md` with `[skip ci]` and posts the verdict as the status `impl-review-ci/verdict`; label `impl-review-override` lets a REJECTED verdict through) — every plan-based PR of M-2 gets the label; `deploy-*.yml` deploy on push to `main` (i.e. after a merge) by piping the `.mydevil/` package over SSH to `deploy/mydevil/deploy.sh`, which runs `npm ci --omit=dev` on the server (never ship Linux-built `node_modules` to FreeBSD). Work on a `change/<change-id>` branch, never commit straight to `main`.
- **API deploy has a short downtime**: stop the API, `pg_dump`, `migration:run`, swap, health-check on `/health`; on failure the database is restored from the dump and the previous version starts. Database dumps older than 180 days are deleted by `prune-backups.sh` (after an API deploy, after a restore and daily from crontab), which first takes a fresh dump when none is younger than 30 days. Details and manual restore: `deploy/mydevil/README.md`. The server scripts are uploaded by hand (`scp`), not by CI.
- **Config files**: `backend-subtracker/.env` (local dev) and `.env.mydevil` (template for the server's `~/apps/subtracker/api/shared/.env`) are both git-ignored; `.env.example` documents the keys.

### Commands

Frontend (`cd frontend-subtracker`):

- `npm start` — dev server (`ng serve`)
- `npm run build` — production build to `dist/frontend-subtracker/` (browser + server bundles)
- `npm run serve:ssr:frontend-subtracker` — run the built SSR server
- `npm test` — unit and component tests (`ng test`, Vitest via `@angular/build:unit-test`, `src/**/*.spec.ts`); `npm run test:ci` — the whole suite once per time zone (Warsaw, New York), as the CI job `frontend` runs it. How to add a test: `context/foundation/test-plan.md` §6.1–6.2.
- `npm run build:e2e` — build in the `e2e` configuration (production optimisation, local API on :3000) to `dist/frontend-subtracker-e2e/`; `npm run e2e` — Playwright browser e2e (`e2e/**/*.e2e-spec.ts`, projects `http` and `chromium`) against that build on :4000 and the real API, as the CI job `browser-e2e` runs it. Tests run on the build: re-run `build:e2e` after changing app code. Needs the local PostgreSQL and `backend-subtracker/.env` with `MODE=DEV` and `http://localhost:4000` in `CORS_ORIGINS` (comma-separated, not a JSON array; the config stops with a message otherwise); the API is reused if running (`start:dev`), else started from the backend build (`npm run build` there first). How to add an e2e test: `context/foundation/test-plan.md` §6.5.
- No lint target exists yet.

Backend (`cd backend-subtracker`):

- `npm run start:dev` — dev server with watch; `npm run build` then `npm run start:prod` for the built app
- `npm run lint` — oxlint (type-aware); `npm run format` — prettier
- `npm test` — vitest unit tests (`src/**/*.spec.ts`); `npm run test:e2e` — e2e tests in `test/` (shared helper `test/support/e2e-app.ts`); `npm run test:cov` — coverage
- Single test file: `npx vitest run src/app.controller.spec.ts`; single e2e file: `npx vitest run --config ./vitest.config.e2e.ts test/<path>`
- `start:dev` and `test:e2e` need the local PostgreSQL (`database/create-local-databases.sql`) and `.env`. In CI the job `backend-e2e` runs `test:e2e` on Postgres 16 with `C.UTF-8` (like production) and a schema built by `migration:run`, so text sorting without `COLLATE` fails only there. How to add an API test: `context/foundation/test-plan.md` §6.4.

Database (`cd backend-subtracker`) — two local databases with the same owner:

- `subtracker-db-dev`: the app's database in `MODE=DEV`; `DATABASE_AUTO_SYNCHRONIZATION=true` lets TypeORM rebuild the schema from entities.
- `subtracker-db`: reference database, changed only by migrations; every `migration:*` script targets it (`POSTGRES_DATABASE`).
- `npm run migration:generate -- <Name>` — diff entities vs `subtracker-db` into `src/database/migrations/` (exit 1 with "No changes in database schema were found" when nothing changed); `npm run migration:create -- <Name>` — empty migration
- `npm run migration:run` / `migration:show` — apply / list on `subtracker-db`; `migration:revert` locally only, never in production

Formatting: @frontend-subtracker/.prettierrc, @backend-subtracker/.prettierrc.

### Skills installed here beyond the synced block

- `/10x-idea-check` (`.claude/skills/`) — pre-shaping check of whether an idea is worth shaping at all.
- `/10x-cli-setup` (`.agents/skills/`) — installs and troubleshoots the `10x` CLI itself; only relevant when downloads or auth misbehave.
- `/roadmap-project` (`.claude/skills/roadmap-project/`, ours, committed) — recomputes roadmap progress (items, must-have FRs, test-plan stages, streams) from `roadmap.md` and rebuilds the progress page with the dependency graph; the page URL lives in its `state.json`. Change the page in `scripts/build-roadmap-page.mjs`, never by hand.
- Skills from earlier lessons stay installed after the block moves on: `/10x-impl-review` + `/10x-lesson` (m2l3), `/10x-research` + `/10x-frame` (m2l4: research before `/10x-plan`, framing when a plan won't converge), `/10x-ui` (m2l5: audit and restyle a view that already renders).
- All lessons of modules 1–5 are downloaded (`10x sync --all --lang pl`, 2026-11-21). The course rules block below holds only the latest lesson (m5l5 since 2026-11-22); the m3l1 test-plan rules it replaced live on in `/10x-test-plan` and `context/foundation/test-plan.md`. The CLI hashes the block byte for byte against `managedRules.upstreamHash` in the manifest, so `CLAUDE.md`, `.claude/prompts/`, `.claude/config-templates/` and `.agents/skills/` are checked out with LF (`.gitattributes`; with CRLF every one shows up as a conflict on `10x sync`) and the block is never edited by hand or pasted from `get --print` — either one makes every later `10x get` skip it as `locally_modified`. Module 3: `/10x-tdd` + prompt `m3l2-ad-hoc-testing` (m3l2), `/10x-configure-hook` (m3l3; hooks already exist, `test-plan.md` §6.7 — audit, do not duplicate), `/10x-e2e-setup` + `/10x-e2e` (m3l4; Playwright is already set up in `frontend-subtracker/e2e/`, do not let setup overwrite it), `/10x-observability-audit` (m3l5). Module 4: `/10x-ray` (m4l1), `/10x-repo-map` (m4l2), `/10x-domain-distillation` (m4l5), prompts `m4l*`. Module 5: `/10x-opportunity-map` + `/10x-mom-test` (m5l1), `/10x-impl-review-ci` (m5l3), `pack-init`/`setup-cicd`/`tf-registry` (m5l4), `/10x-goal-implement` (m5l5), prompts `m5l*` and templates in `.claude/config-templates/`. Newer upstream versions of module 2 also added `/10x-new-plan` (m2l2) and `/10x-new-research` (m2l4).

### Known drift vs. the synced block

When the synced block and an installed `SKILL.md` disagree, the `SKILL.md` wins.

- `/10x-init` creates only `context/{changes,archive,foundation}/` with a `README.md` in each. `docs/reference/contract-surfaces.md` does not exist and nothing here creates it; `context/foundation/lessons.md` is created by `/10x-lesson`.
- `/10x-bootstrapper` scaffolds a single starter into the repo root; SubTracker's two sibling apps were an adaptation made during the run.

<!-- BEGIN @przeprogramowani/10x-cli -->

## Zestaw narzędzi AI 10xDevs — moduł 5, lekcja 5 (agenci asynchroniczni i zdalni)

Deleguj ograniczoną, zaplanowaną zmianę i wróć, aby ją przejrzeć. Kontrola nie znika; przenosi się do kontraktu zadania, konfiguracji sandboxa i końcowego przeglądu.

```
/10x-plan -> /goal + /10x-goal-implement (interactive or claude -p) -> review the commits and the manual checklist
```

### Router zadań — od czego zacząć

| Umiejętność | Użyj jej, gdy |
| --- | --- |
| `/10x-goal-implement <change-id>` | Zatwierdzony `context/changes/<id>/plan.md` powinien zostać wykonany bez nadzoru. Połącz go z `/goal <condition>`; zapisuje commit po każdej zielonej fazie i kończy się oczekującymi ręcznymi kontrolami. |
| `/10x-implement` | Chcesz samodzielnie kierować każdą fazą. |

### Twarde zasady

- **Deleguj wyłącznie zaplanowaną pracę.** Brak zatwierdzonego `plan.md` oznacza brak działania bez nadzoru.
- **Ogranicz każde uruchomienie.** Warunek `/goal` określa stan końcowy i limit tur.
- **Zielone uruchomienie nie oznacza ukończonej zmiany.** Przejrzyj commity i wykonaj ręczną checklistę przed mergowaniem.
- **Przyznaj sandboxowi tylko te sekrety i dostęp do sieci, których zadanie potrzebuje.**
- **Monitoruj równoległe i zdalne uruchomienia w jednym miejscu.** Uruchamiaj każdą sesję bez nadzoru w osobnym obszarze roboczym herdr, aby widzieć, którzy agenci pracują, są zablokowani lub skończyli, oraz interweniować z przeglądarki (konfiguracja w M2L6 Deep Dive).

<!-- END @przeprogramowani/10x-cli -->
