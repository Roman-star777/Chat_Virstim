#!/usr/bin/env bash
# Піднімає тимчасовий Postgres, застосовує міграцію і проганяє перевірки прав (tests/db/rls-test.sql).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | tail -1)}"
DIR="$(mktemp -d)"
AS=()
if [ "$(id -u)" = "0" ]; then chown postgres "$DIR"; AS=(runuser -u postgres --); fi
PORT="${PGPORT_TEST:-54329}"
cleanup() { "${AS[@]}" "$PGBIN/pg_ctl" -D "$DIR" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
"${AS[@]}" "$PGBIN/initdb" -D "$DIR" -U postgres -A trust >/dev/null
"${AS[@]}" "$PGBIN/pg_ctl" -D "$DIR" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null
PSQL=(psql -h "$DIR" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$ROOT/tests/db/supabase-stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -f "$ROOT/tests/db/rls-test.sql"
echo "DB tests: OK"
