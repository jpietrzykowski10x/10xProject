#!/bin/sh
# Deletes api database dumps older than 180 days from backups/, so a copy holding
# the data of a deleted account does not live longer than half a year.
# Usage: prune-backups.sh [file-to-keep]
#
# Never leaves backups/ without a copy: when no dump is younger than 30 days
# (e.g. a month without a deploy), it first takes a fresh one,
# backups/<time>_scheduled.dump, and deletes only after that dump succeeded.
# A failed dump deletes nothing and exits 1. The file given as the argument is
# never deleted (restore-db.sh passes the dump it has just restored).
#
# Runs daily from crontab and after every api deploy (deploy.sh) and restore
# (restore-db.sh). Run on its own, it takes the api lock shared with deploy.sh,
# rollback.sh and restore-db.sh; a busy lock means one of them is running and
# will prune by itself, so it exits 0 without changes. Called by them
# (SUBTRACKER_LOCKED=1), the caller already holds the lock.
#
# SUBTRACKER_BACKUPS and SUBTRACKER_ENV_FILE override the server paths; they
# exist only for a local trial run.
set -eu
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.npm-global/bin:$PATH"

KEEP_FILE="${1:-}"
BACKUPS="${SUBTRACKER_BACKUPS:-$HOME/apps/subtracker/backups}"
ENV_FILE="${SUBTRACKER_ENV_FILE:-$HOME/apps/subtracker/api/shared/.env}"
BACKUP_MAX_AGE_DAYS=180
FRESH_DUMP_DAYS=30

log() { echo "[prune-backups $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

LOCK=""
FRESH=""
cleanup() {
  # Only set while pg_dump runs: a dump cut short is not a backup.
  [ -z "$FRESH" ] || rm -f "$FRESH"
  [ -z "$LOCK" ] || rmdir "$LOCK"
}
trap cleanup EXIT
trap 'exit 1' INT TERM HUP

if [ "${SUBTRACKER_LOCKED:-}" != 1 ]; then
  if ! mkdir "$HOME/apps/subtracker/api/.ops.lock" 2>/dev/null; then
    if [ -d "$HOME/apps/subtracker/api/.ops.lock" ]; then
      log "a deploy, rollback or restore of the api is running; it prunes by itself, nothing changed"
      exit 0
    fi
    log "cannot create the lock $HOME/apps/subtracker/api/.ops.lock; nothing changed"
    exit 1
  fi
  LOCK="$HOME/apps/subtracker/api/.ops.lock"
fi

# Dumps hold user data and the server is shared: keep every copy private.
umask 077
mkdir -p "$BACKUPS"
chmod 700 "$BACKUPS"

RECENT=$(find "$BACKUPS" -maxdepth 1 -type f -name '*.dump' -mtime -"$FRESH_DUMP_DAYS" | head -n 1)
if [ -z "$RECENT" ]; then
  if [ ! -f "$ENV_FILE" ]; then
    log "missing $ENV_FILE; no fresh dump, nothing deleted"
    exit 1
  fi
  FRESH="$BACKUPS/$(date +%Y%m%d-%H%M%S)_scheduled.dump"
  log "no dump younger than $FRESH_DUMP_DAYS days; backing up the database to $FRESH"
  # Subshell: the env stays local; the password goes through PGPASSWORD, never
  # on the command line.
  if ! (
    set -a
    # server-side .env, not in the repo
    # shellcheck source=/dev/null
    . "$ENV_FILE"
    set +a
    PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -Fc \
      -h "$POSTGRES_HOST" -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER" \
      -f "$FRESH" "$POSTGRES_DATABASE"
  ); then
    log "database backup FAILED; nothing deleted"
    exit 1
  fi
  FRESH=""
fi

# Names are written by these scripts (timestamp_sha, timestamp_pre-restore,
# timestamp_scheduled): no spaces or wildcards, so word splitting is safe.
removed=0
for old in $(find "$BACKUPS" -maxdepth 1 -type f -name '*.dump' -mtime +"$BACKUP_MAX_AGE_DAYS"); do
  if [ -n "$KEEP_FILE" ] && { [ "$old" = "$KEEP_FILE" ] || [ "$old" -ef "$KEEP_FILE" ]; }; then
    log "keeping $old (given as the file to keep)"
    continue
  fi
  rm -f "$old"
  log "deleted $old (older than $BACKUP_MAX_AGE_DAYS days)"
  removed=$((removed + 1))
done
log "done: $removed dump(s) deleted"
