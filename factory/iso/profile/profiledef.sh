#!/usr/bin/env bash
# shellcheck disable=SC2034
# Bun OS live/installation medium (archiso profile, derived from Arch's releng for archiso 92). UEFI only, booted by
# systemd-boot; the kernel is linux-bun from [bunos-testing]. Named per docs/ops/RELEASES.md: bunos-YYYY.MM.DD-x86_64.iso.
iso_name="bunos"
iso_label="BUNOS_$(date --date="@${SOURCE_DATE_EPOCH:-$(date +%s)}" +%Y%m)"
iso_publisher="Bun OS <https://aphrody.com>"
iso_application="Bun OS live medium"
iso_version="$(date --date="@${SOURCE_DATE_EPOCH:-$(date +%s)}" +%Y.%m.%d)"
install_dir="bunos"
buildmodes=('iso')
bootmodes=('uefi.systemd-boot')
arch="x86_64"
pacman_conf="pacman.conf"
airootfs_image_type="squashfs"
airootfs_image_tool_options=('-comp' 'zstd' '-Xcompression-level' '15' '-b' '1M')
kernel_params_x86_64="console=tty0 console=ttyS0,115200"
file_permissions=(
  ["/etc/shadow"]="0:0:400"
  ["/root"]="0:0:750"
  ["/usr/local/bin/bunos-os-release"]="0:0:755"
  ["/usr/local/bin/bunos-boot-report"]="0:0:755"
)
