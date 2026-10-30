#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Usage (root): build-wsl-distro.sh <output> <distribution> <suite> <https-mirror> <pkg,pkg,...> [name|url|suite|components|fingerprint ...]
# APHRODY_WSL_PAYLOAD: qualified staging directory containing rootfs/ and SHA256SUMS.
# arch-rootfs consumes factory/usr output; omarchy-rootfs consumes the verified image-owner import plus a qualified Bun payload.
# The guest carries no kernel or credentials; WSL supplies WSLg and /mnt/wsl GPU support.
set -euo pipefail
[[ $# -ge 5 ]] || { echo 'Expected output, distribution, suite, HTTPS mirror and package list' >&2; exit 2; }
output_dir=$1
distribution=$2
suite=$3
mirror=$4
IFS=, read -r -a packages <<<"$5"
shift 5
repositories=("$@")
[[ $EUID -eq 0 ]] || { echo 'build-wsl-distro.sh must run as root' >&2; exit 1; }
[[ $distribution =~ ^[A-Za-z][A-Za-z0-9_-]*$ && $suite =~ ^[a-z][a-z0-9-]*$ && $mirror == https://* ]] || { echo 'Invalid distribution, suite or HTTPS mirror' >&2; exit 2; }
[[ ${#packages[@]} -gt 0 ]] || { echo 'Empty package list' >&2; exit 2; }
for package in "${packages[@]}"; do
  [[ $package =~ ^[a-z0-9][a-z0-9+.-]*$ ]] || { echo 'Invalid package name' >&2; exit 2; }
  [[ $package != nvidia-* && $package != linux-image-* ]] || { echo 'WSL supplies the kernel and GPU driver' >&2; exit 2; }
done

if [[ $suite == omarchy-rootfs ]]; then
  source "$(dirname "$0")/wsl-omarchy-mode.sh"
  build_omarchy_wsl_preview "$output_dir"
  exit 0
fi

# Arch/Bun OS images are exported from the existing /usr factory. This path
# deliberately performs no package resolution or installation of its own.
if [[ $suite == arch-rootfs ]]; then
  usr_artifacts=${APHRODY_WSL_USR_ARTIFACTS:-}
  usr_lock=${APHRODY_WSL_USR_LOCK:-}
  profile_manifest=${APHRODY_WSL_PROFILE_MANIFEST:-$(dirname "$0")/../../../../tools/aphrody/config/os/wsl-build.json}
  [[ -n $usr_artifacts && -n $usr_lock ]] || {
    echo 'arch-rootfs requires APHRODY_WSL_USR_ARTIFACTS and APHRODY_WSL_USR_LOCK' >&2
    exit 2
  }
  usr_artifacts=$(realpath -e -- "$usr_artifacts")
  usr_lock=$(realpath -e -- "$usr_lock")
  profile_manifest=$(realpath -e -- "$profile_manifest")
  [[ -d $usr_artifacts && -f $usr_artifacts/rootfs.tar.zst && -f $usr_artifacts/packages.txt && -f $usr_artifacts/SHA256SUMS && -f $usr_lock && -f $profile_manifest ]] || {
    echo 'The /usr factory job must contain rootfs.tar.zst, packages.txt and SHA256SUMS, with its JSON lock supplied separately' >&2
    exit 2
  }
  command -v zstd >/dev/null && command -v jq >/dev/null && command -v sha256sum >/dev/null || {
    echo 'Arch WSL export requires zstd, jq and sha256sum on the factory host' >&2
    exit 2
  }
  profile=${APHRODY_WSL_PROFILE:-portable-x86_64}
  jq -e --arg profile "$profile" '.arch.targets[$profile] | .state == "ready" and (.requiredPackages | type == "array")' "$profile_manifest" >/dev/null || {
    echo "WSL profile '$profile' is not ready; resolve its declared package and qualification blockers first" >&2
    jq -r --arg profile "$profile" '.arch.targets[$profile].blockers[]?' "$profile_manifest" >&2
    exit 1
  }
  mapfile -t profile_packages < <(jq -r --arg profile "$profile" '.arch.targets[$profile].requiredPackages[]' "$profile_manifest")
  [[ ${#profile_packages[@]} -eq ${#packages[@]} ]] || { echo 'Required package arguments do not match the profile manifest' >&2; exit 2; }
  for i in "${!packages[@]}"; do
    [[ ${packages[$i]} == "${profile_packages[$i]}" ]] || { echo 'Required package arguments must match the ordered profile manifest exactly' >&2; exit 2; }
  done
  (cd "$usr_artifacts" && sha256sum -c SHA256SUMS)
  grep -Fq '  rootfs.tar.zst' "$usr_artifacts/SHA256SUMS" || {
    echo 'The /usr factory checksum manifest does not cover rootfs.tar.zst' >&2
    exit 1
  }
  expected_composition=$(jq -r --arg profile "$profile" '.arch.targets[$profile].composition' "$profile_manifest")
  jq -e --arg composition "$(basename "$(dirname "$usr_artifacts")")" \
    --arg expected "$expected_composition" \
    --arg job "$(basename "$usr_artifacts")" \
    '.schemaVersion == 3 and .kind == "bun-os-usr-lock" and .composition == $composition and .composition == $expected and .job == $job and (.packages | type == "array" and length > 0)' \
    "$usr_lock" >/dev/null || { echo 'The supplied lock does not identify this /usr factory job' >&2; exit 1; }
  if jq -e '[.packages[].name] | any(. == "linux" or . == "linux-cachyos" or . == "linux-cachyos-nvidia-open")' "$usr_lock" >/dev/null; then
    echo 'WSL supplies its own kernel; kernel packages are forbidden in this rootfs' >&2
    exit 1
  fi
  for package in "${packages[@]}"; do
    grep -Fq "$package " "$usr_artifacts/packages.txt" || {
      echo "Required package is absent from the locked /usr inventory: $package" >&2
      exit 1
    }
  done
  diff -u \
    <(jq -r '.packages[] | "\(.name) \(.version)"' "$usr_lock" | LC_ALL=C sort) \
    <(LC_ALL=C sort "$usr_artifacts/packages.txt") || {
      echo 'The installed package inventory differs from the exact package lock' >&2
      exit 1
    }
  for package in "${packages[@]}"; do
    jq -e --arg name "$package" 'any(.packages[]; .name == $name)' "$usr_lock" >/dev/null || {
      echo "Required package is absent from the exact /usr lock: $package" >&2
      exit 1
    }
  done
  jq -e 'any(.packages[]; .name == "bun-aphrody")' "$usr_lock" >/dev/null || {
    echo 'The locked /usr package closure does not contain bun-aphrody' >&2
    exit 1
  }
  [[ -f $usr_artifacts/bun-version.txt ]] || { echo 'The /usr factory did not record a Bun version probe' >&2; exit 1; }

  mkdir -p "$output_dir"
  output_dir=$(realpath "$output_dir")
  for artifact in "$distribution.wsl" packages.txt receipt.json SHA256SUMS; do
    [[ ! -e $output_dir/$artifact && ! -L $output_dir/$artifact ]] || {
      echo "Refusing to overwrite existing WSL artifact: $output_dir/$artifact" >&2
      exit 1
    }
  done
  work=$(mktemp -d "$output_dir/.rootfs.XXXXXX")
  rootfs=$work/rootfs
  cleanup() { local result=$?; trap - EXIT; rm -rf --one-file-system "$work"; exit "$result"; }
  trap cleanup EXIT
  mkdir -p "$rootfs"
  zstd -q -d -c -- "$usr_artifacts/rootfs.tar.zst" | tar --xattrs --acls --numeric-owner -C "$rootfs" -xf -

  [[ -x $rootfs/usr/bin/bun && -f $rootfs/etc/passwd && -f $rootfs/etc/group && -f $rootfs/etc/shadow ]] || {
    echo 'Imported /usr rootfs lacks Bun or the standard account databases' >&2
    exit 1
  }
  if awk -F: '$3 == 1000 && $1 != "aphro" { found=1 } END { exit !found }' "$rootfs/etc/passwd"; then
    echo 'UID 1000 is already assigned to a non-aphro account' >&2
    exit 1
  fi
  if ! awk -F: '$1 == "aphro" && $3 == 1000 && $4 == 1000 { found=1 } END { exit !found }' "$rootfs/etc/passwd"; then
    if grep -q '^aphro:' "$rootfs/etc/passwd" || awk -F: '$3 == 1000 { found=1 } END { exit !found }' "$rootfs/etc/group"; then
      echo 'The /usr rootfs has a conflicting aphro account or GID 1000' >&2
      exit 1
    fi
    printf 'aphro:x:1000:\n' >>"$rootfs/etc/group"
    printf 'aphro:x:1000:1000:Bun OS:/home/aphro:/bin/bash\n' >>"$rootfs/etc/passwd"
    printf 'aphro:!:::::::\n' >>"$rootfs/etc/shadow"
    install -d -m 0755 "$rootfs/home/aphro"
    chown 1000:1000 "$rootfs/home/aphro"
  fi
  lock_guest_account() {
    local account=$1 temp=$rootfs/etc/.shadow.new
    awk -F: -v account="$account" 'BEGIN { OFS=":"; found=0 } $1 == account { $2="!"; found=1 } { print } END { if (!found) print account, "!", "", "", "", "", "", "", "" }' \
      "$rootfs/etc/shadow" >"$temp"
    chmod 0600 "$temp"
    mv "$temp" "$rootfs/etc/shadow"
  }
  lock_guest_account root
  lock_guest_account aphro
  awk -F: 'BEGIN { OFS=":" } { $2="!"; print }' "$rootfs/etc/shadow" >"$rootfs/etc/shadow.new"
  chmod 0600 "$rootfs/etc/shadow.new" && mv "$rootfs/etc/shadow.new" "$rootfs/etc/shadow"
  install -d -m 0755 "$rootfs/etc"
  cat >"$rootfs/etc/wsl.conf" <<EOF
[boot]
systemd=true
[user]
default=aphro
EOF
  cat >"$rootfs/etc/wsl-distribution.conf" <<EOF
[oobe]
defaultName=$distribution
defaultUid=1000
EOF
  chmod 0644 "$rootfs/etc/wsl.conf" "$rootfs/etc/wsl-distribution.conf"
  rm -f "$rootfs/etc/resolv.conf" "$rootfs/var/lib/dbus/machine-id"
  : >"$rootfs/etc/machine-id"
  if find "$rootfs/boot" -maxdepth 1 -type f \( -name 'vmlinuz*' -o -name 'initramfs*' \) -print -quit 2>/dev/null | grep -q .; then
    echo 'WSL rootfs must not contain a kernel or initramfs' >&2
    exit 1
  fi
  "$rootfs/usr/bin/bun" --version >"$work/bun-version.txt"
  cmp -s "$work/bun-version.txt" "$usr_artifacts/bun-version.txt" || {
    echo 'Imported Bun binary version does not match the factory receipt' >&2
    exit 1
  }
  cp "$usr_artifacts/packages.txt" "$work/packages.txt"
  rootfs_sha=$(sha256sum "$usr_artifacts/rootfs.tar.zst" | awk '{print $1}')
  lock_sha=$(sha256sum "$usr_lock" | awk '{print $1}')
  job=$(jq -r '.job' "$usr_lock")
  composition=$(jq -r '.composition' "$usr_lock")
  lock_file=$(basename "$usr_lock")
  tar -C "$rootfs" --numeric-owner --xattrs --acls -czf "$work/$distribution.wsl" .
  cat >"$work/receipt.json" <<EOF
{
  "schemaVersion": 1,
  "kind": "bun-os-wsl-image",
  "distribution": "$distribution",
  "profile": "$profile",
  "architecture": "x86_64",
  "source": {
    "owner": "factory/usr",
    "composition": "$composition",
    "job": "$job",
    "rootfsTarZstSha256": "$rootfs_sha",
    "usrLockFile": "$lock_file",
    "usrLockSha256": "$lock_sha"
  },
  "qualification": { "state": "pending-wsl-import-and-runtime-gates", "qualified": false },
  "kernel": { "provider": "Microsoft WSL2", "included": false },
  "desktop": { "state": "not-qualified" }
}
EOF
  (cd "$work" && sha256sum "$distribution.wsl" packages.txt receipt.json >SHA256SUMS)
  mv "$work/packages.txt" "$output_dir/packages.txt"
  mv "$work/receipt.json" "$output_dir/receipt.json"
  mv "$work/$distribution.wsl" "$output_dir/$distribution.wsl"
  mv "$work/SHA256SUMS" "$output_dir/SHA256SUMS"
  (cd "$output_dir" && sha256sum -c SHA256SUMS)
  exit 0
fi

payload=${APHRODY_WSL_PAYLOAD:-}
[[ -n $payload ]] || { echo 'APHRODY_WSL_PAYLOAD must name a checksum-qualified product payload' >&2; exit 2; }
payload=$(realpath "$payload")
# Validate before bootstrap: every payload byte is listed, confined and checksummed.
python3 - "$payload" <<'PY'
import hashlib, pathlib, re, stat, sys
root = pathlib.Path(sys.argv[1]).resolve(strict=True)
files = root / 'rootfs'
manifest = root / 'SHA256SUMS'
if not files.is_dir() or not manifest.is_file():
    raise SystemExit('Payload needs rootfs/ and SHA256SUMS')
allowed = ('opt/aphrody/', 'usr/local/bin/', 'usr/local/lib/aphrody/', 'usr/local/share/aphrody/')
seen = set()
for line in manifest.read_text().splitlines():
    match = re.fullmatch(r'([0-9a-fA-F]{64})  ([A-Za-z0-9_./+-]+)', line)
    if not match:
        raise SystemExit('Invalid payload checksum entry')
    digest, name = match.groups()
    path = pathlib.PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or name in seen or not name.startswith(allowed):
        raise SystemExit('Payload manifest path outside product allowlist')
    target = files / name
    if target.is_symlink() or not target.is_file() or not target.resolve().is_relative_to(files.resolve()):
        raise SystemExit('Manifest entries must be confined regular files')
    if hashlib.file_digest(target.open('rb'), 'sha256').hexdigest().lower() != digest.lower():
        raise SystemExit('Payload checksum mismatch')
    seen.add(name)
for path in files.rglob('*'):
    name = path.relative_to(files).as_posix()
    mode = path.lstat().st_mode
    if stat.S_ISDIR(mode):
        continue
    if not name.startswith(allowed) or path.suffix.lower() in {'.db', '.sqlite', '.sqlite3', '.gguf', '.safetensors'}:
        raise SystemExit('Protected or unrelated payload path rejected')
    if stat.S_ISLNK(mode):
        try:
            target = path.resolve(strict=True)
        except (OSError, RuntimeError):
            raise SystemExit('Invalid payload symlink')
        if not target.is_relative_to(files.resolve()) or not target.is_file():
            raise SystemExit('Payload symlink escapes product staging')
    elif not stat.S_ISREG(mode) or name not in seen:
        raise SystemExit('Unlisted payload file or unsupported file type')
for required in ('usr/local/bin/aphrody', 'usr/local/bin/yolo', 'usr/local/bin/vu', 'usr/local/share/aphrody/qualification.json'):
    if not (files / required).is_file():
        raise SystemExit('Payload lacks required qualified product: ' + required)
PY

mkdir -p "$output_dir"
output_dir=$(realpath "$output_dir")
work=$(mktemp -d "$output_dir/.rootfs.XXXXXX")
rootfs=$work/rootfs
mounted=()
cleanup() {
  local result=$? failed=0 mount
  trap - EXIT
  for ((i=${#mounted[@]}-1; i>=0; i--)); do
    mount=${mounted[i]}
    if mountpoint -q "$rootfs/$mount" && ! umount "$rootfs/$mount"; then failed=1; fi
  done
  if [[ $failed -eq 0 ]]; then
    rm -rf --one-file-system "$work"
  else
    echo "Rootfs retained after unmount failure: $work" >&2
    result=1
  fi
  exit "$result"
}
trap cleanup EXIT

# The installed bootstrap suite table can lag a signed Ubuntu release.
script=/usr/share/debootstrap/scripts/$suite
[[ -e $script ]] || script=/usr/share/debootstrap/scripts/gutsy
debootstrap --variant=minbase --components=main,universe --include=ca-certificates,gnupg,locales,passwd "$suite" "$rootfs" "$mirror" "$script"
cat >"$rootfs/etc/apt/sources.list.d/ubuntu.sources" <<EOF
Types: deb
URIs: $mirror
Suites: $suite $suite-updates $suite-backports
Components: main universe restricted multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: https://security.ubuntu.com/ubuntu
Suites: $suite-security
Components: main universe restricted multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF
: >"$rootfs/etc/apt/sources.list"
install -d -m 0755 "$rootfs/etc/apt/keyrings"
for spec in "${repositories[@]}"; do
  IFS='|' read -r name url repo_suite components fingerprint extra <<<"$spec"
  [[ $name =~ ^[a-z0-9][a-z0-9-]*$ && $url == https://* && $repo_suite =~ ^[a-z][a-z0-9-]*$ && $components =~ ^[a-z0-9\ -]+$ && $fingerprint =~ ^[0-9A-Fa-f]{40}$ && -z ${extra:-} ]] || { echo 'Invalid signed repository specification' >&2; exit 2; }
  keyring=$rootfs/etc/apt/keyrings/$name.gpg
  curl -fsSL "https://keyserver.ubuntu.com/pks/lookup?op=get&options=mr&search=0x$fingerprint" | gpg --dearmor >"$keyring"
  actual=$(gpg --show-keys --with-colons "$keyring" | awk -F: '$1=="fpr" { print $10; exit }')
  [[ ${actual^^} == "${fingerprint^^}" ]] || { echo "$name signing fingerprint mismatch" >&2; exit 1; }
  chmod 0644 "$keyring"
  cat >"$rootfs/etc/apt/sources.list.d/$name.sources" <<EOF
Types: deb
URIs: $url
Suites: $repo_suite
Components: $components
Signed-By: /etc/apt/keyrings/$name.gpg
EOF
done

# Deny service autostart before any package upgrades or product installation.
printf '#!/bin/sh\nexit 101\n' >"$rootfs/usr/sbin/policy-rc.d"
chmod 0755 "$rootfs/usr/sbin/policy-rc.d"
for mount in proc sys dev dev/pts; do
  case $mount in
    proc) mount -t proc proc "$rootfs/proc" ;;
    sys) mount -t sysfs -o ro sys "$rootfs/sys" ;;
    dev|dev/pts) mount --bind "/$mount" "$rootfs/$mount" ;;
  esac
  mounted+=("$mount")
  if [[ $mount == dev || $mount == dev/pts ]]; then mount --make-private "$rootfs/$mount"; fi
done
chroot "$rootfs" env DEBIAN_FRONTEND=noninteractive apt-get update
chroot "$rootfs" env DEBIAN_FRONTEND=noninteractive apt-get -y full-upgrade
chroot "$rootfs" env DEBIAN_FRONTEND=noninteractive apt-get -y install "${packages[@]}"
printf 'en_US.UTF-8 UTF-8\n' >"$rootfs/etc/locale.gen"
chroot "$rootfs" locale-gen
chroot "$rootfs" update-locale LANG=en_US.UTF-8
chroot "$rootfs" groupadd --gid 1000 aphro
chroot "$rootfs" useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash aphro
chroot "$rootfs" passwd --lock aphro
chroot "$rootfs" passwd --lock root
chroot "$rootfs" usermod --append --groups sudo aphro
# Product payload supplies immutable binaries/config, never host authentication or HOME.
cp -a -- "$payload/rootfs/." "$rootfs/"
(cd "$rootfs" && sha256sum -c "$payload/SHA256SUMS")
install -d -m 0755 "$rootfs/usr/local/share/aphrody"
install -m 0644 "$payload/SHA256SUMS" "$rootfs/usr/local/share/aphrody/payload.SHA256SUMS"
cat >"$rootfs/etc/wsl.conf" <<EOF
[boot]
systemd=true
[user]
default=aphro
EOF
cat >"$rootfs/etc/wsl-distribution.conf" <<EOF
[oobe]
defaultName=$distribution
EOF
[[ $(chroot "$rootfs" id -u aphro) == 1000 && $(chroot "$rootfs" id -g aphro) == 1000 ]]
chroot "$rootfs" locale -a | grep -qi '^en_US\.utf8$'
for product in aphrody yolo vu; do
  chroot "$rootfs" runuser -u aphro -- "/usr/local/bin/$product" --version
 done
# shellcheck disable=SC2016 # dpkg-query expands package fields inside the guest.
chroot "$rootfs" dpkg-query -W -f='${Package}=${Version}\n' >"$work/packages.txt"
chroot "$rootfs" apt-get clean
rm -f "$rootfs/usr/sbin/policy-rc.d"
rm -rf "$rootfs"/var/lib/apt/lists/* "$rootfs"/tmp/* "$rootfs"/var/tmp/*
: >"$rootfs/etc/machine-id"
rm -f "$rootfs/var/lib/dbus/machine-id"
for ((i=${#mounted[@]}-1; i>=0; i--)); do umount "$rootfs/${mounted[i]}"; done
mounted=()

tar -C "$rootfs" --numeric-owner --xattrs --acls -czf "$work/$distribution.wsl" .
(cd "$work" && sha256sum "$distribution.wsl" packages.txt > SHA256SUMS)
mv "$work/packages.txt" "$output_dir/packages.txt"
mv "$work/$distribution.wsl" "$output_dir/$distribution.wsl"
mv "$work/SHA256SUMS" "$output_dir/SHA256SUMS"
(cd "$output_dir" && sha256sum -c SHA256SUMS)
