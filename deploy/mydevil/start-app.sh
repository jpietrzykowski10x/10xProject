#!/bin/sh
# (Re)starts one app under forever on Node 24, with env from public_nodejs/.env.
# Usage: start-app.sh <frontend|api>
set -eu
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.npm-global/bin:$PATH"

APP="$1"
BASE="$HOME/apps/subtracker/$APP"
LIVE="$BASE/public_nodejs"

case "$APP" in
  frontend) ENTRY="app.mjs" ;;
  api) ENTRY="app.js" ;;
  *)
    echo "start-app: unknown app '$APP'" >&2
    exit 1
    ;;
esac

forever stop "subtracker-$APP" >/dev/null 2>&1 || true

set -a
. "$LIVE/.env"
set +a

# On MyDevil /home is a symlink to /usr/home. Node resolves symlinks for the
# entry module, so Angular's isMainModule() only matches (and the SSR server
# only calls listen()) when the script path is passed in its resolved form.
LIVE_REAL=$(realpath "$LIVE")

cd "$LIVE_REAL"
forever start \
  --uid "subtracker-$APP" \
  -c /usr/local/bin/node24 \
  --minUptime 5000 \
  --spinSleepTime 10000 \
  --workingDir "$LIVE_REAL" \
  -a \
  -l "$BASE/logs/forever.log" \
  -o "$BASE/logs/out.log" \
  -e "$BASE/logs/err.log" \
  "$LIVE_REAL/$ENTRY"
