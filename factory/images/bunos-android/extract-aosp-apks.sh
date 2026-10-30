#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Extract the standalone AOSP apps of the pinned redroid base for the Bun OS F-Droid repository.
#   sh extract-aosp-apks.sh <out-dir>
# Kept: APKs from /system/app, /system/priv-app, /product/app, /product/priv-app, /system_ext/app and
# /system_ext/priv-app that declare a launcher activity, no android:sharedUserId and are not platform-signed
# components (those cannot install outside the image). Output: <out-dir>/<package>.apk and index.tsv
# (package, versionCode, versionName, label, image path). Sources: android.googlesource.com (Apache-2.0),
# release named in apps.json "base".
set -eu
out=${1:?out-dir}
here=$(cd "$(dirname "$0")" && pwd)
base=$(jq -r '.base.image + "@" + .base.digest' "$here/apps.json")
bt=${ANDROID_BUILD_TOOLS:-$(ls -d "$HOME"/android-sdk/build-tools/*/ | sort -V | tail -1)}
aapt2="${bt%/}/aapt2"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"; docker rm -f bunos-aosp-extract >/dev/null 2>&1 || true' EXIT
docker rm -f bunos-aosp-extract >/dev/null 2>&1 || true
docker create --name bunos-aosp-extract "$base" >/dev/null
for d in system/app system/priv-app product/app product/priv-app system_ext/app system_ext/priv-app; do
  mkdir -p "$tmp/$d"
  docker cp "bunos-aosp-extract:/$d/." "$tmp/$d/" 2>/dev/null || true
done
mkdir -p "$out"
: >"$out/index.tsv"
find "$tmp" -name '*.apk' | sort | while read -r apk; do
  badging=$("$aapt2" dump badging "$apk" 2>/dev/null) || continue
  echo "$badging" | grep -q '^launchable-activity:' || continue
  "$aapt2" dump xmltree --file AndroidManifest.xml "$apk" 2>/dev/null | grep -q 'sharedUserId' && continue
  pkg=$(echo "$badging" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")
  vc=$(echo "$badging" | sed -n "s/.*versionCode='\([^']*\)'.*/\1/p" | head -1)
  vn=$(echo "$badging" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)
  label=$(echo "$badging" | sed -n "s/^application-label:'\(.*\)'$/\1/p" | head -1)
  cp "$apk" "$out/$pkg.apk"
  printf '%s\t%s\t%s\t%s\t%s\n' "$pkg" "$vc" "$vn" "$label" "${apk#"$tmp"/}" >>"$out/index.tsv"
done
wc -l <"$out/index.tsv" | sed 's/^/standalone AOSP apps: /'
