# SubTracker

Aplikacja do śledzenia osobistych subskrypcji: lista i koszty, cykl życia (trial → aktywna → anulowana) i przypomnienia mailem przed końcem okresu próbnego. Projekt kursu 10xDevs 4.0.

Dwie niezależne aplikacje, bez wspólnego `package.json` w katalogu głównym: każde polecenie `npm` uruchamiasz w katalogu aplikacji.

| Katalog | Co to jest | Port lokalnie |
|---|---|---|
| `frontend-subtracker/` | Angular 22 z SSR (`@angular/ssr`), Angular Material | 4200 (`ng serve`), 4000 (zbudowany SSR) |
| `backend-subtracker/` | NestJS 12, TypeORM, PostgreSQL | 3000 |
| `deploy/mydevil/` | skrypty serwera MyDevil (deploy, restart, rollback) | — |
| `dev-local/` | pomocnicze skrypty do ręcznych testów lokalnie | — |
| `context/` | PRD, roadmapa, plany zmian, wzorce i plan testów | — |

## Wymagania

- **Node 24** (Angular CLI 22 nie ruszy na Node < 22.22.3 / 24.15.0). Na tej maszynie wersje przełącza `fnm`.
- **PostgreSQL 16** lokalnie (13+ wystarczy do uruchomienia, 16 jest w CI i na produkcji).
- Git Bash albo PowerShell na Windows.

## Pierwsze uruchomienie lokalnie

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

### Restart lokalnie

`npm run start:dev` sam przeładowuje API po zmianie kodu, a `npm start` frontend. Pełny restart to `Ctrl+C` i ponowny start. Przy każdym starcie API uruchamia joby: cykl życia subskrypcji (czekając na wynik) i przypomnienia o trialu (w tle). Drugi start tego samego dnia nic już nie zmienia ani nie wysyła drugi raz.

Uwaga: każde `npm run test:e2e` oznacza triale z Twojego lokalnego konta kończące się w ciągu 7 dni jako przypomniane (szczegóły w `dev-local/README.md`).

## Testy i kontrola jakości

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

## Zmiana schematu bazy

Encje zmieniasz w kodzie, a na koniec funkcji generujesz migrację względem bazy referencyjnej:

```sh
cd backend-subtracker
npm run migration:generate -- NazwaZmiany   # plik w src/database/migrations/
npm run migration:run                       # zastosuj na subtracker-db
```

Migrację commitujesz razem z kodem. Na produkcji migracje uruchamia tylko deploy. `migration:revert` wolno używać wyłącznie lokalnie.

## Praca z gitem i deploy

- Każda zmiana na gałęzi `change/<change-id>`, nigdy commit wprost do `main`.
- `ci.yml` sprawdza każdą gałąź poza `main` i każdy PR do `main`.
- Merge do `main` uruchamia deploy (`deploy-backend.yml`, `deploy-frontend.yml`): GitHub Actions buduje paczkę i wysyła ją przez SSH do `deploy.sh` na MyDevil.
- Deploy API ma krótką przerwę: zatrzymanie API, kopia bazy (`pg_dump`), migracje, podmiana wersji i health-check na `/health`. Gdy health-check się nie powiedzie, baza wraca z kopii i startuje poprzednia wersja.

Stan deployu sprawdzisz w zakładce Actions albo poleceniem `gh run list --branch main`.

## Serwer (MyDevil)

Obie aplikacje działają pod `forever` na Node 24 w `~/apps/subtracker/{api,frontend}/`. Skrypty są w `~/apps/subtracker/bin/` (źródła w `deploy/mydevil/`, wgrywane ręcznie przez `scp`). Pełny opis: `deploy/mydevil/README.md`.

### Restart

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

### Logi

```sh
tail -n 50 ~/apps/subtracker/api/logs/out.log   # log aplikacji, w tym przebiegi jobów
tail -n 50 ~/apps/subtracker/api/logs/err.log   # błędy
tail -n 50 ~/apps/subtracker/frontend/logs/err.log
```

Logi większe niż 20 MB są czyszczone co niedzielę o 04:00 (crontab).

### Wycofanie wersji i przywrócenie bazy

- `~/apps/subtracker/bin/rollback.sh api` przywraca poprzednie wydanie **razem z bazą** z kopii sprzed jego deployu. Dane zapisane od tego deployu znikają z bazy (zostają w kopii `*_pre-restore.dump`). Skrypt prosi o potwierdzenie (`TAK`).
- `~/apps/subtracker/bin/rollback.sh frontend` wycofuje tylko kod.
- `~/apps/subtracker/bin/restore-db.sh <plik.dump>` przywraca samą bazę; przedtem zatrzymaj API (`stop-app.sh api`), potem uruchom (`start-app.sh api`).
- Kopie bazy: `~/apps/subtracker/backups/` (10 najnowszych).

### Konfiguracja na serwerze

`~/apps/subtracker/api/shared/.env` (chmod 600) to konfiguracja API: baza, CORS, ciasteczko sesji i SMTP. Szablon lokalnie: `backend-subtracker/.env.mydevil`, opis kluczy: `backend-subtracker/.env.example`. Aplikacja i migracje sprawdzają ją przy starcie, więc brakujący klucz zatrzymuje deploy na etapie migracji, a poprzednia wersja startuje ponownie.

## Dokumentacja projektu

- `CLAUDE.md` — skrót architektury, poleceń i pułapek (także dla agentów AI).
- `context/foundation/prd.md` — wymagania; `roadmap.md` — kolejność slice'ów; `tech-stack.md` — stos i plan wdrożenia.
- `context/foundation/backend-patterns.md` — wzorce backendu: logowanie, sesje, role, CORS, maile, dane domenowe, joby.
- `context/foundation/test-plan.md` — strategia testów i „jak dodać test”.
- `context/foundation/lessons.md` — powtarzające się reguły.
- `deploy/mydevil/README.md` — deploy, skrypty serwera, baza i przywracanie.
