#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Usage: prepare-wsl-kernel.sh <linux-7.3-git> <new-work-tree> <microsoft-wsl-kernel-git> <cachyos-ref> <bore.patch> [extra.patch ...]
# Produces the Bun OS WSL kernel tree as a commit series over the mainline tag:
#   1. CachyOS base patchset: tree delta between the mainline commit and <cachyos-ref>
#      (a ref of CachyOS/linux fetched into <linux-7.3-git> or the work tree)
#   2. CachyOS BORE scheduler (kernel-patches/<major>/sched/0001-bore-cachy.patch)
#   3. Microsoft dxgkrnl (/dev/dxg) ported from WSL2-Linux-Kernel
#   4. Optional extra patches (git am), e.g. API fixes for the dxgkrnl port
# Source trees are read only; the work tree is a --shared clone and must not exist yet.
set -euo pipefail
[[ $# -ge 5 ]] || { sed -n 3p "$0" >&2; exit 2; }
source_tree=$(realpath -e -- "$1")
work=$2
ms_tree=$(realpath -e -- "$3")
cachy_ref=$4
bore_patch=$(realpath -e -- "$5")
shift 5
extra=("$@")
[[ ! -e $work ]] || { echo "Refusing to reuse existing work tree: $work" >&2; exit 2; }
base=$(git -C "$source_tree" rev-parse HEAD)
git clone -q --shared --no-checkout "$source_tree" "$work"
work=$(realpath -e -- "$work")
cd "$work"
git config user.name aphrody-dev
git config user.email contact@aphrody.com
git checkout -q -B bunos-wsl "$base"
version=$(make -s kernelversion)
major=${version%.*}

# 1. CachyOS base: a git ref (source tree or work tree), or the directory of an extracted
#    signature-verified CachyOS/linux release tarball (cachyos-<version>-<rel>.tar.gz).
git checkout -q .
if [[ -d $cachy_ref ]]; then
  cachy_dir=$(realpath -e -- "$cachy_ref")
  [[ -f $cachy_dir/Makefile && -f $cachy_dir/Kconfig ]] || { echo "Not a kernel tree: $cachy_dir" >&2; exit 1; }
  git ls-files -z | xargs -0 rm -f
  (cd "$cachy_dir" && tar -cf - --exclude=.git .) | tar -xf -
  cachy_sha="tree:$(basename "$cachy_dir")"
else
  if ! git rev-parse -q --verify "$cachy_ref^{commit}" >/dev/null; then
    git fetch -q "$source_tree" "+$cachy_ref:refs/remotes/cachyos/base"
    cachy_ref=refs/remotes/cachyos/base
  fi
  cachy_sha=$(git rev-parse "$cachy_ref^{commit}")
  git read-tree -u --reset "$cachy_sha"
fi
# Keep the mainline version identity; CachyOS release trees may carry their own EXTRAVERSION.
git show "$base:Makefile" | grep -m1 '^EXTRAVERSION' >/tmp/extraversion.$$
sed -i "s/^EXTRAVERSION.*/$(sed 's/[\/&]/\\&/g' /tmp/extraversion.$$)/" Makefile
rm -f /tmp/extraversion.$$
git add -A -f .
git commit -q -m "CachyOS: base patchset for Linux $major" -m "Tree delta of CachyOS/linux $cachy_sha over $base." -m "Signed-off-by: aphrody-dev <contact@aphrody.com>"

# 2. BORE
git am -q --keep-cr "$bore_patch" || { git am --abort; echo 'BORE patch does not apply; refresh it for this tree' >&2; exit 1; }

# 3. dxgkrnl from the Microsoft WSL2 kernel (driver, UAPI header, VMBus GUIDs, Kbuild hooks)
ms_rev=$(git -C "$ms_tree" rev-parse HEAD)
git -C "$ms_tree" archive "$ms_rev" drivers/hv/dxgkrnl include/uapi/misc/d3dkmthk.h | tar -x
grep -q dxgkrnl drivers/hv/Kconfig || sed -i '/^endmenu/i source "drivers/hv/dxgkrnl/Kconfig"\n' drivers/hv/Kconfig
grep -q CONFIG_DXGKRNL drivers/hv/Makefile || printf 'obj-$(CONFIG_DXGKRNL)\t\t+= dxgkrnl/\n' >>drivers/hv/Makefile
if ! grep -q HV_GPUP_DXGK_GLOBAL_GUID include/linux/hyperv.h; then
  ms_header=$(mktemp)
  git -C "$ms_tree" show "$ms_rev:include/linux/hyperv.h" >"$ms_header"
  start=$(grep -n 'GPU paravirtualization global DXGK channel' "$ms_header" | cut -d: -f1)
  end=$(grep -n 'define HV_GPUP_DXGK_VGPU_GUID' "$ms_header" | cut -d: -f1)
  [[ -n $start && -n $end ]] || { echo 'Microsoft hyperv.h lacks the DXGK GUIDs' >&2; exit 1; }
  [[ $(tail -n1 include/linux/hyperv.h) == '#endif /* _HYPERV_H */' ]] || { echo 'Unexpected hyperv.h trailer' >&2; exit 1; }
  # The comment opens one line above the title; each macro spans three lines.
  { head -n -1 include/linux/hyperv.h; sed -n "$((start - 1)),$((end + 2))p" "$ms_header"; echo; tail -n1 include/linux/hyperv.h; } >include/linux/hyperv.h.new
  rm -f "$ms_header"
  mv include/linux/hyperv.h.new include/linux/hyperv.h
fi
grep -q HV_GPUP_DXGK_VGPU_GUID include/linux/hyperv.h || { echo 'Failed to add the dxgkrnl VMBus GUIDs' >&2; exit 1; }
git add drivers/hv include/uapi/misc/d3dkmthk.h include/linux/hyperv.h
git commit -q -m "drivers: hv: dxgkrnl: import from WSL2-Linux-Kernel" -m "Microsoft paravirtualized GPU (/dev/dxg) driver, UAPI header and VMBus GUIDs from microsoft/WSL2-Linux-Kernel $ms_rev. GPL-2.0 notices are kept in the imported files." -m "Signed-off-by: aphrody-dev <contact@aphrody.com>"

# 4. Port fixes and extras
for patch in "${extra[@]}"; do
  git am -q "$(realpath -e -- "$patch")" || { git am --abort; echo "Extra patch does not apply: $patch" >&2; exit 1; }
done

mkdir -p "$work/.bunos"
git format-patch -q -o "$work/.bunos/patches" "$base..HEAD"
git log --format='%h %s' "$base..HEAD" >"$work/.bunos/series.txt"
printf '{"base":"%s","version":"%s","cachyos":"%s","microsoft":"%s","bore":"%s","head":"%s"}\n' \
  "$base" "$version" "$cachy_sha" "$ms_rev" "$(sha256sum "$bore_patch" | awk '{print $1}')" "$(git rev-parse HEAD)" >"$work/.bunos/source.json"
cat "$work/.bunos/series.txt"
