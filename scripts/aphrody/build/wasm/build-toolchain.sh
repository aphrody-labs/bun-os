#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Builds the Bun OS WebAssembly core toolchain from the pinned aphrody-labs forks mounted under vendor/wasm/<name>,
# on the VPS build host only. Each source comes from its initialized submodule, or, when the submodule is not
# initialized, from a shallow fetch of its gitlink pin into $APHRODY_WASM_SRC (the shared checkout stays untouched).
#
#   scripts/aphrody/build/wasm/build-toolchain.sh [step...]   default: every step, in order
#
# Steps: wasm-tools wasmtime wit-bindgen wasm-pack wasm-bindgen wac cargo-component wabt binaryen wasm-host
# Output: $APHRODY_WASM_PREFIX/bin (default ~/build/toolchains/wasm/bin); logs in $APHRODY_WASM_LOGS.
# Limits: at most 4 compiler jobs, nice 15, sccache for rustc and the C/C++ compilers.
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)
SRC=${APHRODY_WASM_SRC:-$HOME/build/src/wasm}
TGT=${APHRODY_WASM_TARGET:-$HOME/build/target/wasm}
PREFIX=${APHRODY_WASM_PREFIX:-$HOME/build/toolchains/wasm}
LOG=${APHRODY_WASM_LOGS:-$HOME/build/logs/wasm}
JOBS=${APHRODY_WASM_JOBS:-4}
mkdir -p "$SRC" "$TGT" "$PREFIX/bin" "$LOG"
export RUSTC_WRAPPER=${RUSTC_WRAPPER:-sccache} CARGO_TARGET_DIR="$TGT" CARGO_BUILD_JOBS=$JOBS CARGO_INCREMENTAL=0

# Prints the source directory of vendor/wasm/<name> at its gitlink pin.
source_of() {
  local name=$1 mount="$ROOT/vendor/wasm/$1" pin url dir
  if [ -e "$mount/.git" ] && [ -n "$(ls -A "$mount" 2>/dev/null)" ]; then echo "$mount"; return; fi
  pin=$(git -C "$ROOT" ls-tree HEAD "vendor/wasm/$name" | awk '{print $3}')
  url=$(git -C "$ROOT" config -f .gitmodules "submodule.vendor/wasm/$name.url")
  [ -n "$pin" ] && [ -n "$url" ] || { echo "vendor/wasm/$name is not registered" >&2; return 1; }
  dir="$SRC/$name"
  [ -d "$dir/.git" ] || { git init -q "$dir" && git -C "$dir" remote add origin "$url"; }
  if [ "$(git -C "$dir" rev-parse -q --verify HEAD 2>/dev/null)" != "$pin" ]; then
    git -C "$dir" fetch -q --depth 1 origin "$pin" && git -C "$dir" checkout -q --detach FETCH_HEAD || return 1
  fi
  git -C "$dir" submodule update -q --init --recursive --depth 1 >&2 || return 1
  echo "$dir"
}

cargo_bin() { # mount package bins...
  local dir name=$1 pkg=$2; shift 2
  dir=$(source_of "$name") || return 1
  (cd "$dir" && nice -n 15 cargo build --release --locked -j "$JOBS" -p "$pkg") || return 1
  for b in "$@"; do install -m755 "$TGT/release/$b" "$PREFIX/bin/$b" || return 1; done
}

cmake_proj() { # mount cmake-args...
  local dir name=$1; shift
  dir=$(source_of "$name") || return 1
  cmake -S "$dir" -B "$TGT/cmake-$name" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DCMAKE_C_COMPILER_LAUNCHER=sccache -DCMAKE_CXX_COMPILER_LAUNCHER=sccache "$@" &&
    nice -n 15 ninja -C "$TGT/cmake-$name" -j "$JOBS" && cmake --install "$TGT/cmake-$name"
}

wasm_host() {
  (cd "$ROOT/crates/aphrody-wasm-host" && CARGO_TARGET_DIR="$TGT/aphrody-wasm-host" nice -n 15 cargo build --release -j "$JOBS") &&
    install -m755 "$TGT/aphrody-wasm-host/release/aphrody-wasm-host" "$PREFIX/bin/aphrody-wasm-host"
}

run_step() {
  case $1 in
    wasm-tools) cargo_bin wasm-tools wasm-tools wasm-tools ;;
    wasmtime) cargo_bin wasmtime wasmtime-cli wasmtime ;;
    wit-bindgen) cargo_bin wit-bindgen wit-bindgen-cli wit-bindgen ;;
    wasm-pack) cargo_bin wasm-pack wasm-pack wasm-pack ;;
    wasm-bindgen) cargo_bin wasm-bindgen wasm-bindgen-cli wasm-bindgen wasm-bindgen-test-runner ;;
    wac) cargo_bin wac wac-cli wac ;;
    cargo-component) cargo_bin cargo-component cargo-component cargo-component ;;
    wabt) cmake_proj wabt -DBUILD_TESTS=OFF -DBUILD_LIBWASM=OFF -DUSE_INTERNAL_SHA256=ON ;;
    binaryen) cmake_proj binaryen -DBUILD_TESTS=OFF -DBUILD_STATIC_LIB=OFF -DENABLE_WERROR=OFF ;;
    wasm-host) wasm_host ;;
    *) echo "unknown step $1" >&2; return 2 ;;
  esac
}

steps=("$@")
[ ${#steps[@]} -gt 0 ] || steps=(wasm-tools wasmtime wit-bindgen wasm-pack wasm-bindgen wac cargo-component wabt binaryen wasm-host)
status=0
for s in "${steps[@]}"; do
  echo "[$(date -Is)] start $s"
  if run_step "$s" >"$LOG/$s.log" 2>&1; then echo "[$(date -Is)] ok $s"; else echo "[$(date -Is)] FAIL $s ($LOG/$s.log)"; status=1; fi
done
exit $status
