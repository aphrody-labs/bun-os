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
[[ -f "$root/etc/pacman.conf" ]] || { ls -l "$root/etc" | grep -i pacman || true; cp /etc/pacman.conf "$root/etc/pacman.conf"; }
# Bun is needed inside the chroot for factory/distro (repo layers): bootstrap it from the pinned tarball first.
pacstrap -c -G -M "$root" curl ca-certificates >/dev/null
echo bunos >"$root/etc/hostname"
# bun is installed by bunos-wsl.sh, but the repo-layer step needs it earlier; install the same pinned tarball here.
curl -fsSL -o /tmp/bun.tgz https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-1.4.4-canary.20261028.1.tgz
echo "a9b0e5d28fa06e6ff548da99de85e6e7cfe95a536603b0ad1a9252a906f6796c  /tmp/bun.tgz" | sha256sum -c -
tar xzf /tmp/bun.tgz -C /tmp && install -Dm755 /tmp/package/bin/bun "$root/usr/bin/bun"
arch-chroot "$root" env BUNOS_TIER="${BUNOS_TIER:-x86-64-v3}" BUNOS_PROFILE="${BUNOS_PROFILE:-base}" bash /opt/bunos/factory/wsl/bunos-wsl.sh
# Learn "Configuration file recommendations": checks before archiving.
rm -f "$root/etc/resolv.conf"
fail() { echo "rootfs check failed: $*" >&2; exit 1; }
[[ -z $(find "$root/boot" -mindepth 1 2>/dev/null) ]] || fail "/boot is not empty"
[[ ! -e $root/usr/lib/modules ]] || fail "kernel modules in the archive"
[[ -z $(find "$root" -xdev \( -name 'vmlinuz*' -o -name 'initramfs*' -o -name 'initrd*' \) -print -quit) ]] || fail "kernel or initramfs in the archive"
[[ -z $(awk -F: '$2 !~ /^[!*]/' "$root/etc/shadow") ]] || fail "password hash in /etc/shadow"
awk -F: '$1=="root" && $3==0 {ok=1} END{exit !ok}' "$root/etc/passwd" || fail "no root with uid 0 in /etc/passwd"
awk -F: '$1=="bun" && $3==1000 {ok=1} END{exit !ok}' "$root/etc/passwd" || fail "bun is not uid 1000"
for f in etc/wsl.conf etc/wsl-distribution.conf; do
  [[ $(stat -c '%a %u:%g' "$root/$f") == "644 0:0" ]] || fail "$f must be 0644 root:root"
done
[[ ! -e $root/etc/resolv.conf && ! -L $root/etc/resolv.conf ]] || fail "etc/resolv.conf present"
tar --numeric-owner --xattrs --acls -C "$root" -czf "$out" .
! tar -tzf "$out" | grep -qE '^\./etc/resolv\.conf$' || fail "archive lists etc/resolv.conf"
# Same bytes under the .wsl name: `wsl --install --from-file bunos-wsl.wsl` or double-click (WSL >= 2.4.4).
cp "$out" "${out%.tar.gz}.wsl"
sha256sum "$out" "${out%.tar.gz}.wsl" >"$out.sha256"
ls -l "$out" "${out%.tar.gz}.wsl"
