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

## Zestaw narzędzi AI 10xDevs — Moduł 2, Lekcja 3

Przejrzyj kod wygenerowany przez AI przed scaleniem, korzystając z **łańcucha przeglądu implementacji**:

```
/10x-implement -> /10x-impl-review -> triage -> (/10x-lesson | fix | skip | disagree)
```

`/10x-impl-review` jest głównym tematem lekcji. Przegląd jest bramką jakości, a nie poleceniem naprawienia każdego znaleziska.

### Router zadań — od czego zacząć

| Umiejętność | Użyj jej, gdy |
| --- | --- |
| **Przegląd kodu (główny temat lekcji)** | |
| `/10x-impl-review <change-id>` | Zaimplementowano kod i chcesz przeprowadzić ustrukturyzowany przegląd przed scaleniem. Umiejętność sprawdza zgodność z planem, dyscyplinę zakresu, bezpieczeństwo i jakość, architekturę, spójność wzorców oraz kryteria sukcesu, a następnie przedstawia ustalenia do selekcji. |
| **Wynik powtarzającej się lekcji** | |
| `/10x-lesson` | Ustalenie ujawnia powtarzającą się regułę projektu lub wzorzec błędów agenta. Zapisz je w `context/foundation/lessons.md` zamiast traktować je jako jednorazową notatkę. |

### Dyscyplina selekcji

- Dotkliwość określa, jak poważne jest ustalenie. Wpływ określa, jak duże znaczenie ma teraz decyzja.
- Prawidłowe wyniki: napraw teraz, napraw inaczej, pomiń, zaakceptuj jako ryzyko, zapisz jako powtarzającą się regułę (`/10x-lesson`), nie zgódź się.
- Naprawiaj krytyczne ustalenia. Nie poświęcaj godzin na obserwacje o niskim wpływie tylko dlatego, że agent je znalazł.
- Świadome pomijanie ustaleń o niskim wpływie jest prawidłowym wynikiem przeglądu, a nie zaniedbaniem.
- Jeśli nie zgadzasz się z ustaleniem, zapisz dlaczego. Błędne rozumowanie agenta również jest sygnałem.

### Granice przeglądu

- Ta lekcja dotyczy przeglądu zaimplementowanego kodu. Nie tworzy planu, nie wykonuje nowych faz ani nie uczy przeglądu CI.
- Strategia testowania i bramki jakości zostaną wprowadzone w Module 3.
- Nie używaj `/10x-contract` jako wyniku selekcji w tej lekcji.

### Ścieżki używane przez tę lekcję

- `context/changes/<change-id>/plan.md` — oczekiwany kontrakt implementacji
- `context/changes/<change-id>/reviews/` — wynik przeglądu
- `context/foundation/lessons.md` — powtarzające się lekcje

Umiejętności nie mogą zapisywać do `context/archive/`. Zarchiwizowane zmiany są niezmienne; jeśli rozwiązana ścieżka docelowa zaczyna się od `context/archive/`, przerwij z komunikatem: "Ta zmiana jest zarchiwizowana. Zamiast tego otwórz nową zmianę za pomocą `/10x-new`."

<!-- END @przeprogramowani/10x-cli -->
