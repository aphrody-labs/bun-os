#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Boot a minimal Linux guest under crosvm with KVM (VPS only): the host kernel image plus an initramfs whose init is
# the Bun OS uutils multicall (bunos-utils) running `ls --version`. Pass = the guest kernel boots, uutils prints its
# version from inside the guest, and crosvm exits after the guest reboots (panic=-1).
#   bash factory/rustbase/crosvm-boot.sh <crosvm binary> [bunos-utils binary]
set -euo pipefail
crosvm=${1:?crosvm binary}
base=${RUST_BASE_WORK:-$HOME/build/rust-base}
utils=${2:-$base/out/bunos-utils/target/release/bunos-utils}
work=$base/guest
[ -x "$crosvm" ] || { echo "no crosvm at $crosvm"; exit 1; }
[ -x "$utils" ] || { echo "no bunos-utils at $utils"; exit 1; }
[ -w /dev/kvm ] || { echo "/dev/kvm is not writable"; exit 1; }
rm -rf "$work"; mkdir -p "$work/initramfs/bin" "$work/initramfs/proc" "$work/initramfs/dev"
# The host kernel is mode 0600 on Ubuntu: copy it once.
kernel=/boot/vmlinuz-$(uname -r)
sudo -n install -m 0644 -o "$(id -u)" "$kernel" "$work/vmlinuz"
cp "$utils" "$work/initramfs/bin/bunos-utils"
ln -s bunos-utils "$work/initramfs/bin/ls"
# Dynamic loader and libraries of the multicall.
ldd "$utils" | grep -o '/[^ ]*' | sort -u | while read -r lib; do
  mkdir -p "$work/initramfs$(dirname "$lib")"; cp -L "$lib" "$work/initramfs$lib"
done
(cd "$work/initramfs" && find . | cpio -o -H newc --quiet | gzip -1) > "$work/initramfs.cpio.gz"
echo "crosvm: $("$crosvm" version 2>&1 | head -1)"
echo "kernel: $kernel ($(stat -c %s "$work/vmlinuz") bytes), initramfs $(stat -c %s "$work/initramfs.cpio.gz") bytes"
set +e
timeout 120 "$crosvm" run --disable-sandbox --mem 512 --cpus 1 \
  --serial type=stdout,hardware=serial,num=1,console=true \
  -p "console=ttyS0 panic=-1 quiet loglevel=1 rdinit=/bin/ls -- --version" \
  --initrd "$work/initramfs.cpio.gz" "$work/vmlinuz" > "$work/console.log" 2>&1
code=$?
set -e
cat "$work/console.log" | tr -d '\r' | grep -v '^$' | tail -n 15
echo "crosvm exit: $code"
grep -q "uutils coreutils" "$work/console.log" || { echo "FAIL: uutils did not run in the guest"; exit 1; }
echo "PASS: Linux guest booted under crosvm/KVM and ran uutils ls --version as init"
