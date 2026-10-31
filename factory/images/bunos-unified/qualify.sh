#!/bin/bash
# SPDX-License-Identifier: MIT
# qualify.sh session|disk [out-dir]: qualification of the unified image on the VPS Docker host.
#   session: start one bunos-unified:session container with the production settings of the session manager
#            (docs/UNIFIED-IMAGE.md), wait for /run/bunos/ready, open Helium, a web app and an Android app,
#            list the launcher's desktop entries by kind and take screenshots of cage's output (grim).
#   disk:    boot bunos-unified.img in QEMU/KVM (UEFI, smoke test of the disk image only), serial log + screendump.
set -euo pipefail
MODE=${1:?session|disk}; OUT=${2:-/home/ubuntu/bun-os-disk/qualify-$(date -u +%Y%m%dT%H%M%S)}; mkdir -p "$OUT"
A17=${BUNOS_WAYDROID_IMAGES:-/home/ubuntu/.cache/bunos-waydroid/a17/images}
case "$MODE" in
session)
  name=bunos-unified-qualify; docker rm -f $name >/dev/null 2>&1 || true
  # The binder major is dynamic: allow it in the device cgroup so the private binderfs devices can be opened.
  binder_major=$(rg -o -r '$1' '^\s*(\d+) binder$' /proc/devices)
  install -d -m 0700 "$OUT/secrets"; head -c 32 /dev/urandom | base64 >"$OUT/secrets/session.token"
  docker run -d --name $name --hostname bunos \
    --cap-drop ALL --cap-add SYS_ADMIN --cap-add NET_ADMIN --cap-add NET_RAW --cap-add SETUID --cap-add SETGID \
    --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add KILL --cap-add MKNOD --cap-add SYS_CHROOT \
    --cap-add SETPCAP --cap-add AUDIT_WRITE --security-opt apparmor=unconfined --security-opt seccomp=unconfined \
    --device /dev/dri/renderD128 --device-cgroup-rule "c $binder_major:* rwm" \
    --device /dev/loop-control --device-cgroup-rule "b 7:* rwm" --sysctl net.ipv4.ip_forward=1 --cgroupns private --pids-limit 8192 --shm-size 1g --memory 8g --cpus 4 \
    --tmpfs /run:exec --tmpfs /tmp --tmpfs /var/lib/waydroid --tmpfs /var/lib/misc --tmpfs /var/log \
    -v "$A17:/usr/share/bunos/waydroid/images:ro" -v "$OUT/secrets:/run/secrets:ro" \
    -v bunos-unified-qualify-home:/home/aphrody \
    -e BUNOS_SESSION_SIZE=1600x900 -e APHRODY_REMOTE_TOKEN_FILE=/run/secrets/session.token \
    "${TAG:-bunos-unified:session}" >/dev/null
  for _ in $(seq 120); do docker exec $name test -f /run/bunos/ready && break; sleep 2; done
  docker exec $name cat /run/bunos/ready | tee "$OUT/ready.txt"
  # Same environment as apps started from the COSMIC launcher (cosmic-container-session).
  u() { docker exec -u 1000 -e HOME=/home/aphrody -e PATH=/usr/libexec/bunos/container-bin:/usr/local/bin:/usr/bin:/bin \
    -e XDG_CURRENT_DESKTOP=COSMIC -e XDG_RUNTIME_DIR=/run/user/1000 -e DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus "$@"; }
  # docker cp cannot read tmpfs mounts: stream the screenshot out.
  shot() { u -e WAYLAND_DISPLAY=wayland-0 $name grim - >"$OUT/$1.png"; }
  docker exec $name sh -c 'command -v grim >/dev/null || { apt-get update -qq && apt-get install -y -qq grim; } >/dev/null 2>&1'
  sleep 20; shot 01-desktop
  u -d -e WAYLAND_DISPLAY=wayland-1 $name rio 2>/dev/null || u -d -e WAYLAND_DISPLAY=wayland-1 $name cosmic-term
  u -d -e WAYLAND_DISPLAY=wayland-1 $name helium --ozone-platform=wayland --no-first-run https://aphrody.com/
  u -d -e WAYLAND_DISPLAY=wayland-1 $name bunos-launch-webapp https://gemini.google.com/ com.aphrody.webapp.Gemini
  sleep 25; shot 02-linux-and-web
  for _ in $(seq 60); do docker exec $name sh -c 'waydroid shell -- getprop sys.boot_completed 2>/dev/null' | rg -q 1 && break; sleep 5; done
  docker exec $name sh -c 'waydroid status; ls /home/aphrody/.local/share/applications/ 2>/dev/null | head -60' | tee "$OUT/android.txt" || true
  u -d -e WAYLAND_DISPLAY=wayland-1 $name waydroid app launch com.android.vending
  sleep 40; shot 03-android-window
  docker exec $name sh -c 'for d in /usr/share/applications/*.desktop /home/aphrody/.local/share/applications/*.desktop; do
      [ -f "$d" ] || continue; n=$(basename "$d"); case "$n" in waydroid.*) k=android;; com.aphrody.webapp.*) k=web;; *) k=linux;; esac
      echo "$k $n"; done' | sort >"$OUT/launcher-entries.txt"
  cut -d" " -f1 "$OUT/launcher-entries.txt" | uniq -c | tee "$OUT/launcher-kinds.txt"
  docker exec $name sh -c 'cat /run/user/1000/cosmic.log | tail -40; tail -20 /var/log/waydroid-container.log' >"$OUT/logs.txt" 2>&1 || true
  ;;
disk)
  IMG=${IMG:-/home/ubuntu/bun-os-disk/unified/bunos-unified.img}
  FW=${OVMF:-/usr/share/OVMF}
  cp -f "$FW/OVMF_VARS_4M.fd" "$OUT/vars.fd" 2>/dev/null || cp -f "$FW/OVMF_VARS.fd" "$OUT/vars.fd"
  CODE=$(ls "$FW"/OVMF_CODE_4M.fd "$FW"/OVMF_CODE.fd 2>/dev/null | head -1)
  timeout ${SECS:-600} qemu-system-x86_64 -machine q35,accel=kvm -cpu host -smp 4 -m 6144 \
    -drive if=pflash,format=raw,readonly=on,file="$CODE" -drive if=pflash,format=raw,file="$OUT/vars.fd" \
    -drive file="$IMG",format=raw,if=virtio,snapshot=on -netdev user,id=n0 -device virtio-net-pci,netdev=n0 \
    -device virtio-vga -display none -serial file:"$OUT/serial.log" -monitor unix:"$OUT/monitor.sock",server,nowait &
  q=$!; sleep ${BOOT_WAIT:-240}
  echo "screendump $OUT/greeter.ppm" | socat - UNIX-CONNECT:"$OUT/monitor.sock" >/dev/null || true
  kill $q 2>/dev/null || true
  grep -E "Reached target|cosmic-greeter|greetd|binderfs|waydroid" "$OUT/serial.log" | tail -20 || true
  ;;
esac
echo "evidence: $OUT"
