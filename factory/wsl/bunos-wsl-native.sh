#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Docker Engine and Waydroid native in the bunos WSL distro (docs/WSL.md section 8). Runs as root inside the distro,
# idempotent. Usage: bunos-wsl-native.sh <docker|waydroid|waydroid-init|all> [waydroid-src]
#   docker         Docker Engine + buildx + compose, systemd unit enabled, API on the unix socket and on
#                  tcp://127.0.0.1:2375 (mirrored networking shares that loopback with Windows: docker.exe talks to it)
#   waydroid       Waydroid from the aphrody-labs fork (vendor/waydroid, default /opt/bunos/src/waydroid), its
#                  dependencies from pacman, container unit enabled. Needs the Bun OS kernel (binderfs).
#   waydroid-init  download and initialise the LineageOS image (VANILLA), software rendering, one WSLg window per app
set -euo pipefail
mode=${1:?usage: bunos-wsl-native.sh <docker|waydroid|waydroid-init|all> [waydroid-src]}
src=${2:-/opt/bunos/src/waydroid}
user=$(id -nu 1000)

docker_setup() {
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
  # The Android Mesa has no d3d12 driver and WSL's only DRM node is vgem: render with SwiftShader + default gralloc.
  # multi_windows: every Android activity is its own Wayland toplevel, i.e. its own WSLg (Win32) window.
  python - "$cfg" <<'PY'
import configparser, sys
p = sys.argv[1]; c = configparser.ConfigParser(); c.optionxform = str; c.read(p)
c.setdefault("properties", {})
c["properties"].update({"ro.hardware.gralloc": "default", "ro.hardware.egl": "swiftshader",
                        "persist.waydroid.multi_windows": "true", "persist.waydroid.cursor_on_subsurface": "true"})
with open(p, "w") as f: c.write(f)
PY
  waydroid upgrade -o
  systemctl restart waydroid-container.service
}

case $mode in
  docker) docker_setup ;;
  waydroid) waydroid_setup ;;
  waydroid-init) waydroid_init ;;
  all) docker_setup; waydroid_setup; waydroid_init ;;
  *) echo "unknown mode: $mode" >&2; exit 2 ;;
esac
