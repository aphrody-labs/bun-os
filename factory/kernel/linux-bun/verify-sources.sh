#!/bin/bash
# SPDX-License-Identifier: 0BSD
# verify-sources.sh [DOWNLOAD_DIR]
#
# Offline subset of `makepkg --verifysource`: re-computes b2sums and sha256sums of every source
# of ./PKGBUILD and compares them with the arrays. Local files are read from this directory,
# downloaded files from DOWNLOAD_DIR (default: this directory); a missing download is reported as
# "not downloaded" and is not an error unless --strict is given first. Signatures (.sign/.sig) are
# not checked here (SKIP entries); makepkg checks them against validpgpkeys, or run
#   xz -dc linux-X.tar.xz | gpg --verify linux-X.tar.sign -
set -euo pipefail

strict=0
if [[ ${1:-} == --strict ]]; then
  strict=1
  shift
fi
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
dl=${1:-$here}

# shellcheck source=PKGBUILD disable=SC1091
CARCH=x86_64 source "$here/PKGBUILD"

sources=("${source[@]}" "${source_x86_64[@]}")
b2=("${b2sums[@]}" "${b2sums_x86_64[@]}")
sha=("${sha256sums[@]}" "${sha256sums_x86_64[@]}")

if ((${#b2[@]} != ${#sources[@]})) || ((${#sha[@]} != ${#sources[@]})); then
  echo "array length mismatch: ${#sources[@]} sources, ${#b2[@]} b2sums, ${#sha[@]} sha256sums" >&2
  exit 1
fi

bad=0
for i in "${!sources[@]}"; do
  entry=${sources[$i]}
  if [[ $entry == *::* ]]; then name=${entry%%::*}; else name=${entry##*/}; fi
  if [[ $entry == *://* ]]; then
    file=$dl/$name
  else
    file=$here/$name
  fi
  if [[ ! -f $file ]]; then
    echo "not downloaded: $name"
    ((strict)) && bad=$((bad + 1))
    continue
  fi
  status=ok
  if [[ ${b2[$i]} != SKIP ]]; then
    [[ $(b2sum "$file" | cut -d' ' -f1) == "${b2[$i]}" ]] || status=B2SUM-MISMATCH
  fi
  if [[ ${sha[$i]} != SKIP ]]; then
    [[ $(sha256sum "$file" | cut -d' ' -f1) == "${sha[$i]}" ]] || status=SHA256-MISMATCH
  fi
  [[ ${b2[$i]} == SKIP && ${sha[$i]} == SKIP ]] && status=skipped
  echo "$status: $name"
  [[ $status == ok || $status == skipped ]] || bad=$((bad + 1))
done
((bad == 0))
