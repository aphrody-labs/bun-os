#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Builds the Bun OS kernel package `linux-bun` with Arch's own tooling (makepkg) from the linux-bun PKGBUILD and adds
# it to the pacman testing repository (docs/ops/RELEASES.md):
#
#   factory/kernel/build.sh            newest of kernel.org mainline and stable (7.4-rc1 sorts after 7.3.1)
#   KVER=7.4-rc1 factory/kernel/build.sh
#
# One kernel, mainline (owner decision 2026-11-03): the newest Linus -rc or stable release replaces the previous one;
# there is no longterm variant. A release candidate comes from Linus's annotated tag, which must carry a VALIDSIG by
# his key (rc tarballs have no .sign); a release comes from cdn.kernel.org and makepkg checks its .sign against
# validpgpkeys. Arch's per-release patch is applied when Arch has published one for that exact version. The
# PKGBUILD builds with LLVM=1, runs `make rustavailable`, keeps CONFIG_RUST=y and enforces aphrody-bun.config and
# android.config; after the build, check-android.ts checks the final .config against AOSP's Android 17 kernel
# requirements. The build runs in a clean archlinux:base-devel container as an unprivileged user, in build.slice,
# with every CPU. Output: ~/build/storage/artifacts/pacman/bunos-testing/x86_64/ (packages, repo database,
# linux-bun.PKGBUILD, linux-bun.config, linux-bun.android-check.json, linux-bun.tag-verify.txt).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
variant=linux-bun
[[ $# -eq 0 || $1 == linux-bun ]] || { echo "usage: ${0##*/} [linux-bun]   env: KVER" >&2; exit 2; }
repo="${PACMAN_REPO:-$HOME/build/storage/artifacts/pacman/bunos-testing/x86_64}"
store="${KERNEL_WORK:-$HOME/build/storage/kernel}"
work="$store/$variant"
jobs="${CARGO_BUILD_JOBS:-$(nproc)}"
# AOSP kernel/configs (Android 17 = release letter c); pinned so a later AOSP change shows up as a diff here.
aosp_configs_rev="${AOSP_CONFIGS_REV:-bd79f38685cf939ab836dd8ddd2e01506ccff47a}"
aosp_release="${AOSP_RELEASE:-c/android-6.12}"

# Sort key for kernel.org versions: X.Y-rcN sorts before X.Y, which sorts before X.Y.Z.
vkey() { local v=$1 r=9999; [[ $v =~ ^(.*)-rc([0-9]+)$ ]] && { v=${BASH_REMATCH[1]}; r=${BASH_REMATCH[2]}; }
  [[ $v =~ ^[0-9]+\.[0-9]+$ ]] && v=$v.0; [[ $r -eq 9999 ]] || v=${v%.*}.0; echo "$v.$r"; }
kver="${KVER:-latest}"
if [[ $kver == latest ]]; then
  kver=$(curl -fsS https://www.kernel.org/releases.json |
    jq -r '.releases[] | select(.moniker == "mainline" or .moniker == "stable") | .version' |
    while read -r v; do echo "$(vkey "$v") $v"; done | sort -V | tail -1 | cut -d' ' -f2)
fi
[[ $kver =~ ^[0-9]+\.[0-9]+(\.[0-9]+|-rc[0-9]+)?$ ]] || { echo "unsupported kernel version: $kver" >&2; exit 1; }
pkgver="${kver//-/}"

rm -rf "$work" && mkdir -p "$work" "$repo"
cp -a "$here/linux-bun/." "$work/"
cd "$work"

arch_patch=""
if [[ $kver == *-rc* ]]; then
  # Linus's signed tag: fetch only the tag (shallow), verify it with the vendored key, archive it.
  export GNUPGHOME="$store/gnupg"
  mkdir -p "$GNUPGHOME" && chmod 700 "$GNUPGHOME"
  gpg --batch --quiet --import "$here"/linux-bun/keys/pgp/*.asc
  git init -q --bare "$store/linux-mainline.git" 2>/dev/null || true
  git -C "$store/linux-mainline.git" fetch -q --depth 1 --no-tags \
    https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git "refs/tags/v$kver:refs/tags/v$kver"
  git -C "$store/linux-mainline.git" verify-tag --raw "v$kver" >"$work/tag-verify.txt" 2>&1 || true
  grep -q '^\[GNUPG:\] VALIDSIG ABAF11C65A2970B130ABE3C479BE3E4300411886 ' "$work/tag-verify.txt" ||
    { echo "v$kver: no valid signature by Linus Torvalds" >&2; cat "$work/tag-verify.txt" >&2; exit 1; }
  git -C "$store/linux-mainline.git" archive --format=tar.gz --prefix="linux-$kver/" -o "$work/linux-$kver.tar.gz" "v$kver"
  echo "v$kver: tag $(git -C "$store/linux-mainline.git" rev-parse "v$kver") signed by Linus Torvalds (ABAF11C6...)"
elif curl -fsS -o /dev/null "https://github.com/archlinux/linux/releases/download/v$kver-arch1/linux-v$kver-arch1.patch.zst"; then
  arch_patch="https://github.com/archlinux/linux/releases/download/v$kver-arch1/linux-v$kver-arch1.patch.zst"
fi
echo "$variant: kernel.org $kver${arch_patch:+ + Arch patch arch1} -> pkgver $pkgver"

sed -i \
  -e "s/^_kver=.*/_kver=$kver/" \
  -e "s/^pkgver=.*/pkgver=$pkgver/" \
  -e "s/^pkgrel=.*/pkgrel=${KERNEL_PKGREL:-1}/" \
  PKGBUILD
# Arch's patch is one more source; prepare() applies every *.patch source.
[[ -z $arch_patch ]] || sed -i "s#^  \*) source=(\(.*\)) ;;#  *) source=(\1 $arch_patch{,.sig}) ;;#" PKGBUILD

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
    cp /build/PKGBUILD /repo/linux-bun.PKGBUILD
    cp /build/src/linux-*/.config /repo/linux-bun.config
  '
ls -1 "$repo" | grep "^$variant-$pkgver" || { echo "no package produced" >&2; exit 1; }
[[ ! -f $work/tag-verify.txt ]] || cp "$work/tag-verify.txt" "$repo/linux-bun.tag-verify.txt"

# Android 17 requirements (AOSP kernel/configs) against the final .config and the tree's own Kconfig symbols.
aosp="$store/aosp-kernel-configs"
[[ -d $aosp/.git ]] || git clone -q https://android.googlesource.com/kernel/configs "$aosp"
git -C "$aosp" fetch -q origin && git -C "$aosp" -c advice.detachedHead=false checkout -q "$aosp_configs_rev"
bun "$here/linux-bun/check-android.ts" --aosp "$aosp/$aosp_release" --src "$(ls -d "$work"/src/linux-*/ | head -1)" \
  --config "$repo/linux-bun.config" --json "$repo/linux-bun.android-check.json"
echo "$variant $pkgver added to $repo (bunos-testing)"
