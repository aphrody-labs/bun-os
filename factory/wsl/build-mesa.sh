#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Builds factory/bunos/pkgbuilds/bunos-mesa (Mesa d3d12 + dzn from aphrody-labs/mesa) with makepkg in a clean
# archlinux:base-devel container, as an unprivileged user, in build.slice, and adds the packages to the
# bunos-testing pacman repository. Run on the VPS (docs/WSL.md, "DirectX 12").
#
#   factory/wsl/build-mesa.sh
#   MESA_LOCK=~/build/locks/heavy-2.lock MESA_JOBS=8 factory/wsl/build-mesa.sh   # second lane beside the heavy queue
#
# Starts only with MESA_MIN_FREE_GIB (16) available. While it runs, the container is frozen (docker pause) when
# MemAvailable drops under MESA_PAUSE_GIB (6) and thawed when it is back to MESA_RESUME_GIB (10).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
repo="${PACMAN_REPO:-$HOME/build/storage/artifacts/pacman/bunos-testing/x86_64}"
work="${MESA_WORK:-$HOME/build/storage/mesa}"
lock="${MESA_LOCK:-$HOME/build/locks/heavy.lock}"
jobs="${MESA_JOBS:-$(nproc)}"
min_free="${MESA_MIN_FREE_GIB:-16}"
pause_at="${MESA_PAUSE_GIB:-6}"
resume_at="${MESA_RESUME_GIB:-10}"
name="bunos-mesa-build"

avail_gib() { awk '/MemAvailable/ {print int($2 / 1048576)}' /proc/meminfo; }
avail=$(avail_gib)
((avail >= min_free)) || { echo "only ${avail} GiB available (< ${min_free}); not starting" >&2; exit 75; }

mkdir -p "$work" "$repo" "$(dirname "$lock")"
rm -rf "${work:?}/bunos-mesa" && cp -a "$root/factory/bunos/pkgbuilds/bunos-mesa" "$work/bunos-mesa"
[[ -f "$repo/bunos-testing.db.tar.zst" ]] || tar -cf - -T /dev/null | zstd -q >"$repo/bunos-testing.db.tar.zst"

# Memory guard: freeze the build container under pressure instead of letting the OOM killer pick a production service.
guard() {
  local paused=0
  while sleep 15; do
    docker inspect "$name" >/dev/null 2>&1 || continue
    local a; a=$(avail_gib)
    if ((!paused && a < pause_at)); then
      docker pause "$name" >/dev/null && paused=1 && echo "[guard] ${a} GiB available: paused" >&2
    elif ((paused && a >= resume_at)); then
      docker unpause "$name" >/dev/null && paused=0 && echo "[guard] ${a} GiB available: resumed" >&2
    fi
  done
}
guard &
guard_pid=$!
trap 'kill "$guard_pid" 2>/dev/null || true' EXIT

image=archlinux:base-devel
docker pull -q "$image" >/dev/null
flock "$lock" docker run --rm --name "$name" --cgroup-parent=build.slice --cpus "$jobs" --memory 30g \
  -v "$work:/build" -v "$repo:/repo" -e JOBS="$jobs" "$image" bash -euo pipefail -c '
    pacman -Syu --noconfirm --needed git pacman-contrib >/dev/null
    useradd -m builder && chown -R builder /build
    cd /build/bunos-mesa
    deps=$(bash -c "source ./PKGBUILD; printf \"%s\n\" \"\${makedepends[@]}\"" | sed "/^$/d")
    pacman -S --noconfirm --needed $deps >/build/deps.log 2>&1 || { tail -20 /build/deps.log; exit 1; }
    su builder -c "cd /build/bunos-mesa && MAKEFLAGS=-j$JOBS makepkg --noconfirm --cleanbuild --nodeps" >/build/makepkg.log 2>&1 \
      || { tail -40 /build/makepkg.log; exit 1; }
    cp /build/bunos-mesa/*.pkg.tar.zst /repo/
    (cd /repo && flock .repo.lock repo-add --quiet --remove bunos-testing.db.tar.zst /build/bunos-mesa/*.pkg.tar.zst)
    cp PKGBUILD /repo/bunos-mesa.PKGBUILD
    ls /build/bunos-mesa/*.pkg.tar.zst
  '
echo "bunos-mesa -> $repo (bunos-testing)"
