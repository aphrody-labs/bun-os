#!/usr/bin/env bash
# Build the WSL2 kernel (mainline v7.3 + WSL patch series + Rust) on a Linux host or the GitHub ubuntu runner.
# Usage: build-wsl-kernel.sh <repo-root> <work-dir> <out-dir>   env: KVER (default 7.3), JOBS
# Never run on the Windows workstation, never under WSL (owner rule). Output: bzImage,
# modules.vhdx, config, report.json (times, sizes, tool versions). Anything not produced is not claimed.
set -euo pipefail
repo=$(realpath "$1"); work=$2; out=$3
kver=${KVER:-7.3}
jobs=${JOBS:-$(nproc)}
mkdir -p "$work" "$out"; work=$(realpath "$work"); out=$(realpath "$out")
cd "$work"
t0=$(date +%s)
base=https://cdn.kernel.org/pub/linux/kernel/v${kver%%.*}.x
curl -fsSLO "$base/linux-$kver.tar.xz"; curl -fsSLO "$base/linux-$kver.tar.sign"
# PGP check against the three keys vendored by linux-bun (Torvalds, Kroah-Hartman, heftig).
GNUPGHOME=$(mktemp -d); export GNUPGHOME; chmod 700 "$GNUPGHOME"
for k in "$repo"/factory/kernel/linux-bun/keys/pgp/*.asc; do gpg --batch --import "$k" 2>/dev/null; done
xz -dc "linux-$kver.tar.xz" >linux.tar
gpg --batch --verify "linux-$kver.tar.sign" linux.tar
tar xf linux.tar && rm linux.tar && cd "linux-$kver"
for p in "$repo"/factory/wsl/kernel/patches/*.patch; do patch -p1 --no-backup-if-mismatch <"$p"; done
# Microsoft's config at the commit the series was ported from, then adapted to the new tree.
curl -fsSL https://raw.githubusercontent.com/microsoft/WSL2-Linux-Kernel/a989171929bed4ea681be8d77333845ce1c1732a/arch/x86/configs/config-wsl >.config
export LLVM=1
make olddefconfig
scripts/kconfig/merge_config.sh -m .config "$repo/factory/wsl/kernel/wsl-rust.config"
make olddefconfig
# Fail when a fragment line did not survive olddefconfig. A "# CONFIG_X is not set" line may vanish when X's
# dependencies are unmet (the symbol is then invisible); it only fails if X ended up y or m.
missing=0
while read -r line; do
  if [[ $line =~ ^#\ (CONFIG_[A-Z0-9_]+)\ is\ not\ set$ ]]; then
    sym=${BASH_REMATCH[1]}
    if grep -qE "^$sym=[ym]$" .config; then echo "enabled despite fragment: $sym" >&2; missing=1; fi
  elif [[ $line =~ ^CONFIG_ ]]; then
    grep -qxF "$line" .config || { echo "fragment line dropped: $line" >&2; missing=1; }
  fi
done <"$repo/factory/wsl/kernel/wsl-rust.config"
[[ $missing -eq 0 ]] || exit 1
t1=$(date +%s)
{ rustc --version; bindgen --version; clang --version | head -1; } | tee "$out/tools.txt"
make rustavailable 2>&1 | tee "$out/rustavailable.txt"
make -j"$jobs" bzImage modules 2>&1 | tee "$out/build.log" | tail -n 200
t2=$(date +%s)
cp .config "$out/config"; cp arch/x86/boot/bzImage "$out/bzImage"
# WSL cannot use a modules tarball: `.wslconfig` [wsl2] kernelModules= takes a VHD laid out as
# <kernelrelease>/{modules,linux-headers,perf} (Learn wsl-config; Microsoft/scripts/gen_artifacts_vhdx.sh).
krel=$(make -s kernelrelease)
make modules_install INSTALL_MOD_PATH="$work/mods" INSTALL_MOD_STRIP=1 >/dev/null
make headers_install INSTALL_HDR_PATH="$work/hdrs" >/dev/null
mkdir -p "$work/perf/bin"
# perf is best effort; an empty perf/ directory is still accepted by the script, and the report says which case happened.
perf_built=0
if make -C tools/perf -j"$jobs" NO_LIBTRACEEVENT=1 NO_JEVENTS=1 NO_LIBPERL=1 NO_LIBPYTHON=1 NO_SLANG=1 NO_GTK2=1 NO_LIBBPF=1 NO_LIBLLVM=1 prefix=/ DESTDIR="$work/perf" install >"$out/perf-build.log" 2>&1; then perf_built=1; else tail -n 20 "$out/perf-build.log" >&2; fi
curl -fsSL https://raw.githubusercontent.com/microsoft/WSL2-Linux-Kernel/a989171929bed4ea681be8d77333845ce1c1732a/Microsoft/scripts/gen_artifacts_vhdx.sh >"$work/gen_artifacts_vhdx.sh"
bash "$work/gen_artifacts_vhdx.sh" "$work/mods" "$work/hdrs" "$work/perf" "$krel" "$out/modules.vhdx"
cat >"$out/report.json" <<JSON
{"kernel":"$kver","patches":$(find "$repo/factory/wsl/kernel/patches" -name '*.patch' | wc -l),
 "rust":$(grep -c '^CONFIG_RUST=y' .config),"dxgkrnl":"$(grep '^CONFIG_DXGKRNL=' .config)",
 "seconds":{"prepare":$((t1-t0)),"build":$((t2-t1))},
 "kernelrelease":"$krel","perf_built":$perf_built,
 "bytes":{"bzImage":$(stat -c %s "$out/bzImage"),"modules.vhdx":$(stat -c %s "$out/modules.vhdx"),"vmlinux":$(stat -c %s vmlinux)},
 "rust_objects":$(find . -name '*.o' -path '*rust*' | wc -l)}
JSON
cat "$out/report.json"
