# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository notes (not synced by 10x-cli — safe to edit)

Everything between the `BEGIN`/`END @przeprogramowani/10x-cli` markers below is overwritten by `10x get` / `10x sync`; put project-specific guidance here instead.

### Tripwires

- **No root `package.json`.** Two independent apps, no monorepo tooling — run every `npm` command from inside `frontend-subtracker/` or `backend-subtracker/`.
- **Node 24 is required** (Angular CLI 22 refuses Node < 22.22.3 / 24.15.0). The machine uses `fnm`, not `nvm`.
- **The backend is native ESM** (`"type": "module"`, `module: nodenext`). Relative imports must carry the `.js` extension (`import { AppModule } from './app.module.js'`), and `src/main.ts` uses top-level `await`.
- **Every frontend route is prerendered at build time** — `src/app/app.routes.server.ts` maps `'**'` to `RenderMode.Prerender`. Routes that depend on the logged-in user or live data need an explicit `RenderMode.Server` (or `Client`) entry, or they will ship stale HTML. Today `register`, `sign-in`, `auth/verify` and `subscriptions` are `Client`; `/` is the exception among `guestGuard` routes: it is `RenderMode.Server` with `Cache-Control: private, no-store`; on the server `guestGuard` forwards the `subtracker_session` cookie to `GET /auth/session` and redirects a signed-in visitor before any HTML is sent (no cookie = no API call). `/auth/session` is excluded from the HTTP transfer cache in `app.config.ts`.
- **Recurring rules live in @context/foundation/lessons.md** — follow them when planning and implementing.
- **Backend auth, roles, CORS and mail patterns live in `context/foundation/backend-patterns.md`** — read it before planning or implementing any slice that touches sign-in, sessions, guards, roles, CORS or e-mail (S-01, S-09 first). Roles are a separate `role` + `user_role` table pair, not a column on `user`.
- **`.claude/skills/` and `.agents/skills/` are generated** by the `10x` CLI and git-ignored; don't hand-edit them. `skills-lock.json` and `.claude/.10x-cli-manifest.json` track their provenance. Behaviour changes belong upstream in `przeprogramowani/10x-cli`.

### Project

**SubTracker** — a web app for tracking personal subscriptions, with duplicate detection, budget alerts, and a subscription lifecycle state machine. The root `README.md` is a placeholder; the real specs live in `context/foundation/`:

- `prd.md` — requirements (structure defined by `.claude/skills/10x-shape/references/prd-schema.md`)
- `tech-stack.md` — stack decisions and the deployment plan; source of truth when this file and it disagree
- `context/changes/bootstrap-verification/verification.md` — how the apps were scaffolded and the audit at the time

### Architecture

- `frontend-subtracker/` — Angular 22, standalone components, SSR via `@angular/ssr`. `src/server.ts` is an Express server (port `PORT`, default 4000) that serves `dist/.../browser` and renders everything else through `AngularNodeAppEngine`; `app.config.server.ts` merges server providers onto `app.config.ts` (which enables client hydration). Styles are SCSS. UI is Angular Material 22, installed with `npm install`, not `ng add` (which adds Google Fonts and the icon font to `index.html`). The whole theme lives in `src/styles/_theme.scss` (palette in the generated `_theme-colors.scss`, app colours as `--st-*` variables); shared partials `_forms.scss` and `_notices.scss`; layouts `layout/public-layout` and `layout/app-shell` switch to the phone layout with CSS media queries at 840px. IBM Plex Sans comes from `@fontsource` (self-hosted); icons are inline SVG — never request anything from Google.
- `backend-subtracker/` — NestJS 12, strict TypeScript, listens on `PORT` (default 3000), PostgreSQL via TypeORM (`src/database/`), env validated at startup (`src/config/env.ts`), `GET /health` checks the database, CORS from `CORS_ORIGINS` with credentials. Still planned per `tech-stack.md`: the subscription state machine and scheduled jobs (`@nestjs/schedule`) for trial reminders.
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
- Skills from earlier lessons stay installed after the block moves on: `/10x-impl-review` + `/10x-lesson` (m2l3), `/10x-research` + `/10x-frame` (m2l4: research before `/10x-plan`, framing when a plan won't converge), `/10x-ui` (m2l5: audit and restyle a view that already renders).

### Known drift vs. the synced block

When the synced block and an installed `SKILL.md` disagree, the `SKILL.md` wins.

- `/10x-init` creates only `context/{changes,archive,foundation}/` with a `README.md` in each. `docs/reference/contract-surfaces.md` does not exist and nothing here creates it; `context/foundation/lessons.md` is created by `/10x-lesson`.
- `/10x-bootstrapper` scaffolds a single starter into the repo root; SubTracker's two sibling apps were an adaptation made during the run.

<!-- BEGIN @przeprogramowani/10x-cli -->

## Zestaw narzędzi AI 10xDevs — Moduł 2, Lekcja 5

Rozszerz cykl pojedynczej zmiany na pracę równoległą za pomocą **worktrees, delegowania ukierunkowanego na cel i orkiestracji wielu sesji**:

```
worktree per change -> /goal or claude -p -> PR -> review -> merge
```

Lekcja koncentruje się na bezpiecznej przepustowości: izolowanych kontekstach, wyborze właściwego trybu wykonania oraz ograniczaniu równoległości do możliwości przeglądu.

### Router zadań — od czego zacząć

| Umiejętność | Użyj, gdy |
| --- | --- |
| **Izolacja kodu** | |
| `git worktree add` | Potrzebujesz osobnego katalogu roboczego dla równoległej zmiany. Jedna zmiana na worktree, jeden świeży kontekst agenta na worktree. |
| **Złożone zmiany** | |
| `/10x-implement <change-id> phase <n>` | Zmiana ma wiele faz, wymaga ręcznych bramek lub korzysta z interaktywnego podejmowania decyzji podczas wykonania. |
| **Proste zmiany** | |
| `/goal` | Masz jasne, ograniczone zadanie i chcesz delegowania ukierunkowanego na cel. Agent pracuje autonomicznie w kierunku określonego celu z warunkiem zatrzymania. |
| `claude -p` | Chcesz bezobsługowego wykonania dobrze zdefiniowanego zadania. Pętla Ralph Wiggum (uruchom, sprawdź, ponów próbę) jest uniwersalnym autonomicznym wzorcem. |
| **Orkiestracja wielu sesji** | |
| Superset / Conductor / Antigravity / VS Code Agent View | Uruchamiasz równolegle wiele sesji agentów i potrzebujesz wglądu, koordynacji lub zarządzania sesjami między nimi. |

### Zasady pracy równoległej

- Jedna zmiana na worktree lub izolowaną przestrzeń roboczą. Jeden świeży kontekst agenta na zmianę.
- Wybieraj interaktywne `/10x-implement` dla złożonych zmian, a `/goal` lub `claude -p` dla prostych.
- Równoległość jest ograniczona przez możliwości przeglądu. Więcej agentów bez przeglądu oznacza więcej nieprzejrzanego kodu, a nie większą przepustowość.
- Problem z jakością wynikający z szybszego dostarczania jest celowy — stanowi przejście do bramek testowych w Module 3.

### Granice lekcji

- Nie omawiaj ponownie interaktywnych `/10x-implement` ani `/10x-impl-review`; to Lekcje 2 i 3.
- Nie wprowadzaj tutaj strategii testowania. Problem z jakością jest motywacją dla Modułu 3.
- Worktrees są mechanizmem izolacji, a nie tematem pełnego samouczka git.

### Ścieżki używane przez tę lekcję

- `context/changes/<change-id>/` - folder aktywnej zmiany
- `context/changes/<change-id>/plan.md` - dane wejściowe implementacji dla dowolnego trybu wykonania

Umiejętności nie mogą zapisywać do `context/archive/`. Zarchiwizowane zmiany są niezmienne; jeśli rozstrzygnięta ścieżka docelowa zaczyna się od `context/archive/`, przerwij z komunikatem: „This change is archived. Open a new change with `/10x-new` instead.”

<!-- END @przeprogramowani/10x-cli -->
