#!/bin/sh
# Runs every capability suite in its own container, prints exit codes. Usage: run-all.sh [cap...]
set -u
cd "$(dirname "$0")/.."
C="docker compose -f compose.yaml"
$C up -d repo-server || exit 1
$C run --rm fixtures || { echo "fixtures failed"; exit 1; }
caps=${*:-base rust wasm wine dotnet android}
rc=0
for c in $caps; do
  echo "=== $c"
  t0=$(date +%s)
  extra=""
  [ "$c" = android ] && [ -n "${REDROID_HOST:-}" ] && extra="-e REDROID_HOST=$REDROID_HOST"
  $C run --rm $extra $c sh /tests/$c.sh || rc=1
  echo "=== $c done in $(( $(date +%s) - t0 )) s"
done
$C down >/dev/null 2>&1
exit $rc
