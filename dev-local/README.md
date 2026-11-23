# dev-local — local manual-test helpers

[Polski](#polski) · [English](#english)

Back to the main README / powrót do głównego README: [`../README.md`](../README.md)

---

## Polski

Małe skrypty do ręcznego testowania SubTrackera na komputerze programisty. Są w repo, więc nigdy nie mogą zawierać sekretów ani danych osobowych. Działają **wyłącznie** na lokalnych bazach z `backend-subtracker/.env` (`MODE=DEV`); każdy skrypt Node wywołuje `assertLocalDev()` z `local-only.mjs` i kończy się przed połączeniem, gdy środowisko wygląda na serwer (`MODE` inny niż `DEV`, brak `POSTGRES_DATABASE_DEV` albo baza dev taka sama jak referencyjna). Skrypt powłoki `prune-backups-trial.sh` sprawdza `MODE=DEV` sam.

### Jak uruchamiać

Skrypty Node zawsze z `backend-subtracker/`, żeby znalazły się `.env` i `node_modules/pg`:

```
cd backend-subtracker
node --env-file=.env ../dev-local/<skrypt>.mjs [argumenty]
```

Potrzebny jest lokalny PostgreSQL (`database/create-local-databases.sql`). Skrypty wołające API (`test-session.mjs seed`) potrzebują działającego `npm run start:dev`; adres API to domyślnie `http://localhost:3000` (zmiana przez `TEST_API_URL`).

### Skrypty

| Skrypt | Co robi | Gdzie zapisuje |
| --- | --- | --- |
| `test-session.mjs create [email]` | Zakłada tymczasową sesję (1 dzień) dla istniejącego konta i wypisuje ciasteczko dla przeglądarki, żeby testować strony po zalogowaniu bez linku z maila. | `session` w `subtracker-db-dev` |
| `test-session.mjs seed [email]` | Dodaje 5 przykładowych subskrypcji (każdy status, jedna roczna) przez `POST /subscriptions`, na własnej krótkiej sesji, którą na końcu usuwa. | przez API |
| `test-session.mjs cleanup [email]` | Usuwa przykładowe subskrypcje (po nazwie) i sesje `manual-test`; bez adresu — dla każdego konta, które ma taką sesję. | `subtracker-db-dev` |
| `inspect-category.mjs` | Tylko odczyt: wiersze kategorii, kolumna `name_key` i indeksy w obu lokalnych bazach. | — |
| `check-collation.mjs` | Tylko odczyt: czy jest kolacja ICU `pl-PL-x-icu` i jak sortują się polskie nazwy z nią i bez niej. | — |
| `backfill-category-name-key.mjs` | Jednorazowy (S-02, już zastosowany): dodaje i wypełnia `category.name_key` w istniejącej bazie dev, bo `synchronize` nie doda kolumny NOT NULL do tabeli z wierszami. | `subtracker-db-dev` |
| `backfill-own-category-settings.mjs` | Jednorazowy (S-07, zastosowany 2026-11-17): każdej własnej kategorii bez wiersza `category_setting` daje próg 3, tak jak migracja `BackfillOwnCategorySettings` na `subtracker-db`. Idempotentny. | `subtracker-db-dev` |
| `widen-category-name-key.mjs` | Jednorazowy (S-02, już zastosowany): poszerza `category.name_key` do `varchar(100)` w bazie dev. | `subtracker-db-dev` |
| `prune-backups-trial.sh` | Powłoka, nie Node: `sh dev-local/prune-backups-trial.sh` z Git Bash w katalogu głównym repo. Próba `deploy/mydevil/prune-backups.sh` (S-10) w 7 przypadkach z wynikiem PASS/FAIL: świeża kopia przed kasowaniem, kopia profilaktyczna, nieudana kopia niczego nie usuwa, zachowany argument, zajęta blokada. Uruchamiaj po każdej zmianie tamtego skryptu. Potrzebuje `pg_dump` (`PG_BIN`, gdy nie ma go w `PATH`) i `MODE=DEV` w `.env`. | `dev-local/.prune-trial/` (ignorowany przez git, usuwany na końcu); `pg_dump` czyta `subtracker-db` |
| `watchdog-trial.mjs [reset]` | Próba watchdoga (S-11) po `npm run build`: jedno uruchomienie `dist/cli/watchdog.js` na porcie API z `PORT` i frontendu 4200 (zmiana przez `WATCHDOG_API_PORT`, `WATCHDOG_FRONTEND_PORT`); `reset` kasuje stan. Bez zmiennych `SMTP_*` i `NOTIFICATION_SMTP_*`, więc maile trafiają tylko na konsolę. Przy zatrzymanym API trzecie uruchomienie daje mail „API nie odpowiada”, a pierwsze po starcie API mail „API działa ponownie”. Uruchamiaj po każdej zmianie `src/watchdog/`. | `dev-local/.watchdog-trial/` (ignorowany przez git) |

`[email]` można pominąć, gdy w `backend-subtracker/.env` jest `DEV_USER_EMAIL` (plik ignorowany przez git; zob. `.env.example`).

#### Typowa sesja

```
cd backend-subtracker
npm run start:dev                                            # API na :3000 (w drugim terminalu)
node --env-file=.env ../dev-local/test-session.mjs create   # skopiuj wypisaną linię z ciasteczkiem
node --env-file=.env ../dev-local/test-session.mjs seed
#   ... testy na http://localhost:4200/subscriptions ...
node --env-file=.env ../dev-local/test-session.mjs cleanup
```

Użycie ciasteczka: w Chrome DevTools na `http://localhost:4200` uruchom wypisaną linię `document.cookie = …` (jeśli Chrome blokuje wklejanie, najpierw wpisz `allow pasting`) albo dodaj ciasteczko ręcznie w DevTools → Application → Cookies (`subtracker_session`, ścieżka `/`). Logowanie prawdziwym linkiem z maila też działa — `seed` i `cleanup` nie potrzebują sesji przeglądarki.

**Przypomnienia o trialu po testach e2e.** Każde `npm run test:e2e` startuje API z udawanym transportem poczty, a jego startowy przebieg przypomnień obejmuje całą `subtracker-db-dev`: triale Twojego konta kończące się w ciągu 7 dni dostają `subscription.trial_reminder_sent_for`, choć żaden mail nie wyszedł. Żeby potem ręcznie sprawdzić przypomnienia, dodaj trial jeszcze raz albo zmień datę końca w formularzu edycji (nowa data uzbraja przypomnienie ponownie), a potem zrestartuj `npm run start:dev`.

### Zasady dodawania skryptu

- Żadnych haseł, tokenów, nazw hostów, adresów IP, domen ani danych osobowych (adresy e-mail, prawdziwe nazwiska) w plikach. Połączenie bierzemy z `.env`; konto to argument albo `DEV_USER_EMAIL`.
- Najpierw `assertLocalDev()` (w powłoce: sprawdzenie `MODE=DEV`). Nigdy nie kieruj skryptu do zapisu w bazie referencyjnej (`POSTGRES_DATABASE`) — ta zmienia się tylko migracjami.
- Nie zapisuj plików stanu z tokenami; tokeny trzymaj w pamięci albo wypisuj na konsolę. Wypisanego ciasteczka sesji nie wklejaj do czatów ani zgłoszeń: loguje jako to konto do `cleanup` albo wygaśnięcia.
- Pliki robocze tylko w podkatalogu `dev-local/`, który jest w `.gitignore`, nigdy w systemowych katalogach tymczasowych.
- W komentarzu na początku napisz, co skrypt robi, jak go uruchomić i czy jest jednorazowy. Dopisz go do tabeli w obu językach.

---

## English

Small scripts for testing SubTracker by hand on a developer machine. They are committed, so they must never contain secrets or personal data. They work **only** against the local databases from `backend-subtracker/.env` (`MODE=DEV`); every Node script calls `assertLocalDev()` from `local-only.mjs` and exits before connecting when the environment looks like a server (`MODE` other than `DEV`, no `POSTGRES_DATABASE_DEV`, or the dev and reference databases being the same). The shell script `prune-backups-trial.sh` checks `MODE=DEV` itself.

### How to run

Node scripts always from `backend-subtracker/`, so `.env` and `node_modules/pg` are found:

```
cd backend-subtracker
node --env-file=.env ../dev-local/<script>.mjs [arguments]
```

Needs the local PostgreSQL (`database/create-local-databases.sql`). Scripts that call the API (`test-session.mjs seed`) need `npm run start:dev` running; the API address defaults to `http://localhost:3000` (override with `TEST_API_URL`).

### Scripts

| Script | What it does | Writes to |
| --- | --- | --- |
| `test-session.mjs create [email]` | Creates a temporary session (1 day) for an existing account and prints the browser cookie, so you can test signed-in pages without the e-mail link. | `session` in `subtracker-db-dev` |
| `test-session.mjs seed [email]` | Adds 5 sample subscriptions (every status, a yearly one) through `POST /subscriptions`, using its own short-lived session that it deletes at the end. | via the API |
| `test-session.mjs cleanup [email]` | Deletes the sample subscriptions (by name) and the `manual-test` sessions; without an e-mail, for every account that has such a session. | `subtracker-db-dev` |
| `inspect-category.mjs` | Read-only: category rows, the `name_key` column and the indexes in both local databases. | — |
| `check-collation.mjs` | Read-only: is the ICU collation `pl-PL-x-icu` available, and how Polish names sort with and without it. | — |
| `backfill-category-name-key.mjs` | One-off (S-02, already applied): adds and fills `category.name_key` in an existing dev database, because `synchronize` cannot add a NOT NULL column to a table with rows. | `subtracker-db-dev` |
| `backfill-own-category-settings.mjs` | One-off (S-07, already applied 2026-11-17): gives every own category without a `category_setting` row the threshold 3, as the `BackfillOwnCategorySettings` migration does on `subtracker-db`. Idempotent. | `subtracker-db-dev` |
| `widen-category-name-key.mjs` | One-off (S-02, already applied): widens `category.name_key` to `varchar(100)` in the dev database. | `subtracker-db-dev` |
| `prune-backups-trial.sh` | Shell, not Node: run `sh dev-local/prune-backups-trial.sh` from Git Bash in the repo root. Trial of `deploy/mydevil/prune-backups.sh` (S-10) in 7 cases with PASS/FAIL checks: fresh dump before deleting, preventive dump, failed dump deletes nothing, kept argument, busy lock. Re-run after every change to that script. Needs `pg_dump` (`PG_BIN` when it is not on `PATH`) and `MODE=DEV` in `.env`. | `dev-local/.prune-trial/` (git-ignored, removed at the end); `pg_dump` reads `subtracker-db` |
| `watchdog-trial.mjs [reset]` | Watchdog trial (S-11) after `npm run build`: one run of `dist/cli/watchdog.js` against the API port from `PORT` and the frontend on 4200 (override with `WATCHDOG_API_PORT`, `WATCHDOG_FRONTEND_PORT`); `reset` forgets the state. The `SMTP_*` and `NOTIFICATION_SMTP_*` variables are removed, so mail only goes to the console. With the API stopped, the third run prints the "API nie odpowiada" mail and the first run after the API starts the "API działa ponownie" mail. Re-run after every change to `src/watchdog/`. | `dev-local/.watchdog-trial/` (git-ignored) |

`[email]` is optional when `DEV_USER_EMAIL` is set in `backend-subtracker/.env` (git-ignored; see `.env.example`).

#### Typical session

```
cd backend-subtracker
npm run start:dev                                            # API on :3000 (another terminal)
node --env-file=.env ../dev-local/test-session.mjs create   # copy the printed cookie line
node --env-file=.env ../dev-local/test-session.mjs seed
#   ... test http://localhost:4200/subscriptions ...
node --env-file=.env ../dev-local/test-session.mjs cleanup
```

To use the cookie: in Chrome DevTools on `http://localhost:4200` run the printed `document.cookie = …` line (type `allow pasting` first if Chrome blocks pasting), or add the cookie by hand in DevTools → Application → Cookies (`subtracker_session`, path `/`). Signing in with the real e-mail link also works — `seed` and `cleanup` do not need the browser's session.

**Trial reminders after e2e tests.** Every `npm run test:e2e` starts the API with a fake mail transport, and its startup trial reminder run covers the whole `subtracker-db-dev`: trials of your own account that end within 7 days get `subscription.trial_reminder_sent_for` set although no mail went out. To check reminders by hand after running e2e tests, add the trial again, or move its end date in the edit form (a new end date re-arms the reminder), then restart `npm run start:dev`.

### Rules for adding a script

- No passwords, tokens, host names, IP addresses, domains or personal data (e-mail addresses, real names) in the files. Connection settings come from `.env`; an account is an argument or `DEV_USER_EMAIL`.
- Call `assertLocalDev()` first (in shell: check `MODE=DEV`). Never point a script at the reference database (`POSTGRES_DATABASE`) for writing — that one changes only through migrations.
- Do not write state files with tokens; keep tokens in memory or print them to the console. Do not paste a printed session cookie into chats or tickets: it signs in as that account until `cleanup` or expiry.
- Working files only in a git-ignored subfolder of `dev-local/`, never in system temp folders.
- Say in the header comment what the script does, how to run it, and whether it is a one-off. Add it to the table in both languages.
