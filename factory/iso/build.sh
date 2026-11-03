#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Builds the Bun OS live/installation ISO the Arch way: Arch's own mkarchiso on the archiso profile in
# factory/iso/profile (derived from releng), in a clean archlinux:base-devel container, in build.slice.
#
#   factory/iso/build.sh            -> ~/build/storage/artifacts/iso/bunos-YYYY.MM.DD-x86_64.iso (+ .sha256, .b2sum, .sig)
#
# Content: factory/wsl/packages.base (the base set) + profile/packages.x86_64 (linux-bun, archiso hooks, bunos-cli,
# bunos-desktop, cosmic-session, cosmic-greeter). Packages come from the published, signed [bunos-testing] with
# SigLevel Required, plus Arch [core]/[extra]; the Store key is pinned by fingerprint below and installed in the live
# system's pacman keyring. Name and os-release follow docs/ops/RELEASES.md. Qualify with factory/iso/qualify.sh.
# Env: ISO_OUT, ISO_WORK, ISO_DATE (YYYY.MM.DD), WEBOS_STORE_SECRETS (Store key home, to sign the ISO).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
out="${ISO_OUT:-$HOME/build/storage/artifacts/iso}"
work="${ISO_WORK:-$HOME/build/storage/iso-work}"
keys="${WEBOS_STORE_SECRETS:-$HOME/apps/webos/secrets/store}/gnupg"
store_fpr=A4B3EFE520B09C8184ACF571BFCB340002617BD7 # aphrody-store, https://aphrody.com/repo/os/aphrody.gpg
date="${ISO_DATE:-$(date -u +%Y.%m.%d)}"
[[ "$date" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]{2}$ ]] || { echo "ISO_DATE must be YYYY.MM.DD" >&2; exit 2; }
epoch="$(date -u -d "${date//./-}T00:00:00Z" +%s)"
jobs="${CARGO_BUILD_JOBS:-$(nproc)}"

rm -rf "$work" && mkdir -p "$work" "$out"
p="$work/profile"
cp -a "$here/profile" "$p"
a="$p/airootfs"

# Package list: the base set first, then the live medium's additions.
{ sed 's/#.*//; /^[[:space:]]*$/d' "$root/factory/wsl/packages.base" "$here/profile/packages.x86_64"; } |
  awk '!seen[$1]++ {print $1}' >"$p/packages.x86_64"

# Store key for the live keyring (pacman-key --populate reads every keyring in this directory).
mkdir -p "$a/usr/share/pacman/keyrings" "$a/usr/lib/bunos"
curl -fsS https://aphrody.com/repo/os/aphrody.gpg -o "$a/usr/share/pacman/keyrings/bunos.gpg"
got="$(gpg --show-keys --with-colons "$a/usr/share/pacman/keyrings/bunos.gpg" | awk -F: '/^fpr/ {print $10; exit}')"
[[ "$got" == "$store_fpr" ]] || { echo "Store key fingerprint $got != $store_fpr" >&2; exit 1; }
printf '%s:4:\n' "$store_fpr" >"$a/usr/share/pacman/keyrings/bunos-trusted"
: >"$a/usr/share/pacman/keyrings/bunos-revoked"
printf '%s\n' "$date" >"$a/usr/lib/bunos/image-version"

# Unit enablement and the usual live-system links (kept out of git as symlinks).
s="$a/etc/systemd/system"
mkdir -p "$s"/{multi-user.target.wants,sockets.target.wants,network-online.target.wants,graphical.target.wants}
ln -sf /etc/systemd/system/pacman-init.service "$s/multi-user.target.wants/pacman-init.service"
ln -sf /usr/lib/systemd/system/systemd-networkd.service "$s/multi-user.target.wants/systemd-networkd.service"
ln -sf /usr/lib/systemd/system/systemd-resolved.service "$s/multi-user.target.wants/systemd-resolved.service"
ln -sf /usr/lib/systemd/system/sshd.service "$s/multi-user.target.wants/sshd.service"
ln -sf /usr/lib/systemd/system/systemd-networkd.socket "$s/sockets.target.wants/systemd-networkd.socket"
ln -sf /usr/lib/systemd/system/systemd-networkd-wait-online.service \
  "$s/network-online.target.wants/systemd-networkd-wait-online.service"
ln -sf /etc/systemd/system/bunos-boot-report.service "$s/graphical.target.wants/bunos-boot-report.service"
ln -sf /usr/lib/systemd/system/cosmic-greeter.service "$s/display-manager.service"
ln -sf /usr/lib/systemd/system/graphical.target "$s/default.target"
ln -sf /usr/share/zoneinfo/UTC "$a/etc/localtime"
ln -sf /run/systemd/resolve/stub-resolv.conf "$a/etc/resolv.conf"

image=archlinux:base-devel
docker pull -q "$image" >/dev/null
docker run --rm --privileged --cgroup-parent=build.slice --cpus "$jobs" \
  -v "$work:/work" -v "$out:/out" -e SOURCE_DATE_EPOCH="$epoch" -e FPR="$store_fpr" "$image" bash -euo pipefail -c '
    pacman -Syu --noconfirm --needed archiso >/dev/null
    pacman-key --init >/dev/null 2>&1 # the image ships without a local master key, which --lsign-key needs
    pacman-key --add /work/profile/airootfs/usr/share/pacman/keyrings/bunos.gpg >/dev/null
    pacman-key --lsign-key "$FPR" >/dev/null
    mkarchiso -v -r -w /work/w -o /work/iso /work/profile
    chown -R '"$(id -u):$(id -g)"' /work/iso'
iso="$(ls "$work"/iso/bunos-*.iso)"
name="$(basename "$iso")"
[[ "$name" == "bunos-$date-x86_64.iso" ]] || { echo "unexpected ISO name $name" >&2; exit 1; }
mv -f "$iso" "$out/$name"
(cd "$out" && sha256sum "$name" >"$name.sha256" && b2sum "$name" >"$name.b2sum")
# Detached signature with the Store key when its home is on this host (as publish-testing.sh signs packages).
if [[ -d "$keys" ]]; then
  docker run --rm --cgroup-parent=build.slice -v "$out:/out" -v "$keys:/gnupg" "$image" bash -euc '
    GNUPGHOME=/gnupg gpg --batch --yes --detach-sign --local-user '"$store_fpr"' -o /out/'"$name"'.sig /out/'"$name"'
    chown '"$(id -u):$(id -g)"' /out/'"$name"'.sig'
fi
cp "$p/packages.x86_64" "$out/$name.packages"
echo "built $out/$name ($(du -h "$out/$name" | cut -f1)); $(cut -d' ' -f1 "$out/$name.sha256")"
