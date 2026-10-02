#!/bin/sh
# Restores the newest release from releases/ as the live version.
# The current live version is kept in releases/ with a _rolledback suffix.
# Usage: rollback.sh <frontend|api>
# Note: this rolls back code only, never the database.
set -eu
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/bin:$HOME/.npm-global/bin:$PATH"

APP="$1"
BASE="$HOME/apps/subtracker-$APP"
LIVE="$BASE/public_nodejs"
RELEASES="$BASE/releases"

PREV=$(ls -1 "$RELEASES" | grep -v -e '_failed$' -e '_rolledback$' | sort -r | head -n 1)
if [ -z "$PREV" ]; then
  echo "rollback: no previous release in $RELEASES" >&2
  exit 1
fi

forever stop "subtracker-$APP" >/dev/null 2>&1 || true
mv "$LIVE" "$RELEASES/$(date +%Y%m%d-%H%M%S)_rolledback"
mv "$RELEASES/$PREV" "$LIVE"
"$HOME/bin/start-app.sh" "$APP"
echo "rollback: $APP now runs $PREV"
