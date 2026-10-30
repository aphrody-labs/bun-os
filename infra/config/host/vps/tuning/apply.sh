#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Applies the Bun OS VPS low-level tuning (docs/VPS-TUNING.md) from this checkout. Idempotent, no reboot,
# no restart of other services: sysctl, modules, udev, tmpfiles (THP/KSM), systemd drop-ins, journald,
# earlyoom, Docker (reload only), nginx (backup, `nginx -t`, reload, automatic rollback), firewall UDP 443.
# Run as ubuntu from the VPS checkout: infra/config/host/vps/tuning/apply.sh
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOST=$(cd "$HERE/../.." && pwd)            # infra/config/host
NGX=$HOST/nginx
TS=$(date +%Y%m%d-%H%M%S)
BACKUP=/var/backups/aphrody/vps-tuning-$TS
changed=()

put() { # put SRC DEST [MODE]: install when the content differs, keep a backup of the previous file
  local src=$1 dst=$2 mode=${3:-0644}
  if sudo cmp -s "$src" "$dst" 2>/dev/null; then return 0; fi
  if sudo test -e "$dst"; then sudo install -D -m 0644 "$dst" "$BACKUP$dst"; fi
  sudo install -D -m "$mode" "$src" "$dst"
  changed+=("$dst")
}
was_changed() { local p; for p in "${changed[@]}"; do [[ $p == "$1"* ]] && return 0; done; return 1; }

# 1. Static host files from tuning/etc and tuning/usr.
while IFS= read -r -d '' f; do
  rel=${f#"$HERE"}
  mode=0644; [[ $rel == /usr/local/libexec/* ]] && mode=0755
  put "$f" "$rel" "$mode"
done < <(find "$HERE/etc" "$HERE/usr" -type f -print0)
put "$HOST/docker/daemon.json" /etc/docker/daemon.json.aphrody-new

# 2. Groups for KVM, DRM render nodes and video (effective for new logins and service starts).
for g in kvm render video; do getent group "$g" >/dev/null && sudo usermod -aG "$g" ubuntu; done

# 3. Kernel modules now (persisted by modules-load.d), udev permissions, sysctl, THP/KSM.
grep -vE '^\s*(#|$)' /etc/modules-load.d/aphrody-vps.conf | while read -r m; do sudo modprobe "$m" || echo "modprobe $m failed" >&2; done
sudo udevadm control --reload
sudo udevadm trigger --action=change --subsystem-match=misc
sudo udevadm trigger --action=change --subsystem-match=block
sudo /usr/lib/systemd/systemd-sysctl   # honours the "-" (ignore-failure) prefix of /usr/lib/sysctl.d, unlike sysctl --system
sudo systemd-tmpfiles --create /etc/tmpfiles.d/aphrody-vps-mm.conf

# 4. systemd: drop-ins, journald caps, earlyoom policy, timers.
sudo systemctl daemon-reload
was_changed /etc/systemd/journald.conf.d && sudo systemctl restart systemd-journald
was_changed /etc/default/earlyoom && sudo systemctl restart earlyoom
sudo systemctl disable --now systemd-oomd.service systemd-oomd.socket >/dev/null 2>&1 || true
sudo systemctl enable --now irqbalance.service fstrim.timer earlyoom.service zram-swap.service >/dev/null
was_changed /etc/default/grub.d && sudo update-grub >/dev/null 2>&1

# 5. Docker: validate, install, reload (live-restore and limits; no container restart).
if sudo cmp -s /etc/docker/daemon.json.aphrody-new /etc/docker/daemon.json; then
  sudo rm -f /etc/docker/daemon.json.aphrody-new
elif sudo dockerd --validate --config-file /etc/docker/daemon.json.aphrody-new >/dev/null; then
  sudo install -D -m 0644 /etc/docker/daemon.json "$BACKUP/etc/docker/daemon.json"
  sudo mv /etc/docker/daemon.json.aphrody-new /etc/docker/daemon.json
  sudo systemctl reload docker
else
  echo "docker daemon.json rejected by dockerd --validate; left unchanged" >&2
fi

# 6. nginx: modules, config, test, reload; roll back on a failed test.
sudo tar -C / -cf "/var/backups/aphrody/nginx-$TS.tar" etc/nginx
dpkg -s libnginx-mod-http-brotli-filter libnginx-mod-http-brotli-static >/dev/null 2>&1 ||
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq libnginx-mod-http-brotli-filter libnginx-mod-http-brotli-static >/dev/null
put "$NGX/shared/nginx.conf" /etc/nginx/nginx.conf
put "$NGX/shared/01-tuning.conf" /etc/nginx/conf.d/01-tuning.conf
put "$NGX/shared/02-compression.conf" /etc/nginx/conf.d/02-compression.conf
put "$NGX/shared/03-zstd.conf" /etc/nginx/aphrody/03-zstd.conf
put "$NGX/aphrody/aphrody.com.conf" /etc/nginx/sites-available/aphrody.com
for s in aphrody-google.inc aphrody-wayland.inc aphrody-security.inc; do put "$NGX/snippets/$s" "/etc/nginx/snippets/$s"; done
if sudo nginx -t -q; then
  sudo systemctl reload nginx
  sudo /usr/local/libexec/aphrody-nginx-zstd build || echo "zstd module unavailable; brotli/gzip active" >&2
else
  echo "nginx -t failed: restoring /etc/nginx from /var/backups/aphrody/nginx-$TS.tar" >&2
  sudo tar -C / -xf "/var/backups/aphrody/nginx-$TS.tar"
  sudo nginx -t -q && sudo systemctl reload nginx
  exit 1
fi

# 7. Firewall: QUIC/HTTP3 on 443/udp.
sudo ufw status | grep -qE '^443/udp\s+ALLOW' || sudo ufw allow 443/udp comment 'nginx HTTP/3 QUIC' >/dev/null

printf 'changed: %s\n' "${changed[@]:-none}"
[ -d "$BACKUP" ] && echo "previous files: $BACKUP"
