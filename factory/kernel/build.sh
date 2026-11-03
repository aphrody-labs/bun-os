#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Builds a Bun OS kernel package with Arch's own tooling (makepkg) from the linux-bun PKGBUILD, against the current
# kernel.org release of its series, and adds it to the pacman testing repository (docs/ops/RELEASES.md):
#
#   factory/kernel/build.sh [linux-bun|linux-bun-lts]        default: linux-bun
#
#   linux-bun      latest kernel.org stable; Arch's patch for that version is applied when Arch has released one
#   linux-bun-lts  latest kernel.org longterm
#
# makepkg verifies the kernel.org signatures (validpgpkeys), the PKGBUILD runs `make rustavailable` and keeps
# CONFIG_RUST=y. The build runs in a clean archlinux:base-devel container as an unprivileged user, in build.slice,
# with every CPU. Output: ~/build/storage/artifacts/pacman/bunos-testing/x86_64/ (packages + repo database).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
variant="${1:-linux-bun}"
case "$variant" in
  linux-bun) moniker=stable ;;
  linux-bun-lts) moniker=longterm ;;
  *) echo "usage: ${0##*/} [linux-bun|linux-bun-lts]" >&2; exit 2 ;;
esac
repo="${PACMAN_REPO:-$HOME/build/storage/artifacts/pacman/bunos-testing/x86_64}"
work="${KERNEL_WORK:-$HOME/build/storage/kernel}/$variant"
jobs="${CARGO_BUILD_JOBS:-$(nproc)}"

version="$(curl -fsS https://www.kernel.org/releases.json |
  jq -r --arg m "$moniker" '[.releases[] | select(.moniker == $m)][0].version')"
[[ "$version" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || { echo "no $moniker release on kernel.org" >&2; exit 1; }

# Arch's per-release patch (github.com/archlinux/linux releases v<version>-arch1) when it exists for this version.
arch_tag=""
if [[ "$variant" == linux-bun ]] &&
  curl -fsS -o /dev/null "https://github.com/archlinux/linux/releases/download/v$version-arch1/linux-v$version-arch1.patch.zst"; then
  arch_tag="arch1"
fi
pkgver="$version${arch_tag:+.$arch_tag}"
echo "$variant: kernel.org $moniker $version${arch_tag:+ + Arch patch $arch_tag} -> pkgver $pkgver"

rm -rf "$work" && mkdir -p "$work" "$repo"
cp -a "$here/linux-bun/." "$work/"
cd "$work"
# Retarget the PKGBUILD: name, version, sources. Checksums are recomputed by updpkgsums inside the container; the
# authenticity check is the PGP signature of the kernel.org tarball (and of Arch's patch), not the checksum.
sed -i \
  -e "s/^pkgbase=.*/pkgbase=$variant/" \
  -e "s/^pkgver=.*/pkgver=$pkgver/" \
  -e "s/^pkgrel=.*/pkgrel=${KERNEL_PKGREL:-1}/" \
  -e "s/^pkgdesc=.*/pkgdesc='Linux (Bun OS, kernel.org $moniker)'/" \
  PKGBUILD
if [[ -z "$arch_tag" ]]; then
  # No Arch patch: plain kernel.org source; the version has no .arch suffix to strip.
  sed -i \
    -e 's/^_srcname=.*/_srcname=linux-${pkgver}/' \
    -e '/releases\/download\/\$_srctag/d' \
    -e 's#v\${pkgver%%\.\*}\.x/\${_srcname}#v${pkgver%%.*}.x/${_srcname}#' \
    PKGBUILD
fi

image=archlinux:base-devel
docker pull -q "$image" >/dev/null
docker run --rm --cgroup-parent=build.slice --cpus "$jobs" \
  -v "$work:/build" -v "$repo:/repo" -e MAKEFLAGS="-j$jobs" -e JOBS="$jobs" "$image" bash -euo pipefail -c '
    pacman -Syu --noconfirm --needed pacman-contrib git jq >/dev/null
    source /build/PKGBUILD
    pacman -S --noconfirm --needed "${makedepends[@]}" >/dev/null
    useradd -m builder && chown -R builder /build
    su builder -c "
      set -euo pipefail
      gpg --batch --quiet --import /build/keys/pgp/*.asc
      cd /build
      updpkgsums >/dev/null
      MAKEFLAGS=-j$JOBS makepkg --noconfirm --cleanbuild
    "
    cp /build/*.pkg.tar.zst /repo/
    cd /repo && repo-add --quiet --new --remove bunos-testing.db.tar.zst /build/*.pkg.tar.zst
    cp /build/PKGBUILD "/repo/'"$variant"'.PKGBUILD"
  '
ls -1 "$repo" | grep "^$variant-$pkgver" || { echo "no package produced" >&2; exit 1; }
echo "$variant $pkgver added to $repo (bunos-testing)"
