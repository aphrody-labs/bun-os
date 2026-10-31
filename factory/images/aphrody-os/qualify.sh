#!/bin/bash
# SPDX-License-Identifier: MIT
# qualify.sh IMAGE DISK OUT_DIR: boot-to-desktop gate in QEMU q35 + OVMF (UEFI), virtio-blk/net/gpu/input,
# 9p and virtio-serial. Drives the serial console (auto-login), runs aphrody-qual, waits for the desktop
# processes, takes QMP screendumps and writes qualification.json. KVM when available, TCG otherwise
# (ACCEL=tcg forces it, as the browser engines emulate without acceleration).
set -euo pipefail
IMAGE=$1; DISK=$(realpath "$2"); OUT=$3
FW=${OVMF_DIR:-/usr/share/OVMF}
mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd)
ACCEL=${ACCEL:-}; [ -n "$ACCEL" ] || { ACCEL=tcg; [ -w /dev/kvm ] && ACCEL=kvm; }
DESKTOP_SECS=${DESKTOP_SECS:-$([ "$ACCEL" = kvm ] && echo 240 || echo 1500)}
cp -f "$FW/OVMF_VARS_4M.fd" "$OUT/vars.fd"
rm -f "$OUT"/*.sock "$OUT"/serial.log "$OUT"/*.ppm "$OUT"/*.png
mkdir -p "$OUT/share"; echo "aphrody-9p-ok" >"$OUT/share/probe.txt"
case $IMAGE in
  linux) want='cosmic-comp cosmic-panel' ;;
  win32) want='cage Xwayland explorer.exe' ;;
esac
qemu-system-x86_64 -name "aphrody-$IMAGE" -machine q35,accel=$ACCEL -cpu max -smp 4 -m 4096 \
  -drive if=pflash,format=raw,readonly=on,file="$FW/OVMF_CODE_4M.fd" \
  -drive if=pflash,format=raw,file="$OUT/vars.fd" \
  -drive file="$DISK",if=none,id=d0,snapshot=on -device virtio-blk-pci,drive=d0,bootindex=0 \
  -netdev user,id=n0 -device virtio-net-pci,netdev=n0 \
  -device virtio-vga,xres=1280,yres=800 -display none -vnc unix:"$OUT/vnc.sock" \
  -device virtio-keyboard-pci -device virtio-tablet-pci \
  -virtfs local,path="$OUT/share",mount_tag=host,security_model=none,readonly=on \
  -chardev socket,id=ser,path="$OUT/serial.sock",server=on,wait=off,logfile="$OUT/serial.log" -serial chardev:ser \
  -qmp unix:"$OUT/qmp.sock",server=on,wait=off -daemonize -pidfile "$OUT/qemu.pid"
trap 'kill "$(cat "$OUT/qemu.pid")" 2>/dev/null || true' EXIT
start=$(date +%s)
qmp() { printf '{"execute":"qmp_capabilities"}\n%s\n' "$1" | timeout 20 socat - UNIX-CONNECT:"$OUT/qmp.sock" >/dev/null; }
shot() { qmp "{\"execute\":\"screendump\",\"arguments\":{\"filename\":\"$OUT/$1.ppm\",\"format\":\"ppm\"}}"; sleep 1; }
send() { printf '%s\r' "$1" | timeout 5 socat - UNIX-CONNECT:"$OUT/serial.sock" >/dev/null || true; }
waitlog() { # pattern seconds
  local end=$(($(date +%s) + $2))
  while [ "$(date +%s)" -lt "$end" ]; do grep -aq -- "$1" "$OUT/serial.log" 2>/dev/null && return 0; sleep 2; done
  return 1
}
gate() { echo "$1 $2" >>"$OUT/gates.txt"; echo "gate $1: $2"; }
: >"$OUT/gates.txt"
bootmax=$([ "$ACCEL" = kvm ] && echo 120 || echo 1200)
waitlog 'Linux version' "$bootmax" && gate firmware-kernel pass || gate firmware-kernel fail
waitlog 'login:\|Welcome to Alpine\|aphrody-'"$IMAGE"' ' "$bootmax" && gate init pass || gate init fail
shot 01-boot
sleep 5; send ''; sleep 3
send 'aphrody-qual'
waitlog 'qual-done' 180 && grep -aq 'qual-nu [0-9]' "$OUT/serial.log" && gate shell-login pass || gate shell-login fail
# The login shell is nushell; the scripted gates below use POSIX sh.
send 'exec /bin/sh'; sleep 3
send 'sudo mkdir -p /mnt/host; sudo mount -t 9p -o trans=virtio,version=9p2000.L host /mnt/host; cat /mnt/host/probe.txt'
waitlog 'aphrody-9p-ok' 60 && gate 9p pass || gate 9p fail
# Desktop: wait until every expected process runs for the session user, then let it paint.
end=$(($(date +%s) + DESKTOP_SECS)); ok=0
while [ "$(date +%s)" -lt "$end" ]; do
  : >"$OUT/procs.txt.tmp"
  send "pgrep -a -u aphrody . | awk '{print \"proc\", \$2}' | sort -u | tr '\\n' ' '; echo procs-end"
  sleep 8
  line=$(grep -a 'proc ' "$OUT/serial.log" | grep -a 'procs-end' | tail -n1 || true)
  ok=1; for p in $want; do echo "$line" | grep -q "$(basename "$p")" || ok=0; done
  [ $ok = 1 ] && break
done
[ $ok = 1 ] && gate desktop-processes pass || gate desktop-processes fail
sleep $([ "$ACCEL" = kvm ] && echo 25 || echo 120)
shot 02-desktop
if [ "$IMAGE" = linux ]; then
  send 'env XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-1 setsid cosmic-files /home/aphrody >/dev/null 2>&1 &'
  send 'env XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-1 setsid cosmic-term >/dev/null 2>&1 &'
  sleep $([ "$ACCEL" = kvm ] && echo 30 || echo 240)
  send "pgrep -x cosmic-files >/dev/null && echo explorer-running"
  waitlog 'explorer-running' 30 && gate explorer pass || gate explorer fail
  shot 03-explorer
else
  send 'cat ~/.local/state/aphrody-win32-programs.log 2>/dev/null; aphrody-win32-check'
  waitlog 'win32-check-done' 600 && gate win32-programs "$(grep -ac 'win32-ok ' "$OUT/serial.log")-ok" || gate win32-programs fail
  sleep 20
  shot 03-programs
fi
send 'aphrody-qual'; sleep 10
for f in "$OUT"/*.ppm; do
  if command -v convert >/dev/null; then convert "$f" "${f%.ppm}.png"; else bun -e "
    const b=await Bun.file('$f').bytes(); console.log(b.length)" >/dev/null; fi
done
elapsed=$(( $(date +%s) - start ))
bun -e "
const gates = Object.fromEntries((await Bun.file('$OUT/gates.txt').text()).trim().split('\n').map(l => l.split(' ')));
const log = await Bun.file('$OUT/serial.log').text();
const facts = Object.fromEntries([...log.matchAll(/^(qual-[a-z0-9-]+) (.*)\$/gm)].map(m => [m[1], m[2].trim()]));
const shots = [...new Bun.Glob('*.{png,ppm}').scanSync('$OUT')].sort();
const out = { schemaVersion: 1, image: 'aphrody-$IMAGE', disk: '$(basename "$DISK")', diskSha256: '$(sha256sum "$DISK" | cut -d' ' -f1)',
  firmware: 'OVMF $(dpkg-query -W -f '${Version}' ovmf 2>/dev/null)', qemu: '$(qemu-system-x86_64 --version | head -n1)', accel: '$ACCEL',
  observedAt: new Date().toISOString(), host: '$(hostname)', elapsedSeconds: $elapsed, gates, facts, screenshots: shots };
await Bun.write('$OUT/qualification.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(gates));
"
