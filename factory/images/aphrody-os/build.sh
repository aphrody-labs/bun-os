#!/bin/bash
# SPDX-License-Identifier: MIT
# build.sh IMAGE KERNEL_OUT OUT_DIR: builds aphrody-IMAGE.qcow2 (IMAGE = linux | win32) on the VPS Docker host.
#   KERNEL_OUT  output directory of `bun factory/native-targets.ts build linux-aphrody-bun` (build/, modules/)
#   OUT_DIR     new directory; receives aphrody-IMAGE.qcow2, packages.txt, licenses.txt and receipt.json
# Inputs are pinned in pins.json (Alpine container digest, fork Bun release asset and SHA-256, Windows
# programs). The raw disk is converted to a compressed sparse qcow2 and then deleted.
set -euo pipefail
IMAGE=$1; KERNEL_OUT=$(cd "$2" && pwd); OUT=$3
here=$(cd "$(dirname "$0")" && pwd)
pin() { bun -e "const p=await Bun.file('$here/pins.json').json(); console.log($1)"; }
[ ! -e "$OUT/aphrody-$IMAGE.qcow2" ] || { echo "$OUT already holds an image" >&2; exit 1; }
mkdir -p "$OUT/inputs"; OUT=$(cd "$OUT" && pwd)
cache=${APHRODY_OS_CACHE:-$HOME/build/os-linux-win32/cache}; mkdir -p "$cache"

fetch() { # url sha256 dest
  [ -f "$3" ] && echo "$2  $3" | sha256sum -c --status - && return 0
  curl -fsSL --retry 3 -o "$3.part" "$1"; echo "$2  $3.part" | sha256sum -c --quiet -; mv "$3.part" "$3"
}
bunzip=$cache/$(pin p.bun.asset).zip
fetch "$(pin p.bun.url)" "$(pin p.bun.sha256)" "$bunzip"
rm -rf "$OUT/inputs/bun" && mkdir -p "$OUT/inputs/bun"
unzip -q -j "$bunzip" "$(pin p.bun.asset)/bun" -d "$OUT/inputs/bun"
if [ "$IMAGE" = win32 ]; then
  for name in $(pin "Object.keys(p.windows).join(' ')"); do
    fetch "$(pin "p.windows['$name'].url")" "$(pin "p.windows['$name'].sha256")" "$cache/$name"
    cp "$cache/$name" "$OUT/inputs/$name"
  done
fi

k=$OUT/inputs/kernel; mkdir -p "$k"
cp "$KERNEL_OUT/build/arch/x86/boot/bzImage" "$KERNEL_OUT/build/.config" "$k/"
[ -d "$KERNEL_OUT/modules" ] && cp -a "$KERNEL_OUT/modules" "$k/"
# Fixed partition UUIDs per image (the kernel command line names the root without an initramfs).
case $IMAGE in
  linux) ROOT_UUID=8f3a6a0e-3c1e-4d6e-9b1a-1a6c0a0d0001 ESP_UUID=8f3a6a0e-3c1e-4d6e-9b1a-1a6c0a0de501 ROOT_MIB=6144 ;;
  win32) ROOT_UUID=8f3a6a0e-3c1e-4d6e-9b1a-1a6c0a0d0032 ESP_UUID=8f3a6a0e-3c1e-4d6e-9b1a-1a6c0a0de532 ROOT_MIB=8192 ;;
  *) echo "unknown image $IMAGE" >&2; exit 1 ;;
esac
export ROOT_UUID ESP_UUID ROOT_MIB
alpine=$(pin p.alpine.image)
timeout 5400 docker run --rm --network host \
  -e IMAGE="$IMAGE" -e ROOT_UUID -e ESP_UUID -e ROOT_MIB -e ALPINE="$(pin p.alpine.branch)" \
  -v "$here:/src:ro" -v "$k:/kernel:ro" -v "$OUT/inputs/bun/bun:/bun:ro" -v "$OUT/inputs:/inputs:ro" \
  -v "$OUT:/work" -v "$cache/apk:/var/cache/apk" "$alpine" /bin/sh /src/rootfs.sh

qemu-img convert -c -O qcow2 -o cluster_size=65536 "$OUT/disk.img" "$OUT/aphrody-$IMAGE.qcow2"
rm -f "$OUT/disk.img"
rm -rf "$OUT/root" "$OUT/inputs/bun" "$OUT/inputs/kernel/modules"
sum() { sha256sum "$1" | cut -d' ' -f1; }
src=$(cat "$here/.source-commit" 2>/dev/null || git -C "$here" rev-parse HEAD 2>/dev/null || echo unknown)
cat >"$OUT/receipt.json" <<J
{
  "schemaVersion": 1,
  "image": "aphrody-$IMAGE",
  "builtAt": "$(date -u +%FT%TZ)",
  "host": "$(hostname)",
  "recipe": { "repository": "aphrody-labs/bun-os", "path": "factory/images/aphrody-os", "commit": "$src" },
  "disk": { "file": "aphrody-$IMAGE.qcow2", "sha256": "$(sum "$OUT/aphrody-$IMAGE.qcow2")", "bytes": $(stat -c %s "$OUT/aphrody-$IMAGE.qcow2"), "virtualBytes": $(qemu-img info --output=json "$OUT/aphrody-$IMAGE.qcow2" | bun -e 'console.log((await Bun.stdin.json())["virtual-size"])') },
  "partitions": { "esp": "$ESP_UUID", "root": "$ROOT_UUID" },
  "kernel": { "target": "linux-aphrody-bun", "bzImageSha256": "$(sum "$k/bzImage")", "configSha256": "$(sum "$k/.config")", "release": "$(file -b "$k/bzImage" | sed -n 's/.*version \([^ ]*\).*/\1/p')" },
  "bun": { "release": "$(pin p.bun.release)", "asset": "$(pin p.bun.asset)", "zipSha256": "$(pin p.bun.sha256)" },
  "alpine": { "image": "$alpine", "branch": "$(pin p.alpine.branch)", "packages": "packages.txt", "packagesSha256": "$(sum "$OUT/packages.txt")" }
}
J
cat "$OUT/receipt.json"
