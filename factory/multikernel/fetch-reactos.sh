#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# fetch-reactos.sh OUTDIR: download the official ReactOS 0.4.16 zip, verify sha256 (GitHub release asset digest), unzip.
set -euo pipefail
OUT=${1:?outdir}; mkdir -p "$OUT"
URL=https://github.com/reactos/reactos/releases/download/0.4.16-release/ReactOS-0.4.16-i386.zip
SHA=e5851510cf5b79ef51a76b8155dd5ef7faca1155f44d0a1d41c35b77ece4ce2a
[ -f "$OUT/rosz.zip" ] || curl -fsSL --retry 3 -o "$OUT/rosz.zip" "$URL"
echo "$SHA  $OUT/rosz.zip" | sha256sum -c -
unzip -oq "$OUT/rosz.zip" -d "$OUT/zip"
find "$OUT/zip" -iname '*.iso' -printf '%s %p\n'
