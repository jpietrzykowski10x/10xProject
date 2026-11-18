# SubTracker

[Polski](#polski) · [English](#english)

---

## Polski

Aplikacja do śledzenia osobistych subskrypcji: lista i koszty, cykl życia (trial → aktywna → anulowana) i przypomnienia mailem przed końcem okresu próbnego. Projekt kursu 10xDevs 4.0.

Dwie niezależne aplikacje, bez wspólnego `package.json` w katalogu głównym: każde polecenie `npm` uruchamiasz w katalogu aplikacji.

| Katalog | Co to jest | Port lokalnie |
|---|---|---|
| `frontend-subtracker/` | Angular 22 z SSR (`@angular/ssr`), Angular Material | 4200 (`ng serve`), 4000 (zbudowany SSR) |
| `backend-subtracker/` | NestJS 12, TypeORM, PostgreSQL | 3000 |
| `deploy/mydevil/` | skrypty serwera MyDevil (deploy, restart, rollback) | — |
| `dev-local/` | pomocnicze skrypty do ręcznych testów lokalnie | — |
| `context/` | PRD, roadmapa, plany zmian, wzorce i plan testów | — |

### Wymagania

- **Node 24** (Angular CLI 22 nie ruszy na Node < 22.22.3 / 24.15.0). Na tej maszynie wersje przełącza `fnm`.
- **PostgreSQL 16** lokalnie (13+ wystarczy do uruchomienia, 16 jest w CI i na produkcji).
- Git Bash albo PowerShell na Windows.

### Pierwsze uruchomienie lokalnie

1. **Bazy danych** (raz, jako superużytkownik PostgreSQL):

   ```sh
   cd backend-subtracker
   psql -U postgres -f database/create-local-databases.sql
   ```

   Powstają dwie bazy z tym samym właścicielem:
   - `subtracker-db-dev` — baza robocza aplikacji (`MODE=DEV`), schemat odtwarzany z encji (`DATABASE_AUTO_SYNCHRONIZATION=true`);
   - `subtracker-db` — baza referencyjna, zmieniana tylko migracjami.

2. **Konfiguracja backendu**: skopiuj `backend-subtracker/.env.example` do `backend-subtracker/.env` i uzupełnij hasło bazy. Pusty `SMTP_HOST` w `MODE=DEV` wypisuje maile (link logowania, przypomnienia) na konsolę, więc lokalnie SMTP nie jest potrzebny. `.env` i `.env.mydevil` nie trafiają do gita.

3. **Zależności i migracje**:

   ```sh
   cd backend-subtracker
   npm install
   npm run migration:run      # schemat bazy referencyjnej subtracker-db

   cd ../frontend-subtracker
   npm install
   ```

4. **Start** (dwa terminale):

   ```sh
   cd backend-subtracker && npm run start:dev     # API na http://localhost:3000
   cd frontend-subtracker && npm start            # aplikacja na http://localhost:4200
   ```

   Logowanie jest przez link w mailu: przy pustym `SMTP_HOST` link pojawi się w konsoli API. Bez maila można też założyć sesję skryptem z `dev-local/` (opis w `dev-local/README.md`):

   ```sh
   cd backend-subtracker
   node --env-file=.env ../dev-local/test-session.mjs create <email>   # wypisuje ciasteczko sesji
   node --env-file=.env ../dev-local/test-session.mjs seed <email>     # przykładowe subskrypcje
   ```

#### Restart lokalnie

`npm run start:dev` sam przeładowuje API po zmianie kodu, a `npm start` frontend. Pełny restart to `Ctrl+C` i ponowny start. Przy każdym starcie API uruchamia joby: cykl życia subskrypcji (czekając na wynik) i przypomnienia o trialu (w tle). Drugi start tego samego dnia nic już nie zmienia ani nie wysyła drugi raz.

Uwaga: każde `npm run test:e2e` oznacza triale z Twojego lokalnego konta kończące się w ciągu 7 dni jako przypomniane (szczegóły w `dev-local/README.md`).

### Testy i kontrola jakości

Backend (`cd backend-subtracker`):

| Polecenie | Co robi |
|---|---|
| `npm test` | testy jednostkowe (Vitest) |
| `npm run test:e2e` | testy API na prawdziwej bazie `subtracker-db-dev` (potrzebny PostgreSQL i `.env`) |
| `npm run lint` | oxlint z kontrolą typów |
| `npm run build` | build TypeScript |

Frontend (`cd frontend-subtracker`):

| Polecenie | Co robi |
|---|---|
| `npm test` | testy jednostkowe i komponentów |
| `npm run test:ci` | jak w CI: cały zestaw w strefach Warszawa i Nowy Jork |
| `npm run build:e2e` + `npm run e2e` | Playwright na buildzie (:4000) i prawdziwym API |

Jak dodać test danego rodzaju: `context/foundation/test-plan.md`, §6.

### Zmiana schematu bazy

Encje zmieniasz w kodzie, a na koniec funkcji generujesz migrację względem bazy referencyjnej:

```sh
cd backend-subtracker
npm run migration:generate -- NazwaZmiany   # plik w src/database/migrations/
npm run migration:run                       # zastosuj na subtracker-db
```

Migrację commitujesz razem z kodem. Na produkcji migracje uruchamia tylko deploy. `migration:revert` wolno używać wyłącznie lokalnie.

### Praca z gitem i deploy

- Każda zmiana na gałęzi `change/<change-id>`, nigdy commit wprost do `main`.
- `ci.yml` sprawdza każdą gałąź poza `main` i każdy PR do `main`.
- Merge do `main` uruchamia deploy (`deploy-backend.yml`, `deploy-frontend.yml`): GitHub Actions buduje paczkę i wysyła ją przez SSH do `deploy.sh` na MyDevil.
- Deploy API ma krótką przerwę: zatrzymanie API, kopia bazy (`pg_dump`), migracje, podmiana wersji i health-check na `/health`. Gdy health-check się nie powiedzie, baza wraca z kopii i startuje poprzednia wersja.

Stan deployu sprawdzisz w zakładce Actions albo poleceniem `gh run list --branch main`.

### Serwer (MyDevil)

Obie aplikacje działają pod `forever` na Node 24 w `~/apps/subtracker/{api,frontend}/`. Skrypty są w `~/apps/subtracker/bin/` (źródła w `deploy/mydevil/`, wgrywane ręcznie przez `scp`). Pełny opis: `deploy/mydevil/README.md`.

#### Restart

```sh
ssh <login>@s<N>.mydevil.net

tail -n 30 ~/apps/subtracker/api/logs/out.log   # czy nie trwa przebieg przypomnień
~/apps/subtracker/bin/start-app.sh api           # zatrzymuje (limit 30 s) i uruchamia od nowa
~/apps/subtracker/bin/start-app.sh frontend
forever list
```

- `start-app.sh` sam zatrzymuje starą wersję, więc osobny `stop-app.sh` nie jest potrzebny. Sam `stop-app.sh <app>` tylko zatrzymuje aplikację.
- **Nigdy `forever stopall` ani `forever restartall`**: na tym koncie działają też inne aplikacje.
- Nie restartuj API ok. 02:00 ani w pierwszej minucie po starcie, gdy trwa przebieg przypomnień o trialu. Przerwany przebieg może zgubić przypomnienie jednego użytkownika.
- Restart nie zmienia bazy i nie wymaga kopii. Joby uruchamiane przy starcie nadrabiają to, co ominęło w czasie przerwy, a drugi przebieg tego samego dnia nic nie zmienia ani nie wysyła drugi raz.
- Po restarcie serwera (reboot) obie aplikacje uruchamia `start-all.sh` z crontaba (`@reboot`).

#### Logi

```sh
tail -n 50 ~/apps/subtracker/api/logs/out.log   # log aplikacji, w tym przebiegi jobów
tail -n 50 ~/apps/subtracker/api/logs/err.log   # błędy
tail -n 50 ~/apps/subtracker/frontend/logs/err.log
```

Logi większe niż 20 MB są czyszczone co niedzielę o 04:00 (crontab).

#### Wycofanie wersji i przywrócenie bazy

- `~/apps/subtracker/bin/rollback.sh api` przywraca poprzednie wydanie **razem z bazą** z kopii sprzed jego deployu. Dane zapisane od tego deployu znikają z bazy (zostają w kopii `*_pre-restore.dump`). Skrypt prosi o potwierdzenie (`TAK`).
- `~/apps/subtracker/bin/rollback.sh frontend` wycofuje tylko kod.
- `~/apps/subtracker/bin/restore-db.sh <plik.dump>` przywraca samą bazę; przedtem zatrzymaj API (`stop-app.sh api`), potem uruchom (`start-app.sh api`).
- Kopie bazy: `~/apps/subtracker/backups/` (10 najnowszych).

#### Konfiguracja na serwerze

`~/apps/subtracker/api/shared/.env` (chmod 600) to konfiguracja API: baza, CORS, ciasteczko sesji i SMTP. Szablon lokalnie: `backend-subtracker/.env.mydevil`, opis kluczy: `backend-subtracker/.env.example`. Aplikacja i migracje sprawdzają ją przy starcie, więc brakujący klucz zatrzymuje deploy na etapie migracji, a poprzednia wersja startuje ponownie.

### Postęp roadmapy (`/roadmap-project`)

Skill Claude Code w `.claude/skills/roadmap-project/` (nasz, w repo, nie z `10x` CLI). Polecenie `/roadmap-project` w sesji Claude Code:

- liczy procent realizacji z `context/foundation/roadmap.md`: zrobione pozycje F/S, pokrycie wymagań must-have (FR z `Scope anchors`), etapy planu testów (§3 w `test-plan.md`) i postęp każdego streamu;
- generuje stronę z paskami postępu, grafem zależności (z `Prerequisites`) i listą tego, co zostało, i publikuje ją jako prywatny Artifact na claude.ai;
- przy kolejnym uruchomieniu odświeża stronę pod tym samym adresem (zapisanym w `state.json`).

Warianty: `/roadmap-project next S-10` wskazuje pozycję oznaczaną jako następna, `/roadmap-project new` tworzy osobną stronę. Skill tylko czyta dokumenty; wygląd strony zmienia się w `scripts/build-roadmap-page.mjs`. Sam skrypt można też uruchomić bez Claude Code:

```sh
node .claude/skills/roadmap-project/scripts/build-roadmap-page.mjs --out roadmapa.html
```

#### Użycie w innym projekcie

1. Skopiuj folder `.claude/skills/roadmap-project/` do `.claude/skills/roadmap-project/` drugiego repozytorium (kopia na projekt, nie do `~/.claude/skills/`: `state.json` trzyma adres strony jednego projektu).
2. Wyczyść `state.json` do `{}`. Inaczej pierwsze uruchomienie nadpisze stronę SubTrackera. Opcjonalnie wpisz `"title"` (domyślnie „Roadmapa <project z frontmattera roadmapy>”).
3. Projekt potrzebuje `context/foundation/roadmap.md` w formacie `/10x-roadmap`: bloki `### F-NN:` / `### S-NN:` z liniami `- **Status:**`, `- **Prerequisites:**`, `- **PRD refs:**`, `- **Outcome:**`, a dla pełnego obrazu także `## Milestone` z `Scope anchors`, tabelę `## Streams` i sekcję `## Done` z datami archiwum. Brakujące sekcje są pomijane. `test-plan.md` i `fyi/todo-next.txt` są opcjonalne.
4. Kolory strony to paleta SubTrackera (zmienne w `:root` w skrypcie); zmień je, jeśli projekt ma własne.
5. Jeśli repozytorium ignoruje `.claude/skills/`, dodaj wyjątek w `.gitignore` (np. `!/.claude/skills/roadmap-project/`) i zacommituj folder.
6. Uruchom nową sesję Claude Code (skille są wczytywane przy starcie) i wpisz `/roadmap-project`.

### Dokumentacja projektu

- `CLAUDE.md` — skrót architektury, poleceń i pułapek (także dla agentów AI).
- `context/foundation/prd.md` — wymagania; `roadmap.md` — kolejność slice'ów; `tech-stack.md` — stos i plan wdrożenia.
- `context/foundation/backend-patterns.md` — wzorce backendu: logowanie, sesje, role, CORS, maile, dane domenowe, joby.
- `context/foundation/test-plan.md` — strategia testów i „jak dodać test”.
- `context/foundation/lessons.md` — powtarzające się reguły.
- `deploy/mydevil/README.md` — deploy, skrypty serwera, baza i przywracanie.

---

## English

An app for tracking personal subscriptions: the list and its costs, the lifecycle (trial → active → cancelled) and e-mail reminders before a trial ends. A project for the 10xDevs 4.0 course.

Two independent apps with no shared `package.json` in the root: run every `npm` command inside the app's folder.

| Folder | What it is | Local port |
|---|---|---|
| `frontend-subtracker/` | Angular 22 with SSR (`@angular/ssr`), Angular Material | 4200 (`ng serve`), 4000 (built SSR) |
| `backend-subtracker/` | NestJS 12, TypeORM, PostgreSQL | 3000 |
| `deploy/mydevil/` | MyDevil server scripts (deploy, restart, rollback) | — |
| `dev-local/` | helper scripts for manual local testing | — |
| `context/` | PRD, roadmap, change plans, patterns and the test plan | — |

### Requirements

- **Node 24** (Angular CLI 22 refuses Node < 22.22.3 / 24.15.0). This machine switches versions with `fnm`.
- **PostgreSQL 16** locally (13+ is enough to run the app; CI and production use 16).
- Git Bash or PowerShell on Windows.

### First local run

1. **Databases** (once, as a PostgreSQL superuser):

   ```sh
   cd backend-subtracker
   psql -U postgres -f database/create-local-databases.sql
   ```

   This creates two databases with the same owner:
   - `subtracker-db-dev` — the app's working database (`MODE=DEV`); its schema is rebuilt from the entities (`DATABASE_AUTO_SYNCHRONIZATION=true`);
   - `subtracker-db` — the reference database, changed only by migrations.

2. **Backend config**: copy `backend-subtracker/.env.example` to `backend-subtracker/.env` and fill in the database password. With an empty `SMTP_HOST` in `MODE=DEV`, mail (sign-in links, reminders) is printed to the console, so no SMTP server is needed locally. `.env` and `.env.mydevil` are never committed.

3. **Dependencies and migrations**:

   ```sh
   cd backend-subtracker
   npm install
   npm run migration:run      # schema of the reference database subtracker-db

   cd ../frontend-subtracker
   npm install
   ```

4. **Start** (two terminals):

   ```sh
   cd backend-subtracker && npm run start:dev     # API on http://localhost:3000
   cd frontend-subtracker && npm start            # app on http://localhost:4200
   ```

   Sign-in works through a link sent by e-mail; with an empty `SMTP_HOST` the link appears in the API console. You can also create a session without e-mail using a `dev-local/` script (see `dev-local/README.md`):

   ```sh
   cd backend-subtracker
   node --env-file=.env ../dev-local/test-session.mjs create <email>   # prints the session cookie
   node --env-file=.env ../dev-local/test-session.mjs seed <email>     # sample subscriptions
   ```

#### Restarting locally

`npm run start:dev` reloads the API after a code change, and `npm start` does the same for the frontend. For a full restart, press `Ctrl+C` and start again. On every start the API runs its jobs: the subscription lifecycle (awaited) and the trial reminders (in the background). A second start on the same day changes nothing and sends nothing twice.

Note: every `npm run test:e2e` marks the trials of your local account that end within 7 days as reminded (details in `dev-local/README.md`).

### Tests and quality checks

Backend (`cd backend-subtracker`):

| Command | What it does |
|---|---|
| `npm test` | unit tests (Vitest) |
| `npm run test:e2e` | API tests on the real `subtracker-db-dev` database (needs PostgreSQL and `.env`) |
| `npm run lint` | oxlint with type checking |
| `npm run build` | TypeScript build |

Frontend (`cd frontend-subtracker`):

| Command | What it does |
|---|---|
| `npm test` | unit and component tests |
| `npm run test:ci` | as in CI: the whole suite in the Warsaw and New York time zones |
| `npm run build:e2e` + `npm run e2e` | Playwright on the build (:4000) and the real API |

How to add each kind of test: `context/foundation/test-plan.md`, §6.

### Changing the database schema

Change the entities in code, then at the end of the feature generate a migration against the reference database:

```sh
cd backend-subtracker
npm run migration:generate -- ChangeName   # file in src/database/migrations/
npm run migration:run                      # apply it to subtracker-db
```

Commit the migration together with the code. In production, migrations run only during a deploy. `migration:revert` is for local use only.

### Git workflow and deploy

- Every change goes on a `change/<change-id>` branch; never commit straight to `main`.
- `ci.yml` checks every branch except `main` and every PR into `main`.
- A merge into `main` triggers a deploy (`deploy-backend.yml`, `deploy-frontend.yml`): GitHub Actions builds the package and sends it over SSH to `deploy.sh` on MyDevil.
- The API deploy has a short downtime: the API stops, the database is backed up (`pg_dump`), migrations run, the versions are swapped and `/health` is checked. If the health check fails, the database is restored from the backup and the previous version starts.

Check the deploy status in the Actions tab or with `gh run list --branch main`.

### Server (MyDevil)

Both apps run under `forever` on Node 24 in `~/apps/subtracker/{api,frontend}/`. The scripts live in `~/apps/subtracker/bin/` (sources in `deploy/mydevil/`, uploaded by hand with `scp`). Full description: `deploy/mydevil/README.md`.

#### Restart

```sh
ssh <login>@s<N>.mydevil.net

tail -n 30 ~/apps/subtracker/api/logs/out.log   # make sure no reminder run is in progress
~/apps/subtracker/bin/start-app.sh api           # stops it (30 s limit) and starts it again
~/apps/subtracker/bin/start-app.sh frontend
forever list
```

- `start-app.sh` stops the old version itself, so a separate `stop-app.sh` is not needed. `stop-app.sh <app>` on its own only stops the app.
- **Never use `forever stopall` or `forever restartall`**: other apps run on this account too.
- Don't restart the API around 02:00 or within the first minute after a start, while the trial reminder run is in progress. An interrupted run can lose one user's reminder.
- A restart does not touch the database and needs no backup. The jobs that run on start catch up on whatever was missed during the break, and a second run on the same day changes nothing and sends nothing twice.
- After a server reboot, `start-all.sh` from the crontab (`@reboot`) starts both apps.

#### Logs

```sh
tail -n 50 ~/apps/subtracker/api/logs/out.log   # app log, including job runs
tail -n 50 ~/apps/subtracker/api/logs/err.log   # errors
tail -n 50 ~/apps/subtracker/frontend/logs/err.log
```

Logs larger than 20 MB are emptied every Sunday at 04:00 (crontab).

#### Rolling back and restoring the database

- `~/apps/subtracker/bin/rollback.sh api` restores the previous release **together with the database** from the backup taken before its deploy. Data written since that deploy disappears from the database (it is kept in the `*_pre-restore.dump` backup). The script asks for confirmation (type `TAK`).
- `~/apps/subtracker/bin/rollback.sh frontend` rolls back the code only.
- `~/apps/subtracker/bin/restore-db.sh <file.dump>` restores only the database; stop the API first (`stop-app.sh api`) and start it afterwards (`start-app.sh api`).
- Database backups: `~/apps/subtracker/backups/` (10 newest kept).

#### Configuration on the server

`~/apps/subtracker/api/shared/.env` (chmod 600) holds the API configuration: database, CORS, session cookie and SMTP. Local template: `backend-subtracker/.env.mydevil`; keys are described in `backend-subtracker/.env.example`. The app and the migrations validate it at startup, so a missing key stops the deploy at the migration step and the previous version starts again.

### Roadmap progress (`/roadmap-project`)

A Claude Code skill in `.claude/skills/roadmap-project/` (ours, committed, not from the `10x` CLI). The `/roadmap-project` command in a Claude Code session:

- computes progress from `context/foundation/roadmap.md`: finished F/S items, coverage of the must-have requirements (FRs from `Scope anchors`), test-plan stages (§3 of `test-plan.md`) and each stream;
- generates a page with progress bars, the dependency graph (from `Prerequisites`) and what is left, and publishes it as a private Artifact on claude.ai;
- on the next run refreshes the page at the same address (kept in `state.json`).

Variants: `/roadmap-project next S-10` sets the item marked as next, `/roadmap-project new` creates a separate page. The skill only reads the documents; change the page's look in `scripts/build-roadmap-page.mjs`. The script also runs without Claude Code:

```sh
node .claude/skills/roadmap-project/scripts/build-roadmap-page.mjs --out roadmap.html
```

#### Using it in another project

1. Copy the `.claude/skills/roadmap-project/` folder to `.claude/skills/roadmap-project/` in the other repository (one copy per project, not `~/.claude/skills/`: `state.json` holds one project's page address).
2. Reset `state.json` to `{}`, or the first run will overwrite the SubTracker page. Optionally set `"title"` (default: "Roadmapa <project from the roadmap frontmatter>").
3. The project needs `context/foundation/roadmap.md` in the `/10x-roadmap` format: `### F-NN:` / `### S-NN:` blocks with `- **Status:**`, `- **Prerequisites:**`, `- **PRD refs:**` and `- **Outcome:**` lines, and for the full picture also `## Milestone` with `Scope anchors`, a `## Streams` table and a `## Done` section with archive dates. Missing sections are skipped. `test-plan.md` and `fyi/todo-next.txt` are optional.
4. The page uses the SubTracker palette (the `:root` variables in the script); change them if the project has its own.
5. If the repository ignores `.claude/skills/`, add an exception to `.gitignore` (e.g. `!/.claude/skills/roadmap-project/`) and commit the folder.
6. Start a new Claude Code session (skills load at startup) and type `/roadmap-project`.

### Project documentation

- `CLAUDE.md` — a summary of the architecture, commands and pitfalls (also for AI agents).
- `context/foundation/prd.md` — requirements; `roadmap.md` — slice order; `tech-stack.md` — stack and deployment plan.
- `context/foundation/backend-patterns.md` — backend patterns: sign-in, sessions, roles, CORS, mail, domain data, jobs.
- `context/foundation/test-plan.md` — test strategy and "how to add a test".
- `context/foundation/lessons.md` — recurring rules.
- `deploy/mydevil/README.md` — deploy, server scripts, database and restore.
