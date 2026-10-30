#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Builds and stages an aphrody.com release on the VPS (docs/webos/ARCHITECTURE.md, ADR-003):
#   crates/aphrody-webos-server/release.sh
# 1. the server binary (aphrody-webos) and the wasm client, through the serialized Cargo wrapper (four jobs);
# 2. wasm-bindgen --target web and wasm-opt -Oz for the client;
# 3. an immutable release directory with receipt.json (sha256 of every file);
# 4. the ready pointer consumed by the root activator (aphrody-webos-deploy.timer), which verifies the receipt,
#    switches ~/apps/webos/current, restarts aphrody-webos.service, gates on /api/health and rolls back on failure.
set -euo pipefail

[[ "$(uname -s)" == Linux ]] || { echo "Release aphrody.com from the VPS factory" >&2; exit 1; }
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"
git fetch --quiet origin
commit="$(git rev-parse HEAD)"
# A published commit (on origin/main); main moves fast with concurrent agents, the activator re-checks ancestry.
git merge-base --is-ancestor "$commit" refs/remotes/origin/main ||
  { echo "Release a published commit of main (git fetch origin && git merge --ff-only origin/main)" >&2; exit 1; }
git diff --quiet HEAD -- crates/aphrody-webos-server crates/aphrody-webos-client crates/aphrody-webos-protocol crates/aphrody-inventory ||
  { echo "Commit the WebOS crates before releasing" >&2; exit 1; }

cargo_serial() {
  CARGO_BUILD_JOBS=4 APHRODY_BUILD_HOST='' APHRODY_LOCAL_CARGO=1 scripts/aphrody/build/rust/cargo-serial.sh "$@"
}
cargo_serial build --release -p aphrody-webos-server -p aphrody-inventory
# WebAssembly at full feature level (owner order): SIMD, relaxed SIMD, bulk memory, saturating float conversion, sign
# extension, reference types. Threads (atomics + build-std) follow when the toolchain owner enables them.
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="-C target-feature=+simd128,+relaxed-simd,+bulk-memory,+nontrapping-fptoint,+sign-ext,+reference-types" \
  cargo_serial build --release -p aphrody-webos-client --target wasm32-unknown-unknown

handoff="${WEBOS_DEPLOY_ROOT:-$root/build/webos-deploy}"
release="$handoff/releases/$commit-$(date +%s%3N)"
mkdir -p "$release/client"
install -m 0755 target/release/aphrody-webos "$release/aphrody-webos"
wasm-bindgen --target web --no-typescript --out-dir "$release/client" \
  target/wasm32-unknown-unknown/release/aphrody_webos_client.wasm
wasm-opt -Oz --all-features \
  "$release/client/aphrody_webos_client_bg.wasm" -o "$release/client/aphrody_webos_client_bg.wasm"
# Browser emulator test page (packages/bun-engine/web-emulation), served until the iced client hosts the emulators.
mkdir -p "$release/emulator"
install -m 0644 packages/bun-engine/web-emulation/qualify-page/* "$release/emulator/"
install -m 0644 crates/aphrody-webos-client/web/index.html crates/aphrody-webos-client/web/boot.js "$release/client/"
# Content-hashed names (cached immutably by the server), then brotli and gzip copies served precompressed.
(
  cd "$release/client"
  wasm_hash="$(sha256sum aphrody_webos_client_bg.wasm | cut -c1-16)"
  mv aphrody_webos_client_bg.wasm "aphrody_webos_client_bg-$wasm_hash.wasm"
  js_hash="$(sha256sum aphrody_webos_client.js | cut -c1-16)"
  mv aphrody_webos_client.js "aphrody_webos_client-$js_hash.js"
  sed -i "s#/aphrody_webos_client_bg.wasm#/aphrody_webos_client_bg-$wasm_hash.wasm#; s#/aphrody_webos_client.js#/aphrody_webos_client-$js_hash.js#" boot.js index.html
  boot_hash="$(sha256sum boot.js | cut -c1-16)"
  mv boot.js "boot-$boot_hash.js"
  sed -i "s#/boot.js#/boot-$boot_hash.js#" index.html
  for file in *.wasm *.js; do
    brotli -q 11 -k -f "$file"
    gzip -9 -k -f "$file"
  done
)
# Inventory of every member plus the built wasm modules, with the coverage gate (exits non-zero on failure).
target/release/aphrody-inventory write "$release/inventory" --versions
printf 'SOURCE_COMMIT=%s\n' "$commit" > "$release/release.env"

(
  cd "$release"
  find . -type f ! -name receipt.json -printf '%P\n' | LC_ALL=C sort | while read -r path; do
    printf '{"path":"%s","bytes":%s,"sha256":"%s"}\n' "$path" "$(stat -c %s "$path")" "$(sha256sum "$path" | cut -d' ' -f1)"
  done | {
    printf '{"schemaVersion":2,"sourceCommit":"%s","createdAt":"%s","files":[' "$commit" "$(date -u +%FT%TZ)"
    paste -sd, -
    printf ']}\n'
  } > receipt.json
)

# Keep the newest four releases and the active one.
active="$(readlink "$HOME/apps/webos/current" || true)"
ls -1dt "$handoff/releases"/*/ 2>/dev/null | tail -n +5 | while read -r old; do
  [[ "${old%/}" == "${active%/}" ]] || rm -rf "$old"
done

printf '%s\n' "$(basename "$release")" > "$handoff/ready.tmp"
mv "$handoff/ready.tmp" "$handoff/ready"
echo "aphrody.com release staged: $release ($(du -sh "$release" | cut -f1)); client wasm $(gzip -9c "$release"/client/aphrody_webos_client_bg-*.wasm | wc -c) bytes gzip"
