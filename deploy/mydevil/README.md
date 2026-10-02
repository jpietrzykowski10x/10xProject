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
```

Domains are MyDevil proxy domains, and TLS terminates on MyDevil:

- `subtracker.jakubpietrzykowski.pl` → `localhost:<PORT_FE>`
- `apisubtracker.jakubpietrzykowski.pl` → `localhost:<PORT_API>`

## Scripts

| Script | Purpose |
|---|---|
| `ci-gate.sh` | Forced command for the CI key. It accepts only `deploy <frontend\|api> <sha>`. |
| `deploy.sh <app> <sha>` | Unpacks the tarball from stdin into `public_nodejs_new`, runs `npm24 ci --omit=dev`, swaps it in with `mv`, and runs a health check. If the health check fails, it restores the previous version automatically. |
| `start-app.sh <app>` | Restarts the app under `forever` on `/usr/local/bin/node24`, using the env from `.env`. Entry: `app.mjs` (frontend) / `app.js` (api), since MyDevil starts only these names. |
| `rollback.sh <app>` | Makes the newest entry in `releases/` live again. Rolls back code only, not the database. |
| `start-all.sh` | Starts both apps after a reboot. |

## Updating the scripts on the server

The scripts are **not** deployed by GitHub Actions: the workflows only ship app packages, and changes under `deploy/` don't trigger them. After changing any script here, upload it by hand.

1. Locally, from the repo root (PowerShell or Git Bash). List the files explicitly, because PowerShell doesn't expand `*.sh` for `scp`:

   ```
   scp deploy/mydevil/ci-gate.sh deploy/mydevil/deploy.sh deploy/mydevil/start-app.sh deploy/mydevil/rollback.sh deploy/mydevil/start-all.sh <login>@s<N>.mydevil.net:~/apps/subtracker/bin/
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

   Changes to `deploy.sh` and `ci-gate.sh` take effect with the next deploy. Changes to `rollback.sh` and `start-all.sh` take effect the next time they run.

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

Other apps run under `forever` on this account. Stop SubTracker processes by uid (`forever stop subtracker-frontend`), never with `forever stopall`.
