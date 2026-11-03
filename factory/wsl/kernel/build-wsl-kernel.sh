#!/usr/bin/env bash
# Build the WSL2 kernel (newest kernel.org mainline or stable + WSL patch series + Rust) on a Linux host or the GitHub
# ubuntu runner.
# Usage: build-wsl-kernel.sh <repo-root> <work-dir> <out-dir>
#   env: KVER   latest (default: the newest of kernel.org's mainline and stable releases), or a version such as
#               7.4-rc1 or 7.3.1. A release candidate comes from Linus's signed git tag (rc tarballs carry no .sign);
#               a release comes from the cdn.kernel.org tarball and its .sign.
#        JOBS   make -j (default: all CPUs)
# Never run on the Windows workstation, never under WSL (owner rule). Output: bzImage,
# modules.vhdx, config, report.json (times, sizes, tool versions). Anything not produced is not claimed.
set -euo pipefail
# mke2fs (gen_artifacts_vhdx.sh) lives in /usr/sbin, which a minimal service PATH may lack.
export PATH="$PATH:/usr/sbin:/sbin"
repo=$(realpath "$1"); work=$2; out=$3
kver=${KVER:-latest}
jobs=${JOBS:-$(nproc)}
mkdir -p "$work" "$out"; work=$(realpath "$work"); out=$(realpath "$out")
cd "$work"
t0=$(date +%s)
# Sort key for kernel.org versions: X.Y-rcN sorts before X.Y, which sorts before X.Y.Z.
vkey() { local v=$1 r=9999; [[ $v =~ ^(.*)-rc([0-9]+)$ ]] && { v=${BASH_REMATCH[1]}; r=${BASH_REMATCH[2]}; }
  [[ $v =~ ^[0-9]+\.[0-9]+$ ]] && v=$v.0; [[ $r -eq 9999 ]] || v=${v%.*}.0; echo "$v.$r"; }
if [[ $kver == latest ]]; then
  kver=$(curl -fsSL https://www.kernel.org/releases.json | bun -e '
    const r = (await Bun.stdin.json()).releases.filter(x => x.moniker === "mainline" || x.moniker === "stable");
    for (const x of r) console.log(x.version);' | while read -r v; do echo "$(vkey "$v") $v"; done | sort -V | tail -1 | cut -d" " -f2)
  echo "newest kernel.org mainline/stable: $kver"
fi
[[ $kver =~ ^[0-9]+\.[0-9]+(\.[0-9]+|-rc[0-9]+)?$ ]] || { echo "unsupported KVER: $kver" >&2; exit 1; }
# PGP check against the three keys vendored by linux-bun (Torvalds, Kroah-Hartman, heftig).
GNUPGHOME=$(mktemp -d); export GNUPGHOME; chmod 700 "$GNUPGHOME"
for k in "$repo"/factory/kernel/linux-bun/keys/pgp/*.asc; do gpg --batch --import "$k" 2>/dev/null; done
rm -rf "linux-$kver"
if [[ $kver == *-rc* ]]; then
  # Release candidates: Linus's annotated tag, signed by his key (ABAF11C65A2970B130ABE3C479BE3E4300411886).
  git init -q linux-mainline.git 2>/dev/null || true
  git -C linux-mainline.git fetch -q --depth 1 https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git tag "v$kver"
  git -C linux-mainline.git verify-tag --raw "v$kver" 2>&1 | tee "$out/tag-verify.txt" |
    grep -q '^\[GNUPG:\] VALIDSIG ABAF11C65A2970B130ABE3C479BE3E4300411886 ' ||
    { echo "v$kver: no valid signature by Linus Torvalds" >&2; cat "$out/tag-verify.txt" >&2; exit 1; }
  mkdir "linux-$kver"; git -C linux-mainline.git archive "v$kver" | tar -x -C "linux-$kver"
  cd "linux-$kver"
else
  base=https://cdn.kernel.org/pub/linux/kernel/v${kver%%.*}.x
  curl -fsSLO "$base/linux-$kver.tar.xz"; curl -fsSLO "$base/linux-$kver.tar.sign"
  xz -dc "linux-$kver.tar.xz" >linux.tar
  gpg --batch --verify "linux-$kver.tar.sign" linux.tar
  tar xf linux.tar && rm linux.tar && cd "linux-$kver"
fi
for p in "$repo"/factory/wsl/kernel/patches/*.patch; do patch -p1 --no-backup-if-mismatch <"$p"; done
# Microsoft's config at the commit the series was ported from, then adapted to the new tree.
curl -fsSL https://raw.githubusercontent.com/microsoft/WSL2-Linux-Kernel/a989171929bed4ea681be8d77333845ce1c1732a/arch/x86/configs/config-wsl >.config
export LLVM=1
# CONFIG_RUST is invisible unless `make rustavailable` passes (rustc, bindgen, libclang and the rust-src
# component); check it first so a missing component fails here with the real reason, not as a dropped line.
make rustavailable || { echo "Rust toolchain unusable for the kernel (rustup component add rust-src?)" >&2; exit 1; }
make olddefconfig
# Fragments in order: Rust + identity, Android 17 (the linux-bun fragment, shared: Rust binder for Waydroid, AOSP
# requirements), Docker/Waydroid networking, desktop (vkms), Hyper-V latency.
fragfiles=("$repo/factory/wsl/kernel/wsl-rust.config" "$repo/factory/kernel/linux-bun/android.config")
for f in wsl-docker wsl-desktop wsl-latency; do fragfiles+=("$repo/factory/wsl/kernel/$f.config"); done
scripts/kconfig/merge_config.sh -m .config "${fragfiles[@]}"
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
done < <(cat "${fragfiles[@]}")
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
 "binder":"$(grep -E '^CONFIG_ANDROID_(BINDERFS|BINDER_IPC_RUST)=' .config | tr '\n' ' ')","hz":$(grep -oP '^CONFIG_HZ=\K[0-9]+' .config),
 "seconds":{"prepare":$((t1-t0)),"build":$((t2-t1))},
 "kernelrelease":"$krel","perf_built":$perf_built,
 "bytes":{"bzImage":$(stat -c %s "$out/bzImage"),"modules.vhdx":$(stat -c %s "$out/modules.vhdx"),"vmlinux":$(stat -c %s vmlinux)},
 "rust_objects":$(find . -name '*.o' -path '*rust*' | wc -l)}
JSON
cat "$out/report.json"
