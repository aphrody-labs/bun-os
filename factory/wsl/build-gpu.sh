#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Builds the DirectX 12 GPU packages of the Bun OS WSL distro (docs/WSL.md, "DirectX 12") with makepkg in a clean
# archlinux:base-devel container, as an unprivileged user, in build.slice, and adds them to the bunos-testing pacman
# repository: bunos-mesa (Mesa d3d12 + Dozen + rusticl from aphrody-labs/mesa) and bunos-virglrenderer (vtest bridge
# for Waydroid, aphrody-labs/virglrenderer). Run on the VPS.
#
#   factory/wsl/build-gpu.sh                          bunos-mesa bunos-virglrenderer
#   factory/wsl/build-gpu.sh bunos-virglrenderer      only these
#   GPU_LOCK=~/build/locks/heavy-2.lock GPU_JOBS=8 factory/wsl/build-gpu.sh   # second lane beside the heavy queue
#
# Starts only with GPU_MIN_FREE_GIB (16) available. While it runs, the container is frozen (docker pause) when
# MemAvailable drops under GPU_PAUSE_GIB (6) and thawed when it is back to GPU_RESUME_GIB (10).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
repo="${PACMAN_REPO:-$HOME/build/storage/artifacts/pacman/bunos-testing/x86_64}"
work="${GPU_WORK:-$HOME/build/storage/gpu}"
lock="${GPU_LOCK:-$HOME/build/locks/heavy.lock}"
jobs="${GPU_JOBS:-$(nproc)}"
min_free="${GPU_MIN_FREE_GIB:-16}"
pause_at="${GPU_PAUSE_GIB:-6}"
resume_at="${GPU_RESUME_GIB:-10}"
name="bunos-gpu-build"
pkgs=("$@")
((${#pkgs[@]})) || pkgs=(bunos-mesa bunos-virglrenderer)

avail_gib() { awk '/MemAvailable/ {print int($2 / 1048576)}' /proc/meminfo; }
avail=$(avail_gib)
((avail >= min_free)) || { echo "only ${avail} GiB available (< ${min_free}); not starting" >&2; exit 75; }

mkdir -p "$work" "$repo" "$(dirname "$lock")"
for p in "${pkgs[@]}"; do
  [[ -f "$root/factory/bunos/pkgbuilds/$p/PKGBUILD" ]] || { echo "no recipe: $p" >&2; exit 2; }
  rm -rf "${work:?}/$p" && cp -a "$root/factory/bunos/pkgbuilds/$p" "$work/$p"
done
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
  -v "$work:/build" -v "$repo:/repo" -e JOBS="$jobs" -e PKGS="${pkgs[*]}" "$image" bash -euo pipefail -c '
    pacman -Syu --noconfirm --needed git pacman-contrib >/dev/null
    useradd -m builder && chown -R builder /build
    for p in $PKGS; do
      echo "=== $p"
      cd /build/$p
      # depends too: the libraries a package links against (libepoxy, gbm) must be present to build it.
      deps=$(bash -c "source ./PKGBUILD; printf \"%s\n\" \"\${makedepends[@]}\" \"\${depends[@]}\"" | sed "/^$/d")
      pacman -S --noconfirm --needed $deps >/build/$p.deps.log 2>&1 || { tail -20 /build/$p.deps.log; exit 1; }
      su builder -c "cd /build/$p && MAKEFLAGS=-j$JOBS makepkg --noconfirm --cleanbuild --nodeps" >/build/$p.log 2>&1 \
        || { tail -40 /build/$p.log; exit 1; }
      cp /build/$p/*.pkg.tar.zst /repo/
      (cd /repo && flock .repo.lock repo-add --quiet --remove bunos-testing.db.tar.zst /build/$p/*.pkg.tar.zst)
      cp PKGBUILD /repo/$p.PKGBUILD
      ls /build/$p/*.pkg.tar.zst
    done
  '
echo "${pkgs[*]} -> $repo (bunos-testing)"
