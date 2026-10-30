#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Install the bun-ui Broadway apps on the VPS and write their bundle manifests into the UI directory.
#   crates/bun-ui-web/broadway/install.sh <ui dir>      (ui dir: the release's ui/, or ~/apps/webos/ui)
# Each line of apps.tsv: id, port, display, title, command.
set -euo pipefail
ui=$(realpath -m -- "${1:?ui dir}")
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
sudo install -m 0755 "$here/bun-ui-broadway" /usr/local/libexec/bun-ui-broadway
sudo install -m 0644 "$here/bun-ui-broadway@.service" /etc/systemd/system/bun-ui-broadway@.service
sudo install -d -m 0755 /etc/bun-ui/broadway
sudo systemctl daemon-reload
while IFS=$'\t' read -r id port display title command; do
  [[ -z "$id" || "$id" == \#* ]] && continue
  command -v "${command%% *}" >/dev/null || { echo "skip $id: ${command%% *} is not installed" >&2; continue; }
  printf 'BROADWAY_PORT=%s\nBROADWAY_DISPLAY=%s\nAPP_COMMAND=%s\n' "$port" "$display" "$command" |
    sudo tee "/etc/bun-ui/broadway/$id.env" >/dev/null
  sudo systemctl enable --now "bun-ui-broadway@$id.service"
  sudo systemctl restart "bun-ui-broadway@$id.service"
  mkdir -p "$ui/gtk/$id"
  cat > "$ui/gtk/$id/bun-ui.json" <<JSON
{
  "schemaVersion": 1,
  "id": "$id",
  "toolkit": "gtk",
  "title": "$title",
  "kind": "broadway",
  "entry": "index.html",
  "upstream": "127.0.0.1:$port",
  "scriptSrc": ["'unsafe-inline'"],
  "size": [720, 560],
  "source": { "repo": "$(dpkg-query -W -f='${source:Package} ${Version}' "$(dpkg -S "$(command -v "${command%% *}")" | cut -d: -f1)" 2>/dev/null || echo system)", "commit": "", "recipe": "gtk-broadway" },
  "builtAt": "$(date -u +%FT%TZ)",
  "notes": "Native GTK $(pkg-config --modversion gtk4 2>/dev/null || echo 4) app on the host, streamed by GDK Broadway; one shared display."
}
JSON
  echo "gtk/$id -> 127.0.0.1:$port (display :$display)"
done < "$here/apps.tsv"
