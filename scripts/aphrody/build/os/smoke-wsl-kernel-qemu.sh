#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Usage: smoke-wsl-kernel-qemu.sh <kernel-build-dir> <bun-binary> <work-dir>
# Boots the WSL kernel under QEMU (virtio, no Hyper-V, so no /dev/dxg) with an initramfs holding
# busybox and Bun, then checks: userspace shell, kernel config toggles, cgroup2, a .ko.zst module
# from modules_install, and a Bun HTTP loopback request. Prints BUNOS-SMOKE-OK on success.
set -euo pipefail
build=$(realpath -e -- "$1")
bun=$(realpath -e -- "$2")
work=$3
[[ ! -e $work ]] || { echo "Refusing to reuse $work" >&2; exit 2; }
mkdir -p "$work/initramfs"/{bin,usr/bin,proc,sys,dev,tmp,lib/modules,etc}
work=$(realpath -e -- "$work")
root=$work/initramfs
release=$(jq -r .kernelRelease "$build/build-receipt.json")
copy_with_libs() {
  install -Dm0755 "$1" "$root$2"
  ldd "$1" | awk '/=> \//{print $3} /^\s*\/lib/{print $1}' | sort -u | while read -r lib; do
    install -Dm0755 "$(realpath "$lib")" "$root$lib"
  done
}
copy_with_libs "$(command -v busybox)" /bin/busybox
copy_with_libs "$bun" /usr/bin/bun
module=$(find "$build/modules/lib/modules/$release" -name 'zram.ko*' -print -quit)
[[ -n $module ]] || { echo 'zram module missing from modules_install' >&2; exit 1; }
case $module in
  *.zst) zstd -q -d -c "$module" >"$root/lib/modules/zram.ko" ;;
  *) cp "$module" "$root/lib/modules/zram.ko" ;;
esac
cat >"$root/init" <<'EOF'
#!/bin/busybox sh
/bin/busybox --install -s /bin
mount -t proc proc /proc; mount -t sysfs sys /sys; mount -t devtmpfs dev /dev; mount -t tmpfs tmp /tmp
echo "BUNOS-SMOKE uname $(uname -r) $(uname -v)"
zcat /proc/config.gz | grep -E '^CONFIG_(RUST|DXGKRNL|SCHED_BORE|CACHY|HYPERV|VIRTIO_FS|NET_9P|HYPERV_VSOCKETS|BPF_SYSCALL|SCHED_CLASS_EXT|NF_TABLES|OVERLAY_FS|HZ)=' | sed 's/^/BUNOS-SMOKE config /'
mkdir -p /sys/fs/cgroup && mount -t cgroup2 none /sys/fs/cgroup && echo "BUNOS-SMOKE cgroup2 $(cat /sys/fs/cgroup/cgroup.controllers)"
[ -e /sys/kernel/sched_ext/state ] && echo "BUNOS-SMOKE sched_ext $(cat /sys/kernel/sched_ext/state)"
[ -e /proc/sys/kernel/sched_bore ] && echo "BUNOS-SMOKE sched_bore $(cat /proc/sys/kernel/sched_bore)"
insmod /lib/modules/zram.ko && grep -q '^zram ' /proc/modules && echo "BUNOS-SMOKE module zram loaded"
ip link set lo up
/usr/bin/bun -e 'const s=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>new Response("ok")});const t=await (await fetch(s.url)).text();s.stop(true);console.log("BUNOS-SMOKE bun",Bun.version,t)'
echo "BUNOS-SMOKE shell $(sh -c 'echo $((6*7))')"
echo BUNOS-SMOKE-OK
poweroff -f
EOF
chmod 0755 "$root/init"
(cd "$root" && find . -print0 | cpio --null -o -H newc --quiet | gzip -1) >"$work/initramfs.cpio.gz"
accel=(-accel tcg)
if sudo -n test -w /dev/kvm 2>/dev/null; then accel=(-accel kvm -cpu host); fi
sudo -n timeout 300 qemu-system-x86_64 "${accel[@]}" -m 2048 -smp 2 -nographic -no-reboot \
  -kernel "$build/arch/x86/boot/bzImage" -initrd "$work/initramfs.cpio.gz" \
  -append "console=ttyS0 panic=-1 rdinit=/init" -device virtio-rng-pci 2>&1 | tee "$work/console.log"
sudo -n chown "$(id -u):$(id -g)" "$work/console.log" 2>/dev/null || true
grep -q BUNOS-SMOKE-OK "$work/console.log"
