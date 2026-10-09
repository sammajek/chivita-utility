#!/usr/bin/env bash
# Spin up a throwaway local Postgres, apply every migration on top of a
# Supabase stub, then run the SQL tests in supabase/tests. Nothing touches
# any Supabase project.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
TMP="$(mktemp -d)"
PORT="${PGPORT_TEST:-$((54000 + RANDOM % 1000))}"
cleanup() { "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

RUNAS=()
if [ "$(id -u)" = "0" ]; then
  id pgtest >/dev/null 2>&1 || useradd -M pgtest
  chown -R pgtest "$TMP"
  RUNAS=(runuser -u pgtest --)
fi
"${RUNAS[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c timezone=UTC" -l "$TMP/log" -w start >/dev/null \
  || { cat "$TMP/log"; exit 1; }

PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X -o /dev/null)
"${PSQL[@]}" -f "$ROOT/supabase/tests/00_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate: $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
for f in "$ROOT"/supabase/seed/*.sql; do
  [ -e "$f" ] || continue
  echo "seed:    $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
status=0
for f in "$ROOT"/supabase/tests/[1-9]*.sql; do
  [ -e "$f" ] || continue
  echo "test:    $(basename "$f")"
  if ! "${PSQL[@]}" -f "$f"; then status=1; fi
done
[ $status -eq 0 ] && echo "All database tests passed."
exit $status
