#!/bin/sh
# Restores the newest release from releases/ as the live version.
# The current live version is kept in releases/ with a _rolledback suffix.
# Usage: rollback.sh <frontend|api> [--yes]
#
# For the api the database goes back too: it is restored from the backup taken
# right before the rolled-back release was deployed (BACKUP in its .deploy-info),
# so old code never runs on a newer schema. Data written since that deploy is
# dropped from the live database (restore-db.sh keeps a pre-restore dump), so
# the script asks for confirmation (type TAK) unless --yes is given.
# The frontend rolls back code only. Ends with a health check.
set -eu
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.npm-global/bin:$PATH"

APP="$1"
CONFIRM="${2:-}"
case "$APP" in
  api) HEALTH_PATH=/health ;;
  frontend) HEALTH_PATH=/ ;;
  *)
    echo "rollback: unknown app '$APP'" >&2
    exit 1
    ;;
esac
BIN="$HOME/apps/subtracker/bin"
BASE="$HOME/apps/subtracker/$APP"
LIVE="$BASE/public_nodejs"
RELEASES="$BASE/releases"

# Same per-app lock as deploy.sh; restore-db.sh sees SUBTRACKER_LOCKED.
LOCK="$BASE/.ops.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "rollback: another deploy, rollback or restore of $APP is running ($LOCK exists; rmdir it if stale)" >&2
  exit 1
fi
trap 'rmdir "$LOCK"' EXIT
trap 'exit 1' INT TERM HUP
export SUBTRACKER_LOCKED=1

health_check() {
  port=$(sed -n 's/^PORT=//p' "$LIVE/.env" | tr -d '"\r')
  for _ in 1 2 3 4 5; do
    sleep 3
    if curl -fsS -o /dev/null --max-time 5 "http://localhost:$port$HEALTH_PATH"; then
      return 0
    fi
  done
  return 1
}

# names are written by these scripts (timestamp_sha)
# shellcheck disable=SC2010
PREV=$(ls -1 "$RELEASES" | grep -v -e '_failed$' -e '_rolledback$' | sort -r | head -n 1)
if [ -z "$PREV" ]; then
  echo "rollback: no previous release in $RELEASES" >&2
  exit 1
fi

LIVE_SHA=$(sed -n 's/^SHA=//p' "$LIVE/.deploy-info" 2>/dev/null || true)

if [ "$APP" = api ]; then
  INFO="$LIVE/.deploy-info"
  if [ ! -f "$INFO" ]; then
    echo "rollback: $INFO missing (release from before database backups); nothing changed" >&2
    exit 1
  fi
  BACKUP=$(sed -n 's/^BACKUP=//p' "$INFO")
  if [ -z "$BACKUP" ] || [ ! -f "$BACKUP" ]; then
    echo "rollback: backup '$BACKUP' not found; nothing changed" >&2
    exit 1
  fi
  # Backup names start with the deploy time: YYYYmmdd-HHMMSS_<sha7>.dump
  BACKUP_TIME=$(basename "$BACKUP" | cut -c1-15)

  echo "rollback: api $LIVE_SHA -> $PREV"
  echo "rollback: database will be restored from $BACKUP"
  echo "rollback: dane zapisane od $BACKUP_TIME znikną z bazy (restore-db.sh zachowa kopię obecnego stanu)"
  if [ "$CONFIRM" != "--yes" ]; then
    printf 'Wpisz TAK, aby kontynuować: '
    read -r answer
    if [ "$answer" != "TAK" ]; then
      echo "rollback: aborted; nothing changed"
      exit 1
    fi
  fi

  "$BIN/stop-app.sh" "$APP"
  if ! "$BIN/restore-db.sh" "$BACKUP"; then
    echo "rollback: DATABASE RESTORE FAILED; code unchanged, api left stopped" >&2
    exit 1
  fi
fi

"$BIN/stop-app.sh" "$APP"
SHORT_LIVE_SHA=$(echo "$LIVE_SHA" | cut -c1-7)
mv "$LIVE" "$RELEASES/$(date +%Y%m%d-%H%M%S)_${SHORT_LIVE_SHA:-live}_rolledback"
mv "$RELEASES/$PREV" "$LIVE"
"$BIN/start-app.sh" "$APP"

if ! health_check; then
  echo "rollback: $APP now runs $PREV, but it does NOT answer on $HEALTH_PATH; check $BASE/logs/err.log" >&2
  exit 1
fi
echo "rollback: $APP now runs $PREV (health-check OK on $HEALTH_PATH)"
