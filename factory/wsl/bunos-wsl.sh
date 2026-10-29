#!/usr/bin/env bash
# Runs INSIDE the new rootfs (arch-chroot). Needs network (CachyOS keyserver, mirror.cachyos.org, npm registry).
set -euo pipefail
tier=${BUNOS_TIER:-x86-64-v3}
profile=${BUNOS_PROFILE:-base}
bun_ver=1.4.4-canary.20261028.1
bun_tgz_sha256=a9b0e5d28fa06e6ff548da99de85e6e7cfe95a536603b0ad1a9252a906f6796c   # factory/usr/pkgs/bun-canary/PKGBUILD

pacman-key --init
pacman-key --populate archlinux

if [[ $tier != x86-64 ]]; then
  # Same steps as cachyos-repo-add-script cachyos-repo.sh (e2c90c6): key, keyring+mirrorlists, CachyOS pacman fork.
  pacman-key --recv-keys F3B607488DB35A47 --keyserver keyserver.ubuntu.com
  pacman-key --lsign-key F3B607488DB35A47
  m=https://mirror.cachyos.org/repo/x86_64/cachyos
  pacman -U --noconfirm "$m/cachyos-keyring-20240331-1-any.pkg.tar.zst" "$m/cachyos-mirrorlist-27-1-any.pkg.tar.zst" \
    "$m/cachyos-v3-mirrorlist-27-1-any.pkg.tar.zst" "$m/cachyos-v4-mirrorlist-27-1-any.pkg.tar.zst" \
    "$m/pacman-7.1.0.r9.g54d9411-5-x86_64.pkg.tar.zst"
  # Layers come from factory/distro (repos.ts), the single owner of the v3/v4 logic.
  bun /opt/bunos/factory/distro/cli.ts repo --tier "$tier" --conf /etc/pacman.conf
fi
pacman -Syu --noconfirm
for list in base $([[ $profile == base ]] || echo "$profile"); do
  grep -vE '^\s*(#|$)' "/opt/bunos/factory/wsl/packages.$list" | pacman -S --needed --noconfirm -
done

# Bun: unmodified official npm canary, pinned by sha256 (same artifact as the bun-canary package).
cd "$(mktemp -d)"
curl -fsSL -o bun.tgz "https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-${bun_ver}.tgz"
echo "$bun_tgz_sha256  bun.tgz" | sha256sum -c -
tar xzf bun.tgz
install -Dm755 package/bin/bun /usr/bin/bun
ln -sf bun /usr/bin/bunx
bun --revision

# buncc: not published to npm yet, so ship the workspace sources and a launcher.
install -d /opt/bunos/buncc
cp -r /opt/bunos/src-buncc/. /opt/bunos/buncc/
printf '#!/bin/sh\nexec /usr/bin/bun /opt/bunos/buncc/src/cli.ts "$@"\n' >/usr/local/bin/buncc
chmod 755 /usr/local/bin/buncc

# User, sudo, locale, os-release, services
echo 'en_US.UTF-8 UTF-8' >/etc/locale.gen && locale-gen && echo LANG=en_US.UTF-8 >/etc/locale.conf
useradd -m -G wheel -s /bin/bash bun
passwd -l bun
# The Windows user already owns this VM; passwordless wheel keeps `wsl -d` + sudo usable without an OOBE.
echo '%wheel ALL=(ALL:ALL) NOPASSWD: ALL' >/etc/sudoers.d/10-bunos-wheel && chmod 440 /etc/sudoers.d/10-bunos-wheel
sed -i 's/^NAME=.*/NAME="Bun OS (WSL)"/;s/^ID=.*/ID=arch/' /etc/os-release
# Microsoft's list of units that break WSL (Learn build-custom-distro "Systemd recommendations" and
# distributions/validate-modern.py DISCOURAGED_SYSTEM_UNITS): mask them for system and user managers.
# WSL generates /etc/resolv.conf itself ([network] generateResolvConf=true), so systemd-resolved stays masked.
units=(systemd-resolved.service systemd-networkd.service systemd-networkd-wait-online.service
  NetworkManager.service NetworkManager-wait-online.service networking.service
  systemd-tmpfiles-setup.service systemd-tmpfiles-clean.service systemd-tmpfiles-clean.timer
  systemd-tmpfiles-setup-dev-early.service systemd-tmpfiles-setup-dev.service
  systemd-vconsole-setup.service tmp.mount console-getty.service hypervkvpd.service)
systemctl mask "${units[@]}"
systemctl --global mask "${units[@]}"
# WSL files: configuration, icon, no resolv.conf, locked passwords (no hashes in /etc/shadow).
install -Dm644 /opt/bunos/factory/wsl/wsl.conf /etc/wsl.conf
install -Dm644 /opt/bunos/factory/wsl/wsl-distribution.conf /etc/wsl-distribution.conf
install -Dm644 /opt/bunos/factory/wsl/bunos.ico /usr/lib/wsl/bunos.ico
usermod -p '!' root
usermod -p '!' bun
rm -f /etc/resolv.conf
rm -rf /var/cache/pacman/pkg/* /etc/pacman.d/gnupg/S.* 2>/dev/null || true
