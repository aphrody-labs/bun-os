#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Builds the Bun OS desktop packages (factory/desktop/pkgbuilds) with makepkg in a clean archlinux:base-devel
# container, as an unprivileged user, in build.slice, and adds them to the pacman testing repository
# (docs/ops/RELEASES.md, docs/DESKTOP-SESSIONS.md). Same pattern as factory/kernel/build.sh.
#
#   factory/desktop/build.sh                  every package, in dependency order
#   factory/desktop/build.sh ripgrep fd ...   only these, in the given order
#
# Packages build one at a time under ~/build/locks/heavy.lock (shared with the other heavy VPS jobs) and only when
# MemAvailable is above DESKTOP_MIN_FREE_GIB (default 12). A failing package is recorded and the run goes on;
# the exit status is non-zero when any failed. Built packages are visible to the next ones through a file:// repo,
# so bunos-omarchy can depend on bunos-desktop, hyprbars on hyprland, gnome-shell on mutter.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="${PACMAN_REPO:-$HOME/build/storage/artifacts/pacman/bunos-testing/x86_64}"
work="${DESKTOP_WORK:-$HOME/build/storage/desktop}"
cache="${DESKTOP_CARGO_HOME:-$HOME/build/storage/cache/cargo-desktop}"
jobs="${CARGO_BUILD_JOBS:-$(nproc)}"
min_free="${DESKTOP_MIN_FREE_GIB:-12}"

default=(
  sd fd ripgrep bat eza dust procs zoxide hyperfine tokei xh ouch just starship git-delta bottom gitui yazi atuin
  helix nushell zellij rio uutils-coreutils bunos-cli
  bunos-design-m3 bunos-desktop wlvncc cosmic-comp cosmic-session hyprland hyprland-plugin-hyprbars bunos-omarchy
  mutter gnome-shell
)
pkgs=("$@")
((${#pkgs[@]})) || pkgs=("${default[@]}")

avail=$(awk '/MemAvailable/ {print int($2 / 1048576)}' /proc/meminfo)
((avail >= min_free)) || { echo "only ${avail} GiB available (< ${min_free}); not starting" >&2; exit 75; }

mkdir -p "$work" "$repo" "$cache" "$HOME/build/locks"
for p in "${pkgs[@]}"; do
  [[ -f "$here/pkgbuilds/$p/PKGBUILD" ]] || { echo "no recipe: $p" >&2; exit 2; }
  rm -rf "${work:?}/$p" && cp -a "$here/pkgbuilds/$p" "$work/$p"
done
# bunos-desktop's sources are repository files.
[[ ! -d "$work/bunos-desktop" ]] || cp "$here/bunos-desktop/"*.ts "$here/sessions.json" "$work/bunos-desktop/"
# bunos-design-m3 installs the design track's artifact (docs/DESIGN-M3-WINDOWS.md), keyed by its receipt.
design="${DESIGN_ARTIFACT:-$HOME/build/storage/artifacts/design/current}"
if [[ -d "$work/bunos-design-m3" ]]; then
  [[ -f "$design/receipt.json" ]] || { echo "no design artifact at $design" >&2; exit 2; }
  mkdir -p "$work/bunos-design-m3/design" && cp -aL "$design/." "$work/bunos-design-m3/design/"
fi
[[ -f "$repo/bunos-testing.db.tar.zst" ]] || tar -cf - -T /dev/null | zstd -q >"$repo/bunos-testing.db.tar.zst"
rm -f "$work/failed"

image=archlinux:base-devel
docker pull -q "$image" >/dev/null
flock "$HOME/build/locks/heavy.lock" docker run --rm --cgroup-parent=build.slice --cpus "$jobs" --memory 30g \
  -v "$work:/build" -v "$repo:/repo" -v "$cache:/cargo" -e JOBS="$jobs" -e PKGS="${pkgs[*]}" "$image" bash -uo pipefail -c '
    sed -i "/^\[core\]/i [bunos-testing]\nSigLevel = Optional TrustAll\nServer = file:///repo\n" /etc/pacman.conf
    [[ -f /repo/bunos-testing.db ]] || ln -sf bunos-testing.db.tar.zst /repo/bunos-testing.db
    pacman -Syu --noconfirm --needed git pacman-contrib >/dev/null
    useradd -m builder && chown -R builder /build /cargo
    for p in $PKGS; do
      echo "=== $p"
      deps=$(cd /build/$p && bash -c "source ./PKGBUILD; printf \"%s\n\" \"\${makedepends[@]}\" \"\${depends[@]}\"" | sed "/^$/d")
      if ! pacman -Sy --noconfirm --needed $deps >/build/$p.deps.log 2>&1; then
        echo "$p: dependencies" >>/build/failed; tail -5 /build/$p.deps.log; continue
      fi
      if su builder -c "cd /build/$p && CARGO_HOME=/cargo MAKEFLAGS=-j$JOBS CARGO_BUILD_JOBS=$JOBS makepkg --noconfirm --cleanbuild --nodeps" >/build/$p.log 2>&1; then
        cp /build/$p/*.pkg.tar.zst /repo/
        (cd /repo && repo-add --quiet --remove bunos-testing.db.tar.zst /build/$p/*.pkg.tar.zst)
        cp /build/$p/PKGBUILD "/repo/$p.PKGBUILD"
        ls /build/$p/*.pkg.tar.zst
      else
        echo "$p: makepkg" >>/build/failed; tail -15 /build/$p.log
      fi
    done
  '
if [[ -s "$work/failed" ]]; then
  echo "failed (logs in $work/<pkg>.log):" >&2; cat "$work/failed" >&2; exit 1
fi
echo "built: ${pkgs[*]} -> $repo (bunos-testing)"
