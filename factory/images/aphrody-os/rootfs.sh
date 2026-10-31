#!/bin/sh
# SPDX-License-Identifier: MIT
# Runs as root inside the pinned alpine container started by build.sh (no --privileged, no loop device).
#   /src     this directory (read-only)    /kernel  bzImage, .config and modules/ from linux-aphrody-bun
#   /bun     the fork's musl Bun            /work    output directory
# Builds the rootfs with apk --root, writes the ESP tree, then an ext4 root and a FAT ESP joined into a GPT
# disk image (raw, sparse). IMAGE selects linux or win32.
set -eu
IMAGE=${IMAGE:?linux or win32}
ALPINE=${ALPINE:-v3.24}
MIRROR=${MIRROR:-https://dl-cdn.alpinelinux.org/alpine}
ROOT_MIB=${ROOT_MIB:-6144}
ESP_MIB=${ESP_MIB:-256}
# Fixed partition UUIDs: the kernel command line finds its root without an initramfs.
ROOT_UUID=${ROOT_UUID:?}
ESP_UUID=${ESP_UUID:?}
W=/work; R=$W/root; E=$W/esp
rm -rf "$R" "$E" "$W/root.img" "$W/esp.img" "$W/disk.img"
mkdir -p "$R/etc/apk" "$E"

apk add --no-cache e2fsprogs dosfstools mtools sfdisk >/dev/null
printf '%s/%s/main\n%s/%s/community\n' "$MIRROR" "$ALPINE" "$MIRROR" "$ALPINE" >"$R/etc/apk/repositories"
cp -a /etc/apk/keys "$R/etc/apk/keys"
pkgs=$(cat /src/base.packages "/src/$IMAGE.packages" | sed 's/#.*//' | tr -s ' \n' ' ')
echo "== apk --root ($IMAGE)"
# shellcheck disable=SC2086
apk --root "$R" --initdb --arch x86_64 --no-cache --update-cache add $pkgs
apk --root "$R" info -v 2>/dev/null | sort >"$W/packages.txt"

echo "== Aphrody Bun, kernel modules, overlays"
install -D -m 0755 /bun "$R/usr/bin/bun"
ln -sf bun "$R/usr/bin/bunx"
[ -d /kernel/modules/lib/modules ] && cp -a /kernel/modules/lib/modules "$R/lib/"
cp -a /src/overlay/common/. "$R/"
[ -d "/src/overlay/$IMAGE" ] && cp -a "/src/overlay/$IMAGE/." "$R/"
chmod 0755 "$R"/usr/local/bin/* 2>/dev/null || true
chmod 0440 "$R/etc/sudoers.d/aphrody"

echo "== system configuration"
echo "aphrody-$IMAGE" >"$R/etc/hostname"
printf '127.0.0.1 localhost aphrody-%s\n::1 localhost\n' "$IMAGE" >"$R/etc/hosts"
cat >"$R/etc/fstab" <<F
PARTUUID=$ROOT_UUID / ext4 rw,relatime 0 1
PARTUUID=$ESP_UUID /efi vfat rw,umask=0077 0 2
tmpfs /tmp tmpfs nosuid,nodev,mode=1777 0 0
F
mkdir -p "$R/efi"
ln -sf /usr/share/zoneinfo/UTC "$R/etc/localtime"
grep -qx /usr/bin/nu "$R/etc/shells" || echo /usr/bin/nu >>"$R/etc/shells"
# chroot-free account setup: edit the databases apk installed.
sed -i 's|^root:[^:]*:|root:*:|' "$R/etc/shadow"
echo 'aphrody:x:1000:1000:Aphrody:/home/aphrody:/usr/bin/nu' >>"$R/etc/passwd"
echo 'aphrody::20000:0:99999:7:::' >>"$R/etc/shadow"
echo 'aphrody:x:1000:' >>"$R/etc/group"
for g in wheel video input audio seat render netdev; do
  if grep -q "^$g:" "$R/etc/group"; then
    sed -i "/^$g:/ s/\$/,aphrody/; /^$g:/ s/:,aphrody\$/:aphrody/" "$R/etc/group"
  else
    echo "$g:x:$(awk -F: 'BEGIN{m=900}{if($3>=m&&$3<1000)m=$3+1}END{print m}' "$R/etc/group"):aphrody" >>"$R/etc/group"
  fi
done
mkdir -p "$R/home/aphrody"
cp -a /src/overlay/home/. "$R/home/aphrody/"
[ -d "/src/overlay/home-$IMAGE" ] && cp -a "/src/overlay/home-$IMAGE/." "$R/home/aphrody/"
chown -R 1000:1000 "$R/home/aphrody"
[ "$IMAGE" = win32 ] && sh /src/wineprefix.sh "$R"
chmod 0755 "$R"/etc/local.d/*.start
# Services (OpenRC runlevels as symlinks, the layout rc-update writes).
svc() { mkdir -p "$R/etc/runlevels/$1"; ln -sf "/etc/init.d/$2" "$R/etc/runlevels/$1/$2"; }
for s in devfs dmesg udev udev-trigger udev-settle; do svc sysinit $s; done
for s in hwclock modules sysctl hostname bootmisc syslog; do svc boot $s; done
for s in dbus seatd dhcpcd local; do svc default $s; done
for s in mount-ro killprocs savecache; do svc shutdown $s; done
cat >"$R/etc/inittab" <<'I'
::sysinit:/sbin/openrc sysinit
::sysinit:/sbin/openrc boot
::wait:/sbin/openrc default
tty1::respawn:/sbin/agetty --autologin aphrody --noclear 38400 tty1 linux
tty2::respawn:/sbin/agetty 38400 tty2 linux
ttyS0::respawn:/sbin/agetty --autologin aphrody -L 115200 ttyS0 vt100
::ctrlaltdel:/sbin/reboot
::shutdown:/sbin/openrc shutdown
I
cat >"$R/etc/os-release" <<O
NAME="Aphrody $IMAGE"
ID=aphrody
ID_LIKE=alpine
VERSION_ID=$(cat "$R/etc/alpine-release")
PRETTY_NAME="Aphrody $IMAGE (Alpine $(cat "$R/etc/alpine-release"), linux-aphrody-bun)"
HOME_URL="https://$IMAGE.aphrody.com/"
O

echo "== ESP: systemd-boot loader, kernel at \\EFI\\aphrody\\linux.efi"
# aphrody-boot replaces BOOTX64.EFI and chains the same \EFI\aphrody\linux.efi with loader/entries.
apk --root "$W/sdboot" --initdb --arch x86_64 --no-cache --allow-untrusted \
  --repositories-file "$R/etc/apk/repositories" --keys-dir "$R/etc/apk/keys" add systemd-boot >/dev/null
mkdir -p "$E/EFI/BOOT" "$E/EFI/aphrody" "$E/loader/entries"
cp "$W/sdboot/usr/lib/systemd/boot/efi/systemd-bootx64.efi" "$E/EFI/BOOT/BOOTX64.EFI"
apk --root "$W/sdboot" info -v 2>/dev/null | grep systemd-boot >>"$W/packages.txt"
rm -rf "$W/sdboot"
cp /kernel/bzImage "$E/EFI/aphrody/linux.efi"
CMD="root=PARTUUID=$ROOT_UUID rootfstype=ext4 rw console=tty0 console=ttyS0,115200 loglevel=4"
printf 'default aphrody.conf\ntimeout 1\nconsole-mode keep\n' >"$E/loader/loader.conf"
printf 'title Aphrody %s\nlinux /EFI/aphrody/linux.efi\noptions %s\n' "$IMAGE" "$CMD" >"$E/loader/entries/aphrody.conf"
printf 'title Aphrody %s (text console)\nlinux /EFI/aphrody/linux.efi\noptions %s aphrody.session=none\n' "$IMAGE" "$CMD" \
  >"$E/loader/entries/aphrody-console.conf"
# OVMF falls back to this script when no boot entry loads.
printf 'fs0:\\EFI\\aphrody\\linux.efi %s\n' "$CMD" >"$E/startup.nsh"

echo "== filesystems"
cd "$W"
truncate -s "${ESP_MIB}M" esp.img
mkfs.vfat -F32 -n APHRODY-ESP esp.img >/dev/null
mcopy -s -i esp.img "$E"/* ::
truncate -s "${ROOT_MIB}M" root.img
mkfs.ext4 -q -F -L "aphrody-$IMAGE" -E root_owner=0:0 -d "$R" root.img
truncate -s $((ESP_MIB + ROOT_MIB + 2))M disk.img
sfdisk -q disk.img <<S
label: gpt
first-lba: 2048
start=2048, size=$((ESP_MIB * 2048)), type=C12A7328-F81F-11D2-BA4B-00A0C93EC93B, uuid=$ESP_UUID, name="ESP"
size=$((ROOT_MIB * 2048)), type=4F68BCE3-E8CD-4DB1-96E7-FBCAF984B709, uuid=$ROOT_UUID, name="aphrody-$IMAGE"
S
dd if=esp.img of=disk.img bs=1M seek=1 conv=notrunc,sparse status=none
dd if=root.img of=disk.img bs=1M seek=$((1 + ESP_MIB)) conv=notrunc,sparse status=none
du -sh "$R" | sed 's/^/rootfs /'
rm -rf "$R" "$E" esp.img root.img
ls -ls disk.img
