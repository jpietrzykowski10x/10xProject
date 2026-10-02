#!/bin/sh
# Deploys one app from a .mydevil tarball read on stdin.
#
#   tar czf - -C .mydevil . | ssh mydevil "deploy <frontend|api> <sha>"
#
# The new version is installed in public_nodejs_new while the live one keeps
# running; only the final swap (two mv) causes a few seconds of downtime.
# If the health check fails, the previous version is restored automatically.
set -eu
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.npm-global/bin:$PATH"

APP="$1"
SHA="$2"
BASE="$HOME/apps/subtracker/$APP"
LIVE="$BASE/public_nodejs"
NEW="$BASE/public_nodejs_new"
RELEASES="$BASE/releases"
NPM=/usr/local/bin/npm24
KEEP=3

log() { echo "[deploy $APP] $*"; }

health_check() {
  port=$(sed -n 's/^PORT=//p' "$LIVE/.env" | tr -d '"\r')
  for attempt in 1 2 3 4 5; do
    sleep 3
    if curl -fsS -o /dev/null --max-time 5 "http://localhost:$port/"; then
      log "health-check OK (attempt $attempt, port $port)"
      return 0
    fi
  done
  log "health-check FAILED on port $port"
  return 1
}

[ -f "$BASE/shared/.env" ] || { log "missing $BASE/shared/.env"; exit 1; }

log "unpacking $SHA into $NEW"
rm -rf "$NEW"
mkdir -p "$NEW" "$RELEASES" "$BASE/logs"
tar xzf - -C "$NEW"
cp "$BASE/shared/.env" "$NEW/.env"

log "installing production dependencies"
(cd "$NEW" && "$NPM" ci --omit=dev --no-audit --no-fund)

# Database step goes here once TypeORM lands: pg_dump to ~/backups, then
# run migrations. A failure must stop the deploy before the swap below.

RELEASE="$RELEASES/$(date +%Y%m%d-%H%M%S)_$(echo "$SHA" | cut -c1-7)"
had_live=0
if [ -d "$LIVE" ]; then
  forever stop "subtracker-$APP" >/dev/null 2>&1 || true
  mv "$LIVE" "$RELEASE"
  had_live=1
fi
mv "$NEW" "$LIVE"
"$HOME/apps/subtracker/bin/start-app.sh" "$APP"

if ! health_check; then
  if [ "$had_live" -eq 1 ]; then
    log "restoring previous version from $RELEASE"
    forever stop "subtracker-$APP" >/dev/null 2>&1 || true
    mv "$LIVE" "${RELEASE}_failed"
    mv "$RELEASE" "$LIVE"
    "$HOME/apps/subtracker/bin/start-app.sh" "$APP"
  fi
  log "check $BASE/logs/err.log"
  exit 1
fi

# Keep the newest $KEEP releases (names start with a timestamp).
ls -1 "$RELEASES" | sort -r | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -rf "${RELEASES:?}/$old"
done

log "deployed $SHA"
