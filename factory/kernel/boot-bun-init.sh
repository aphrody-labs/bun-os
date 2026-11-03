#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Qualifies Bun as PID 1 on a linux-bun package (factory/kernel/ROADMAP.md, Phase 0 step 3):
#   1. compile packages/bunos-init into a single executable (`bun build --compile`);
#   2. build an initramfs with the kernel's own usr/gen_init_cpio (no root needed: /dev/console is a cpio entry)
#      holding /init and exactly the shared libraries it links (from ldd);
#   3. boot the package's vmlinuz with it under QEMU/KVM, `rdinit=/init bunos.init=selftest`, and require the
#      BUNOS-INIT-OK line on the serial console followed by a clean power-off.
#
#   factory/kernel/boot-bun-init.sh [path/to/linux-bun-*.pkg.tar.zst]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
repo="${PACMAN_REPO:-$HOME/build/storage/artifacts/pacman/bunos-testing/x86_64}"
pkg="${1:-$(ls -t "$repo"/linux-bun-[0-9]*.pkg.tar.zst | grep -v headers | head -1)}"
out="${BOOT_OUT:-$HOME/build/out/boot-bun-init}"
rm -rf "$out" && mkdir -p "$out/rootfs"
echo "package: $pkg"

# 1. Kernel image from the package.
tar --zstd -xf "$pkg" -C "$out/rootfs" --wildcards 'usr/lib/modules/*/vmlinuz'
vmlinuz="$(ls "$out"/rootfs/usr/lib/modules/*/vmlinuz)"
release="$(basename "$(dirname "$vmlinuz")")"

# 2. Bun /init and its libraries.
bun build --compile --minify "$root/packages/bunos-init/src/init.ts" --outfile "$out/init" >/dev/null
gen="$out/gen_init_cpio"
# Any kernel tree has usr/gen_init_cpio.c; the package build leaves one in src/ (linux-7.4-rc1, linux-7.4.1, ...).
cc -O2 -o "$gen" "${KERNEL_SRC:-$(ls -d "$HOME"/build/storage/kernel/linux-bun/src/linux-*/ | head -1)}/usr/gen_init_cpio.c"
{
  echo "dir /dev 0755 0 0"
  echo "nod /dev/console 0600 0 0 c 5 1"
  echo "nod /dev/null 0666 0 0 c 1 3"
  for d in proc sys run tmp lib lib64 usr usr/lib usr/lib64 usr/lib/x86_64-linux-gnu lib/x86_64-linux-gnu; do echo "dir /$d 0755 0 0"; done
  echo "file /init $out/init 0755 0 0"
  # glibc loads libc.so.6 by name for bun:ffi dlopen as well; ldd lists everything the executable links.
  ldd "$out/init" | grep -oE '/[^ ]+' | sort -u | while read -r lib; do
    echo "file $lib $(readlink -f "$lib") 0755 0 0"
  done
} >"$out/initramfs.list"
"$gen" "$out/initramfs.list" | gzip -9 >"$out/initramfs.cpio.gz"
echo "initramfs: $(du -h "$out/initramfs.cpio.gz" | cut -f1), kernel $release"

# 3. Boot under KVM and read the serial console.
timeout 180 qemu-system-x86_64 -enable-kvm -cpu host -smp 2 -m 1024 -nographic -no-reboot \
  -kernel "$vmlinuz" -initrd "$out/initramfs.cpio.gz" \
  -append "console=ttyS0 rdinit=/init bunos.init=selftest panic=-1 quiet" | tee "$out/console.log" || true
# Exactly one report: more would mean the self-test child re-ran init instead of exiting.
if [[ "$(grep -c BUNOS-INIT-OK "$out/console.log")" == 1 ]] && grep -q 'reboot: Power down' "$out/console.log"; then
  printf '{"kernel":"%s","package":"%s","init":"bun","result":"BUNOS-INIT-OK","at":"%s"}\n' \
    "$release" "$(basename "$pkg")" "$(date -u +%FT%TZ)" >"$out/receipt.json"
  echo "qualified: Bun booted as PID 1 on $release ($out/receipt.json)"
else
  echo "Bun as PID 1 did not report BUNOS-INIT-OK; console in $out/console.log" >&2
  exit 1
fi
