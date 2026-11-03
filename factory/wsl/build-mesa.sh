#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Builds factory/bunos/pkgbuilds/bunos-mesa (Mesa d3d12 + dzn from aphrody-labs/mesa) with makepkg in a clean
# archlinux:base-devel container, as an unprivileged user, in build.slice under ~/build/locks/heavy.lock, and adds
# the packages to the bunos-testing pacman repository. Run on the VPS (docs/WSL.md, "DirectX 12").
#
#   factory/wsl/build-mesa.sh
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
repo="${PACMAN_REPO:-$HOME/build/storage/artifacts/pacman/bunos-testing/x86_64}"
work="${MESA_WORK:-$HOME/build/storage/mesa}"
jobs="${MESA_JOBS:-$(nproc)}"
min_free="${MESA_MIN_FREE_GIB:-12}"

avail=$(awk '/MemAvailable/ {print int($2 / 1048576)}' /proc/meminfo)
((avail >= min_free)) || { echo "only ${avail} GiB available (< ${min_free}); not starting" >&2; exit 75; }

mkdir -p "$work" "$repo" "$HOME/build/locks"
rm -rf "${work:?}/bunos-mesa" && cp -a "$root/factory/bunos/pkgbuilds/bunos-mesa" "$work/bunos-mesa"
[[ -f "$repo/bunos-testing.db.tar.zst" ]] || tar -cf - -T /dev/null | zstd -q >"$repo/bunos-testing.db.tar.zst"

image=archlinux:base-devel
docker pull -q "$image" >/dev/null
flock "$HOME/build/locks/heavy.lock" docker run --rm --cgroup-parent=build.slice --cpus "$jobs" --memory 30g \
  -v "$work:/build" -v "$repo:/repo" -e JOBS="$jobs" "$image" bash -euo pipefail -c '
    pacman -Syu --noconfirm --needed git pacman-contrib >/dev/null
    useradd -m builder && chown -R builder /build
    cd /build/bunos-mesa
    deps=$(bash -c "source ./PKGBUILD; printf \"%s\n\" \"\${makedepends[@]}\"" | sed "/^$/d")
    pacman -S --noconfirm --needed $deps >/build/deps.log 2>&1 || { tail -20 /build/deps.log; exit 1; }
    su builder -c "cd /build/bunos-mesa && MAKEFLAGS=-j$JOBS makepkg --noconfirm --cleanbuild --nodeps" >/build/makepkg.log 2>&1 \
      || { tail -40 /build/makepkg.log; exit 1; }
    cp /build/bunos-mesa/*.pkg.tar.zst /repo/
    (cd /repo && repo-add --quiet --remove bunos-testing.db.tar.zst /build/bunos-mesa/*.pkg.tar.zst)
    cp PKGBUILD /repo/bunos-mesa.PKGBUILD
    ls /build/bunos-mesa/*.pkg.tar.zst
  '
echo "bunos-mesa -> $repo (bunos-testing)"
