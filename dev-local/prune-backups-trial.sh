#!/bin/sh
# Local trial of deploy/mydevil/prune-backups.sh (S-10, plan step 3.7). Not a one-off: re-run it
# after every change to prune-backups.sh.
#
# Run from Git Bash in the repo root (needs pg_dump and the local PostgreSQL):
#   sh dev-local/prune-backups-trial.sh
# pg_dump is looked up in PATH and in C:\Program Files\PostgreSQL\17\bin; override with PG_BIN.
#
# Works in dev-local/.prune-trial/ (git-ignored, recreated on every run): fake backups/ and a fake
# HOME holding the api lock directory. Dump files are made by `touch -d` with chosen ages.
# The only real dump is of the reference database (POSTGRES_DATABASE from backend-subtracker/.env,
# read-only for pg_dump); the trial refuses to run unless that .env says MODE=DEV. No password is
# written anywhere: the working env file is backend-subtracker/.env itself, and the failing case
# uses a generated env file with a nonexistent role and database.
#
# Cases (each prints PASS/FAIL; exit code 1 when any check failed):
#   A  only dumps older than 180 days -> fresh _scheduled.dump first, then the old ones go
#   B  newest dump 40 days old        -> preventive dump, nothing younger than 180 days goes
#   C  pg_dump fails                  -> nothing deleted, no partial dump left, exit 1
#   C2 env file missing               -> nothing deleted, exit 1
#   D  a dump younger than 30 days    -> no new dump, only > 180 days deleted, the argument kept
#   E  api lock busy                  -> exit 0, nothing changed, the other operation's lock stays
#   F  lock busy, SUBTRACKER_LOCKED=1 -> runs anyway (the caller holds the lock)
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/deploy/mydevil/prune-backups.sh"
DOTENV="$ROOT/backend-subtracker/.env"
T="$ROOT/dev-local/.prune-trial"

MODE_VALUE=$(sed -n 's/^MODE=//p' "$DOTENV" 2>/dev/null | tr -d '\r"')
if [ "$MODE_VALUE" != DEV ]; then
  echo "prune-backups-trial runs only with backend-subtracker/.env in MODE=DEV (found: '${MODE_VALUE}')." >&2
  exit 1
fi

if [ -n "${PG_BIN:-}" ]; then
  PATH="$PG_BIN:$PATH"
elif ! command -v pg_dump >/dev/null 2>&1; then
  PATH="/c/Program Files/PostgreSQL/17/bin:$PATH"
fi
export PATH
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump not found; set PG_BIN to the PostgreSQL bin directory." >&2
  exit 1
fi

export HOME="$T/home"
export SUBTRACKER_BACKUPS="$T/backups"
export PGCONNECT_TIMEOUT=5
unset SUBTRACKER_LOCKED SUBTRACKER_ENV_FILE
LOCK_DIR="$HOME/apps/subtracker/api/.ops.lock"

rm -rf "$T"
mkdir -p "$HOME/apps/subtracker/api"
cat >"$T/bad.env" <<'EOF'
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=prune_trial_no_such_role
POSTGRES_PASSWORD=not-a-password
POSTGRES_DATABASE=prune_trial_no_such_database
EOF

failures=0
check() { # check <description> <shell test...>
  desc=$1
  shift
  if "$@"; then echo "  PASS  $desc"; else echo "  FAIL  $desc"; failures=$((failures + 1)); fi
}
reset() { rm -rf "$SUBTRACKER_BACKUPS" "$LOCK_DIR"; mkdir -p "$SUBTRACKER_BACKUPS"; }
dump() { # dump <name> <age in days>
  echo "fake dump" >"$SUBTRACKER_BACKUPS/$1"
  touch -d "-$2 days" "$SUBTRACKER_BACKUPS/$1"
}
has() { [ -f "$SUBTRACKER_BACKUPS/$1" ]; }
gone() { [ ! -e "$SUBTRACKER_BACKUPS/$1" ]; }
scheduled_count() { find "$SUBTRACKER_BACKUPS" -maxdepth 1 -name '*_scheduled.dump' | wc -l | tr -d ' '; }
scheduled_ok() { # exactly one, a real pg_dump archive (starts with PGDMP)
  [ "$(scheduled_count)" = 1 ] &&
    [ "$(head -c 5 "$(find "$SUBTRACKER_BACKUPS" -maxdepth 1 -name '*_scheduled.dump')")" = PGDMP ]
}
run_rc() { # run_rc [args...] -> sets rc, prints the script's log indented
  out=$(sh "$SCRIPT" "$@" 2>&1)
  rc=$?
  printf '%s\n' "$out" | sed 's/^/    | /'
}
show() { echo "    files: $(ls -1 "$SUBTRACKER_BACKUPS" | tr '\n' ' ')"; }

echo "== A: only dumps older than 180 days"
reset
dump 20250101-000000_aaaaaaa.dump 200
dump 20250102-000000_pre-restore.dump 300
SUBTRACKER_ENV_FILE="$DOTENV" run_rc
show
check "exit 0" [ "$rc" = 0 ]
check "one fresh _scheduled.dump, a real pg_dump archive" scheduled_ok
check "200-day dump deleted" gone 20250101-000000_aaaaaaa.dump
check "300-day pre-restore dump deleted" gone 20250102-000000_pre-restore.dump
check "lock released" [ ! -d "$LOCK_DIR" ]

echo "== B: newest dump 40 days old"
reset
dump 20261012-000000_bbbbbbb.dump 40
dump 20260601-000000_ccccccc.dump 170
SUBTRACKER_ENV_FILE="$DOTENV" run_rc
show
check "exit 0" [ "$rc" = 0 ]
check "preventive _scheduled.dump made" scheduled_ok
check "40-day dump kept" has 20261012-000000_bbbbbbb.dump
check "170-day dump kept" has 20260601-000000_ccccccc.dump

echo "== C: pg_dump fails (nonexistent role and database)"
reset
dump 20250101-000000_aaaaaaa.dump 200
dump 20250102-000000_pre-restore.dump 300
SUBTRACKER_ENV_FILE="$T/bad.env" run_rc
show
check "exit 1" [ "$rc" = 1 ]
check "no _scheduled.dump left behind" [ "$(scheduled_count)" = 0 ]
check "200-day dump kept" has 20250101-000000_aaaaaaa.dump
check "300-day dump kept" has 20250102-000000_pre-restore.dump
check "lock released" [ ! -d "$LOCK_DIR" ]

echo "== C2: env file missing"
reset
dump 20250101-000000_aaaaaaa.dump 200
SUBTRACKER_ENV_FILE="$T/missing.env" run_rc
show
check "exit 1" [ "$rc" = 1 ]
check "200-day dump kept" has 20250101-000000_aaaaaaa.dump

echo "== D: a dump younger than 30 days; argument kept"
reset
dump 20261116-000000_recent1.dump 5
dump 20260604-000000_mid0001.dump 170
dump 20250101-000000_old0001.dump 200
dump 20260522-000000_pre-restore.dump 183
dump 20250103-000000_keepme1.dump 250
SUBTRACKER_ENV_FILE="$T/bad.env" run_rc "$SUBTRACKER_BACKUPS/20250103-000000_keepme1.dump"
show
check "exit 0 (bad env never used: no dump needed)" [ "$rc" = 0 ]
check "no new dump" [ "$(scheduled_count)" = 0 ]
check "5-day dump kept" has 20261116-000000_recent1.dump
check "170-day dump kept" has 20260604-000000_mid0001.dump
check "200-day dump deleted" gone 20250101-000000_old0001.dump
check "183-day pre-restore dump deleted" gone 20260522-000000_pre-restore.dump
check "250-day dump given as argument kept" has 20250103-000000_keepme1.dump

echo "== E: api lock busy"
reset
dump 20250101-000000_aaaaaaa.dump 200
mkdir "$LOCK_DIR"
SUBTRACKER_ENV_FILE="$DOTENV" run_rc
show
check "exit 0" [ "$rc" = 0 ]
check "nothing deleted" has 20250101-000000_aaaaaaa.dump
check "no dump made" [ "$(scheduled_count)" = 0 ]
check "the other operation's lock still there" [ -d "$LOCK_DIR" ]

echo "== F: lock busy, SUBTRACKER_LOCKED=1, recent dump present"
dump 20261120-000000_recent1.dump 1
SUBTRACKER_LOCKED=1 SUBTRACKER_ENV_FILE="$T/bad.env" run_rc
show
check "exit 0" [ "$rc" = 0 ]
check "200-day dump deleted" gone 20250101-000000_aaaaaaa.dump
check "caller's lock untouched" [ -d "$LOCK_DIR" ]

rm -rf "$T"
echo
if [ "$failures" = 0 ]; then echo "ALL PASSED"; else echo "$failures check(s) FAILED"; exit 1; fi
