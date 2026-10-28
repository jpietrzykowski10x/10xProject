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
                             <YYYYmmdd-HHMMSS>_<sha7>.dump (-rw-------), 10 newest kept
```

`shared/.env` of the api also holds the database and CORS settings (template: `backend-subtracker/.env.example`, local copy `.env.mydevil`):

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
```

The scripts source this file with `sh`, so quote values that contain spaces.

Domains are MyDevil proxy domains, and TLS terminates on MyDevil:

- `subtracker.jakubpietrzykowski.pl` → `localhost:<PORT_FE>`
- `apisubtracker.jakubpietrzykowski.pl` → `localhost:<PORT_API>`

## Scripts

| Script | Purpose |
|---|---|
| `ci-gate.sh` | Forced command for the CI key. It accepts only `deploy <frontend\|api> <sha>`. |
| `deploy.sh <app> <sha>` | Unpacks the tarball from stdin into `public_nodejs_new`, runs `npm24 ci --omit=dev`, swaps it in with `mv`, and runs a health check (`/health` for the api, `/` for the frontend). For the api it first stops the live version, backs up the database and runs migrations (see [Database](#database)). If the health check fails, it restores the previous version automatically. |
| `restore-db.sh <file.dump>` | Restores the api database from a backup: drops and recreates the `public` schema and restores the dump, in one transaction. Does not stop or start the api. |
| `stop-app.sh <app>` | Stops the app: `forever stop` capped at 30 s, then the forever monitor and the app are killed by their path. `forever stop` can hang for good while the app is crash-looping. Every other script stops apps through it. |
| `start-app.sh <app>` | Restarts the app under `forever` on `/usr/local/bin/node24`, using the env from `.env`. Entry: `app.mjs` (frontend) / `app.js` (api), since MyDevil starts only these names. |
| `rollback.sh <app> [--yes]` | Makes the newest entry in `releases/` live again. For the api it also restores the database from the backup taken before the rolled-back release (asks for `TAK`). The frontend rolls back code only. |
| `start-all.sh` | Starts both apps after a reboot. |

## Database

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

`rollback.sh api` does this together with the code: it restores the backup listed in the live release's `.deploy-info`, i.e. the database from right before that release was deployed, then makes the previous release live. **Data written since that deploy is lost.** A release deployed before the backups existed has no `.deploy-info`, and the rollback refuses to run.

Never run `migration:revert` in production: `down()` methods are unreliable. Going back is always a restore from a backup.

## Updating the scripts on the server

The scripts are **not** deployed by GitHub Actions: the workflows only ship app packages, and changes under `deploy/` don't trigger them. After changing any script here, upload it by hand.

1. Locally, from the repo root (PowerShell or Git Bash). List the files explicitly, because PowerShell doesn't expand `*.sh` for `scp`:

   ```
   scp deploy/mydevil/ci-gate.sh deploy/mydevil/deploy.sh deploy/mydevil/restore-db.sh deploy/mydevil/stop-app.sh deploy/mydevil/start-app.sh deploy/mydevil/rollback.sh deploy/mydevil/start-all.sh <login>@s<N>.mydevil.net:~/apps/subtracker/bin/
   ```

   You can upload a single changed file the same way, for example only `deploy/mydevil/start-app.sh`.

2. On the server:

   ```
   chmod 700 ~/apps/subtracker/bin/*.sh
   ls -l ~/apps/subtracker/bin
   SSH_ORIGINAL_COMMAND="ls" ~/apps/subtracker/bin/ci-gate.sh
   ```

   Expected result: every script shows `-rwx------`, and the last command prints `ci-gate: rejected command: ls`. Sizes must match the local files (`wc -c deploy/mydevil/*.sh`). A mismatch usually means CRLF line endings, which `.gitattributes` prevents for `*.sh`.

3. If you changed `start-app.sh`, apply it to the running processes:

   ```
   ~/apps/subtracker/bin/start-app.sh api
   ~/apps/subtracker/bin/start-app.sh frontend
   forever list
   ```

   Changes to `deploy.sh` and `ci-gate.sh` take effect with the next deploy. Changes to `stop-app.sh`, `restore-db.sh`, `rollback.sh` and `start-all.sh` take effect the next time they run.

## One-time setup

`authorized_keys` entry for the GitHub Actions key. Use an absolute path:

```
command="/usr/home/<login>/apps/subtracker/bin/ci-gate.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... github-actions-subtracker
```

crontab:

```
@reboot /usr/home/<login>/apps/subtracker/bin/start-all.sh
0 4 * * 0 find /usr/home/<login>/apps/subtracker/*/logs -name '*.log' -size +20M -exec truncate -s 0 {} \;
```

The scripts expect `forever` on `PATH`. They look in `/usr/local/bin` and `~/.npm-global/bin`. If yours lives elsewhere, adjust the `PATH` line at the top of each script.

Other apps run under `forever` on this account. Stop SubTracker processes with `stop-app.sh <app>` (by uid, with a fallback kill by path), never with `forever stopall`. The scripts need `timeout` and `pkill`, both in FreeBSD's base system.
