#!/bin/bash
# SPDX-License-Identifier: MIT
# config.sh SOURCE OUT_CONFIG: full x86_64 .config for the linux-aphrody-bun native target
# (factory/native-targets.json): x86_64_defconfig + kvm_guest.config + aphrody-virt.config, resolved by
# olddefconfig with the same LLVM/Rust toolchain as the build. Fails if any requested =y did not survive.
set -euo pipefail
SRC=$(cd "$1" && pwd); OUT=$2
here=$(cd "$(dirname "$0")" && pwd); frag=$here/aphrody-virt.config
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
mk=(make -s -C "$SRC" O="$tmp" ARCH=x86 LLVM=1 RUSTC=rustc BINDGEN=bindgen)
"${mk[@]}" x86_64_defconfig
KCONFIG_CONFIG="$tmp/.config" "$SRC/scripts/kconfig/merge_config.sh" -m -O "$tmp" "$tmp/.config" \
  "$SRC/kernel/configs/kvm_guest.config" "$frag" >/dev/null
"${mk[@]}" olddefconfig
missing=0
while read -r line; do
  grep -qx "$line" "$tmp/.config" || { echo "missing after olddefconfig: $line" >&2; missing=1; }
done < <(grep -E '^CONFIG_[A-Z0-9_]+=y$' "$frag")
[ $missing = 0 ] || exit 1
install -m 0644 "$tmp/.config" "$OUT"
sha256sum "$OUT"
