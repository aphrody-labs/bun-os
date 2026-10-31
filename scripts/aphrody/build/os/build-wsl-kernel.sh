#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Usage: build-wsl-kernel.sh <source> <output> <jobs> <microsoft-wsl-tree> <gcc|rust> [fragment.config ...]
# The Microsoft WSL kernel tree supplies the base configuration and the modules VHDX generator;
# it may be a checkout or a no-checkout clone (files are then read from HEAD).
# `rust` builds with LLVM and requires CONFIG_RUST=y in the final configuration.
# Fragments are merged in order. "# @toggle NAME default=on|off" ... "# @else" ... "# @end"
# sections follow BUNOS_WSL_<NAME>=1|0 (see tools/aphrody/config/os/wsl-kernel/bunos-wsl.config).
# BUNOS_WSL_PERF=0 skips tools/perf; the modules VHDX then carries an empty perf directory.
set -euo pipefail
source_dir=$1
output_dir=$2
jobs=$3
wsl_tree=$4
toolchain=$5
shift 5
fragments=("$@")
make_args=(-C "$source_dir" O="$output_dir")
# BUNOS_WSL_LLVM: LLVM=1 or a version suffix such as -23; match the libclang that bindgen loads.
[[ $toolchain == rust ]] && make_args+=(LLVM="${BUNOS_WSL_LLVM:-1}")
mkdir -p "$output_dir"
wsl_file() {
  if [[ -e $wsl_tree/$1 ]]; then cat "$wsl_tree/$1"; else git -C "$wsl_tree" show "HEAD:$1"; fi
}
started=$(date +%s)
if [[ ! -f "$output_dir/.config" ]]; then wsl_file arch/x86/configs/config-wsl >"$output_dir/.config"; fi
if [[ $toolchain == rust ]]; then
  make "${make_args[@]}" rustavailable
  # RUST requires GENDWARFKSYMS while MODVERSIONS is on; BTF needs pahole language exclusion.
  "$source_dir/scripts/config" --file "$output_dir/.config" --enable RUST --enable GENDWARFKSYMS
fi
resolved=()
for fragment in "${fragments[@]}"; do
  out="$output_dir/$(basename "$fragment" .config).resolved.config"
  awk -v env_prefix=BUNOS_WSL_ '
    function enabled(name, def,   v) { v = ENVIRON[env_prefix name]; if (v == "") return def == "on"; return v == "1" || v == "on" || v == "y" }
    /^# @toggle / { name = $3; def = $4; sub(/^default=/, "", def); state = enabled(name, def) ? "on" : "off"; print "# toggle " name "=" state; next }
    /^# @else/ { state = (state == "on") ? "off" : "on"; next }
    /^# @end/ { state = ""; next }
    state == "off" { next }
    { print }
  ' "$fragment" >"$out"
  resolved+=("$out")
done
if [[ ${#resolved[@]} -gt 0 ]]; then
  KCONFIG_CONFIG="$output_dir/.config" "$source_dir/scripts/kconfig/merge_config.sh" -m -O "$output_dir" "$output_dir/.config" "${resolved[@]}"
fi
make "${make_args[@]}" olddefconfig
config=$'\n'$(<"$output_dir/.config")$'\n'
if [[ $toolchain == rust && $config != *$'\nCONFIG_RUST=y\n'* ]]; then
  echo "CONFIG_RUST was dropped by Kconfig; check rustc, bindgen, rust-src and pahole versions" >&2
  exit 1
fi
# Report every requested symbol that Kconfig changed or dropped.
for out in "${resolved[@]}"; do
  while IFS= read -r line; do
    [[ $line =~ ^(CONFIG_[A-Z0-9_]+)=(.*)$ ]] || [[ $line =~ ^#\ (CONFIG_[A-Z0-9_]+)\ is\ not\ set$ ]] || continue
    symbol=${BASH_REMATCH[1]}
    actual=$(grep -E "^$symbol=|^# $symbol is not set" "$output_dir/.config" || true)
    [[ $actual == "$line" || ( -z $actual && $line == "# "* ) ]] || echo "kconfig: requested '$line', got '${actual:-<absent>}'"
  done <"$out"
done | tee "$output_dir/kconfig-mismatch.txt"
make "${make_args[@]}" -j"$jobs"
built=$(date +%s)
rm -rf "$output_dir/modules" "$output_dir/headers" "$output_dir/perf"
make "${make_args[@]}" INSTALL_MOD_PATH="$output_dir/modules" INSTALL_MOD_STRIP=1 modules_install
make "${make_args[@]}" headers_install INSTALL_HDR_PATH="$output_dir/headers"
mkdir -p "$output_dir/perf"
if [[ ${BUNOS_WSL_PERF:-1} != 0 ]]; then
  mkdir -p "$output_dir/perf-build"
  make -C "$source_dir/tools/perf" O="$output_dir/perf-build/" -j"$jobs" NO_JEVENTS=1 NO_JVMTI=1 NO_LIBTRACEEVENT=1 install DESTDIR="$output_dir/perf" prefix=/
fi
kernel_release=$(make -s "${make_args[@]}" kernelrelease)
# Upstream refuses to overwrite an existing VHDX; construct a new image atomically.
image_dir=$(mktemp -d "$output_dir/.vhdx.XXXXXX")
trap 'rm -rf "$image_dir"' EXIT
wsl_file Microsoft/scripts/gen_artifacts_vhdx.sh >"$image_dir/gen_artifacts_vhdx.sh"
bash "$image_dir/gen_artifacts_vhdx.sh" "$output_dir/modules" "$output_dir/headers" "$output_dir/perf" "$kernel_release" "$image_dir/modules.vhdx"
rm -f "$output_dir/modules.vhdx"
mv "$image_dir/modules.vhdx" "$output_dir/modules.vhdx"
printf '{"kernelRelease":"%s","toolchain":"%s","jobs":%s,"buildSeconds":%s,"totalSeconds":%s}\n' \
  "$kernel_release" "$toolchain" "$jobs" "$((built - started))" "$(($(date +%s) - started))" >"$output_dir/build-receipt.json"
cat "$output_dir/build-receipt.json"
