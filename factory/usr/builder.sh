#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Runs inside a privileged archlinux container with the job directory at /job.
# Inputs: /job/pacman.conf, /job/packages.txt, /job/overlay/, /job/pkgs/, /job/boot/, /job/env and optional /job/lock.tsv.
set -euo pipefail
source /job/env
out=/job/out root=/job/root cache=/job/cache repo=/job/repo
mkdir -p "$out" "$root" "$cache" "$repo"
log() { printf '[bun-os-usr] %s\n' "$*"; }

log "builder tools"
pacman-key --init >/dev/null
pacman-key --populate archlinux >/dev/null
pacman -Sy --noconfirm --needed ${BUILDER_PACKAGES} >/dev/null
for key in ${KEYS}; do
  pacman-key --keyserver "${KEYSERVER}" --recv-keys "$key"
  pacman-key --lsign-key "$key"
done

log "Bun OS packages: ${BUNOS_PACKAGES}"
id builder >/dev/null 2>&1 || useradd -r -m builder
mkdir -p /tmp/pkgs /pkgcache && chown builder "$repo"
[ ! -d /job/bunos-utils-src ] || cp -r /job/bunos-utils-src /job/pkgs/bunos-utils/src-tree
for name in ${BUNOS_PACKAGES}; do
  src=/job/pkgs/$name
  [ -d "$src" ] || src=/job/bunos-pkgs/$name
  [ -f "$src/PKGBUILD" ] || { log "no PKGBUILD for $name"; exit 3; }
  # Built packages are reused across jobs while their PKGBUILD directory is byte-identical.
  key=$(cd "$src" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16)
  cached=/pkgcache/$name-$key
  if ! ls "$cached"/*.pkg.tar.zst >/dev/null 2>&1; then
    log "makepkg $name ($key)"
    cp -r "$src" "/tmp/pkgs/$name" && chown -R builder "/tmp/pkgs/$name"
    deps=$(bash -c "source /tmp/pkgs/$name/PKGBUILD; echo \${depends[@]} \${makedepends[@]} \${checkdepends[@]}")
    # Dependencies on packages built earlier in this loop come from the local repository.
    sync=""
    for dep in $deps; do
      dep=${dep%%[<>=]*}
      built=$(ls "$repo/$dep"-[0-9]*.pkg.tar.zst 2>/dev/null | head -1 || true)
      if [ -n "$built" ]; then pacman -U --noconfirm --needed "$built" >/dev/null; else sync="$sync $dep"; fi
    done
    [ -z "$sync" ] || pacman -S --noconfirm --needed $sync >/dev/null
    mkdir -p "$cached.tmp" && chown builder "$cached.tmp"
    (cd "/tmp/pkgs/$name" && su builder -c "SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH} PKGDEST=$cached.tmp makepkg --clean --noconfirm --nosign" \
      >"$out/makepkg-$name.log" 2>&1) || { tail -40 "$out/makepkg-$name.log"; exit 3; }
    rm -rf "$cached" && mv "$cached.tmp" "$cached"
  fi
  cp "$cached"/*.pkg.tar.zst "$repo/"
done
# Rust base (docs/RUST-BASE.md): packages compiled from the aphrody-labs forks with cargo-serial and published in the
# signed aphrody repository; each file is verified against the repository key before it joins the local repository.
if [ -n "${RUST_BASE_PACKAGES:-}" ]; then
  log "Rust base from ${RUST_BASE_REPO}: ${RUST_BASE_PACKAGES}"
  rbgpg=$(mktemp -d)
  curl -fsS "${RUST_BASE_KEY}" -o "$rbgpg/key.gpg"
  gpg --homedir "$rbgpg" --batch -q --import "$rbgpg/key.gpg"
  curl -fsS "${RUST_BASE_REPO}/aphrody.db.tar.zst" -o "$rbgpg/db"
  curl -fsS "${RUST_BASE_REPO}/aphrody.db.tar.zst.sig" -o "$rbgpg/db.sig"
  gpg --homedir "$rbgpg" --batch -q --verify "$rbgpg/db.sig" "$rbgpg/db"
  for name in ${RUST_BASE_PACKAGES}; do
    desc=$(bsdtar -tf "$rbgpg/db" | grep -E "^${name}-[^-]+-[^-]+/desc$" | head -1)
    [ -n "$desc" ] || { log "Rust base package $name is not published"; exit 3; }
    file=$(bsdtar -xOf "$rbgpg/db" "$desc" | awk '/^%FILENAME%$/{getline; print; exit}')
    curl -fsS "${RUST_BASE_REPO}/$file" -o "$repo/$file"
    curl -fsS "${RUST_BASE_REPO}/$file.sig" -o "$rbgpg/pkg.sig"
    gpg --homedir "$rbgpg" --batch -q --verify "$rbgpg/pkg.sig" "$repo/$file"
    log "Rust base $file verified"
  done
  rm -rf "$rbgpg"
fi
repo-add -q "$repo/bunos.db.tar.zst" "$repo"/*.pkg.tar.zst
mkdir -p "$out/repo" && cp "$repo"/*.pkg.tar.zst "$out/repo/"

log "resolve"
mapfile -t packages </job/packages.txt
mkdir -p /tmp/rdb /tmp/rroot
rp() { pacman --config /job/pacman.conf -r /tmp/rroot -b /tmp/rdb "$@"; }
rp -Sy >/dev/null
for i in "${!packages[@]}"; do
  if ! rp -Si "${packages[$i]}" >/dev/null 2>&1 && ! rp -Sg "${packages[$i]}" >/dev/null 2>&1; then
    if [ "${packages[$i]}" = linux-cachyos ]; then packages[$i]="${FALLBACK_KERNEL}"; else
      log "missing package: ${packages[$i]}"; exit 3; fi
  fi
done
if [ -f /job/lock.tsv ]; then
  cp /job/lock.tsv /tmp/resolved.tsv
else
  rp -Sp --print-format '%r %n %v %l' "${packages[@]}" | awk '{n=split($4,a,"/"); print $1"\t"$2"\t"$3"\t"a[n]"\t"$4}' >/tmp/resolved.tsv
fi

log "download and verify $(wc -l </tmp/resolved.tsv) packages"
: >"$out/lock.tsv"
mismatch=0
while IFS=$'\t' read -r r name version file url sha bytes; do
  curl -fsSL --retry 3 -o "$cache/$file" "$url"
  [ "$r" = bunos ] || curl -fsSL --retry 3 -o "$cache/$file.sig" "$url.sig"
  actual=$(sha256sum "$cache/$file" | cut -d' ' -f1)
  if [ -n "${sha:-}" ] && [ "$sha" != "$actual" ]; then
    if [ "$r" = bunos ]; then log "local rebuild differs: $file"; else log "sha256 mismatch: $file"; mismatch=1; fi
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$r" "$name" "$version" "$file" "$url" "$actual" "$(stat -c %s "$cache/$file")" >>"$out/lock.tsv"
done </tmp/resolved.tsv
[ "$mismatch" = 0 ] || exit 6
for f in "$cache"/*.sig; do
  pacman-key --verify "$f" "${f%.sig}" >/dev/null 2>&1 || { log "bad signature: ${f##*/}"; exit 7; }
done

log "pacstrap $(wc -l <"$out/lock.tsv") locked packages"
# Package documentation stays out of the image; licenses, man pages and translations remain.
sed '/^\[options\]/a NoExtract = usr/share/doc/* usr/share/gtk-doc/* usr/share/info/*' /job/pacman.conf >/tmp/pacstrap.conf
pacstrap -C /tmp/pacstrap.conf -G -M -U "$root" "$cache"/*.pkg.tar.zst
install -d "$root/usr/share/doc"
sed '/^\[bunos\]/,/^$/d' /tmp/pacstrap.conf >/tmp/target-pacman.conf
install -Dm644 /tmp/target-pacman.conf "$root/etc/pacman.conf"

log "merged-usr hierarchy"
for d in ${USR_DIRS}; do install -d "$root/usr/$d"; done
for pair in ${ROOT_LINKS}; do
  name=${pair%%=*} target=${pair#*=}
  [ -L "$root/$name" ] && [ "$(readlink "$root/$name")" = "$target" ] || { log "bad /$name"; exit 4; }
done
for pair in ${USR_LINKS}; do
  name=${pair%%=*} target=${pair#*=}
  [ -L "$root/usr/$name" ] || { rm -rf "$root/usr/$name"; ln -s "$target" "$root/usr/$name"; }
done

log "Bun OS overlay"
cp -a --no-preserve=ownership /job/overlay/. "$root/"
chmod 0755 "$root/usr/bin/bunsh" "$root/usr/bin/bun-python" "$root/usr/lib/bun-os/boot-check" "$root/usr/lib/bun-os/install-bunos-utils"
"$root/usr/lib/bun-os/install-bunos-utils" "$root"
[ -x "$root/usr/lib/bunos-utils/bin/ls" ] || { log "bunos-utils applet links missing"; exit 5; }
install -Dm644 "$root/usr/share/factory/etc/profile.d/bunos-utils.sh" "$root/etc/profile.d/bunos-utils.sh"
ln -sf ../usr/lib/os-release "$root/etc/os-release"
for p in ${REQUIRED}; do [ -e "$root/$p" ] || { log "missing $p"; exit 5; }; done
pacman -r "$root" -Ql bunos-filesystem | grep -q "usr/lib/os-release$" || { log "os-release not owned by bunos-filesystem"; exit 5; }
"$root/usr/bin/bun" --version >"$out/bun-version.txt"

log "inventory"
pacman -r "$root" -Q >"$out/packages.txt"
pacman -r "$root" -Qi | awk -F': ' '/^Name/{n=$2}/^Licenses/{print n"\t"$2}' >"$out/licenses.tsv"
(cd "$root" && find usr -maxdepth 2 -printf '%y %p%l\n' | sort) >"$out/tree.txt"
du -sb "$root/usr" | cut -f1 >"$out/usr-bytes.txt"
rm -rf "$root"/var/cache/pacman/pkg/* "$root"/var/lib/pacman/sync/*

log "images"
mkfs.erofs -z"${EROFS_COMPRESSION}" -Eztailpacking -T0 --all-root "$out/usr.erofs" "$root/usr" >/dev/null
mksquashfs "$root/usr" "$out/usr.squashfs" -comp "${SQUASHFS_COMPRESSION}" -Xcompression-level 19 -b 1M -all-root -noappend -quiet
if [ "${VERITY}" = 1 ]; then
  veritysetup format --root-hash-file="$out/usr.erofs.roothash" "$out/usr.erofs" "$out/usr.erofs.verity" >"$out/usr.erofs.verity.txt"
fi
log "rootfs tarball"
tar -I 'zstd -T0 -19 --long' --xattrs --acls --numeric-owner -C "$root" -cf "$out/rootfs.tar.zst" .
sums="usr.erofs usr.squashfs rootfs.tar.zst"
[ "${VERITY}" = 1 ] && sums="$sums usr.erofs.verity"

if [ "${BOOT}" = 1 ]; then
  log "boot: signed /usr partitions (systemd-repart)"
  b=/tmp/boot && mkdir -p "$b"
  openssl req -new -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=Bun OS test signing ${JOB}/" \
    -keyout "$b/signing.key" -out "$out/signing.crt" 2>/dev/null
  rm -f /job/disk.raw
  systemd-repart --empty=create --size=auto --dry-run=no --offline=yes --definitions=/job/boot/repart.d \
    --copy-source="$root" --defer-partitions=esp --private-key="$b/signing.key" --certificate="$out/signing.crt" \
    --json=pretty /job/disk.raw >"$out/repart.json"
  usrhash=$(jq -r '.[] | select(.type | startswith("usr-")) | .roothash // empty' "$out/repart.json" | grep -m1 .)
  printf '%s\n' "$usrhash" >"$out/usrhash"

  log "boot: initrd and signed UKI"
  kver=$(ls "$root/usr/lib/modules" | head -1)
  kernel=$(ls "$root"/boot/vmlinuz-* | head -1)
  cp /job/boot/mkinitcpio.conf "$root/var/tmp/bunos-mkinitcpio.conf"
  arch-chroot "$root" mkinitcpio -c /var/tmp/bunos-mkinitcpio.conf -k "$kver" -g /var/tmp/bunos-initrd.img >/tmp/mkinitcpio.log 2>&1 \
    || { tail -30 /tmp/mkinitcpio.log; exit 8; }
  cmdline="$(cat /job/boot/cmdline) usrhash=$usrhash"
  ukify build --linux="$kernel" --initrd="$root/var/tmp/bunos-initrd.img" --cmdline="$cmdline" \
    --os-release=@"$root/usr/lib/os-release" --uname="$kver" \
    --secureboot-private-key="$b/signing.key" --secureboot-certificate="$out/signing.crt" \
    --output="$out/bunos.efi" >/dev/null
  sbverify --cert "$out/signing.crt" "$out/bunos.efi" >"$out/sbverify.txt" 2>&1
  rm -f "$b/signing.key"

  log "boot: ESP"
  esp_offset=$(jq -r '.[] | select(.type=="esp") | .offset' "$out/repart.json")
  esp_size=$(jq -r '.[] | select(.type=="esp") | .raw_size' "$out/repart.json")
  mkfs.vfat -n ESP -C "$b/esp.img" $((esp_size / 1024)) >/dev/null
  mmd -i "$b/esp.img" ::EFI ::EFI/BOOT
  mcopy -i "$b/esp.img" "$out/bunos.efi" ::EFI/BOOT/BOOTX64.EFI
  dd if="$b/esp.img" of=/job/disk.raw bs=1M seek=$((esp_offset / 1048576)) conv=notrunc status=none
  # The deferred ESP has no GPT entry yet; firmware only boots a listed EFI system partition.
  echo "$((esp_offset / 512)),$((esp_size / 512)),U" | sfdisk -q --no-reread --no-tell-kernel -N 1 /job/disk.raw

  log "boot: QEMU"
  cp /usr/share/edk2/x64/OVMF_VARS.4m.fd "$b/vars.fd"
  set +e
  timeout "${BOOT_TIMEOUT}" qemu-system-x86_64 -machine q35,accel=kvm -cpu host -smp 2 -m 2048 -nographic -no-reboot -nic none \
    -drive if=pflash,format=raw,readonly=on,file=/usr/share/edk2/x64/OVMF_CODE.4m.fd \
    -drive if=pflash,format=raw,file="$b/vars.fd" \
    -drive file=/job/disk.raw,format=raw,if=virtio </dev/null >"$out/boot.log" 2>&1
  set -e
  if grep -q 'BUNOS-BOOT-OK' "$out/boot.log"; then echo qualified >"$out/boot-result.txt"; else
    echo failed >"$out/boot-result.txt"; tail -40 "$out/boot.log"; fi
  zstd -q -T0 -19 --long --rm /job/disk.raw -o "$out/disk.raw.zst"
  sums="$sums bunos.efi disk.raw.zst"
fi

(cd "$out" && sha256sum $sums >SHA256SUMS)
rm -rf "$root" "$cache" /tmp/rdb
chmod -R a+rX "$out"
ls -l "$out"
log done
