#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Docker Engine and Waydroid native in the bunos WSL distro (docs/WSL.md section 8). Runs as root inside the distro,
# idempotent. Usage: bunos-wsl-native.sh <repo|desktop|docker|waydroid|waydroid-init|all> [waydroid-src]
#   repo           [bunos-testing] (https://aphrody.com/repo/bunos-testing, factory/wsl/publish-testing.sh) before the
#                  first repository, signatures required, key aphrody-store from https://aphrody.com/repo/os/aphrody.gpg
#   desktop        repo + the session packages of factory/wsl/packages.desktop (docs/DESKTOP-SESSIONS.md)
#   docker         Docker Engine + buildx + compose, systemd unit enabled, API on the unix socket and on
#                  tcp://127.0.0.1:2375 (mirrored networking shares that loopback with Windows: docker.exe talks to it)
#   waydroid       Waydroid from the aphrody-labs fork (vendor/waydroid, default /opt/bunos/src/waydroid), its
#                  dependencies from pacman, container unit enabled. Needs the Bun OS kernel (binderfs).
#   waydroid-init  download and initialise the LineageOS image (VANILLA), software rendering, one WSLg window per app
set -euo pipefail
mode=${1:?usage: bunos-wsl-native.sh <repo|desktop|docker|waydroid|waydroid-init|all> [waydroid-src]}
src=${2:-/opt/bunos/src/waydroid}
user=$(id -nu 1000)

here=$(dirname "$(realpath "$0")")
origin=${BUNOS_REPO_ORIGIN:-https://aphrody.com}

repo_setup() {
  # Same key as the signed Store repo /repo/os (apps/webos/store/pacman.ts); trusted locally, for these repos only.
  curl -fsSL "$origin/repo/os/aphrody.gpg" -o /tmp/aphrody-store.gpg
  fpr=$(gpg --show-keys --with-colons /tmp/aphrody-store.gpg | awk -F: '/^fpr/{print $10; exit}')
  pacman-key --list-keys "$fpr" >/dev/null 2>&1 || { pacman-key --add /tmp/aphrody-store.gpg && pacman-key --lsign-key "$fpr"; } >/dev/null
  if ! grep -qx '\[bunos-testing\]' /etc/pacman.conf; then
    # Before the first repository: its mutter/gnome-shell/cosmic/hyprland builds come from our pinned forks.
    awk -v o="$origin" '/^\[/ && $0 != "[options]" && !d {
        print "[bunos-testing]"; print "SigLevel = Required"; print "Server = " o "/repo/bunos-testing/$arch"; print ""; d = 1
      } {print}' /etc/pacman.conf >/etc/pacman.conf.new && mv /etc/pacman.conf.new /etc/pacman.conf
  fi
  pacman -Sy --noconfirm >/dev/null
}

desktop_setup() {
  repo_setup
  grep -vE '^\s*(#|$)' "${PACKAGES_DESKTOP:-$here/packages.desktop}" | pacman -S --needed --noconfirm -
  # Hyprland's headless backend opens the vgem node (/dev/dri/card0, group video) as the session user.
  usermod -aG video,render "$user"
  bunos-session --list
}

latency_setup() {
  # The kernel defaults to bbr + fq (wsl-latency.config), but systemd's 50-default.conf resets default_qdisc to
  # fq_codel at boot; a later drop-in wins.
  printf 'net.core.default_qdisc = fq\nnet.ipv4.tcp_congestion_control = bbr\n' >/etc/sysctl.d/90-bunos-latency.conf
  sysctl -q --system >/dev/null
}

docker_setup() {
  latency_setup
  pacman -S --needed --noconfirm docker docker-buildx docker-compose
  install -d /etc/systemd/system/docker.service.d /etc/docker
  # Loopback TCP without TLS: reachable only from this machine (127.0.0.1, shared with Windows by mirrored mode).
  # Whoever can reach it is root in the distro, which the Windows user already is through `wsl -u root`.
  cat >/etc/systemd/system/docker.service.d/bunos.conf <<'UNIT'
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd -H fd:// -H tcp://127.0.0.1:2375 --tls=false --containerd=/run/containerd/containerd.sock
UNIT
  # local log driver (binary, rotated) instead of json-file; overlay2 is the default on ext4.
  [[ -e /etc/docker/daemon.json ]] || printf '{\n  "log-driver": "local",\n  "features": { "buildkit": true }\n}\n' >/etc/docker/daemon.json
  usermod -aG docker "$user"
  systemctl daemon-reload
  systemctl enable --now containerd.service docker.service
  docker version --format 'docker {{.Server.Version}} ({{.Server.Os}}/{{.Server.Arch}})'
}

waydroid_setup() {
  pacman -S --needed --noconfirm lxc python python-gbinder python-gobject python-dbus dnsmasq nftables wayland-utils
  # The bundle ships the fork as `git archive` output (waydroid-src.tar.gz, bundle.sh).
  if [[ -f $src && $src == *.tar.gz ]]; then
    rm -rf /opt/bunos/src/waydroid && install -d /opt/bunos/src/waydroid
    tar -xzf "$src" -C /opt/bunos/src/waydroid && src=/opt/bunos/src/waydroid
  fi
  [[ -f $src/waydroid.py ]] || { echo "waydroid source not found: $src" >&2; exit 1; }
  make -C "$src" install USE_SYSTEMD=1 USE_DBUS_ACTIVATION=1 USE_NFTABLES=1 >/dev/null
  systemctl daemon-reload
  systemctl enable --now waydroid-container.service
  grep -q binder /proc/filesystems || { echo "kernel has no binderfs: install the Bun OS WSL kernel" >&2; exit 1; }
  waydroid --version
}

waydroid_init() {
  [[ -f /var/lib/waydroid/waydroid.cfg ]] || waydroid init -s VANILLA
  cfg=/var/lib/waydroid/waydroid.cfg
  # The Android Mesa has no d3d12 driver and the only DRM node is vgem: default (CPU) gralloc; Waydroid 1.6 then
  # renders through ANGLE on a software Vulkan device by itself (ro.hardware.egl=angle).
  # multi_windows: every Android activity is its own Wayland toplevel, i.e. its own WSLg (Win32) window.
  python - "$cfg" <<'PY'
import configparser, sys
p = sys.argv[1]; c = configparser.ConfigParser(); c.optionxform = str; c.read(p)
c.setdefault("properties", {})
c["properties"].update({"ro.hardware.gralloc": "default",
                        "persist.waydroid.multi_windows": "true", "persist.waydroid.cursor_on_subsurface": "true"})
with open(p, "w") as f: c.write(f)
PY
  waydroid upgrade -o
  systemctl restart waydroid-container.service
}

case $mode in
  repo) repo_setup ;;
  desktop) desktop_setup ;;
  docker) docker_setup ;;
  waydroid) waydroid_setup ;;
  waydroid-init) waydroid_init ;;
  all) docker_setup; waydroid_setup; waydroid_init ;;
  *) echo "unknown mode: $mode" >&2; exit 2 ;;
esac
