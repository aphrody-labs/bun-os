#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Boots Android 17 (Waydroid, LineageOS a17 image) headless in a QEMU/KVM guest that runs a linux-bun kernel, and
# proves it end to end: binderfs from the Rust binder, the LXC container, Android's sys.boot_completed=1, and a
# screencap of the Android display copied out of the guest.
#
#   factory/kernel/boot-waydroid.sh [path/to/linux-bun-*.pkg.tar.zst]
#   env: WAYDROID_IMAGES  directory with system.img + vendor.img (default ~/.cache/bunos-waydroid/a17/images)
#        BOOT_OUT         output directory (default ~/build/out/boot-waydroid)
#        BOOT_TIMEOUT     seconds for the whole guest run (default 1500)
#
# Guest: archlinux:base + Arch's lxc/python-gbinder/weston + Waydroid built from the aphrody-labs fork
# (vendor/waydroid, `make install` as bunos-wsl-native.sh does), the package's vmlinuz and modules, no initramfs
# (android.config builds ext4 and virtio-blk in). The images ride on a second, read-only disk mounted at
# /usr/share/waydroid-extra/images, so `waydroid init` takes them as preinstalled images (no download).
# Output: console.log, screen.png, report.json (guest facts), receipt.json. Never run on the workstation.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
repo="${PACMAN_REPO:-$HOME/build/storage/artifacts/pacman/bunos-testing/x86_64}"
pkg="${1:-$(ls -t "$repo"/linux-bun-[0-9]*.pkg.tar.zst | grep -v headers | head -1)}"
images="${WAYDROID_IMAGES:-$HOME/.cache/bunos-waydroid/a17/images}"
out="${BOOT_OUT:-$HOME/build/out/boot-waydroid}"
[[ -f $images/system.img && -f $images/vendor.img ]] || { echo "no system.img/vendor.img in $images" >&2; exit 1; }
rm -rf "$out" && mkdir -p "$out/ctx/kroot" "$out/share"
echo "package: $pkg"

tar --zstd -xf "$pkg" -C "$out/ctx/kroot" usr/lib/modules
vmlinuz="$(ls "$out"/ctx/kroot/usr/lib/modules/*/vmlinuz)"
release="$(basename "$(dirname "$vmlinuz")")"
cp "$vmlinuz" "$out/vmlinuz"
git -C "$root/vendor/waydroid" archive -o "$out/ctx/waydroid-src.tar.gz" HEAD

# The test, run once by systemd in the guest; everything it prints goes to the serial console.
cat >"$out/ctx/bunos-waydroid-test" <<'GUEST'
#!/bin/bash
set -x
modprobe -a 9pnet_virtio 9p
mkdir -p /mnt/out && mount -t 9p -o trans=virtio,version=9p2000.L out /mnt/out
facts() { printf '%s=%s\n' "$1" "$2" >>/mnt/out/facts.txt; }
facts kernel "$(uname -r)"
facts binderfs "$(grep -c binder /proc/filesystems)"
modprobe vgem
waydroid init
python - /var/lib/waydroid/waydroid.cfg <<'PY'
import configparser, sys
p = sys.argv[1]; c = configparser.ConfigParser(); c.optionxform = str; c.read(p)
c.setdefault("properties", {})
c["properties"].update({"ro.hardware.gralloc": "default", "persist.waydroid.width": "1280",
                        "persist.waydroid.height": "800", "persist.waydroid.multi_windows": "false"})
with open(p, "w") as f: c.write(f)
PY
waydroid upgrade -o
systemctl restart waydroid-container.service
install -d -o bun -g bun -m 700 /run/user/1000
as_bun() { runuser -u bun -- env XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 "$@"; }
as_bun weston --backend=headless --renderer=pixman --width=1280 --height=800 --socket=wayland-0 >/mnt/out/weston.log 2>&1 &
sleep 3
as_bun dbus-run-session -- waydroid session start >/mnt/out/session.log 2>&1 &
booted=0
for i in $(seq 1 240); do
  [[ "$(waydroid shell -- getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]] && { booted=1; break; }
  sleep 5
done
facts boot_seconds "$((i * 5))"
facts boot_completed "$booted"
ls /dev/binderfs >/mnt/out/binderfs.txt 2>&1
for p in ro.build.version.release ro.build.version.sdk ro.build.fingerprint ro.lineage.version ro.hardware.egl; do
  facts "$p" "$(waydroid shell -- getprop "$p" 2>/dev/null | tr -d '\r')"
done
if [[ $booted == 1 ]]; then
  sleep 20
  waydroid shell -- screencap -p /data/local/tmp/screen.png
  cp /home/bun/.local/share/waydroid/data/local/tmp/screen.png /mnt/out/screen.png
fi
waydroid shell -- logcat -d -t 400 >/mnt/out/logcat.txt 2>&1
cp /var/lib/waydroid/waydroid.log /mnt/out/ 2>/dev/null
dmesg >/mnt/out/dmesg.txt
[[ $booted == 1 && -s /mnt/out/screen.png ]] && echo BUNOS-WAYDROID-OK || echo BUNOS-WAYDROID-FAILED
sync
systemctl poweroff
GUEST
cat >"$out/ctx/bunos-waydroid-test.service" <<'UNIT'
[Unit]
Description=Bun OS: Android 17 under Waydroid on linux-bun (factory/kernel/boot-waydroid.sh)
After=network.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/bunos-waydroid-test
StandardOutput=journal+console
StandardError=journal+console
[Install]
WantedBy=multi-user.target
UNIT
cat >"$out/ctx/Dockerfile" <<'DOCKER'
FROM archlinux:base
RUN pacman -Syu --noconfirm --needed lxc python python-gbinder python-gobject python-dbus dnsmasq nftables \
      iptables-nft weston mesa make kmod iproute2 which && pacman -Scc --noconfirm
COPY kroot/usr/lib/modules /usr/lib/modules
COPY waydroid-src.tar.gz /tmp/
RUN install -d /opt/bunos/src/waydroid && tar -xzf /tmp/waydroid-src.tar.gz -C /opt/bunos/src/waydroid && rm /tmp/waydroid-src.tar.gz && \
    make -C /opt/bunos/src/waydroid install USE_SYSTEMD=1 USE_DBUS_ACTIVATION=1 USE_NFTABLES=1 && \
    depmod "$(ls /usr/lib/modules)"
COPY bunos-waydroid-test /usr/local/bin/
COPY bunos-waydroid-test.service /etc/systemd/system/
RUN chmod 755 /usr/local/bin/bunos-waydroid-test && useradd -m -u 1000 bun && \
    systemctl enable bunos-waydroid-test.service waydroid-container.service && \
    systemctl mask systemd-firstboot.service systemd-homed.service && \
    install -d /usr/share/waydroid-extra/images && \
    printf 'LABEL=wdimages /usr/share/waydroid-extra/images ext4 ro 0 0\n' >>/etc/fstab && \
    systemd-machine-id-setup && printf 'bunos-android\n' >/etc/hostname
DOCKER
tag="bunos-waydroid-vm:$release"
docker build -q -t "$tag" "$out/ctx" >/dev/null
cid=$(docker create "$tag")
docker export "$cid" -o "$out/rootfs.tar" && docker rm "$cid" >/dev/null
# /.dockerenv would make systemd treat the VM as a container.
tar --delete -f "$out/rootfs.tar" .dockerenv 2>/dev/null || true
# mke2fs >= 1.47.1 populates from a tarball and keeps its owners and modes (no root needed).
mke2fs -q -t ext4 -L bunosroot -d "$out/rootfs.tar" "$out/root.img" 16G
rm "$out/rootfs.tar"
mke2fs -q -t ext4 -L wdimages -d "$images" "$out/images.img" "$(( $(du -sm "$images" | cut -f1) + 512 ))M"

timeout "${BOOT_TIMEOUT:-1500}" qemu-system-x86_64 -enable-kvm -cpu host -smp 4 -m 6144 -nographic -no-reboot \
  -kernel "$out/vmlinuz" -append "console=ttyS0 root=LABEL=bunosroot rw rootfstype=ext4 panic=-1" \
  -drive "file=$out/root.img,format=raw,if=virtio" -drive "file=$out/images.img,format=raw,if=virtio,readonly=on" \
  -virtfs "local,path=$out/share,mount_tag=out,security_model=none,id=out" \
  -netdev user,id=n0 -device virtio-net-pci,netdev=n0 </dev/null | tee "$out/console.log" || true
cp "$out"/share/* "$out/" 2>/dev/null || true
jq -Rn '[inputs | capture("^(?<k>[^=]+)=(?<v>.*)$")] | from_entries' "$out/facts.txt" >"$out/report.json" 2>/dev/null || true
if grep -q BUNOS-WAYDROID-OK "$out/console.log" && [[ -s $out/screen.png ]]; then
  jq -c --arg kernel "$release" --arg package "$(basename "$pkg")" \
    --arg vmlinuz_sha256 "$(sha256sum "$out/vmlinuz" | cut -d' ' -f1)" \
    --arg system_sha256 "$(sha256sum "$images/system.img" | cut -d' ' -f1)" \
    --arg vendor_sha256 "$(sha256sum "$images/vendor.img" | cut -d' ' -f1)" \
    --arg screen_sha256 "$(sha256sum "$out/screen.png" | cut -d' ' -f1)" --arg at "$(date -u +%FT%TZ)" \
    '{kernel: $kernel, package: $package, vmlinuz_sha256: $vmlinuz_sha256, system_sha256: $system_sha256,
      vendor_sha256: $vendor_sha256, screen_sha256: $screen_sha256, result: "BUNOS-WAYDROID-OK", guest: ., at: $at}' \
    "$out/report.json" >"$out/receipt.json"
  rm -f "$out/root.img" "$out/images.img"
  echo "qualified: Android 17 booted under Waydroid on $release ($out/receipt.json, $out/screen.png)"
else
  echo "Waydroid did not reach sys.boot_completed with a screenshot; see $out/console.log and $out/*.txt" >&2
  exit 1
fi
