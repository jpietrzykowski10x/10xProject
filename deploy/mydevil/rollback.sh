#!/bin/sh
# Restores the newest release from releases/ as the live version.
# The current live version is kept in releases/ with a _rolledback suffix.
# Usage: rollback.sh <frontend|api> [--yes]
#
# For the api the database goes back too: it is restored from the backup taken
# right before the rolled-back release was deployed (BACKUP in its .deploy-info),
# so old code never runs on a newer schema. Data written since that deploy is
# lost, so the script asks for confirmation (type TAK) unless --yes is given.
# The frontend rolls back code only.
set -eu
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.npm-global/bin:$PATH"

APP="$1"
CONFIRM="${2:-}"
BIN="$HOME/apps/subtracker/bin"
BASE="$HOME/apps/subtracker/$APP"
LIVE="$BASE/public_nodejs"
RELEASES="$BASE/releases"

PREV=$(ls -1 "$RELEASES" | grep -v -e '_failed$' -e '_rolledback$' | sort -r | head -n 1)
if [ -z "$PREV" ]; then
  echo "rollback: no previous release in $RELEASES" >&2
  exit 1
fi

if [ "$APP" = api ]; then
  INFO="$LIVE/.deploy-info"
  if [ ! -f "$INFO" ]; then
    echo "rollback: $INFO missing (release from before database backups); nothing changed" >&2
    exit 1
  fi
  LIVE_SHA=$(sed -n 's/^SHA=//p' "$INFO")
  BACKUP=$(sed -n 's/^BACKUP=//p' "$INFO")
  if [ -z "$BACKUP" ] || [ ! -f "$BACKUP" ]; then
    echo "rollback: backup '$BACKUP' not found; nothing changed" >&2
    exit 1
  fi
  # Backup names start with the deploy time: YYYYmmdd-HHMMSS_<sha7>.dump
  BACKUP_TIME=$(basename "$BACKUP" | cut -c1-15)

  echo "rollback: api $LIVE_SHA -> $PREV"
  echo "rollback: database restored from $BACKUP"
  echo "rollback: dane zapisane od $BACKUP_TIME zostaną utracone"
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
mv "$LIVE" "$RELEASES/$(date +%Y%m%d-%H%M%S)_rolledback"
mv "$RELEASES/$PREV" "$LIVE"
"$BIN/start-app.sh" "$APP"
echo "rollback: $APP now runs $PREV"
