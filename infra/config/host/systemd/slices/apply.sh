#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Installs the Bun OS priority classes (interactive.slice, build.slice, blk-iocost, aphrody-priority timer)
# from this checkout and applies them live without restarting any service. Idempotent; run as ubuntu.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOST=$(cd "$HERE/../.." && pwd)
command -v jq >/dev/null || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq jq >/dev/null
for f in interactive.slice build.slice aphrody-iocost.service aphrody-priority.service aphrody-priority.timer; do
  sudo install -D -m 0644 "$HERE/$f" "/etc/systemd/system/$f"
done
sudo install -D -m 0644 "$HERE/aphrody-priority.json" /etc/aphrody/priority.json
sudo install -D -m 0755 "$HOST/libexec/aphrody-priority" /usr/local/libexec/aphrody-priority
for u in $(jq -r '.interactiveUnits[]' "$HERE/aphrody-priority.json"); do
  systemctl cat "$u" >/dev/null 2>&1 || continue
  sudo install -D -m 0644 "$HERE/interactive.conf" "/etc/systemd/system/$u.d/90-aphrody-interactive.conf"
done
sudo systemctl daemon-reload
sudo systemctl start interactive.slice build.slice
sudo systemctl enable --now aphrody-iocost.service aphrody-priority.timer >/dev/null
sudo systemctl start aphrody-priority.service
journalctl -u aphrody-priority.service -n 3 --no-pager -o cat
