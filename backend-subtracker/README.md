# backend-subtracker

[Polski](#polski) · [English](#english)

Back to the main README / powrót do głównego README: [`../README.md`](../README.md)

---

## Polski

API SubTrackera: NestJS 12, ścisły TypeScript, natywny ESM, PostgreSQL przez TypeORM. Pierwsze uruchomienie (bazy lokalne, `.env`, migracje): [główne README](../README.md#pierwsze-uruchomienie-lokalnie).

### Polecenia

Wszystkie z tego katalogu (`cd backend-subtracker`):

| Polecenie | Co robi |
|---|---|
| `npm run start:dev` | API z przeładowaniem po zmianie kodu, port `PORT` (domyślnie 3000) |
| `npm run build` + `npm run start:prod` | build i uruchomienie zbudowanej aplikacji |
| `npm run lint` | oxlint z kontrolą typów |
| `npm run format` | prettier |
| `npm test` | testy jednostkowe Vitest (`src/**/*.spec.ts`) |
| `npm run test:e2e` | testy API w `test/` na prawdziwej `subtracker-db-dev` (wspólny pomocnik `test/support/e2e-app.ts`) |
| `npm run test:cov` | pokrycie |
| `npm run migration:generate -- <Nazwa>` | migracja z różnicy encji względem `subtracker-db` |
| `npm run migration:create -- <Nazwa>` | pusta migracja |
| `npm run migration:run` / `migration:show` | zastosowanie / lista migracji na `subtracker-db` |
| `npm run admin:grant -- <mail>` | lokalne nadanie roli `ADMIN` (na serwerze: [`deploy/mydevil/README.md`](../deploy/mydevil/README.md#nadawanie-roli-administratora)) |
| `npm run prepare-mydevil` | paczka do deployu na MyDevil (używa jej CI) |

Pojedynczy plik testu: `npx vitest run src/app.controller.spec.ts`; pojedynczy plik e2e: `npx vitest run --config ./vitest.config.e2e.ts test/<ścieżka>`.

### Konfiguracja

- `.env` (lokalnie) i `.env.mydevil` (szablon `.env` na serwerze) są ignorowane przez git; opis wszystkich kluczy: [`.env.example`](.env.example). Konfiguracja jest sprawdzana przy starcie (`src/config/env.ts`).
- `database/create-local-databases.sql` — zakłada dwie lokalne bazy: `subtracker-db-dev` (robocza, `synchronize`) i `subtracker-db` (referencyjna, tylko migracje).

### Układ

- `src/` — moduły funkcji `auth/`, `users/`, `mail/`, `subscriptions/`, oraz `config/`, `database/` (opcje i migracje), `health/`, `cli/`, `shared/` (kod ogólny bez wiedzy o domenie).
- `test/` — testy e2e API (`auth/`, `subscriptions/`, `support/`).
- `scripts/` — `prepare-mydevil.mjs`, `migration-file.mjs`.

### Ważne zasady

- Natywny ESM: względne importy z rozszerzeniem `.js`.
- Schemat bazy zmieniają tylko migracje generowane na koniec funkcji; reguły w [`context/foundation/lessons.md`](../context/foundation/lessons.md).
- Wzorce logowania, sesji, ról, CORS, maili, danych domenowych i jobów: [`context/foundation/backend-patterns.md`](../context/foundation/backend-patterns.md).
- Jak dodać test API: [`context/foundation/test-plan.md`](../context/foundation/test-plan.md) §6.3–6.4.

---

## English

The SubTracker API: NestJS 12, strict TypeScript, native ESM, PostgreSQL through TypeORM. First run (local databases, `.env`, migrations): [main README](../README.md#first-local-run).

### Commands

All from this folder (`cd backend-subtracker`):

| Command | What it does |
|---|---|
| `npm run start:dev` | API with reload on code change, port `PORT` (default 3000) |
| `npm run build` + `npm run start:prod` | build and run the built app |
| `npm run lint` | oxlint with type checking |
| `npm run format` | prettier |
| `npm test` | Vitest unit tests (`src/**/*.spec.ts`) |
| `npm run test:e2e` | API tests in `test/` on the real `subtracker-db-dev` (shared helper `test/support/e2e-app.ts`) |
| `npm run test:cov` | coverage |
| `npm run migration:generate -- <Name>` | migration from the entity diff against `subtracker-db` |
| `npm run migration:create -- <Name>` | empty migration |
| `npm run migration:run` / `migration:show` | apply / list migrations on `subtracker-db` |
| `npm run admin:grant -- <mail>` | grant the `ADMIN` role locally (on the server: [`deploy/mydevil/README.md`](../deploy/mydevil/README.md#granting-the-admin-role)) |
| `npm run prepare-mydevil` | MyDevil deploy package (used by CI) |

Single test file: `npx vitest run src/app.controller.spec.ts`; single e2e file: `npx vitest run --config ./vitest.config.e2e.ts test/<path>`.

### Configuration

- `.env` (local) and `.env.mydevil` (template of the server's `.env`) are git-ignored; every key is described in [`.env.example`](.env.example). The config is validated at startup (`src/config/env.ts`).
- `database/create-local-databases.sql` — creates the two local databases: `subtracker-db-dev` (working, `synchronize`) and `subtracker-db` (reference, migrations only).

### Layout

- `src/` — feature modules `auth/`, `users/`, `mail/`, `subscriptions/`, plus `config/`, `database/` (options and migrations), `health/`, `cli/`, `shared/` (generic code with no domain knowledge).
- `test/` — API e2e tests (`auth/`, `subscriptions/`, `support/`).
- `scripts/` — `prepare-mydevil.mjs`, `migration-file.mjs`.

### Key rules

- Native ESM: relative imports carry the `.js` extension.
- The database schema changes only through migrations generated at the end of a feature; rules in [`context/foundation/lessons.md`](../context/foundation/lessons.md).
- Patterns for sign-in, sessions, roles, CORS, mail, domain data and jobs: [`context/foundation/backend-patterns.md`](../context/foundation/backend-patterns.md).
- How to add an API test: [`context/foundation/test-plan.md`](../context/foundation/test-plan.md) §6.3–6.4.
