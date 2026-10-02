#!/bin/sh
# Forced command for the GitHub Actions deploy key (authorized_keys `command=`).
# The key can only run: deploy <frontend|api> <40-char commit sha>
# The release tarball arrives on stdin and is passed through to deploy.sh.
set -eu
set -f

# Intentional word splitting of the client's command; globbing is off (set -f).
# shellcheck disable=SC2086
set -- ${SSH_ORIGINAL_COMMAND:-}

reject() {
  echo "ci-gate: rejected command: ${SSH_ORIGINAL_COMMAND:-<none>}" >&2
  exit 1
}

[ "$#" -eq 3 ] || reject
[ "$1" = "deploy" ] || reject
case "$2" in
  frontend | api) ;;
  *) reject ;;
esac
[ "${#3}" -eq 40 ] || reject
case "$3" in
  *[!0-9a-f]*) reject ;;
esac

exec "$HOME/bin/deploy.sh" "$2" "$3"
