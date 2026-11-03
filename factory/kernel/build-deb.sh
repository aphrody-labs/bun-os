#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Builds the Bun OS kernel `linux-bun` as Debian packages straight from kernel.org, the upstream way
# (Documentation/admin-guide/quickly-build-trimmed-linux.rst: `make bindeb-pkg`), with Rust enabled
# (Documentation/rust/quick-start.rst: LLVM=1, rust-src, bindgen >= 0.71.1, `make rustavailable`).
#
#   factory/kernel/build-deb.sh [mainline|stable|longterm|<version>]     default: stable
#
# Channel -> image (docs/ops/RELEASES.md): mainline -> edge, stable -> stable, longterm -> LTS.
# Stages follow Linux From Scratch: verified sources first, toolchain check before use, build in a clean tree as an
# unprivileged user, install into a package (never onto the build host). Output: ~/build/storage/artifacts/kernel/<ver>/.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
channel="${1:-stable}"
work="${KERNEL_WORK:-$HOME/build/storage/kernel}"
out_root="${KERNEL_OUT:-$HOME/build/storage/artifacts/kernel}"
jobs="${CARGO_BUILD_JOBS:-$(nproc)}"
mkdir -p "$work" "$out_root"

# 1. Resolve the version from kernel.org's release index (the machine-readable form of the front page).
releases="$(curl -fsS https://www.kernel.org/releases.json)"
case "$channel" in
  mainline | stable)
    version="$(jq -r --arg m "$channel" '[.releases[] | select(.moniker == $m)][0].version' <<<"$releases")" ;;
  longterm)
    version="$(jq -r '[.releases[] | select(.moniker == "longterm")][0].version' <<<"$releases")" ;;
  *) version="$channel" ;;
esac
[[ -n "$version" && "$version" != null ]] || { echo "no $channel release on kernel.org" >&2; exit 1; }
major="${version%%.*}"
echo "linux-bun: $channel -> $version"

# 2. Verified sources (LFS ch. 3: every package is checked before use).
#    Releases: tarball + sha256sums.asc signed by the stable maintainers. Mainline -rc: the signed tag in Linus' tree.
gpghome="$work/gnupg"
mkdir -p "$gpghome" && chmod 700 "$gpghome"
gpg --homedir "$gpghome" --quiet --import "$here"/linux-bun/keys/pgp/*.asc 2>/dev/null
src="$work/linux-$version"
if [[ ! -d "$src" ]]; then
  if [[ "$version" == *-rc* ]]; then
    git -c advice.detachedHead=false clone --quiet --depth 1 --branch "v$version" \
      https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git "$src.tmp"
    GNUPGHOME="$gpghome" git -C "$src.tmp" verify-tag "v$version"
    mv "$src.tmp" "$src"
  else
    base="https://cdn.kernel.org/pub/linux/kernel/v$major.x"
    curl -fsSo "$work/linux-$version.tar.xz" "$base/linux-$version.tar.xz"
    curl -fsSo "$work/sha256sums.asc" "$base/sha256sums.asc"
    gpg --homedir "$gpghome" --quiet --verify "$work/sha256sums.asc"
    (cd "$work" && grep " linux-$version.tar.xz\$" sha256sums.asc | sha256sum -c --quiet -)
    tar -C "$work" -xf "$work/linux-$version.tar.xz"
  fi
fi
echo "sources verified: $src"

# 3. Toolchain check before it is used (LFS ch. 5 sanity checks; kernel `make rustavailable`).
rustup component add rust-src >/dev/null 2>&1 || true
cd "$src"
make -s LLVM=1 rustavailable

# 4. Configuration: Arch's distribution config as the base (it already ships CONFIG_RUST=y), the Bun OS fragment over
#    it, then the kernel's own olddefconfig; check-config.sh fails when a requested option did not survive.
cp "$here/linux-bun/config.x86_64" .config
scripts/kconfig/merge_config.sh -m -O . .config "$here/linux-bun/aphrody-bun.config" >/dev/null
./scripts/config --set-str LOCALVERSION "-bunos" --disable LOCALVERSION_AUTO \
  --enable RUST --enable ANDROID_BINDER_IPC --enable ANDROID_BINDERFS --module DRM_VKMS \
  --enable KVM --module KVM_INTEL --module KVM_AMD --enable MEMFD_CREATE
make -s LLVM=1 olddefconfig
"$here/linux-bun/check-config.sh" "$here/linux-bun/aphrody-bun.config" .config
grep -q '^CONFIG_RUST=y' .config || { echo "CONFIG_RUST did not survive olddefconfig" >&2; exit 1; }

# 5. Build and package as an unprivileged user, every CPU, in the build tier when systemd is there.
revision="${KERNEL_REVISION:-1}"
pkgversion="${version//-rc/~rc}-bunos$revision"
runner=()
command -v systemd-run >/dev/null && [[ -n "${XDG_RUNTIME_DIR:-}" ]] && runner=(systemd-run --user --scope -q --slice=build.slice)
"${runner[@]}" make -j"$jobs" LLVM=1 KBUILD_BUILD_HOST=bunos KBUILD_BUILD_USER=bunos \
  KDEB_PKGVERSION="$pkgversion" KDEB_SOURCENAME=linux-bun bindeb-pkg

# 6. Collect the packages with a receipt (name, size, sha256), the same shape as every other release artifact.
dest="$out_root/$version"
mkdir -p "$dest"
mv ../linux-*"$pkgversion"*.deb ../linux-bun_"$pkgversion"*.{buildinfo,changes} "$dest/" 2>/dev/null || true
(
  cd "$dest"
  for f in *.deb; do printf '{"path":"%s","bytes":%s,"sha256":"%s"}\n' "$f" "$(stat -c %s "$f")" "$(sha256sum "$f" | cut -d' ' -f1)"; done |
    { printf '{"schemaVersion":1,"kernel":"%s","channel":"%s","package":"%s","files":[' "$version" "$channel" "$pkgversion"; paste -sd,; printf ']}\n'; } >receipt.json
)
echo "linux-bun $pkgversion: $(ls "$dest"/*.deb | wc -l) packages in $dest"
