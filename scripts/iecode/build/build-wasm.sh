#!/usr/bin/env bash
# Reproducible WebAssembly build for the NIE WASM library adapter.
#
# Étapes :
#   1. scripts/aphrody/build/rust/wasm-package.ts : cargo build --release --target wasm32-unknown-unknown,
#      wasm-bindgen --target web à la version du Cargo.lock (glue ESM + .d.ts), wasm-opt -Oz si binaryen est installé
#   2. patch Turbopack : `new URL(..., import.meta.url)` -> throw (force module_or_path)
#   3. publication in the canonical nie-web WASM surface
set -euo pipefail

# Derived portable paths: ROOT is the repository root.
ROOT="${NIE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
PKG="${NIE_WASM_PKG:-$ROOT/crates/aphrody-nie-wasm/pkg}"

cd "$ROOT"

echo "[1/3] wasm-package.ts (cargo, wasm-bindgen, wasm-opt -Oz)…"
bun scripts/aphrody/build/rust/wasm-package.ts --crate aphrody-nie-wasm --out "$PKG"

echo "[2/3] patch Turbopack…"
sed -i "s|module_or_path = new URL('aphrody_nie_wasm_bg.wasm', import.meta.url);|throw new Error(\"aphrody-nie-wasm: module_or_path requis\");|" "$PKG/aphrody_nie_wasm.js"
grep -q 'aphrody-nie-wasm: module_or_path requis' "$PKG/aphrody_nie_wasm.js"

after=$(wc -c < "$PKG/aphrody_nie_wasm_bg.wasm")
echo "[3/3] NIE library bindings generated in $PKG"

echo "OK — NIE WASM bindings generated ($after bytes); consuming hosts are qualified separately."
