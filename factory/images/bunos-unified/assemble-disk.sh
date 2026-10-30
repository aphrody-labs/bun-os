#!/bin/bash
# SPDX-License-Identifier: MIT
# assemble-disk.sh [workdir] [tag]: on the VPS Docker host, turn bunos-unified:unified into a UEFI GPT disk image
# (ESP with systemd-boot + ext4 root). Runs the copy inside the image itself without --privileged and without a loop
# device: mkfs.vfat/mtools fill the ESP, mkfs.ext4 -d fills the root. Output: $W/bunos-unified.img (+ .sha256).
set -euo pipefail
W=${1:-/home/ubuntu/bun-os-disk/unified}; TAG=${2:-bunos-unified:unified}
mkdir -p "$W"
timeout 3600 docker run --rm --entrypoint /bin/bash -v "$W:/work" "$TAG" -euo pipefail -c '
  apt-get update -qq >/dev/null && apt-get install -y -qq dosfstools mtools fdisk e2fsprogs >/dev/null
  W=/work; IMG=bunos-unified.img; ESP_MIB=512; ROOT_MIB=${ROOT_MIB:-20480}
  rm -rf $W/root $W/esp $W/*.part $W/$IMG; mkdir -p $W/root $W/esp/EFI/BOOT $W/esp/loader/entries
  tar -C / --one-file-system --exclude=./work --exclude=./proc --exclude=./sys --exclude=./dev -cpf - . | tar -C $W/root -xpf -
  cd $W/root
  mkdir -p proc sys dev run tmp boot/efi; chmod 1777 tmp
  echo bunos >etc/hostname; printf "127.0.0.1 localhost\n127.0.1.1 bunos\n" >etc/hosts
  rm -f etc/machine-id; : >etc/machine-id
  ln -sfn ../run/systemd/resolve/stub-resolv.conf etc/resolv.conf
  K=$(ls boot/vmlinuz-* | sort -V | tail -n1); V=${K#boot/vmlinuz-}
  cp usr/lib/systemd/boot/efi/systemd-bootx64.efi $W/esp/EFI/BOOT/BOOTX64.EFI
  cp "boot/vmlinuz-$V" $W/esp/vmlinuz; cp "boot/initrd.img-$V" $W/esp/initrd.img
  printf "default bunos.conf\ntimeout 2\nconsole-mode keep\n" >$W/esp/loader/loader.conf
  printf "title Bun OS\nlinux /vmlinuz\ninitrd /initrd.img\noptions root=LABEL=bunos-root rw console=tty0 console=ttyS0,115200 systemd.show_status=1\n" >$W/esp/loader/entries/bunos.conf
  cd $W
  truncate -s ${ESP_MIB}M esp.part; mkfs.vfat -F32 -n BUNOS-ESP esp.part >/dev/null; mcopy -s -i esp.part esp/* ::
  truncate -s ${ROOT_MIB}M root.part; mkfs.ext4 -q -L bunos-root -d root root.part
  truncate -s $((ESP_MIB+ROOT_MIB+2))M $IMG
  printf "label: gpt\nfirst-lba: 2048\nstart=2048, size=$((ESP_MIB*2048)), type=C12A7328-F81F-11D2-BA4B-00A0C93EC93B, name=ESP\nsize=$((ROOT_MIB*2048)), type=4F68BCE3-E8CD-4DB1-96E7-FBCAF984B709, name=bunos-root\n" | sfdisk -q $IMG
  dd if=esp.part of=$IMG bs=1M seek=1 conv=notrunc,sparse status=none
  dd if=root.part of=$IMG bs=1M seek=$((1+ESP_MIB)) conv=notrunc,sparse status=none
  rm -rf root esp esp.part root.part
'
cd "$W" && sha256sum bunos-unified.img >bunos-unified.img.sha256 && cat bunos-unified.img.sha256
