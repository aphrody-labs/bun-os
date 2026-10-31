#!/bin/bash
# SPDX-License-Identifier: MIT
# reactos.sh ISO OUT_DIR FIRMWARE [KEYS...]: boots the ReactOS i386 ISO (unified boot/live CD) in QEMU and
# records screenshots. FIRMWARE = bios (SeaBIOS, i440fx, IDE) or ovmf (q35 + OVMF x64).
# KEYS are QMP send-key steps "WAIT:key[,key]" (seconds after boot, then the keys), so a
# run can pick the LiveCD entry and open programs. Writes reactos.json with the observed result.
set -euo pipefail
ISO=$(realpath "$1"); OUT=$2; FW=$3; shift 3
mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd); rm -f "$OUT"/*.sock "$OUT"/*.ppm "$OUT"/*.png "$OUT/serial.log"
ACCEL=${ACCEL:-}; [ -n "$ACCEL" ] || { ACCEL=tcg; [ -w /dev/kvm ] && ACCEL=kvm; }
SECS=${SECS:-240}
case $FW in
  bios) fw=(-machine pc,accel=$ACCEL) ;;
  ovmf) cp -f /usr/share/OVMF/OVMF_VARS_4M.fd "$OUT/vars.fd"
    fw=(-machine q35,accel=$ACCEL -drive if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.fd
        -drive if=pflash,format=raw,file="$OUT/vars.fd") ;;
  *) echo "firmware: bios | ovmf" >&2; exit 1 ;;
esac
qemu-img create -q -f qcow2 "$OUT/hd.qcow2" 8G
qemu=qemu-system-i386; [ "$FW" = ovmf ] && qemu=qemu-system-x86_64
$qemu "${fw[@]}" -cpu max -m 1024 -smp 1 -vga std   -drive file="$ISO",media=cdrom,readonly=on -drive file="$OUT/hd.qcow2",if=ide -boot d   -nic user,model=pcnet -usb -device usb-tablet -display none -vnc unix:"$OUT/vnc.sock"   -serial file:"$OUT/serial.log" -qmp unix:"$OUT/qmp.sock",server=on,wait=off   -daemonize -pidfile "$OUT/qemu.pid"
trap 'kill "$(cat "$OUT/qemu.pid")" 2>/dev/null || true; rm -f "$OUT/hd.qcow2"' EXIT
qmp() { printf '{"execute":"qmp_capabilities"}\n%s\n' "$1" | timeout 20 socat - UNIX-CONNECT:"$OUT/qmp.sock" >/dev/null; }
shot() { qmp "{\"execute\":\"screendump\",\"arguments\":{\"filename\":\"$OUT/$1.ppm\"}}"; sleep 1
  convert "$OUT/$1.ppm" "$OUT/$1.png" && rm -f "$OUT/$1.ppm"; }
keys() { local list=() k; IFS=, read -ra ks <<<"$1"
  for k in "${ks[@]}"; do list+=("{\"type\":\"qcode\",\"data\":\"$k\"}"); done
  local IFS=,; qmp "{\"execute\":\"send-key\",\"arguments\":{\"keys\":[${list[*]}]}}"; }
start=$(date +%s); n=0
for step in "$@"; do
  at=${step%%:*}; k=${step#*:}
  while [ $(( $(date +%s) - start )) -lt "$at" ]; do sleep 1; done
  n=$((n + 1)); shot "$(printf '%02d' $n)-t$at"
  if [ "${k#text=}" != "$k" ]; then
    t=${k#text=}; for ((i = 0; i < ${#t}; i++)); do c=${t:i:1}
      case $c in ' ') keys spc ;; '.') keys dot ;; '\') keys backslash ;; ':') keys shift,semicolon ;; *) keys "$c" ;; esac; done
  else keys "$k"; fi
done
while [ $(( $(date +%s) - start )) -lt "$SECS" ]; do sleep 2; done
shot final
bun -e "
const shots=[...new Bun.Glob('*.png').scanSync('$OUT')].sort();
await Bun.write('$OUT/reactos.json', JSON.stringify({schemaVersion:1, iso:'$(basename "$ISO")', isoSha256:'$(sha256sum "$ISO" | cut -d' ' -f1)',
  firmware:'$FW', accel:'$ACCEL', qemu:'$(qemu-system-x86_64 --version | head -n1)', observedAt:new Date().toISOString(),
  steps: process.argv.slice(1), screenshots: shots, serialBytes: Bun.file('$OUT/serial.log').size}, null, 2)+'\n');" -- "$@"
ls "$OUT"
