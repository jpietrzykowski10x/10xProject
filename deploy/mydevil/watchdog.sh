#!/bin/sh
# Checks the api (/health, including the state of the scheduled jobs) and the
# frontend (/) on localhost and mails the operator when one of them stays down:
# after 3 consecutive failed checks, then every 12 h while it lasts, and once
# when it is back. The policy and the mails live in the api package
# (cli/watchdog.js, src/watchdog/); this script only prepares its environment.
# Usage: watchdog.sh   (from crontab every 5 minutes)
#
# Silent while a deploy, rollback or restore holds the api or frontend lock
# (.ops.lock) younger than 30 minutes: the downtime is expected. An older lock
# is left by a killed process; it no longer silences the watchdog and is logged
# on every run until removed (rmdir).
#
# The state (failure counts, time of the last mail) is kept outside the
# releases, in ~/apps/subtracker/watchdog/, so a deploy does not reset it.
#
# SUBTRACKER_APPS (default ~/apps/subtracker) and SUBTRACKER_NODE (default
# /usr/local/bin/node24) override the server paths; they exist only for a local
# trial run.
set -eu
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.npm-global/bin:$PATH"

APPS="${SUBTRACKER_APPS:-$HOME/apps/subtracker}"
NODE="${SUBTRACKER_NODE:-/usr/local/bin/node24}"
API_LIVE="$APPS/api/public_nodejs"
FRONTEND_ENV="$APPS/frontend/public_nodejs/.env"
STATE_DIR="$APPS/watchdog"
LOCK_MAX_AGE_MINUTES=30

log() { echo "[watchdog $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

for app in api frontend; do
  lock="$APPS/$app/.ops.lock"
  [ -d "$lock" ] || continue
  if [ -n "$(find "$lock" -maxdepth 0 -mmin -"$LOCK_MAX_AGE_MINUTES")" ]; then
    log "a deploy, rollback or restore of $app is running ($lock); check skipped"
    exit 0
  fi
  log "$lock is older than $LOCK_MAX_AGE_MINUTES minutes (left by a killed process?); checking anyway, rmdir it if nothing runs"
done

# PORT only, read as text: the frontend's .env belongs to the other app and is
# never executed here.
port_of() {
  sed -n 's/^PORT=//p' "$1" | tail -n 1 | tr -d '"\r'
}

if [ ! -f "$API_LIVE/.env" ]; then
  log "missing $API_LIVE/.env; cannot run"
  exit 1
fi
if [ ! -f "$FRONTEND_ENV" ]; then
  log "missing $FRONTEND_ENV; cannot run"
  exit 1
fi
API_PORT=$(port_of "$API_LIVE/.env")
FRONTEND_PORT=$(port_of "$FRONTEND_ENV")
if [ -z "$API_PORT" ] || [ -z "$FRONTEND_PORT" ]; then
  log "no PORT in $API_LIVE/.env or $FRONTEND_ENV; cannot run"
  exit 1
fi

# The state names no user, but the server is shared: keep it private.
umask 077
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

# One run at a time: a hanging SMTP can make a run outlast the 5-minute cron
# step, and two runs on the same state.json would send the same alert twice.
RUN_LOCK="$STATE_DIR/.run.lock"
if ! mkdir "$RUN_LOCK" 2>/dev/null; then
  log "the previous watchdog run is still going; skipped"
  exit 0
fi
trap 'rmdir "$RUN_LOCK"' EXIT
trap 'exit 1' INT TERM HUP

# Subshell: the api env stays local. Run from the live release, like the
# migrations in deploy.sh; the exit code is the watchdog's own (1 = bad env).
(
  cd "$API_LIVE"
  set -a
  # server-side .env, not in the repo
  # shellcheck source=/dev/null
  . ./.env
  set +a
  export WATCHDOG_API_PORT="$API_PORT"
  export WATCHDOG_FRONTEND_PORT="$FRONTEND_PORT"
  export WATCHDOG_STATE_FILE="$STATE_DIR/state.json"
  exec "$NODE" cli/watchdog.js
)
