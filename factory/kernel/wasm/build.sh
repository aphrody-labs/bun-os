#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# linux-bun-wasm: the Linux kernel as native WebAssembly in the browser (no x86 emulation), from our forks of
# tombl/linux (arch wasm: kernel threads as Web Workers, SMP, virtio-blk, binfmt_wasm), tombl/musl, tombl/busybox and
# the tombl/distro build (aphrody-labs/wasm-{linux,musl,busybox,distro}).
#
#   factory/kernel/wasm/build.sh [<git ref of aphrody-labs/wasm-distro>]
#
# Builds the distro's `site` flake output (kernel vmlinux.wasm + guest rootfs + browser runner) with Nix in a
# nixos/nix container, using the project's binary cache, in build.slice. Output: an immutable release directory with
# a receipt under ~/build/storage/artifacts/linux-wasm/, served at aphrody.com/linux/ with COOP/COEP (threads need
# SharedArrayBuffer, which needs cross-origin isolation).
set -euo pipefail

ref="${1:-main}"
flake="github:aphrody-labs/wasm-distro/$ref"
out_root="${LINUX_WASM_OUT:-$HOME/build/storage/artifacts/linux-wasm}"
store="${LINUX_WASM_NIX:-$HOME/build/storage/nix}"
mkdir -p "$out_root" "$store"

commit="$(git ls-remote https://github.com/aphrody-labs/wasm-distro.git "$ref" | cut -f1 | head -1)"
[[ -n "$commit" ]] || commit="$ref"
release="$out_root/$commit-$(date +%s%3N)"
mkdir -p "$release"

docker run --rm --cgroup-parent=build.slice -v "$store:/nix-cache" -v "$release:/out" nixos/nix:latest sh -euc "
  mkdir -p /etc/nix
  cat >> /etc/nix/nix.conf <<'CONF'
experimental-features = nix-command flakes
accept-flake-config = true
max-jobs = auto
cores = 0
CONF
  nix build '$flake#site' --out-link /tmp/site --print-build-logs
  cp -rL /tmp/site/. /out/
"
(
  cd "$release"
  find . -type f ! -name receipt.json -printf '%P\n' | LC_ALL=C sort | while read -r f; do
    printf '{"path":"%s","bytes":%s,"sha256":"%s"}\n' "$f" "$(stat -c %s "$f")" "$(sha256sum "$f" | cut -d' ' -f1)"
  done | { printf '{"schemaVersion":2,"sourceCommit":"%s","flake":"%s","files":[' "$commit" "$flake"; paste -sd,; printf ']}\n'; } >receipt.json
)
ln -sfn "$release" "$out_root/current"
echo "linux-bun-wasm $commit: $(find "$release" -type f | wc -l) files, $(du -sh "$release" | cut -f1) in $release"
