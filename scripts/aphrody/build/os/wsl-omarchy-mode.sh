# SPDX-License-Identifier: Apache-2.0
# Sourced only by build-wsl-distro.sh for the explicit Omarchy WSL preview.

kernel_receipt='{ "provider": "Microsoft WSL2", "requestedVersion": "7.3", "included": false, "qualificationState": "blocked" }'
theme_receipt=null

# Bun OS WSL overlay, each part optional:
#   APHRODY_WSL_KERNEL_DIR   build-wsl-kernel.sh output: modules go to /usr/lib/modules/<release>;
#                            bzImage stays outside the rootfs (WSL boots it through .wslconfig kernel=).
#   APHRODY_WSL_M3_HYPRLAND  m3-hyprland.conf from `m3-emit --target hyprland` (aphrody-labs/bun-ui),
#                            translated to the Omarchy 4 Lua config as ~/.config/hypr/m3.lua.
# The WSLg Hyprland launcher and environment are always installed.
bunos_wsl_overlay() {
  local rootfs=$1 kernel_dir=${APHRODY_WSL_KERNEL_DIR:-} theme=${APHRODY_WSL_M3_HYPRLAND:-} release home lua var value
  if [[ -n $kernel_dir ]]; then
    kernel_dir=$(realpath -e -- "$kernel_dir")
    release=$(jq -r .kernelRelease "$kernel_dir/build-receipt.json")
    [[ $release =~ ^[0-9A-Za-z._+-]+$ && -d $kernel_dir/modules/lib/modules/$release ]] || { echo 'Kernel output lacks its installed modules' >&2; exit 1; }
    install -d -m 0755 "$rootfs/usr/lib/modules"
    cp -a "$kernel_dir/modules/lib/modules/$release" "$rootfs/usr/lib/modules/$release"
    rm -f "$rootfs/usr/lib/modules/$release/build" "$rootfs/usr/lib/modules/$release/source"
    chown -R 0:0 "$rootfs/usr/lib/modules/$release"
    kernel_receipt=$(jq -c --arg sha "$(sha256sum "$kernel_dir/arch/x86/boot/bzImage" | awk '{print $1}')" \
      '{provider: "Bun OS (Linux 7.3 + CachyOS + WSL2 dxgkrnl)", release: .kernelRelease, included: "modules-only", bzImageSha256: $sha, qualificationState: "vps-built-not-wsl-booted"}' \
      "$kernel_dir/build-receipt.json")
  fi
  install -Dm0755 /dev/stdin "$rootfs/usr/local/bin/bunos-hyprland-wslg" <<'EOF'
#!/bin/bash
# Bun OS: run Hyprland as a nested Wayland client of WSLg (one window on the Windows desktop).
set -euo pipefail
: "${WAYLAND_DISPLAY:=wayland-0}"
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
# WSLg publishes its sockets in /mnt/wslg/runtime-dir; systemd's user runtime dir starts empty.
for socket in "$WAYLAND_DISPLAY" "$WAYLAND_DISPLAY.lock"; do
  [[ -e $XDG_RUNTIME_DIR/$socket || ! -e /mnt/wslg/runtime-dir/$socket ]] || ln -s "/mnt/wslg/runtime-dir/$socket" "$XDG_RUNTIME_DIR/$socket"
done
[[ -S $XDG_RUNTIME_DIR/$WAYLAND_DISPLAY ]] || { echo "No WSLg Wayland socket ($WAYLAND_DISPLAY); enable guiApplications in .wslconfig" >&2; exit 1; }
export WAYLAND_DISPLAY XDG_SESSION_TYPE=wayland
# /dev/dxg (dxgkrnl) + Mesa d3d12 render through the Windows GPU driver; vgem provides the GBM render node.
[[ -e /dev/dxg ]] && export GALLIUM_DRIVER=${GALLIUM_DRIVER:-d3d12} LIBVA_DRIVER_NAME=${LIBVA_DRIVER_NAME:-d3d12}
export LD_LIBRARY_PATH=/usr/lib/wsl/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
export AQ_NO_KMS_REQUIREMENT=1
unset DISPLAY
exec Hyprland "$@"
EOF
  install -Dm0644 /dev/stdin "$rootfs/etc/profile.d/bunos-wsl.sh" <<'EOF'
# Bun OS WSL: Windows GPU user-mode drivers (mounted by WSL) and the Bun runtime.
case ":${LD_LIBRARY_PATH:-}:" in *:/usr/lib/wsl/lib:*) ;; *) [ -d /usr/lib/wsl/lib ] && export LD_LIBRARY_PATH=/usr/lib/wsl/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH} ;; esac
EOF
  install -Dm0644 /dev/stdin "$rootfs/etc/modules-load.d/bunos-wsl.conf" <<'EOF'
# Loaded when present; the WSL kernel builds most of these in.
vgem
EOF
  if [[ -n $theme ]]; then
    theme=$(realpath -e -- "$theme")
    install -Dm0644 "$theme" "$rootfs/usr/share/bun-os/hypr/m3-hyprland.conf"
    lua=$(mktemp)
    {
      echo '-- Generated from aphrody-m3-emit --target hyprland (Material 3). Re-run the emitter to change it.'
      while IFS= read -r line; do
        if [[ $line =~ ^\$m3_([a-z_]+)\ =\ rgb\(([0-9a-f]{6})\)$ ]]; then
          var=${BASH_REMATCH[1]}; value=${BASH_REMATCH[2]}
          echo "local m3_$var = \"rgba(${value}ff)\""
        fi
      done <"$theme"
      tertiary=$(sed -n 's/.*col\.active_border = rgb([0-9a-f]*) rgb(\([0-9a-f]\{6\}\)).*/\1/p' "$theme")
      echo "local m3_tertiary = \"rgba(${tertiary:-cfbdfe}ff)\""
      cat <<'LUA'
local active = { colors = { m3_primary, m3_tertiary }, angle = 45 }
hl.config({
  general = { col = { active_border = active, inactive_border = m3_outline } },
  decoration = { rounding = 12 },
  group = { col = { border_active = active, border_inactive = m3_outline } },
})
LUA
    } >"$lua"
    grep -q 'local m3_primary' "$lua" || { echo 'm3-hyprland.conf has no $m3_primary colour' >&2; exit 1; }
    for home in "$rootfs/etc/skel" "$rootfs/home/aphro"; do
      [[ -f $home/.config/hypr/hyprland.lua ]] || continue
      install -m0644 "$lua" "$home/.config/hypr/m3.lua"
      grep -q 'require("hypr.m3")' "$home/.config/hypr/hyprland.lua" ||
        sed -i 's/^require("hypr.looknfeel")$/&\nrequire("hypr.m3")/' "$home/.config/hypr/hyprland.lua"
      grep -q 'require("hypr.m3")' "$home/.config/hypr/hyprland.lua" || { echo "Cannot hook m3.lua into $home" >&2; exit 1; }
      [[ $home == */home/aphro ]] && chown 1000:1000 "$home/.config/hypr/m3.lua"
    done
    rm -f "$lua"
    theme_receipt=$(jq -cn --arg sha "$(sha256sum "$theme" | awk '{print $1}')" '{generator: "aphrody-m3-emit --target hyprland", sourceSha256: $sha, installed: "~/.config/hypr/m3.lua"}')
  fi
}

build_omarchy_wsl_preview() {
  local repo_root image_dir package_inventory bun_payload package_inventory_sha profile_manifest guest_inputs profile
  local rootfs_sha guest_manifest_sha packages_lock_sha actual_inventory_sha bun_root bun_sha bun_payload_sha bun_version bun_revision bun_asset bun_asset_sha
  local output_dir work rootfs guest_user guest_gid old_group package version output checksum checksum_line relative path account
  repo_root=$(realpath -e -- "$(dirname "$0")/../../../..")
  image_dir=${APHRODY_WSL_OMARCHY_IMAGE_DIR:-}
  package_inventory=${APHRODY_WSL_OMARCHY_PACKAGES:-}
  bun_payload=${APHRODY_WSL_BUN_PAYLOAD:-}
  package_inventory_sha=${APHRODY_WSL_OMARCHY_PACKAGES_SHA256:-}
  profile_manifest=${APHRODY_WSL_PROFILE_MANIFEST:-$repo_root/tools/aphrody/config/os/wsl-build.json}
  guest_inputs=${APHRODY_WSL_OMARCHY_GUEST_INPUTS:-$repo_root/factory/images/bunos-omarchy/guest-inputs.json}
  profile=${APHRODY_WSL_PROFILE:-omarchy-preview}
  [[ -n $image_dir && -n $package_inventory && -n $bun_payload && $package_inventory_sha =~ ^[0-9a-f]{64}$ ]] || {
    echo 'omarchy-rootfs requires the image job directory, Bun payload and package inventory SHA256' >&2
    exit 2
  }
  image_dir=$(realpath -e -- "$image_dir")
  package_inventory=$(realpath -e -- "$package_inventory")
  bun_payload=$(realpath -e -- "$bun_payload")
  profile_manifest=$(realpath -e -- "$profile_manifest")
  guest_inputs=$(realpath -e -- "$guest_inputs")
  [[ -f $image_dir/rootfs.tar && -f $image_dir/import-receipt.json && -f $image_dir/guest-manifest.json && -f $image_dir/packages.lock.txt && -f $image_dir/NOTICES.md && -f $package_inventory && -f $bun_payload/bun-runtime.json && -f $bun_payload/SHA256SUMS && -d $bun_payload/rootfs ]] || {
    echo 'Omarchy import or pinned Bun runtime payload is incomplete' >&2
    exit 2
  }
  command -v jq >/dev/null && command -v sha256sum >/dev/null || { echo 'Omarchy WSL export requires jq and sha256sum' >&2; exit 2; }
  jq -e --arg profile "$profile" '.arch.targets[$profile] | .state == "experimental" and (.requiredPackages | type == "array") and (.requiredPackageVersions | type == "object")' "$profile_manifest" >/dev/null || {
    echo "WSL profile '$profile' is not an experimental import target" >&2
    exit 1
  }
  mapfile -t profile_packages < <(jq -r --arg profile "$profile" '.arch.targets[$profile].requiredPackages[]' "$profile_manifest")
  [[ ${#profile_packages[@]} -eq ${#packages[@]} ]] || { echo 'Package arguments do not match the Omarchy WSL profile' >&2; exit 2; }
  for i in "${!packages[@]}"; do
    [[ ${packages[$i]} == "${profile_packages[$i]}" ]] || { echo 'Package arguments must match the ordered Omarchy profile exactly' >&2; exit 2; }
  done
  actual_inventory_sha=$(sha256sum "$package_inventory" | awk '{print $1}')
  [[ $actual_inventory_sha == "$package_inventory_sha" ]] || { echo 'Omarchy package inventory hash mismatch' >&2; exit 1; }
  rootfs_sha=$(sha256sum "$image_dir/rootfs.tar" | awk '{print $1}')
  guest_manifest_sha=$(sha256sum "$image_dir/guest-manifest.json" | awk '{print $1}')
  packages_lock_sha=$(sha256sum "$image_dir/packages.lock.txt" | awk '{print $1}')
  jq -e --arg rootfs "$rootfs_sha" --arg manifest "$guest_manifest_sha" --arg lock "$packages_lock_sha" \
    --arg manifest_pin "$(jq -r '.assets.guestManifest.sha256' "$guest_inputs")" \
    --arg lock_pin "$(jq -r '.assets.packagesLock.sha256' "$guest_inputs")" \
    --arg release "$(jq -r '.release.tag' "$guest_inputs")" \
    --arg revision "$(jq -r '.release.revision' "$guest_inputs")" \
    --arg omarchy_revision "$(jq -r '.omarchy.revision' "$guest_inputs")" \
    --arg version "$(jq -r '.omarchy.version' "$guest_inputs")" \
    '.schemaVersion == 1 and .state == "unqualified" and .packageLockDigestVerified == true and .assets.dockerArchive.sha256 == $rootfs and .assets.guestManifest.sha256 == $manifest and .assets.guestManifest.sha256 == $manifest_pin and .assets.packagesLock.sha256 == $lock and .assets.packagesLock.sha256 == $lock_pin and .release.tag == $release and .release.revision == $revision and .omarchy.revision == $omarchy_revision and .omarchy.version == $version and .desktopQualified == false' \
    "$image_dir/import-receipt.json" >/dev/null || { echo 'Omarchy receipt does not match the pinned guest inputs and imported files' >&2; exit 1; }
  for package in "${packages[@]}"; do
    version=$(jq -r --arg profile "$profile" --arg package "$package" '.arch.targets[$profile].requiredPackageVersions[$package]' "$profile_manifest")
    grep -Fqx "$package $version" "$package_inventory" || { echo "Omarchy package missing or version mismatch: $package=$version" >&2; exit 1; }
  done

  bun_root=$(realpath -e -- "$bun_payload/rootfs")
  [[ -f $bun_root/usr/bin/bun && -x $bun_root/usr/bin/bun && ! -L $bun_root/usr/bin/bun ]] || { echo 'Bun payload must provide a regular executable at rootfs/usr/bin/bun' >&2; exit 1; }
  declare -A bun_checksums=()
  while IFS= read -r checksum_line || [[ -n ${checksum_line:-} ]]; do
    [[ $checksum_line =~ ^([0-9a-f]{64})\ \ (.+)$ ]] || {
      echo 'Malformed or unsafe path in Bun payload checksum manifest' >&2; exit 1;
    }
    checksum=${BASH_REMATCH[1]}
    relative=${BASH_REMATCH[2]}
    [[ $relative != /* && $relative != *\\* && $relative != *'..'* ]] || {
      echo 'Malformed or unsafe path in Bun payload checksum manifest' >&2; exit 1;
    }
    case $relative in
      usr/bin/bun|usr/bin/bunx|usr/share/licenses/bun-aphrody/LICENSE.md|usr/share/licenses/bun-aphrody/MULLVAD-LICENSE.md|usr/share/licenses/bun-aphrody/MULLVAD-THIRD-PARTY.md) ;;
      *) echo "Unexpected path in Bun checksum manifest: $relative" >&2; exit 1 ;;
    esac
    [[ -z ${bun_checksums[$relative]+present} ]] || { echo "Duplicate Bun checksum entry: $relative" >&2; exit 1; }
    bun_checksums[$relative]=$checksum
  done <"$bun_payload/SHA256SUMS"
  # bun, bunx and LICENSE.md are required; the Mullvad notices exist only in runtimes that vendor it.
  for relative in usr/bin/bun usr/bin/bunx usr/share/licenses/bun-aphrody/LICENSE.md; do
    [[ -n ${bun_checksums[$relative]+present} ]] || { echo "Bun checksum manifest omits $relative" >&2; exit 1; }
  done
  (cd "$bun_root" && sha256sum -c "$bun_payload/SHA256SUMS")
  bun_version=$(jq -r --arg profile "$profile" '.arch.targets[$profile].bunRuntimeVersion' "$profile_manifest")
  bun_revision=$(jq -r --arg profile "$profile" '.arch.targets[$profile].bunRuntimeSourceRevision' "$profile_manifest")
  bun_asset=$(jq -r --arg profile "$profile" '.arch.targets[$profile].bunRuntimeReleaseAsset' "$profile_manifest")
  bun_asset_sha=$(jq -r --arg profile "$profile" '.arch.targets[$profile].bunRuntimeReleaseAssetSha256' "$profile_manifest")
  jq -e --arg version "$bun_version" --arg revision "$bun_revision" --arg asset "$bun_asset" --arg asset_sha "$bun_asset_sha" \
    '.schemaVersion == 1 and .kind == "aphrody-bun-runtime-payload" and .qualified == true and .packageName == "bun-aphrody" and .version == $version and .sourceRevision == $revision and .releaseAsset == $asset and .releaseAssetSha256 == $asset_sha and (.sourceRevision | test("^[0-9a-f]{40}$")) and (.releaseAssetSha256 | test("^[0-9a-f]{64}$")) and (.binarySha256 | test("^[0-9a-f]{64}$"))' \
    "$bun_payload/bun-runtime.json" >/dev/null || {
    echo 'Bun payload receipt must identify a qualified, pinned Aphrody runtime' >&2
    exit 1
  }
  bun_sha=$(sha256sum "$bun_root/usr/bin/bun" | awk '{print $1}')
  [[ $bun_sha == "$(jq -r '.binarySha256' "$bun_payload/bun-runtime.json")" ]] || { echo 'Bun binary does not match its payload receipt' >&2; exit 1; }
  bun_payload_sha=$(sha256sum "$bun_payload/SHA256SUMS" | awk '{print $1}')
  for relative in "${!bun_checksums[@]}"; do
    grep -Fq "  $relative" "$bun_payload/SHA256SUMS" || { echo "Bun payload checksum manifest omits $relative" >&2; exit 1; }
    [[ -e $bun_root/$relative || -L $bun_root/$relative ]] || { echo "Bun payload file is missing: $relative" >&2; exit 1; }
  done
  [[ -L $bun_root/usr/bin/bunx && $(readlink "$bun_root/usr/bin/bunx") == bun ]] || { echo 'bunx must be the package-owned relative symlink to bun' >&2; exit 1; }
  [[ $(realpath -e -- "$bun_root/usr/bin/bunx") == "$bun_root/usr/bin/bun" ]] || { echo 'bunx resolves outside the pinned Bun binary' >&2; exit 1; }
  while IFS= read -r path; do
    case ${path#"$bun_root/"} in
      usr|usr/bin|usr/share|usr/share/licenses|usr/share/licenses/bun-aphrody) ;;
      usr/bin/bun|usr/bin/bunx|usr/share/licenses/bun-aphrody/LICENSE.md|usr/share/licenses/bun-aphrody/MULLVAD-LICENSE.md|usr/share/licenses/bun-aphrody/MULLVAD-THIRD-PARTY.md) ;;
      *) echo "Unexpected path in Bun payload: ${path#"$bun_root/"}" >&2; exit 1 ;;
    esac
  done < <(find "$bun_root" -mindepth 1 ! -type d -print)

  output_dir=$1
  mkdir -p "$output_dir"
  output_dir=$(realpath "$output_dir")
  for output in "$distribution.wsl" packages.txt receipt.json SHA256SUMS; do
    [[ ! -e $output_dir/$output && ! -L $output_dir/$output ]] || {
      echo "Refusing to overwrite existing WSL artifact: $output_dir/$output" >&2
      exit 1
    }
  done
  work=$(mktemp -d "$output_dir/.rootfs.XXXXXX")
  rootfs=$work/rootfs
  cleanup_omarchy_wsl() { local result=$?; trap - EXIT; rm -rf --one-file-system "$work"; exit "$result"; }
  trap cleanup_omarchy_wsl EXIT
  mkdir -p "$rootfs"
  tar --xattrs --acls --selinux --numeric-owner -C "$rootfs" -xf "$image_dir/rootfs.tar"
  install -Dm0644 "$image_dir/import-receipt.json" "$rootfs/usr/share/doc/bun-os-omarchy/import-receipt.json"
  install -m0644 "$image_dir/guest-manifest.json" "$rootfs/usr/share/doc/bun-os-omarchy/guest-manifest.json"
  install -m0644 "$image_dir/packages.lock.txt" "$rootfs/usr/share/doc/bun-os-omarchy/packages.lock.txt"
  install -m0644 "$image_dir/NOTICES.md" "$rootfs/usr/share/licenses/bun-os-omarchy/NOTICES.md"
  install -Dm0755 "$bun_root/usr/bin/bun" "$rootfs/usr/bin/bun"
  ln -sfn bun "$rootfs/usr/bin/bunx"
  install -Dm0644 "$bun_root/usr/share/licenses/bun-aphrody/LICENSE.md" "$rootfs/usr/share/licenses/bun-aphrody/LICENSE.md"
  for relative in usr/share/licenses/bun-aphrody/MULLVAD-LICENSE.md usr/share/licenses/bun-aphrody/MULLVAD-THIRD-PARTY.md; do
    [[ -z ${bun_checksums[$relative]+present} ]] || install -Dm0644 "$bun_root/$relative" "$rootfs/$relative"
  done
  install -Dm0644 "$bun_payload/bun-runtime.json" "$rootfs/usr/share/doc/bun-os-aphrody-bun/runtime-payload.json"
  install -m0644 "$bun_payload/SHA256SUMS" "$rootfs/usr/share/doc/bun-os-aphrody-bun/runtime-payload.SHA256SUMS"
  [[ -f $rootfs/etc/passwd && -f $rootfs/etc/group && -f $rootfs/etc/shadow ]] || { echo 'Imported Omarchy rootfs lacks account databases' >&2; exit 1; }
  awk -F: '$1 == "root" && $3 == 0 { found=1 } END { exit !found }' "$rootfs/etc/passwd" || { echo 'Imported rootfs has no UID 0 root account' >&2; exit 1; }
  # The official guest creates its user on first boot; WSL needs it in the image.
  if ! awk -F: '$3 == 1000 { found=1 } END { exit !found }' "$rootfs/etc/passwd"; then
    if grep -q '^aphro:' "$rootfs/etc/passwd" "$rootfs/etc/group" || awk -F: '$3 == 1000 { found=1 } END { exit !found }' "$rootfs/etc/group"; then
      echo 'Omarchy rootfs has a conflicting aphro account or GID 1000 group' >&2
      exit 1
    fi
    printf 'aphro:x:1000:\n' >>"$rootfs/etc/group"
    printf 'aphro:!::\n' >>"$rootfs/etc/gshadow"
    printf 'aphro:x:1000:1000:Bun OS:/home/aphro:/bin/bash\n' >>"$rootfs/etc/passwd"
    printf 'aphro:!:::::::\n' >>"$rootfs/etc/shadow"
    for group in wheel video render input audio; do
      awk -F: -v g="$group" 'BEGIN { OFS=":" } $1 == g { $4 = ($4 == "" ? "aphro" : $4 ",aphro") } { print }' "$rootfs/etc/group" >"$rootfs/etc/group.new"
      chmod 0644 "$rootfs/etc/group.new" && mv "$rootfs/etc/group.new" "$rootfs/etc/group"
    done
    install -d -m 0700 -o 1000 -g 1000 "$rootfs/home/aphro"
    cp -a "$rootfs/etc/skel/." "$rootfs/home/aphro/"
    chown -R 1000:1000 "$rootfs/home/aphro"
  fi
  guest_user=$(awk -F: '$3 == 1000 { print $1; exit }' "$rootfs/etc/passwd")
  guest_gid=$(awk -F: -v user="$guest_user" '$1 == user { print $4; exit }' "$rootfs/etc/passwd")
  [[ -n $guest_user && $guest_gid == 1000 ]] || { echo 'Omarchy rootfs needs an existing normal UID/GID 1000 user' >&2; exit 1; }
  old_group=$(awk -F: '$3 == 1000 { print $1; exit }' "$rootfs/etc/group")
  [[ -n $old_group ]] || { echo 'Omarchy rootfs has no GID 1000 group' >&2; exit 1; }
  [[ -f $rootfs/etc/gshadow ]] || { echo 'Omarchy rootfs has no group shadow database' >&2; exit 1; }
  if [[ $guest_user != aphro ]]; then
    grep -q '^aphro:' "$rootfs/etc/passwd" && { echo 'Cannot rename UID 1000: aphro already exists' >&2; exit 1; }
    awk -F: -v old="$guest_user" 'BEGIN { OFS=":" } $1 == old { $1="aphro" } { print }' "$rootfs/etc/passwd" >"$rootfs/etc/passwd.new"
    chmod 0644 "$rootfs/etc/passwd.new" && mv "$rootfs/etc/passwd.new" "$rootfs/etc/passwd"
    awk -F: -v old="$guest_user" 'BEGIN { OFS=":" } $1 == old { $1="aphro" } { print }' "$rootfs/etc/shadow" >"$rootfs/etc/shadow.new"
    chmod 0600 "$rootfs/etc/shadow.new" && mv "$rootfs/etc/shadow.new" "$rootfs/etc/shadow"
  fi
  if [[ $old_group != aphro ]]; then
    grep -q '^aphro:' "$rootfs/etc/group" && { echo 'Cannot safely rename GID 1000 group to aphro' >&2; exit 1; }
    grep -q '^aphro:' "$rootfs/etc/gshadow" && { echo 'Cannot safely rename GID 1000 gshadow group to aphro' >&2; exit 1; }
  fi
  awk -F: -v old="$old_group" 'BEGIN { OFS=":" } $1 == old { $1="aphro" } { print }' "$rootfs/etc/group" >"$rootfs/etc/group.new"
  chmod 0644 "$rootfs/etc/group.new" && mv "$rootfs/etc/group.new" "$rootfs/etc/group"
  awk -F: -v old="$old_group" 'BEGIN { OFS=":" } $1 == old { $1="aphro" } { print }' "$rootfs/etc/gshadow" >"$rootfs/etc/gshadow.new"
  if [[ $guest_user != aphro ]]; then
    awk -F: -v old="$guest_user" 'BEGIN { OFS=":" } { for (f=3;f<=4;f++) if ($f != "") { n=split($f,m,","); for (i=1;i<=n;i++) if (m[i] == old) m[i]="aphro"; $f=m[1]; for (i=2;i<=n;i++) $f=$f "," m[i] } print }' "$rootfs/etc/gshadow.new" >"$rootfs/etc/gshadow.user.new"
    mv "$rootfs/etc/gshadow.user.new" "$rootfs/etc/gshadow.new"
  fi
  chmod 0640 "$rootfs/etc/gshadow.new" && mv "$rootfs/etc/gshadow.new" "$rootfs/etc/gshadow"
  awk -F: -v old="$guest_user" 'BEGIN { OFS=":" } NF >= 4 && $4 != "" { n=split($4,m,","); for (i=1;i<=n;i++) if (m[i] == old) m[i]="aphro"; $4=m[1]; for (i=2;i<=n;i++) $4=$4 "," m[i] } { print }' "$rootfs/etc/group" >"$rootfs/etc/group.new"
  chmod 0644 "$rootfs/etc/group.new" && mv "$rootfs/etc/group.new" "$rootfs/etc/group"
  for account in root aphro; do
    awk -F: -v account="$account" 'BEGIN { OFS=":"; found=0 } $1 == account { $2="!"; found=1 } { print } END { if (!found) print account, "!", "", "", "", "", "", "", "" }' "$rootfs/etc/shadow" >"$rootfs/etc/shadow.new"
    chmod 0600 "$rootfs/etc/shadow.new" && mv "$rootfs/etc/shadow.new" "$rootfs/etc/shadow"
  done
  awk -F: 'BEGIN { OFS=":" } { $2="!"; print }' "$rootfs/etc/shadow" >"$rootfs/etc/shadow.new"
  chmod 0600 "$rootfs/etc/shadow.new" && mv "$rootfs/etc/shadow.new" "$rootfs/etc/shadow"
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
  bunos_wsl_overlay "$rootfs"
  if find "$rootfs/boot" -maxdepth 1 -type f \( -name 'vmlinuz*' -o -name 'initramfs*' \) -print -quit 2>/dev/null | grep -q .; then
    echo 'WSL rootfs must not contain a kernel or initramfs' >&2
    exit 1
  fi
  command -v chroot >/dev/null || { echo 'chroot is required to probe Bun against the guest ABI' >&2; exit 2; }
  chroot "$rootfs" /usr/bin/bun --version >"$work/bun-version.txt"
  [[ $(<"$work/bun-version.txt") == "$bun_version" ]] || { echo 'Bun version does not match its pinned runtime receipt' >&2; exit 1; }
  cp "$package_inventory" "$work/packages.txt"
  tar -C "$rootfs" --numeric-owner --xattrs --acls --selinux --sparse -czf "$work/$distribution.wsl" .
  cat >"$work/receipt.json" <<EOF
{
  "schemaVersion": 1,
  "kind": "bun-os-wsl-image",
  "distribution": "$distribution",
  "profile": "$profile",
  "architecture": "x86_64",
  "source": {
    "owner": "factory/images/bunos-omarchy",
    "release": "$(jq -r '.release.tag' "$guest_inputs")",
    "omarchyRevision": "$(jq -r '.omarchy.revision' "$guest_inputs")",
    "rootfsTarSha256": "$rootfs_sha",
    "importReceiptSha256": "$(sha256sum "$image_dir/import-receipt.json" | awk '{print $1}')",
    "guestManifestSha256": "$guest_manifest_sha",
    "packagesLockSha256": "$packages_lock_sha",
    "packageInventorySha256": "$actual_inventory_sha"
  },
  "bunRuntime": { "version": "$(jq -r '.version' "$bun_payload/bun-runtime.json")", "sourceRevision": "$(jq -r '.sourceRevision' "$bun_payload/bun-runtime.json")", "binarySha256": "$bun_sha", "payloadManifestSha256": "$bun_payload_sha" },
  "qualification": { "state": "pending-wsl-import-desktop-and-product-gates", "qualified": false },
  "desktop": { "session": "omarchy-hyprland", "state": "unqualified" },
  "cosmic": { "state": "not-included" },
  "kernel": $kernel_receipt,
  "hyprlandTheme": $theme_receipt
}
EOF
  (cd "$work" && sha256sum "$distribution.wsl" packages.txt receipt.json >SHA256SUMS)
  mv "$work/packages.txt" "$output_dir/packages.txt"
  mv "$work/receipt.json" "$output_dir/receipt.json"
  mv "$work/$distribution.wsl" "$output_dir/$distribution.wsl"
  mv "$work/SHA256SUMS" "$output_dir/SHA256SUMS"
  (cd "$output_dir" && sha256sum -c SHA256SUMS)
}
