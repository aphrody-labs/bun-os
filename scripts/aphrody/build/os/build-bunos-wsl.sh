#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Bun OS WSL image for Windows 11, end to end on the VPS factory host.
# Usage: build-bunos-wsl.sh <kernel|image|wslconfig> <work-root>
#   kernel     prepare-wsl-kernel.sh + build-wsl-kernel.sh into <work-root>/kernel-build
#   image      build-wsl-distro.sh omarchy-rootfs with the kernel modules and the M3 Hyprland theme
#   wslconfig  copy bzImage/modules.vhdx to <work-root>/out and write the .wslconfig snippet
# Inputs (environment, defaults under <work-root>):
#   LINUX_SRC (~/src/linux-v7.3-upstream), MS_WSL_SRC (~/src/microsoft-wsl-kernel-current),
#   CACHYOS_TREE (extracted cachyos-7.3.0-4 release), BORE_PATCH, EXTRA_PATCHES (space separated),
#   JOBS (BUN_FACTORY_JOBS of the held factory slots, at most 10), BUNOS_WSL_GPU/RUST/CACHY/DEBUG toggles (see wsl-kernel/bunos-wsl.config),
#   OMARCHY_IMPORT (factory/images/bunos-omarchy/import.ts job dir), BUN_PAYLOAD (stage-wsl-runtime.ts output),
#   M3_HYPRLAND (m3-hyprland.conf from bun-ui `m3-emit --target hyprland`), DISTRIBUTION (BunOS).
set -euo pipefail
step=$1
root=$(realpath -e -- "$2")
here=$(realpath -e -- "$(dirname "$0")")
repo=$(realpath -e -- "$here/../../../..")
out=$root/out
kernel_build=$root/kernel-build
# Inside `bun factory run` the slot jobs apply (4 per slot); at most 10 compiler jobs.
jobs=${JOBS:-${BUN_FACTORY_JOBS:-10}}
(( jobs > 10 )) && jobs=10
mkdir -p "$out" "$root/logs"
# bindgen loads the newest libclang; build with the same clang/lld version when it is installed.
if [[ -z ${BUNOS_WSL_LLVM:-} ]]; then
  newest=$(compgen -c clang- | sed -n 's/^clang-\([0-9][0-9]*\)$//p' | sort -n | tail -n1)
  export BUNOS_WSL_LLVM=${newest:+-$newest}
  : "${BUNOS_WSL_LLVM:=1}"
fi
case $step in
  kernel)
    tree=$root/src/linux-bunos-wsl
    if [[ ! -d $tree ]]; then
      # shellcheck disable=SC2086 # EXTRA_PATCHES is a list of paths.
      bash "$here/prepare-wsl-kernel.sh" "${LINUX_SRC:-$HOME/src/linux-v7.3-upstream}" "$tree" \
        "${MS_WSL_SRC:-$HOME/src/microsoft-wsl-kernel-current}" "${CACHYOS_TREE:-$root/patches/cachyos-7.3.0-4}" \
        "${BORE_PATCH:-$root/patches/0001-bore-cachy.patch}" ${EXTRA_PATCHES:-}
    fi
    BUNOS_WSL_PERF=${BUNOS_WSL_PERF:-0} bash "$here/build-wsl-kernel.sh" "$tree" "$kernel_build" "$jobs" \
      "${MS_WSL_SRC:-$HOME/src/microsoft-wsl-kernel-current}" rust "$repo/tools/aphrody/config/os/wsl-kernel/bunos-wsl.config"
    ;;
  image)
    distribution=${DISTRIBUTION:-BunOS}
    import=${OMARCHY_IMPORT:?OMARCHY_IMPORT names the import.ts job directory}
    image_dir=$root/omarchy-image
    mkdir -p "$image_dir"
    for file in rootfs.tar import-receipt.json guest-manifest.json packages.lock.txt NOTICES.md; do
      ln -sfn "$import/context/import/$file" "$image_dir/$file"
    done
    # The official signed package lock is the exact "name version" inventory of the guest.
    inventory=$import/context/import/packages.lock.txt
    sudo -n env APHRODY_WSL_OMARCHY_IMAGE_DIR="$image_dir" APHRODY_WSL_OMARCHY_PACKAGES="$inventory" \
      APHRODY_WSL_OMARCHY_PACKAGES_SHA256="$(sha256sum "$inventory" | awk '{print $1}')" \
      APHRODY_WSL_BUN_PAYLOAD="${BUN_PAYLOAD:?}" APHRODY_WSL_KERNEL_DIR="$kernel_build" \
      APHRODY_WSL_M3_HYPRLAND="${M3_HYPRLAND:?}" \
      bash "$here/build-wsl-distro.sh" "$out/image" "$distribution" omarchy-rootfs https://geo.mirror.pkgbuild.com \
      hyprland,mesa,quickshell,vulkan-virtio
    sudo -n chown -R "$(id -u):$(id -g)" "$out/image"
    ;;
  wslconfig)
    release=$(jq -r .kernelRelease "$kernel_build/build-receipt.json")
    install -m0644 "$kernel_build/arch/x86/boot/bzImage" "$out/bunos-wsl-$release.bzImage"
    install -m0644 "$kernel_build/modules.vhdx" "$out/bunos-wsl-$release-modules.vhdx"
    tar -C "$kernel_build/modules" --numeric-owner --owner=0 --group=0 -cf - lib | zstd -q -19 -T0 -o "$out/bunos-wsl-$release-modules.tar.zst" -f
    cp "$kernel_build/.config" "$out/bunos-wsl-$release.config"
    cat >"$out/wslconfig.snippet" <<EOF
# %UserProfile%\\.wslconfig — Bun OS WSL kernel ($release). Copy the two files to C:\\BunOS\\wsl first.
# Applies to every WSL 2 distribution; remove both lines to return to Microsoft's kernel.
[wsl2]
kernel=C:\\\\BunOS\\\\wsl\\\\bunos-wsl-$release.bzImage
kernelModules=C:\\\\BunOS\\\\wsl\\\\bunos-wsl-$release-modules.vhdx
guiApplications=true
nestedVirtualization=true
EOF
    (cd "$out" && find . -maxdepth 2 -type f ! -name SHA256SUMS -printf '%P\n' | LC_ALL=C sort | xargs sha256sum >SHA256SUMS)
    cat "$out/SHA256SUMS"
    ;;
  *) sed -n 3,7p "$0" >&2; exit 2 ;;
esac
