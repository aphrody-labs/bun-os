#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Ubuntu 26.04 (Pop!_OS + COSMIC session, bunos-unified image) form of the Rust base. Runs in ubuntu:26.04 with the
# staged fork builds at /out (factory/rustbase/rust-base.ts build) and writes .deb files plus index.tsv lines to /debs
# (~/native-apps/debs: the unified image installs every deb there; the Store publishes them in suite `resolute`).
# Ubuntu already ships rust-coreutils, rust-findutils, rust-diffutils, sudo-rs and ntpd-rs: each is rebuilt under the
# same name with the Ubuntu maintainer scripts and layout, the binaries replaced by our fork builds, and a version that
# sorts above the archive one, so apt upgrades the session in place. crosvm has no Ubuntu package: bunos-crosvm.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends dpkg-dev ca-certificates >/dev/null
work=$(mktemp -d); cd "$work"
apt-get download -qq rust-coreutils rust-findutils rust-diffutils sudo-rs ntpd-rs >/dev/null
multicall=/out/bunos-utils/target/release/bunos-utils
applets=$("$multicall" --list)
has() { printf '%s\n' "$applets" | awk -F'\t' -v a="$1" '$1==a{f=1} END{exit !f}'; }

repack() { # <deb>
  local deb=$1 name dir
  name=$(dpkg-deb -f "$deb" Package); dir=$work/$name
  dpkg-deb -R "$deb" "$dir"
  echo "$dir"
}
finish() { # <dir> <version>
  local dir=$1 ver=$2 name file
  name=$(awk -F': ' '$1=="Package"{print $2}' "$dir/DEBIAN/control")
  sed -i "s/^Version: .*/Version: $ver/; s/^Maintainer: .*/Maintainer: aphrody-dev <contact@aphrody.com>/" "$dir/DEBIAN/control"
  grep -q '^X-Bunos-Fork:' "$dir/DEBIAN/control" || echo "X-Bunos-Fork: $3" >> "$dir/DEBIAN/control"
  (cd "$dir" && find . -path ./DEBIAN -prune -o -type f -printf '%P\0' | xargs -0 -r md5sum > DEBIAN/md5sums)
  sed -i "s/^Installed-Size: .*/Installed-Size: $(du -sk --exclude=DEBIAN "$dir" | cut -f1)/" "$dir/DEBIAN/control"
  file=${name}_${ver}_amd64.deb
  dpkg-deb --root-owner-group -Zxz --build "$dir" "/debs/$file" >/dev/null
  printf '%s\t%s\t%s\t%s\n' "$name" "$ver" "$file" "$(sha256sum "/debs/$file" | cut -d' ' -f1)" >> /debs/index.tsv
  echo "deb $file"
}

# rust-coreutils: /usr/bin/coreutils becomes the Bun OS multicall (uutils coreutils + findutils + diffutils + procps +
# util-linux from the aphrody-labs forks); every applet link Ubuntu ships keeps working.
d=$(repack rust-coreutils_*.deb)
install -m755 "$multicall" "$d/usr/bin/coreutils"
missing=""
for l in "$d"/usr/lib/cargo/bin/coreutils/*; do a=$(basename "$l"); has "$a" || missing="$missing $a"; done
[ -z "$missing" ] || echo "rust-coreutils: applets Ubuntu links but the multicall lacks:$missing"
install -dm755 "$d/usr/lib/bunos-utils/bin" "$d/usr/share/bun-os"
printf '%s\n' "$applets" > "$d/usr/share/bun-os/bunos-utils.applets"
printf '%s\n' "$applets" | cut -f1 | while read -r a; do ln -sf /usr/bin/coreutils "$d/usr/lib/bunos-utils/bin/$a"; done
for f in /out/bunos-utils/licenses/*; do [ -f "$f" ] && install -Dm644 "$f" "$d/usr/share/doc/rust-coreutils/bunos/$(basename "$f")"; done
finish "$d" "$(cat /out/bunos-utils/version)+bunos1" "aphrody-labs/uutils-* via crates/bunos-utils"

# rust-findutils, rust-diffutils: their binaries become links to the same multicall.
for p in findutils diffutils; do
  d=$(repack rust-${p}_*.deb)
  find "$d/usr" -type f -perm -u+x | while read -r b; do a=$(basename "$b"); has "$a" && ln -sf /usr/bin/coreutils "$b" || echo "rust-$p: $a kept from Ubuntu"; done
  sed -i "s/^Depends: .*/&, rust-coreutils (>= $(cat /out/bunos-utils/version)+bunos1)/" "$d/DEBIAN/control"
  finish "$d" "$(cat /out/bunos-utils/version)+bunos1" "aphrody-labs/uutils-$p via crates/bunos-utils"
done

# sudo-rs: Ubuntu layout /usr/lib/cargo/bin/{sudo,su,visudo}; its postinst keeps setting the setuid modes.
d=$(repack sudo-rs_*.deb)
for b in sudo su visudo; do install -m755 /out/sudo-rs/target/release/$b "$d/usr/lib/cargo/bin/$b"; done
chmod 4755 "$d/usr/lib/cargo/bin/sudo" "$d/usr/lib/cargo/bin/su"
finish "$d" "$(cat /out/sudo-rs/version)+bunos1" "aphrody-labs/sudo-rs $(cat /out/sudo-rs/sha)"

# ntpd-rs: same binaries Ubuntu ships.
d=$(repack ntpd-rs_*.deb)
for b in ntp-daemon ntp-ctl; do [ -e "$d/usr/bin/$b" ] && install -m755 /out/ntpd-rs/target/release/$b "$d/usr/bin/$b"; done
finish "$d" "$(cat /out/ntpd-rs/version)+bunos1" "aphrody-labs/ntpd-rs $(cat /out/ntpd-rs/sha)"

# bunos-crosvm: new package.
d=$work/bunos-crosvm; mkdir -p "$d/DEBIAN" "$d/usr/bin" "$d/usr/share/doc/bunos-crosvm"
install -m755 /out/crosvm/target/release/crosvm "$d/usr/bin/crosvm"
install -m644 /out/crosvm/crosvm/LICENSE "$d/usr/share/doc/bunos-crosvm/copyright"
cat > "$d/DEBIAN/control" <<CTL
Package: bunos-crosvm
Version: 0
Architecture: amd64
Maintainer: aphrody-dev <contact@aphrody.com>
Installed-Size: 0
Depends: libc6, libgcc-s1, libcap2
Provides: crosvm
Section: admin
Priority: optional
Homepage: https://github.com/aphrody-labs/crosvm
Description: crosvm, the ChromiumOS KVM virtual machine monitor (Bun OS fork)
 VMM of Bun OS VM sessions, built from aphrody-labs/crosvm.
CTL
finish "$d" "0~git$(cut -c1-12 /out/crosvm/sha)" "aphrody-labs/crosvm $(cat /out/crosvm/sha)"
