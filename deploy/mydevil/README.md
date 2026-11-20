# MyDevil deploy scripts

Server-side scripts for deploying SubTracker to MyDevil. They live in `~/apps/subtracker/bin` on the server and are not installed automatically. After changing them here, upload them again; see [Updating the scripts on the server](#updating-the-scripts-on-the-server).

## Server layout

```
~/apps/subtracker/frontend/          ~/apps/subtracker/api/
  public_nodejs/      live version (forever runs it)
  public_nodejs_new/  being installed during a deploy
  releases/           previous versions, with node_modules (3 newest kept)
  shared/.env         PORT=..., NODE_ENV=production (chmod 600), copied into every release
  logs/               forever.log, out.log, err.log

~/apps/subtracker/backups/   (drwx------) api database dumps before each deploy,
                             <YYYYmmdd-HHMMSS>_<sha7>.dump (-rw-------), 10 newest kept,
                             none older than 180 days (see Backups and deleted accounts)
```

`shared/.env` of the api also holds the database, CORS, session cookie and mail settings (template: `backend-subtracker/.env.example`, local copy `backend-subtracker/.env.mydevil`):

```
MODE=PROD
PORT=<PORT_API>
NODE_ENV=production
POSTGRES_HOST=...          # from `devil pgsql db add`; no POSTGRES_DATABASE_DEV
POSTGRES_PORT=5432
POSTGRES_USER=...
POSTGRES_PASSWORD=...
POSTGRES_DATABASE=...
DATABASE_AUTO_SYNCHRONIZATION=false   # true is rejected at startup in PROD
CORS_ORIGINS=https://subtracker.jakubpietrzykowski.pl
FRONTEND_URL=https://subtracker.jakubpietrzykowski.pl   # bare https origin, target of the magic links
SESSION_COOKIE_DOMAIN=.jakubpietrzykowski.pl
SMTP_HOST=...
SMTP_PORT=587
SMTP_SECURE=false                     # false = STARTTLS on 587, true = TLS on 465
SMTP_USERNAME=...
SMTP_PASSWORD=...
SMTP_FROM_EMAIL=...
SMTP_FROM_NAME=SubTracker
NOTIFICATION_ADMINISTRATOR_MAIL=...
LOG_ERROR_STACKS=true                 # optional, default true; false hides stack traces in error logs
```

The app and the migrations validate these settings at startup, so a missing or inconsistent key stops the deploy at the migration step and the previous version starts again. In `MODE=PROD`:

- `FRONTEND_URL`, `SESSION_COOKIE_DOMAIN`, `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` and `NOTIFICATION_ADMINISTRATOR_MAIL` are required.
- `CORS_ORIGINS` must include `FRONTEND_URL`.
- `SESSION_COOKIE_DOMAIN` must cover the `FRONTEND_URL` host.
- Leave `NOTIFICATION_SMTP_*` unset unless operator notifications need a separate transporter; unset, they go through `SMTP_*`. A set `NOTIFICATION_SMTP_HOST` requires `NOTIFICATION_SMTP_USERNAME`, `NOTIFICATION_SMTP_PASSWORD` and `NOTIFICATION_SMTP_FROM_EMAIL` too.

The scripts source this file with `sh` (`. .env`) and export it, so the app gets whatever `sh` made of each line. Keep values plain or in single quotes (`KEY='two words'`); never leave `$`, `` ` ``, `"`, `\` or `#` unquoted. Use letters and digits for passwords (`openssl rand -hex 16`). The keys must not repeat: `deploy.sh` reads `PORT` with `sed` and a second `PORT=` line breaks the health check.

Domains are MyDevil proxy domains, and TLS terminates on MyDevil:

- `subtracker.jakubpietrzykowski.pl` → `localhost:<PORT_FE>`
- `apisubtracker.jakubpietrzykowski.pl` → `localhost:<PORT_API>`

## Scripts

| Script | Purpose |
|---|---|
| `ci-gate.sh` | Forced command for the CI key. It accepts only `deploy <frontend\|api> <sha>`. |
| `deploy.sh <app> <sha>` | Unpacks the tarball from stdin into `public_nodejs_new`, runs `npm24 ci --omit=dev`, swaps it in with `mv`, and runs a health check (`/health` for the api, `/` for the frontend). For the api it first stops the live version, backs up the database and runs migrations (see [Database](#database)). If the health check fails, it restores the previous version automatically. |
| `restore-db.sh <file.dump>` | Restores the api database from a backup: first dumps the current state to `backups/<time>_pre-restore.dump` (10 kept), then drops and recreates the `public` schema and restores the dump, in one transaction. After a successful restore it runs `prune-backups.sh`. Does not stop or start the api. |
| `prune-backups.sh [file-to-keep]` | Deletes api dumps older than 180 days from `backups/`, but first takes a fresh `<time>_scheduled.dump` when no dump is younger than 30 days. Run daily from crontab and by `deploy.sh` (api) and `restore-db.sh`. See [Backups and deleted accounts](#backups-and-deleted-accounts). |
| `stop-app.sh <app>` | Stops the app: `forever stop` capped at 30 s, then the forever monitor and the app are killed by their path. `forever stop` can hang for good while the app is crash-looping. Every other script stops apps through it. |
| `start-app.sh <app>` | Restarts the app under `forever` on `/usr/local/bin/node24`, using the env from `.env`. Entry: `app.mjs` (frontend) / `app.js` (api), since MyDevil starts only these names. |
| `rollback.sh <app> [--yes]` | Makes the newest entry in `releases/` live again. For the api it also restores the database from the backup taken before the rolled-back release (asks for `TAK`). The frontend rolls back code only. Ends with a health check. |
| `start-all.sh` | Starts both apps after a reboot. |

## Database

PostgreSQL on the server is version 16.10. Migrations use `gen_random_uuid()`, which needs version 13 or newer.

The api deploy is a deliberate step with a short downtime (about 30–60 s), in this order:

1. The new version is installed next to the live one (`npm24 ci`).
2. The live api is stopped. From now on nothing writes to the database.
3. `pg_dump -Fc` writes `~/apps/subtracker/backups/<time>_<sha7>.dump`.
4. `migration:run` from the new release, the whole batch in one transaction.
5. `.deploy-info` (`SHA`, `BACKUP`) is written into the new release, the versions are swapped, the new one starts and must pass the health check on `/health`, which queries the database.

Failure paths:

- **Backup or migration fails**: the old version starts again and the deploy stops. A failed migration batch is rolled back by PostgreSQL, so the database is as it was.
- **Health check fails after the migrations**: the new version is stopped, the database is restored from the backup of step 3, and the previous version starts again. If that restore fails, the deploy fails loudly and the api stays stopped: running old code on a mismatched schema is worse than downtime.
- `public_nodejs_new` (or `releases/<time>_failed`) stays for diagnosis.

Restoring by hand, e.g. when a problem shows up hours after a deploy:

```
~/apps/subtracker/bin/stop-app.sh api
~/apps/subtracker/bin/restore-db.sh ~/apps/subtracker/backups/<time>_<sha7>.dump
~/apps/subtracker/bin/start-app.sh api
```

`rollback.sh api` does this together with the code: it restores the backup listed in the live release's `.deploy-info`, i.e. the database from right before that release was deployed, then makes the previous release live. **Data written since that deploy disappears from the live database.** `restore-db.sh` keeps it in `backups/<time>_pre-restore.dump`, so a mistaken rollback can be undone by restoring that file (stop the api first). A release deployed before the backups existed has no `.deploy-info`, and the rollback refuses to run.

Releases in `releases/` are named `<time>_<sha7>` after the SHA they contain (`.deploy-info`); failed deploys end in `_failed`, rolled-back ones in `_rolledback`. Deploy, rollback and a manual restore of one app take a lock (`~/apps/subtracker/<app>/.ops.lock`), so they never overlap; the frontend and the api can still deploy at the same time. A lock left behind by a killed process is removed with `rmdir`.

Never run `migration:revert` in production: `down()` methods are unreliable. Going back is always a restore from a backup.

**Scheduled jobs.** The api runs its jobs (subscription lifecycle: trials ending, cancellations completing, billing dates moving forward; cleanup of sign-in tokens and sessions older than 7 days) once at every start, before it takes requests, and then daily at 00:05 Europe/Warsaw. None of this needs a manual step: whatever was missed while the api was stopped (a deploy across midnight, a restart by MyDevil, a reboot) is caught up by the next start, and a second run on the same day changes nothing. After a rollback or a manual restore from a dump, the database is back to its state from before the deploy, and the next start of a version that has the jobs repeats the transitions by itself. A release from before the jobs existed does not run them, so after rolling back to it dates stay as restored until a newer version starts. A failed run is only logged (`logs/err.log`) and does not fail the start or the health check.

## Backups and deleted accounts

A user can delete their account in the app (`/account`). The deletion is immediate and final in the live database: the account and all its data are gone. Copies of the database still hold that data until they are deleted, so their age is limited.

- **Dumps live at most 180 days.** `backups/` holds the dumps taken before each api deploy (`<time>_<sha7>.dump`, 10 newest kept), before each restore (`<time>_pre-restore.dump`, 10 newest kept) and the scheduled ones (`<time>_scheduled.dump`, rotated together with the deploy dumps). On top of the count, `prune-backups.sh` deletes every dump older than 180 days. It runs daily from crontab (see [One-time setup](#one-time-setup)), after every api deploy and after every successful restore (which passes the restored dump so it is never deleted).
- **There is always a copy no older than a month.** Before deleting anything, `prune-backups.sh` checks for a dump younger than 30 days. If there is none (e.g. a month without a deploy), it first takes a fresh `<time>_scheduled.dump` and deletes only after that succeeded. Pruning never leaves `backups/` empty.
- **A failed dump deletes nothing.** The script exits 1 and the cron log `~/apps/subtracker/api/logs/prune-backups.log` says `database backup FAILED; nothing deleted` (after a deploy or restore the message is in their output instead; the deploy or restore itself still counts as successful). Fix the cause (usually the database settings in `shared/.env`) and run `~/apps/subtracker/bin/prune-backups.sh` by hand. If a deploy, rollback or restore is running, the cron run does nothing and exits 0; that operation prunes by itself.
- **Rollback of an old release may be refused.** `rollback.sh api` needs the dump listed in the release's `.deploy-info`. Once it is older than 180 days it is gone, and the rollback stops with `backup ... not found; nothing changed`. To recover after a failure, restore the newest dump with `restore-db.sh` (see [Database](#database)).
- **MyDevil's own daily backup** of the account has a retention we do not control. It is outside this rule.
- **A restore or rollback brings back deleted accounts.** Every account deleted after the dump was taken is in the restored database again. After a restore, delete those accounts again (the operator has to know which ones, e.g. from the users' requests).
- **The mail archive is anonymised.** Deleting an account keeps its rows in the `mail` table (type, status, dates) but replaces the address with `zanonimizowano@anonymized.invalid` and clears the error message. Mail goes only to addresses that still have an account.

What the full privacy policy has to say about this (it is written separately, before the public launch):

- deleting the account removes the data from the live database at once;
- database backups keep the data for up to 180 days, then they are deleted; MyDevil's own backup has its own retention;
- after restoring a backup, deletions made since then are repeated;
- the record of sent mail stays without the address.

## Granting the admin role

The `ADMIN` role is granted on the server, once the user has registered. `npm run admin:grant` is for local use only: `prepare-mydevil.mjs` flattens `dist/` into the package root, so the script lives at `cli/admin-grant.js`. Run it from the live release with its env exported, the same way `deploy.sh` runs the migrations:

```
cd ~/apps/subtracker/api/public_nodejs
sh -c 'set -a; . ./.env; set +a; exec /usr/local/bin/node24 cli/admin-grant.js "$1"' sh <mail>
```

Granting the role twice is harmless. An unknown address prints an error and exits with code 1.

## Updating the scripts on the server

The scripts are **not** deployed by GitHub Actions: the workflows only ship app packages, and changes under `deploy/` don't trigger them. After changing any script here, upload it by hand.

1. Locally, from the repo root (PowerShell or Git Bash). List the files explicitly, because PowerShell doesn't expand `*.sh` for `scp`:

   ```
   scp deploy/mydevil/ci-gate.sh deploy/mydevil/deploy.sh deploy/mydevil/restore-db.sh deploy/mydevil/stop-app.sh deploy/mydevil/start-app.sh deploy/mydevil/rollback.sh deploy/mydevil/start-all.sh deploy/mydevil/prune-backups.sh <login>@s<N>.mydevil.net:~/apps/subtracker/bin/
   ```

   You can upload a single changed file the same way, for example only `deploy/mydevil/start-app.sh`.

2. On the server:

   ```
   chmod 700 ~/apps/subtracker/bin/*.sh
   ls -l ~/apps/subtracker/bin
   sha256 ~/apps/subtracker/bin/*.sh
   SSH_ORIGINAL_COMMAND="ls" ~/apps/subtracker/bin/ci-gate.sh
   ```

   Expected result: every script shows `-rwx------`, and the last command prints `ci-gate: rejected command: ls`. The checksums must match the repo: locally run `sha256sum deploy/mydevil/*.sh` (Git Bash) on the commit you uploaded from. Compare **all** scripts, not only the ones you changed: the server copy is updated by hand and can drift. A mismatch usually means CRLF line endings, which `.gitattributes` prevents for `*.sh`, or a forgotten upload.

3. If you changed `start-app.sh`, apply it to the running processes:

   ```
   ~/apps/subtracker/bin/start-app.sh api
   ~/apps/subtracker/bin/start-app.sh frontend
   forever list
   ```

   Changes to `deploy.sh` and `ci-gate.sh` take effect with the next deploy. Changes to `stop-app.sh`, `restore-db.sh`, `rollback.sh`, `start-all.sh` and `prune-backups.sh` take effect the next time they run.

## One-time setup

`authorized_keys` entry for the GitHub Actions key. Use an absolute path:

```
command="/usr/home/<login>/apps/subtracker/bin/ci-gate.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... github-actions-subtracker
```

crontab:

```
@reboot /usr/home/<login>/apps/subtracker/bin/start-all.sh
0 4 * * 0 find /usr/home/<login>/apps/subtracker/*/logs -name '*.log' -size +20M -exec truncate -s 0 {} \;
30 4 * * * /usr/home/<login>/apps/subtracker/bin/prune-backups.sh >> /usr/home/<login>/apps/subtracker/api/logs/prune-backups.log 2>&1
```

The last line deletes database dumps older than 180 days every day, also without deploys (see [Backups and deleted accounts](#backups-and-deleted-accounts)). Run it once by hand after adding it; it should end with `done: <n> dump(s) deleted`.

The scripts expect `forever` on `PATH`. They look in `/usr/local/bin` and `~/.npm-global/bin`. If yours lives elsewhere, adjust the `PATH` line at the top of each script.

Other apps run under `forever` on this account. Stop SubTracker processes with `stop-app.sh <app>` (by uid, with a fallback kill by path), never with `forever stopall`. The scripts need `timeout` and `pkill`, both in FreeBSD's base system.
