#!/bin/sh
# Stops one app under forever. Usage: stop-app.sh <frontend|api>
#
# `forever stop` can hang indefinitely while the app is crash-looping (between
# restarts, waiting out --spinSleepTime); that once froze a deploy for hours.
# It gets 30 s. After that the forever monitor and the app are killed by their
# script path, which matches only this SubTracker app (not public_nodejs_new,
# not the other forever apps on the account), and only this user's processes.
# Exits 0 once no process is left (SIGTERM, then SIGKILL after 10 s), 1 if one survives.
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

PATTERN="apps/subtracker/$APP/public_nodejs/"
ME=$(id -u)

alive() { pgrep -U "$ME" -f "$PATTERN" >/dev/null 2>&1; }

# Non-zero also when the app is not running; then there is nothing to kill.
if ! timeout 30 forever stop "subtracker-$APP" >/dev/null 2>&1; then
  pkill -U "$ME" -f "$PATTERN" || true
fi

# Wait for the processes to exit, so the caller never backs up a database the
# old app still writes to, or starts a new app on a port still in use.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  alive || exit 0
  sleep 1
done
pkill -KILL -U "$ME" -f "$PATTERN" || true
sleep 1
if alive; then
  echo "stop-app: subtracker-$APP still running after SIGKILL" >&2
  exit 1
fi
