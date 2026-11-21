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
- **`.claude/skills/10x-*`, `.claude/skills/{pack-init,setup-cicd,tf-registry}` (m5l4) and `.agents/skills/` are generated** by the `10x` CLI and git-ignored; don't hand-edit them. The exception is `.claude/skills/roadmap-project/`, a project-owned, committed skill. `skills-lock.json` and `.claude/.10x-cli-manifest.json` track their provenance. Behaviour changes belong upstream in `przeprogramowani/10x-cli`.

### Project

**SubTracker** — a web app for tracking personal subscriptions, with duplicate detection, budget alerts, and a subscription lifecycle state machine. The root `README.md` is a placeholder; the real specs live in `context/foundation/`:

- `prd.md` — requirements (structure defined by `.claude/skills/10x-shape/references/prd-schema.md`)
- `tech-stack.md` — stack decisions and the deployment plan; source of truth when this file and it disagree
- `context/changes/bootstrap-verification/verification.md` — how the apps were scaffolded and the audit at the time
- UI mockups — private claude.ai design canvas https://claude.ai/artifact/1GnVVi4MbScvb9CFMBT53J (owner-only; the chosen direction is row **F2**, other variants are rejected). The decisions taken from it are in `context/archive/2026-11-10-ui-foundation/change.md` (Notes); when the canvas and the repo disagree, the repo wins.

### Architecture

- `frontend-subtracker/` — Angular 22, standalone components, SSR via `@angular/ssr`. `src/server.ts` is an Express server (port `PORT`, default 4000) that serves `dist/.../browser` and renders everything else through `AngularNodeAppEngine`; `app.config.server.ts` merges server providers onto `app.config.ts` (which enables client hydration). Styles are SCSS. UI is Angular Material 22, installed with `npm install`, not `ng add` (which adds Google Fonts and the icon font to `index.html`). The whole theme lives in `src/styles/_theme.scss` (palette in the generated `_theme-colors.scss`, app colours as `--st-*` variables); shared partials `_forms.scss` and `_notices.scss`; layouts `layout/public-layout` and `layout/app-shell` switch to the phone layout with CSS media queries at 840px. The app-shell is exactly window-high (`100dvh`) at every width and the window never scrolls: a page's own list or table scrolls in its region (sticky column headers), and so do the expanded categories in the navy column/header — a new page with a long list gives its root `flex: 1 1 0; min-height: 0` and the list its own scroll region; a page without one (e.g. `/budget`) simply scrolls in the content area. IBM Plex Sans comes from `@fontsource` (self-hosted); icons are inline SVG — never request anything from Google.
- `backend-subtracker/` — NestJS 12, strict TypeScript, listens on `PORT` (default 3000), PostgreSQL via TypeORM (`src/database/`), env validated at startup (`src/config/env.ts`), `GET /health` checks the database, CORS from `CORS_ORIGINS` with credentials. Feature modules: `auth/`, `users/`, `mail/` and the first domain module `subscriptions/` (`GET/POST /categories`, `GET/POST /subscriptions`, `GET/PUT /budget` for the duplicate thresholds (S-07) and the monthly limits, overall and per category (S-08; per-user `budget_settings` and per-category `category_setting`; `GET /subscriptions/totals` adds each limit's `budgetAlert`, worked out on read); patterns for amounts, dates, categories and SQL sorting in `context/foundation/backend-patterns.md`, section „Dane domenowe”; lifecycle actions `POST /subscriptions/:id/cancel` and `/resume`). Scheduled jobs (`@nestjs/schedule`) run once at every start and on a daily cron in `Europe/Warsaw` (`APP_TIME_ZONE`, `src/shared/date/`). At 00:05, with the startup run awaited (a failure is only logged): the subscription lifecycle job (`trial → active`, `cancelled_pending → cancelled`, billing dates of `active` rolled forward, each the day after the date) and the auth cleanup (sign-in tokens and expired or revoked sessions older than 7 days). At 02:00, with the startup run in the background so SMTP cannot delay the deploy health-check: the trial reminder job (S-06), one mail per user listing the trials that end within 7 days, sent once per end date thanks to the `subscription.trial_reminder_sent_for` marker, released when the mail fails; a failed run mails the operator. The e2e helper's `start()` waits for that background run. Rules, the scheduler pattern and when a job needs a marker: `backend-patterns.md`, section „Cykl życia i zadania cykliczne”. `PUT /subscriptions/:id` stays a free manual correction of status and dates. `POST /auth/delete-account` (S-10, body `{ email }` = the account's own address) deletes the account in one transaction: the `user` row goes and everything else follows by `ON DELETE CASCADE`, while its `mail` rows stay as an archive with `recipient` replaced by `zanonimizowano@anonymized.invalid` (`ANONYMIZED_RECIPIENT`). Mail to a user goes out only while an active account with that address exists (`MailService.sendToUser` checks before sending and again before the audit row; the account-access mails also reach a blocked account). The `admin/` module (S-09) serves `/admin/users` for `ADMIN` and `SUPER_ADMIN`: search (`q` 3–254 chars, required unless `status=blocked`; `status=all|active|blocked`), the account's detail (read-only, every view logged in `admin_audit`), and `POST /admin/users/:id/block|unblock|reset-sessions` through `AccountAccessService` (one transaction under the user-row lock; nobody manages themselves, an admin manages only plain users, the single superadmin also admins). A blocked account (`user.is_active = false`) has its sessions and links ended, is skipped by the jobs and gets 403 `account_blocked` with the `SUPPORT_EMAIL` contact from the sign-in routes. Roles are granted and revoked only by CLI scripts (`admin:grant|revoke`, `superadmin:grant|revoke`); rules in `backend-patterns.md`.
- The two apps run as separate Node processes on separate subdomains of MyDevil (FreeBSD), so the API needs CORS and a session cookie scoped to the parent domain. GitHub Actions: `ci.yml` checks every branch except `main` and PRs into `main`; `deploy-*.yml` deploy on push to `main` (i.e. after a merge) by piping the `.mydevil/` package over SSH to `deploy/mydevil/deploy.sh`, which runs `npm ci --omit=dev` on the server (never ship Linux-built `node_modules` to FreeBSD). Work on a `change/<change-id>` branch, never commit straight to `main`.
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
- All lessons of modules 1–5 are downloaded (`10x sync --all --lang pl`, 2026-11-21). The course rules block above stays at m3l1: later blocks were skipped as a conflict with the local edits, so use the skills directly. Module 3: `/10x-tdd` + prompt `m3l2-ad-hoc-testing` (m3l2), `/10x-configure-hook` (m3l3; hooks already exist, `test-plan.md` §6.7 — audit, do not duplicate), `/10x-e2e-setup` + `/10x-e2e` (m3l4; Playwright is already set up in `frontend-subtracker/e2e/`, do not let setup overwrite it), `/10x-observability-audit` (m3l5). Module 4: `/10x-ray` (m4l1), `/10x-repo-map` (m4l2), `/10x-domain-distillation` (m4l5), prompts `m4l*`. Module 5: `/10x-opportunity-map` + `/10x-mom-test` (m5l1), `/10x-impl-review-ci` (m5l3), `pack-init`/`setup-cicd`/`tf-registry` (m5l4), `/10x-goal-implement` (m5l5), prompts `m5l*` and templates in `.claude/config-templates/`. Newer upstream versions of module 2 also added `/10x-new-plan` (m2l2) and `/10x-new-research` (m2l4).

### Known drift vs. the synced block

When the synced block and an installed `SKILL.md` disagree, the `SKILL.md` wins.

- `/10x-init` creates only `context/{changes,archive,foundation}/` with a `README.md` in each. `docs/reference/contract-surfaces.md` does not exist and nothing here creates it; `context/foundation/lessons.md` is created by `/10x-lesson`.
- `/10x-bootstrapper` scaffolds a single starter into the repo root; SubTracker's two sibling apps were an adaptation made during the run.

<!-- BEGIN @przeprogramowani/10x-cli -->

## Zestaw narzędzi AI 10xDevs — Moduł 3, Lekcja 1

Rozpocznij Moduł 3 od stworzenia **trwałego, ukierunkowanego na ryzyko kontraktu jakości** przed napisaniem jakiegokolwiek testu — następnie prowadź każdą fazę wdrożenia przez standardowy łańcuch zmian.

```
PRD + roadmap + archive
        │
        ▼
   /10x-test-plan  ──►  context/foundation/test-plan.md  (strategia §1–§5 zamrożona + cookbook §6 się rozwija)
        │
        ▼  (jedna faza wdrożenia naraz, /clear między przekazaniami)
   /10x-new ──► /10x-research ──► /10x-plan ──► /10x-implement
```

`/10x-test-plan` to **stanowy orkiestrator**, a nie generator jednorazowy. Przy pierwszym uruchomieniu zapisuje etapowe wdrożenie do `context/foundation/test-plan.md`. Przy każdym kolejnym uruchomieniu ponownie wyprowadza stan z artefaktów na dysku i prezentuje następne przekazanie. Lekcja skupia się na **strategii i sekwencjonowaniu wdrożenia, a nie konfiguracji**. Hooki, serwery MCP i CI YAML są konfigurowane w późniejszych lekcjach tego modułu.

### Router zadań — od czego zacząć

| Umiejętność | Użyj, gdy |
| --- | --- |
| **Strategia jakości jako plik reguł (temat lekcji)** | |
| `/10x-test-plan` | Masz PRD (a najlepiej także roadmapę i kilka zarchiwizowanych fragmentów) i zaraz napiszesz pierwsze testy projektu albo zauważyłeś, że testy generowane przez AI trafiają w helpery, podczas gdy krytyczne przepływy pozostają niepokryte. Pierwsze wywołanie uruchamia discovery (PRD + roadmap + archive + skan hot spotów), 5-pytaniowy wywiad z użytkownikiem oraz etap syntezy z obowiązkową kontrolą challengera, a następnie zapisuje `test-plan.md` w `context/foundation/` z mapą ryzyk (5–7 scenariuszy awarii), tabelą etapowego wdrożenia, tabelą stosu, tabelą bramek jakości, sekcją cookbook (`§6`, uzupełnianą w miarę dostarczania faz) oraz sekcją negatywnej przestrzeni (czego celowo nie testujemy). Kolejne wywołania przesuwają wdrożenie o jedno przekazanie naraz. |
| `/10x-test-plan --status` | `test-plan.md` już istnieje i chcesz uzyskać zwięzły obraz stanu wdrożenia — które fazy mają status `not started`, `change opened`, `researched`, `planned`, `implementing` lub `complete`, oraz jaka jest następna akcja. Nie wykonuje pracy; można bezpiecznie uruchomić w dowolnym momencie. |
| `/10x-test-plan --refresh` | `test-plan.md` już istnieje i wystąpiło jedno z następujących: nowe ryzyko z top 3 pojawiło się w roadmapie lub archive, data `checked:` narzędzia jest starsza niż trzy miesiące, stos technologiczny projektu się zmienił albo negatywna przestrzeń §7 nie odpowiada już temu, co uważa zespół. Otwiera nowy folder zmiany `test-plan-refresh-<YYYY-MM-DD>` zamiast edytować przewodnik w miejscu. |

### Łańcuch wdrożenia — co dzieje się po zapisaniu przewodnika

Tabela §3 *Phased Rollout* przewodnika jest stanem orkiestratora. Dla każdego wiersza, który nie ma statusu `complete`, orkiestrator wybiera następne przekazanie na podstawie istniejących artefaktów w `context/changes/<change-id>/`:

| Stan na dysku | Następne przekazanie | Status przechodzi na |
| --- | --- | --- |
| brak folderu zmiany | `/10x-new <change-id>` | `change opened` |
| tylko `change.md` | `/10x-research` (z opisem ryzyk do zweryfikowania) | `researched` |
| `+ research.md` | `/10x-plan` (z ograniczeniami cost × signal + aktualizacji cookbooka) | `planned` |
| `+ plan.md` z oczekującymi elementami `## Progress` | `/10x-implement <change-id> phase <N>` | `implementing` / `complete` |
| `+ plan.md` w pełni `[x]` | Oznacz wiersz §3 jako `complete`; przejdź w pętli do następnego oczekującego wiersza | — |

Każde przekazanie jest punktem **STOP**. Orkiestrator kopiuje następne polecenie do schowka, prosi użytkownika o wykonanie `/clear` i uruchomienie go, a następnie kończy działanie. Ponownie wywołaj `/10x-test-plan` (bez argumentów), aby przejść dalej.

### Reguły priorytetyzacji zorientowanej na ryzyko

- Ryzyka to **scenariusze awarii w kategoriach użytkownika / biznesu**, a nie nazwy testów. „Wylogowany użytkownik uzyskuje dostęp do płatnej treści przez nieaktualny token” to ryzyko; „przetestuj formularz logowania” nim nie jest.
- Od 5 do 7 ryzyk. Mniej jest zbyt ogólne; więcej czyni priorytetyzację bezużyteczną.
- Wpływ i prawdopodobieństwo są ocenami użytkownika/biznesu, a nie złożoności technicznej.
- Każde ryzyko ma źródło: sekcję PRD, zarchiwizowany fragment, wpis roadmapy, pytanie z wywiadu Fazie 2, katalog hot spotu z liczbą zmian lub ograniczenie stosu technologicznego. Żadnych wymyślonych ryzyk.
- **Sygnał, nie wiedza.** §2 cytuje *dowody, które podniosły ryzyko*, nigdy plik jako „miejsce, gdzie występuje awaria”. Kotwice file:line, nazwy funkcji, nazwy schematów i nazwy modułów są zabronione w §2 — należą do wyniku `/10x-research`, tworzonego dla każdej fazy wdrożenia względem aktualnego kodu. Plan jest specyfikacją QA; nie jest audytem kodu.
- Pokrycie nie jest metryką. Metryką jest **pokrycie ryzyka**.

### Reguły mapowania dwuwarstwowego

- Najpierw warstwa klasyczna: wygrywa najtańszy test dający rzeczywisty sygnał. Awansuj do e2e tylko wtedy, gdy żadna tańsza warstwa nie pokrywa ryzyka.
- Następnie warstwa AI-native i tylko tam, gdzie dodaje sygnał, którego klasyczne testy nie dostarczają tanio.
- Każdy wiersz AI-native ma linię **„When NOT to use”**. Jeśli nie potrafisz jej napisać, usuń wiersz.
- Każda nazwa narzędzia zawiera datę `checked: <YYYY-MM-DD>`. Nazwy narzędzi są przykładami kategorii, a nie rekomendacjami.
- Obie warstwy muszą być niepuste w końcowym przewodniku, jeśli projekt ich wymaga. Tylko klasyczna warstwa to plan z 2020 roku; tylko AI-native to hype. Fazy AI-native nie są obowiązkowe — uwzględniaj je tylko wtedy, gdy brief uzasadnił je w ramach cost × signal.

### Reguły bramek jakości

- Wymagane bramki (lint, typecheck, unit+integration, e2e dla krytycznych przepływów) muszą mapować się na rzeczywiste kroki CI. Jeśli wymagana bramka nie jest jeszcze podłączona, oznacz ją jako `required after §3 Phase <N>` i pozwól wskazanej fazie wdrożenia ją podłączyć.
- Hook po edycji jest **zalecany lokalnie**, a nie substytutem CI.
- Multimodalny przegląd wizualny jest **selektywny**, stosowany do 1–3 krytycznych ekranów, a nie do każdej strony.
- Zapasowe rozwiązanie oparte na wizji (Anthropic Computer Use lub OpenAI CUA) jest zarezerwowane dla powierzchni niedostępnych przez DOM; kosztowne na akcję.

### Wzorce cookbooka (§6) — uzupełniane z czasem

`test-plan.md` jest zarówno etapową strategią, jak i **rosnącym cookbookiem**. §6 zaczyna się od placeholderów (`TBD — see §3 Phase <N>`) i jest uzupełniany stopniowo — plan każdej fazy wdrożenia kończy się podfazą aktualizującą odpowiedni wpis §6 (lokalizacja, nazewnictwo, test referencyjny, polecenie uruchomienia). Po ukończeniu Modułu 3 §6 staje się kanoniczną odpowiedzią na pytanie „jak dodać test dla X w tym projekcie?” — i jest tym, co `/10x-tdd` odczytuje w Lekcji 2.

### Granice lekcji

- Nie pisz kodu testów. To temat Lekcji 2 (`/10x-tdd` i tworzenie testów jednostkowych).
- Nie konfiguruj hooków, cyklu życia hooków ani hooków debugowania. To temat Lekcji 3.
- Nie konfiguruj serwerów MCP, Playwright API, kodu e2e ani kodu scenariuszy multimodalnych. To temat Lekcji 4.
- Nie uruchamiaj przepływu bug-to-fix-to-regression-test. To temat Lekcji 5.
- Nie twórz od podstaw potoków CI/CD ani nie pisz GitHub Actions YAML. Przewodnik wskazuje bramki; konfiguracja należy do Modułu 1 Lekcji 5 i Modułu 2 Lekcji 5.
- Nie porównuj modeli multimodalnych. Cytuj kryteria (cost, latency, agent-friendliness), nigdy ranking.
- Nie czytaj codebase w celu zdobywania wiedzy (grafy wywołań, schematy, „który plik odpowiada za tę awarię”). To zadanie `/10x-research`, wykonywane dla każdej fazy wdrożenia.

### Ścieżki używane przez tę lekcję

- `context/foundation/test-plan.md` — kontrakt jakości tworzony i utrzymywany przez `/10x-test-plan`
- `context/foundation/prd.md` — główne źródło ryzyk
- `context/foundation/roadmap.md` — ważenie prawdopodobieństwa
- `context/foundation/tech-stack.md` — dane wejściowe stosu (gdy obecne)
- `context/archive/<change-id>/plan.md` — zaimplementowana powierzchnia ryzyka
- `context/changes/<change-id>/` — folder zmiany dla każdej fazy wdrożenia (po jednym na wiersz w §3)
<!-- END @przeprogramowani/10x-cli -->
