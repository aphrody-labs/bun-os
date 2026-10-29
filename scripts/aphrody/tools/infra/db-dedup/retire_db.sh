#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# Retire one PostgreSQL database on this host (run as a sudo-capable user).
# usage: retire_db.sh <db> <unique-backup-dir>
# 1. revoke CONNECT, 2. terminate client backends, 3. final pg_dump -Fc +
# globals, verified with pg_restore --list and sha256, 4. DROP DATABASE.
set -euo pipefail
DB="$1"; OUT="$2"
case "$DB" in postgres|template0|template1) echo "refusing to retire $DB" >&2; exit 2;; esac
PSQL=(sudo -n -u postgres psql -X -v ON_ERROR_STOP=1 -At)
TS=$(date -u +%Y%m%dT%H%M%SZ)
"${PSQL[@]}" -c "select 1 from pg_database where datname='$DB'" | grep -q 1 || { echo "$DB absent"; exit 0; }

echo "[$DB] active sessions before revoke:"
"${PSQL[@]}" -F'|' -c "select usename, application_name, backend_type, state from pg_stat_activity where datname='$DB'"

# 1. revoke CONNECT from PUBLIC and every role holding it explicitly
"${PSQL[@]}" -c "REVOKE CONNECT ON DATABASE \"$DB\" FROM PUBLIC"
for r in $("${PSQL[@]}" -c "select distinct (aclexplode(datacl)).grantee::regrole::text from pg_database where datname='$DB'" | grep -v -E '^(-|postgres|0)$' || true); do
  "${PSQL[@]}" -c "REVOKE CONNECT ON DATABASE \"$DB\" FROM $r" || true
done

# 2. terminate remaining client backends (not background workers)
"${PSQL[@]}" -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='$DB' and backend_type='client backend' and pid<>pg_backend_pid()" >/dev/null

# 3. final verified dump
sudo -n install -d -m 700 -o root -g root "$OUT"
sudo -n -u postgres pg_dump -Fc -d "$DB" | sudo -n tee "$OUT/$DB-final-$TS.dump" >/dev/null
sudo -n -u postgres pg_dumpall --globals-only | sudo -n tee "$OUT/globals-before-drop-$DB-$TS.sql" >/dev/null
sudo -n chmod 600 "$OUT/$DB-final-$TS.dump" "$OUT/globals-before-drop-$DB-$TS.sql"
N=$(sudo -n pg_restore --list "$OUT/$DB-final-$TS.dump" | grep -c 'TABLE DATA' || true)
sudo -n pg_restore --list "$OUT/$DB-final-$TS.dump" >/dev/null
sudo -n sha256sum "$OUT/$DB-final-$TS.dump" "$OUT/globals-before-drop-$DB-$TS.sql"
echo "[$DB] final dump ok: $N TABLE DATA entries"

# 4. drop (FORCE terminates background workers still attached, e.g. pg_net)
"${PSQL[@]}" -c "DROP DATABASE \"$DB\" WITH (FORCE)"
echo "[$DB] dropped at $(date -u +%FT%TZ)"
