#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Download the pinned APKs of apps.json into the build context (apk/<id>.apk) and verify each sha256.
#   sh factory/images/bunos-android/fetch.sh [cache-dir]
# The cache (default ~/.cache/bunos-android/apk) keeps verified files between builds.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
cache=${1:-${XDG_CACHE_HOME:-$HOME/.cache}/bunos-android/apk}
mkdir -p "$cache" "$here/apk"
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }
jq -r '.apps[] | [.id, .url, .sha256] | @tsv' "$here/apps.json" | while IFS="$(printf '\t')" read -r id url sum; do
  f="$cache/$id-$sum.apk"
  if ! [ -s "$f" ] || ! echo "$sum  $f" | sha256sum -c --status; then
    curl -fsSL --retry 3 --max-time 600 -o "$f.part" "$url"
    echo "$sum  $f.part" | sha256sum -c --status || { echo "sha256 mismatch for $id ($url)" >&2; rm -f "$f.part"; exit 3; }
    mv "$f.part" "$f"
  fi
  cp "$f" "$here/apk/$id.apk"
  echo "ok $id"
done
