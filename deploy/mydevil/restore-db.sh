#!/bin/sh
# Restores the api database from a pg_dump -Fc backup made by deploy.sh.
# Usage: restore-db.sh <file.dump>
#
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
. "$ENV_FILE"
set +a
export PGHOST="$POSTGRES_HOST" PGPORT="${POSTGRES_PORT:-5432}" PGUSER="$POSTGRES_USER"
export PGPASSWORD="$POSTGRES_PASSWORD"

# The dump holds user data and the server is shared: keep the SQL copy private.
umask 077
SQL=$(mktemp)
trap 'rm -f "$SQL"' EXIT

pg_restore --no-owner -f "$SQL" "$DUMP"

# -o /dev/null drops query results echoed from the dump (e.g. set_config) and
# client_min_messages hides the "drop cascades" notices; errors still go to stderr.
psql -X -q -o /dev/null -v ON_ERROR_STOP=1 --single-transaction -d "$POSTGRES_DATABASE" \
  -c 'SET client_min_messages TO warning; DROP SCHEMA public CASCADE; CREATE SCHEMA public;' \
  -f "$SQL"

echo "restore-db: $POSTGRES_DATABASE restored from $DUMP"
