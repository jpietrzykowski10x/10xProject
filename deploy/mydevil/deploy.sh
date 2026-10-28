#!/bin/sh
# Deploys one app from a .mydevil tarball read on stdin.
#
#   tar czf - -C .mydevil . | ssh mydevil "deploy <frontend|api> <sha>"
#
# The new version is installed in public_nodejs_new while the live one keeps
# running. For the frontend only the final swap (two mv) causes a few seconds
# of downtime. For the api the downtime also covers the database backup, the
# migrations and the health check: the old version is stopped first, so nothing
# writes to the database between pg_dump and a possible restore.
# If the health check fails, the previous version is restored automatically
# (for the api together with the database backup taken by this deploy).
set -eu
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.npm-global/bin:$PATH"

APP="$1"
SHA="$2"
BIN="$HOME/apps/subtracker/bin"
BASE="$HOME/apps/subtracker/$APP"
LIVE="$BASE/public_nodejs"
NEW="$BASE/public_nodejs_new"
RELEASES="$BASE/releases"
BACKUPS="$HOME/apps/subtracker/backups"
NPM=/usr/local/bin/npm24
NODE=/usr/local/bin/node24
KEEP=3
KEEP_BACKUPS=10

STAMP=$(date +%Y%m%d-%H%M%S)
SHORT_SHA=$(echo "$SHA" | cut -c1-7)
RELEASE="$RELEASES/${STAMP}_$SHORT_SHA"

log() { echo "[deploy $APP] $*"; }

case "$APP" in
  api) HEALTH_PATH=/health ;;
  frontend) HEALTH_PATH=/ ;;
  *)
    echo "deploy: unknown app '$APP'" >&2
    exit 1
    ;;
esac

# One deploy/rollback/restore per app at a time (the frontend and the api may
# deploy in parallel). restore-db.sh sees SUBTRACKER_LOCKED and does not re-lock.
LOCK="$BASE/.ops.lock"
mkdir -p "$BASE"
if ! mkdir "$LOCK" 2>/dev/null; then
  log "another deploy, rollback or restore of $APP is running ($LOCK exists; rmdir it if stale)"
  exit 1
fi
trap 'rmdir "$LOCK"' EXIT
trap 'exit 1' INT TERM HUP
export SUBTRACKER_LOCKED=1

health_check() {
  port=$(sed -n 's/^PORT=//p' "$LIVE/.env" | tr -d '"\r')
  for attempt in 1 2 3 4 5; do
    sleep 3
    if curl -fsS -o /dev/null --max-time 5 "http://localhost:$port$HEALTH_PATH"; then
      log "health-check OK on $HEALTH_PATH (attempt $attempt, port $port)"
      return 0
    fi
  done
  log "health-check FAILED on $HEALTH_PATH, port $port"
  return 1
}

# Brings the old version back after a failed database step (it was stopped, not moved).
start_old_and_fail() {
  if [ "$had_live" -eq 1 ]; then
    log "starting the previous version again"
    "$BIN/start-app.sh" "$APP"
  fi
  log "deploy aborted; $NEW kept for diagnosis"
  exit 1
}

[ -f "$BASE/shared/.env" ] || { log "missing $BASE/shared/.env"; exit 1; }

log "unpacking $SHA into $NEW"
rm -rf "$NEW"
mkdir -p "$NEW" "$RELEASES" "$BASE/logs"
tar xzf - -C "$NEW"
cp "$BASE/shared/.env" "$NEW/.env"

log "installing production dependencies"
(cd "$NEW" && "$NPM" ci --omit=dev --no-audit --no-fund)

had_live=0
[ -d "$LIVE" ] && had_live=1

# File the outgoing release under its own SHA (from its .deploy-info; "prev" for
# releases from before .deploy-info existed), so each releases/ name matches its
# content. A failed new version is parked under the new SHA.
if [ "$had_live" -eq 1 ]; then
  OLD_SHA=$(sed -n 's/^SHA=//p' "$LIVE/.deploy-info" 2>/dev/null | cut -c1-7)
  RELEASE="$RELEASES/${STAMP}_${OLD_SHA:-prev}"
fi
FAILED="$RELEASES/${STAMP}_${SHORT_SHA}_failed"

BACKUP=""
if [ "$APP" = api ]; then
  if [ "$had_live" -eq 1 ]; then
    log "stopping the live version (downtime starts)"
    if ! "$BIN/stop-app.sh" "$APP"; then
      log "could not stop the live version; nothing changed (database untouched)"
      log "deploy aborted; $NEW kept for diagnosis"
      exit 1
    fi
  fi

  mkdir -p "$BACKUPS"
  chmod 700 "$BACKUPS"
  BACKUP="$BACKUPS/${STAMP}_$SHORT_SHA.dump"
  log "backing up the database to $BACKUP"
  # Subshell: the env of the new release stays local; the password goes through
  # PGPASSWORD, never on the command line; umask 077 makes the dump -rw-------.
  if ! (
    set -a
    . "$NEW/.env"
    set +a
    umask 077
    PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -Fc \
      -h "$POSTGRES_HOST" -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER" \
      -f "$BACKUP" "$POSTGRES_DATABASE"
  ); then
    rm -f "$BACKUP"
    log "database backup FAILED"
    start_old_and_fail
  fi

  log "running migrations"
  # One transaction for the whole batch (migrationsTransactionMode: 'all'): a failed
  # migration leaves the database exactly as backed up.
  if ! (
    cd "$NEW"
    set -a
    . ./.env
    set +a
    "$NODE" node_modules/typeorm/cli.js migration:run -d database/data-source.js
  ); then
    log "migrations FAILED; the database was rolled back by the transaction (backup: $BACKUP)"
    start_old_and_fail
  fi

fi

# Every release records its SHA (used to name it in releases/ later); for the
# api, rollback.sh also reads BACKUP to restore the database with the code.
printf 'SHA=%s\nBACKUP=%s\n' "$SHA" "$BACKUP" > "$NEW/.deploy-info"

# Runs after the migrations committed, so a failure here must take the same
# recovery path as a failed health check. Explicit returns: `set -e` does not
# apply inside a function called from an `if` condition.
swap_and_start() {
  if [ "$had_live" -eq 1 ]; then
    "$BIN/stop-app.sh" "$APP" || return 1
    mv "$LIVE" "$RELEASE" || return 1
  fi
  mv "$NEW" "$LIVE" || return 1
  "$BIN/start-app.sh" "$APP" || return 1
}

if ! swap_and_start; then
  log "swap or start FAILED"
  deploy_ok=0
elif ! health_check; then
  deploy_ok=0
else
  deploy_ok=1
fi

if [ "$deploy_ok" -eq 0 ]; then
  if [ -n "$BACKUP" ]; then
    "$BIN/stop-app.sh" "$APP"
    log "restoring the database from $BACKUP"
    if ! "$BIN/restore-db.sh" "$BACKUP"; then
      log "DATABASE RESTORE FAILED. The api stays stopped: running on a mismatched schema"
      log "is worse than downtime. Restore by hand: $BIN/restore-db.sh $BACKUP"
      [ "$had_live" -eq 1 ] && log "then: mv $LIVE $FAILED && mv $RELEASE $LIVE && $BIN/start-app.sh $APP"
      exit 1
    fi
  fi
  if [ "$had_live" -eq 1 ]; then
    log "restoring previous version"
    "$BIN/stop-app.sh" "$APP"
    # The swap may have stopped half-way: move only what is actually there.
    if [ -d "$RELEASE" ]; then
      [ -d "$LIVE" ] && mv "$LIVE" "$FAILED"
      mv "$RELEASE" "$LIVE"
    fi
    "$BIN/start-app.sh" "$APP"
  else
    # First deploy: nothing to go back to. Park the failed build, so the next
    # deploy does not file it as a normal release that rollback.sh could pick.
    "$BIN/stop-app.sh" "$APP"
    [ -d "$LIVE" ] && mv "$LIVE" "$FAILED"
  fi
  log "check $BASE/logs/err.log"
  exit 1
fi

# Keep the newest $KEEP releases (names start with a timestamp).
ls -1 "$RELEASES" | sort -r | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -rf "${RELEASES:?}/$old"
done

# Keep the newest $KEEP_BACKUPS deploy dumps: more than $KEEP releases, so every
# release in releases/ still has the backup taken right before it.
# restore-db.sh rotates its own *_pre-restore.dump files.
if [ -d "$BACKUPS" ]; then
  # names are written by these scripts (timestamp_sha)
  # shellcheck disable=SC2010
  ls -1 "$BACKUPS" | grep '\.dump$' | grep -v '_pre-restore\.dump$' | sort -r | tail -n +$((KEEP_BACKUPS + 1)) | while read -r old; do
    rm -f "${BACKUPS:?}/$old"
  done
fi

log "deployed $SHA"
