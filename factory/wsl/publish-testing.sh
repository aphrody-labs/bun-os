#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Publish [bunos-testing] (built by factory/desktop/build.sh) at https://aphrody.com/repo/bunos-testing/x86_64/,
# signed with the store's pacman key (the `aphrody-store` key of apps/webos/store/pacman.ts, kept in the protected
# store and never served; its public half is https://aphrody.com/repo/os/aphrody.gpg). Runs on the build host.
# Usage: publish-testing.sh [repo-dir]   env: WEBOS_STORE, WEBOS_STORE_SECRETS
set -euo pipefail
src=${1:-$HOME/build/storage/artifacts/pacman/bunos-testing/x86_64}
store=${WEBOS_STORE:-$HOME/apps/webos/store}
keys=${WEBOS_STORE_SECRETS:-$HOME/apps/webos/secrets/store}/gnupg
dst=$store/repo/bunos-testing/x86_64
stage=$store/.work/bunos-testing-$$
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage" "$dst"
# Only the files the database references: superseded builds stay in the build repo, out of the published one.
tar --zstd -xOf "$src/bunos-testing.db.tar.zst" --wildcards '*/desc' | awk '/%FILENAME%/{getline; print}' >"$stage/.files"
while read -r f; do cp --reflink=auto "$src/$f" "$stage/"; done <"$stage/.files"
rm "$stage/.files"
docker run --rm --cgroup-parent=build.slice -v "$stage:/stage" -v "$keys:/gnupg" archlinux:base-devel bash -euc '
  export GNUPGHOME=/gnupg
  fpr=$(gpg --list-secret-keys --with-colons aphrody-store | awk -F: "/^fpr/{print \$10; exit}")
  [ -n "$fpr" ] || { echo "no aphrody-store key in the store" >&2; exit 1; }
  cd /stage
  for f in *.pkg.tar.zst; do gpg --batch --yes --detach-sign --no-armor --local-user "$fpr" "$f"; done
  repo-add --quiet --sign --key "$fpr" bunos-testing.db.tar.zst *.pkg.tar.zst
  chown -R '"$(id -u):$(id -g)"' /stage'
chmod -R a+rX "$stage"
# Packages first, database last, so a client never sees a database that names a file not yet served.
rsync -a --exclude 'bunos-testing.*' "$stage/" "$dst/"
rsync -a --delete "$stage/" "$dst/"
echo "published $(ls "$dst"/*.pkg.tar.zst | wc -l) packages -> https://aphrody.com/repo/bunos-testing/x86_64/"
