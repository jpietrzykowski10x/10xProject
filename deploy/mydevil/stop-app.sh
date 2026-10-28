#!/bin/sh
# Stops one app under forever. Usage: stop-app.sh <frontend|api>
#
# `forever stop` can hang indefinitely while the app is crash-looping (between
# restarts, waiting out --spinSleepTime); that once froze a deploy for hours.
# It gets 30 s. After that the forever monitor and the app are killed by their
# script path, which matches only this SubTracker app (not public_nodejs_new,
# not the other forever apps on the account).
set -eu
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.npm-global/bin:$PATH"

APP="$1"
case "$APP" in
  frontend | api) ;;
  *)
    echo "stop-app: unknown app '$APP'" >&2
    exit 1
    ;;
esac

# Non-zero also when the app is not running; then pkill simply finds nothing.
if ! timeout 30 forever stop "subtracker-$APP" >/dev/null 2>&1; then
  pkill -f "apps/subtracker/$APP/public_nodejs/" || true
fi
