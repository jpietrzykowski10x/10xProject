#!/bin/sh
# Restores the api database from a pg_dump -Fc backup made by deploy.sh.
# Usage: restore-db.sh <file.dump>
#
# First dumps the current state to backups/<time>_pre-restore.dump (10 kept),
# so the restore itself can be undone: restore-db.sh <that file>.
# Drops and recreates the public schema first, so tables added by a later
# migration do not survive (pg_restore --clean only drops objects in the dump).
# The drop and the restore run in one transaction: on any error nothing changes.
# It does not stop or start the api; the caller does (deploy.sh, rollback.sh,
# or by hand: forever stop subtracker-api, restore, start-app.sh api).
set -eu
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.npm-global/bin:$PATH"

DUMP="${1:-}"
ENV_FILE="$HOME/apps/subtracker/api/shared/.env"

if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "usage: restore-db.sh <file.dump> (file not found: '${DUMP}')" >&2
  exit 1
fi

set -a
# server-side .env, not in the repo
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a
export PGHOST="$POSTGRES_HOST" PGPORT="${POSTGRES_PORT:-5432}" PGUSER="$POSTGRES_USER"
export PGPASSWORD="$POSTGRES_PASSWORD"

BACKUPS="$HOME/apps/subtracker/backups"
KEEP_PRE_RESTORE=10

# Dumps hold user data and the server is shared: keep every copy private, and
# keep the temporary SQL in backups/ (drwx------) rather than the shared /tmp.
umask 077
mkdir -p "$BACKUPS"
chmod 700 "$BACKUPS"

# Run by hand, take the api lock shared with deploy.sh and rollback.sh; called
# by them (SUBTRACKER_LOCKED=1), the caller already holds it.
LOCK=""
if [ "${SUBTRACKER_LOCKED:-}" != 1 ]; then
  LOCK="$HOME/apps/subtracker/api/.ops.lock"
  if ! mkdir "$LOCK" 2>/dev/null; then
    echo "restore-db: a deploy, rollback or restore of the api is running ($LOCK exists; rmdir it if stale)" >&2
    exit 1
  fi
fi

SQL=$(mktemp "$BACKUPS/restore.XXXXXX")
trap 'rm -f "$SQL"; [ -z "$LOCK" ] || rmdir "$LOCK"' EXIT
trap 'exit 1' INT TERM HUP

# A restore discards everything written since $DUMP was taken. Keep the current
# state first, so a mistaken rollback can be undone with this same script.
PRE_RESTORE="$BACKUPS/$(date +%Y%m%d-%H%M%S)_pre-restore.dump"
if ! pg_dump -Fc -f "$PRE_RESTORE" "$POSTGRES_DATABASE"; then
  rm -f "$PRE_RESTORE"
  echo "restore-db: backup of the current state FAILED; nothing restored" >&2
  exit 1
fi
echo "restore-db: current state saved to $PRE_RESTORE"

# names are written by these scripts (timestamp_sha)
# shellcheck disable=SC2010
ls -1 "$BACKUPS" | grep '_pre-restore\.dump$' | sort -r | tail -n +$((KEEP_PRE_RESTORE + 1)) | while read -r old; do
  rm -f "${BACKUPS:?}/$old"
done

pg_restore --no-owner -f "$SQL" "$DUMP"

# -o /dev/null drops query results echoed from the dump (e.g. set_config) and
# client_min_messages hides the "drop cascades" notices; errors still go to stderr.
psql -X -q -o /dev/null -v ON_ERROR_STOP=1 --single-transaction -d "$POSTGRES_DATABASE" \
  -c 'SET client_min_messages TO warning; DROP SCHEMA public CASCADE; CREATE SCHEMA public;' \
  -f "$SQL"

echo "restore-db: $POSTGRES_DATABASE restored from $DUMP"
