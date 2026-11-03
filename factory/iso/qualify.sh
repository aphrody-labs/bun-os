#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Qualifies a Bun OS ISO (factory/iso/build.sh): boots it headless under QEMU/KVM with UEFI firmware (OVMF), q35,
# virtio-vga and user networking, passes `bunos.qualify=1` through SMBIOS type 11 (systemd-boot appends
# io.systemd.boot.kernel-cmdline-extra to the entry), waits for the BUNOS-BOOT-REPORT lines that
# bunos-boot-report.service prints on the serial console after graphical.target, takes a screenshot of the display
# with QEMU's screendump and writes receipt.json (ISO sha256, kernel, targets, greeter, repo/key check, screenshot).
#
#   factory/iso/qualify.sh [path/to/bunos-*.iso]      default: newest in ~/build/storage/artifacts/iso
set -euo pipefail

dir="${ISO_OUT:-$HOME/build/storage/artifacts/iso}"
iso="${1:-$(ls -t "$dir"/bunos-*-x86_64.iso | head -1)}"
name="$(basename "$iso" .iso)"
out="${QUALIFY_OUT:-$dir/$name.qualify}"
ovmf="${OVMF_DIR:-/usr/share/OVMF}"
rm -rf "$out" && mkdir -p "$out"
cp "$ovmf/OVMF_VARS_4M.fd" "$out/vars.fd"
echo "iso: $iso"

qemu-system-x86_64 -name bunos-qualify -enable-kvm -machine q35 -cpu host -smp 4 -m 6144 \
  -drive if=pflash,format=raw,readonly=on,file="$ovmf/OVMF_CODE_4M.fd" \
  -drive if=pflash,format=raw,file="$out/vars.fd" \
  -drive file="$iso",media=cdrom,readonly=on,if=none,id=cd -device ide-cd,drive=cd,bootindex=0 \
  -device virtio-vga -display none \
  -nic user,model=virtio-net-pci \
  -smbios type=11,value=io.systemd.boot.kernel-cmdline-extra=bunos.qualify=1 \
  -serial file:"$out/serial.log" -monitor unix:"$out/monitor.sock",server,nowait \
  -pidfile "$out/qemu.pid" -daemonize
mon() { printf '%s\n' "$1" | socat - UNIX-CONNECT:"$out/monitor.sock" >/dev/null; }
trap 'mon quit 2>/dev/null || true' EXIT

# Two report lines (system state, then the signed repository sync); 15 minutes for firmware, squashfs and COSMIC.
for _ in $(seq 900); do
  [[ "$(grep -c BUNOS-BOOT-REPORT "$out/serial.log" 2>/dev/null)" -ge 2 ]] && break
  sleep 1
done
sleep "${SCREEN_SETTLE:-20}" # let the greeter draw its first frames
mon "screendump $out/screen.ppm"
sleep 2
magick "$out/screen.ppm" "$out/screen.png" && rm -f "$out/screen.ppm"
mon quit || true
trap - EXIT

report="$(grep -a BUNOS-BOOT-REPORT "$out/serial.log" | tr -d '\r' || true)"
[[ -n "$report" ]] || { echo "no BUNOS-BOOT-REPORT on the serial console; see $out/serial.log" >&2; exit 1; }
echo "$report"
field() { grep -oE "(^| )$1=[^ ]*" <<<"$report" | head -1 | cut -d= -f2-; }
jq -n --arg iso "$(basename "$iso")" --arg sha "$(sha256sum "$iso" | cut -d' ' -f1)" --arg size "$(stat -c %s "$iso")" \
  --arg kernel "$(field kernel)" --arg system "$(field system)" --arg multi "$(field multi_user)" \
  --arg graphical "$(field graphical)" --arg greeter "$(field greeter)" --arg failed "$(field failed)" \
  --arg id "$(field id)" --arg like "$(field id_like)" --arg build "$(field build_id)" --arg imgver "$(field image_version)" \
  --arg pkgs "$(field packages)" --arg key "$(field store_key)" \
  --arg shot "$out/screen.png" --arg shotsha "$(sha256sum "$out/screen.png" 2>/dev/null | cut -d' ' -f1)" \
  --arg at "$(date -u +%FT%TZ)" '{iso: $iso, sha256: $sha, size: ($size | tonumber), firmware: "OVMF (UEFI), systemd-boot",
    machine: "qemu q35 KVM, virtio-vga", os_release: {ID: $id, ID_LIKE: $like, BUILD_ID: $build, IMAGE_VERSION: $imgver},
    kernel: $kernel, system: $system, multi_user: $multi, graphical: $graphical, cosmic_greeter: $greeter,
    failed_units: $failed, bunos_testing: {packages: $pkgs, store_key: $key}, screenshot: $shot,
    screenshot_sha256: $shotsha, at: $at}' >"$out/receipt.json"
cat "$out/receipt.json"
[[ "$(field multi_user)" == active ]] || { echo "multi-user.target not active" >&2; exit 1; }
echo "qualified: $out/receipt.json"
