#!/usr/bin/env bash
# Assemble the "Bun OS for Windows" bundle: WSL kernel + modules VHD, bunos-wsl distro, WSLg settings, installer and
# the bunos.sys driver package. Runs on the build host (never on the Windows workstation).
# Usage: bundle.sh <repo-root> <kernel-dir> <distro-dir> <driver-dir|-> <out-dir>   env: DOCKER_CLI_DIR (docker-cli.sh out)
#   kernel-dir  output of factory/wsl/kernel/build-wsl-kernel.sh (bzImage, modules.vhdx, report.json, config)
#   distro-dir  output of factory/wsl/build-rootfs.sh (bunos-wsl.wsl)
#   driver-dir  `cargo wdk build --profile release` package dir (bunos.sys, bunos.inf, bunos.cat, WDRLocalTestCert.cer)
# Output: <out-dir>/bunos-windows/ and <out-dir>/bunos-windows.zip, with SHA256SUMS and manifest.json.
set -euo pipefail
repo=$(realpath "$1"); kdir=$(realpath "$2"); ddir=$(realpath "$3"); drv=$4; out=$5
mkdir -p "$out"; out=$(realpath "$out")
b="$out/bunos-windows"
rm -rf "$b"; mkdir -p "$b"
cp "$kdir/bzImage" "$kdir/modules.vhdx" "$b/"
cp "$kdir/report.json" "$b/kernel-report.json"; cp "$kdir/config" "$b/kernel.config"
cp "$ddir/bunos-wsl.wsl" "$b/"
cp "$repo"/factory/wsl/windows/{install.ts,latency.ts,setup-elevated.ps1,wslconfig.template,wslgconfig.template} "$b/"
cp "$repo/factory/wsl/bunos-wsl-native.sh" "$b/"
# Waydroid from the aphrody-labs fork, unpacked in the distro by bunos-wsl-native.sh.
git -C "$repo/vendor/waydroid" archive --format=tar.gz -o "$b/waydroid-src.tar.gz" HEAD
# bunos.exe (`bunos apk ...` on Windows), cross-compiled by Bun; signed on the target by setup-elevated.ps1.
bun build --compile --target=bun-windows-x64 "$repo/packages/bunos-run/src/bunos.ts" --outfile "$b/bunos.exe" >/dev/null
[[ -n ${DOCKER_CLI_DIR:-} ]] && cp "$DOCKER_CLI_DIR/docker.exe" "$DOCKER_CLI_DIR/docker-cli.json" "$b/"
if [[ $drv != - ]]; then
  mkdir -p "$b/driver"
  cp "$drv"/{bunos.sys,bunos.inf,bunos.cat,WDRLocalTestCert.cer} "$b/driver/"
fi
(cd "$b" && find . -type f ! -name SHA256SUMS -printf '%P\n' | sort | xargs sha256sum >SHA256SUMS)
krel=$(jq -r .kernelrelease "$kdir/report.json")
cat >"$b/manifest.json" <<JSON
{"name":"bunos-windows","built":"$(date -u +%FT%TZ)","commit":"$(git -C "$repo" rev-parse HEAD)",
 "kernelrelease":"$krel","waydroid":"$(git -C "$repo/vendor/waydroid" rev-parse HEAD)","driver":$([[ $drv != - ]] && echo true || echo false),
 "files":$(cd "$b" && find . -type f ! -name manifest.json -printf '%P\t%s\n' | sort | jq -R 'split("\t")|{(.[0]):(.[1]|tonumber)}' | jq -s add)}
JSON
rm -f "$out/bunos-windows.zip"
(cd "$out" && zip -qr -1 bunos-windows.zip bunos-windows)
sha256sum "$out/bunos-windows.zip" | tee "$out/bunos-windows.zip.sha256"
cat "$b/SHA256SUMS"
