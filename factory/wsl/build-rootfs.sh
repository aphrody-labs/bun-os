#!/usr/bin/env bash
# Build the Bun OS WSL rootfs tarball for `wsl --import`. Run as root inside archlinux:base-devel with
# --privileged (pacstrap/arch-chroot need mount namespaces). Never run on the Windows workstation.
# Usage: build-rootfs.sh <repo-root> <out.tar.gz>   env: BUNOS_TIER (x86-64|x86-64-v3|x86-64-v4|znver4), BUNOS_PROFILE (base|cosmic|hyprland)
set -euo pipefail
repo=$(realpath "${1:?repo root}"); out=${2:?output tarball}
root=$(mktemp -d /tmp/bunos-rootfs.XXXXXX)
pacman -Sy --noconfirm archlinux-keyring arch-install-scripts zstd
pacman-key --init && pacman-key --populate archlinux
pacstrap -c -G -M "$root" base
install -d "$root/opt/bunos" "$root/opt/bunos/src-buncc"
cp -r "$repo/factory" "$root/opt/bunos/factory"
cp -r "$repo/packages/buncc/." "$root/opt/bunos/src-buncc/"
cp /etc/pacman.d/mirrorlist "$root/etc/pacman.d/mirrorlist"
# Bun is needed inside the chroot for factory/distro (repo layers): bootstrap it from the pinned tarball first.
pacstrap -c -G -M "$root" curl ca-certificates >/dev/null
install -m644 "$repo/factory/wsl/wsl.conf" "$root/etc/wsl.conf"
echo bunos >"$root/etc/hostname"
# bun is installed by bunos-wsl.sh, but the repo-layer step needs it earlier; install the same pinned tarball here.
curl -fsSL -o /tmp/bun.tgz https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-1.4.4-canary.20261028.1.tgz
echo "a9b0e5d28fa06e6ff548da99de85e6e7cfe95a536603b0ad1a9252a906f6796c  /tmp/bun.tgz" | sha256sum -c -
tar xzf /tmp/bun.tgz -C /tmp && install -Dm755 /tmp/package/bin/bun "$root/usr/bin/bun"
arch-chroot "$root" env BUNOS_TIER="${BUNOS_TIER:-x86-64-v3}" BUNOS_PROFILE="${BUNOS_PROFILE:-base}" bash /opt/bunos/factory/wsl/bunos-wsl.sh
tar --numeric-owner --xattrs --acls -C "$root" -czf "$out" .
sha256sum "$out" >"$out.sha256"
ls -l "$out"
