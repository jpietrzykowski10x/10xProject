# dev-local — local manual-test helpers

Small Node scripts for testing SubTracker by hand on a developer machine. They are committed, so
they must never contain secrets or personal data. They work **only** against the local databases
from `backend-subtracker/.env` (`MODE=DEV`); every script calls `assertLocalDev()` from
`local-only.mjs` and exits before connecting when the environment looks like a server
(`MODE` other than `DEV`, no `POSTGRES_DATABASE_DEV`, or the dev and reference databases being the
same).

## How to run

Always from `backend-subtracker/`, so `.env` and `node_modules/pg` are found:

```
cd backend-subtracker
node --env-file=.env ../dev-local/<script>.mjs [arguments]
```

Needs the local PostgreSQL (`database/create-local-databases.sql`). Scripts that call the API
(`test-session.mjs seed`) need `npm run start:dev` running; the API address defaults to
`http://localhost:3000` (override with `TEST_API_URL`).

## Scripts

| Script | What it does | Writes to |
| --- | --- | --- |
| `test-session.mjs create [email]` | Creates a temporary session (1 day) for an existing account and prints the browser cookie, so you can test signed-in pages without the e-mail link. | `session` in `subtracker-db-dev` |
| `test-session.mjs seed [email]` | Adds 5 sample subscriptions (every status, a yearly one) through `POST /subscriptions`, using its own short-lived session that it deletes at the end. | via the API |
| `test-session.mjs cleanup [email]` | Deletes the sample subscriptions (by name) and the `manual-test` sessions; without an e-mail, for every account that has such a session. | `subtracker-db-dev` |
| `inspect-category.mjs` | Read-only: category rows, the `name_key` column and the indexes in both local databases. | — |
| `check-collation.mjs` | Read-only: is the ICU collation `pl-PL-x-icu` available, and how Polish names sort with and without it. | — |
| `backfill-category-name-key.mjs` | One-off (S-02, already applied): adds and fills `category.name_key` in an existing dev database, because `synchronize` cannot add a NOT NULL column to a table with rows. | `subtracker-db-dev` |
| `widen-category-name-key.mjs` | One-off (S-02, already applied): widens `category.name_key` to `varchar(100)` in the dev database. | `subtracker-db-dev` |

`[email]` is optional when `DEV_USER_EMAIL` is set in `backend-subtracker/.env` (git-ignored; see
`.env.example`).

### Typical session

```
cd backend-subtracker
npm run start:dev                                            # API on :3000 (another terminal)
node --env-file=.env ../dev-local/test-session.mjs create   # copy the printed cookie line
node --env-file=.env ../dev-local/test-session.mjs seed
#   ... test http://localhost:4200/subscriptions ...
node --env-file=.env ../dev-local/test-session.mjs cleanup
```

To use the cookie: in Chrome DevTools on `http://localhost:4200` run the printed
`document.cookie = …` line (type `allow pasting` first if Chrome blocks pasting), or add the cookie
by hand in DevTools → Application → Cookies (`subtracker_session`, path `/`). Signing in with the
real e-mail link also works — `seed` and `cleanup` do not need the browser's session.

## Rules for adding a script

- No passwords, tokens, host names, IP addresses or personal data (e-mail addresses, real names)
  in the files. Connection settings come from `.env`; an account is an argument or
  `DEV_USER_EMAIL`.
- Call `assertLocalDev()` first. Never point a script at the reference database
  (`POSTGRES_DATABASE`) for writing — that one changes only through migrations.
- Do not write state files with tokens; keep tokens in memory or print them to the console.
  Do not paste a printed session cookie into chats or tickets: it signs in as that account until
  `cleanup` or expiry.
- Say in the header comment what the script does, how to run it, and whether it is a one-off.
