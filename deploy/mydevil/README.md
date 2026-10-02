# MyDevil deploy scripts

Server-side scripts for deploying SubTracker to MyDevil. Copy them to `~/bin` on the server (`chmod 700 ~/bin/*.sh`). They are not installed automatically: after changing them here, copy them again.

## Server layout

```
~/apps/subtracker-frontend/          ~/apps/subtracker-api/
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

## One-time setup

`authorized_keys` entry for the GitHub Actions key. Use an absolute path:

```
command="/usr/home/<login>/bin/ci-gate.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... github-actions-subtracker
```

crontab:

```
@reboot /usr/home/<login>/bin/start-all.sh
0 4 * * 0 find /usr/home/<login>/apps/*/logs -name '*.log' -size +20M -exec truncate -s 0 {} \;
```

The scripts expect `forever` on `PATH`. They look in `/usr/local/bin`, `~/bin` and `~/.npm-global/bin`. If yours lives elsewhere, adjust the `PATH` line at the top of each script.
