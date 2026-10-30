#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Build the Gemma wasm modules with Emscripten against the pinned llama.cpp release.
#   scripts/build.sh [web|node|wasi|all] [--wasm32]
# Needs emcc/emcmake on PATH (emsdk image, see Dockerfile) and git.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
pin_tag="$(sed -n 's/.*"tag": *"\([^"]*\)".*/\1/p' "$here/build/pin.json" | head -1)"
pin_sha="$(sed -n 's/.*"commit": *"\([^"]*\)".*/\1/p' "$here/build/pin.json" | head -1)"
work="${GW_WORK:-$here/build/work}"
llama="${GW_LLAMA_DIR:-$work/llama.cpp}"
variant="${1:-all}"
mem64=ON
[[ "${2:-}" == "--wasm32" ]] && mem64=OFF

if [[ ! -d "$llama/.git" ]]; then
  mkdir -p "$work"
  git clone --filter=blob:none https://github.com/ggml-org/llama.cpp "$llama"
fi
git -C "$llama" fetch -q --tags origin "$pin_tag"
git -C "$llama" checkout -q "$pin_sha"
test "$(git -C "$llama" rev-parse HEAD)" = "$pin_sha"

variants=("$variant")
[[ "$variant" == all ]] && variants=(web node wasi)
for v in "${variants[@]}"; do
  out="$here/dist/$v$([[ $mem64 == OFF && $v != wasi ]] && echo -32 || true)"
  mkdir -p "$out"
  emcmake cmake -S "$here/native" -B "$work/build-$v-$mem64" -DCMAKE_BUILD_TYPE=Release \
    -DGW_VARIANT="$v" -DGW_LLAMA_DIR="$llama" -DGW_MEM64="$mem64"
  cmake --build "$work/build-$v-$mem64" -j"$(nproc)" --target "gemma-$v"
  cp "$work/build-$v-$mem64"/gemma-"$v".* "$out"/
  ls -la "$out"
done
