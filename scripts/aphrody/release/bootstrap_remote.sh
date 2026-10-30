#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Idempotent toolchain bootstrap for the build factory host (Ubuntu). Run by ship_remote.sh before every build, and
# standalone: bash scripts/release/bootstrap_remote.sh
# Pins follow the sources: yolo rust-toolchain.toml (workspace), the Bun fork checkout ($APHRODY_BUN_CHECKOUT, default
# ~/bun) rust-toolchain.toml and scripts/aphrody/build/ci-images/spec.ts (LLVM 23, nightly Rust, release Bun), cmake/ninja from apt.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
CACHE=${APHRODY_BUILD_CACHE:-/home/ubuntu/build/cache}
LLVM=${YOLO_LLVM:-23}
RUST_STABLE=$(sed -n 's/^channel *= *"\(.*\)"/\1/p' "$ROOT/rust-toolchain.toml" | head -1)
RUST_BUN=$(sed -n 's/^channel *= *"\(.*\)"/\1/p' "${APHRODY_BUN_CHECKOUT:-$HOME/bun}/rust-toolchain.toml" 2>/dev/null | head -1 || true)
say() { echo "=== bootstrap: $* ($(date -u +%FT%TZ))"; }

say "apt packages"
apt() { sudo -n env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get "$@"; }
apt update -qq
apt install -y -qq build-essential pkg-config libssl-dev libtool make just cmake ninja-build ccache nasm perl \
  python3 golang nodejs ruby-full libatomic1 xz-utils unzip curl git gh lsb-release software-properties-common gnupg mold \
  libgtk-4-dev libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libxkbcommon-dev libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 libcairo2 libasound2-dev librsvg2-dev libxdo-dev patchelf tmux

if ! command -v "clang-$LLVM" >/dev/null && [ ! -x "/usr/lib/llvm-$LLVM/bin/clang" ]; then
  say "LLVM $LLVM (apt.llvm.org)"
  curl -fsSL https://apt.llvm.org/llvm.sh -o /tmp/llvm.sh
  sudo -n bash /tmp/llvm.sh "$LLVM" all
fi

if ! command -v rustup >/dev/null && [ ! -x "$HOME/.cargo/bin/rustup" ]; then
  say "rustup"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none
fi
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:/usr/lib/llvm-$LLVM/bin:$PATH"

say "rust toolchains ${RUST_STABLE:-stable} ${RUST_BUN:+and $RUST_BUN}"
rustup toolchain install "${RUST_STABLE:-stable}" --profile minimal -c rustfmt -c clippy -c rust-src
rustup default "${RUST_STABLE:-stable}"
[ -n "$RUST_BUN" ] && rustup toolchain install "$RUST_BUN" --profile minimal -c rust-src -c rustfmt -c clippy -c llvm-tools || true

if ! command -v bun >/dev/null; then
  say "bun (upstream release)"
  curl -fsSL https://bun.com/install | bash
fi

# cargo reuses one sccache store on the factory volume; Bun's own build uses ccache under BUN_BUILD_CACHE_DIR
mkdir -p "$HOME/.cargo" "$CACHE/sccache" "$CACHE/bun-build"
cat > "$HOME/.cargo/config.toml" <<EOF
[build]
rustc-wrapper = "sccache"
incremental = false

[net]
git-fetch-with-cli = true
retry = 3

[env]
SCCACHE_DIR = "$CACHE/sccache"
SCCACHE_CACHE_SIZE = "60G"
SCCACHE_DIRECT = "true"
EOF

say "cargo addons (locked): sccache cargo-nextest cargo-deny"
for crate in sccache cargo-nextest cargo-deny; do
  bin=${crate#cargo-}; [ "$crate" = sccache ] && bin=sccache
  command -v "$crate" >/dev/null || command -v "$bin" >/dev/null || RUSTC_WRAPPER='' cargo install --locked "$crate"
done

grep -q BUN_BUILD_CACHE_DIR "$HOME/.profile" 2>/dev/null || cat >> "$HOME/.profile" <<EOF
export BUN_BUILD_CACHE_DIR="$CACHE/bun-build" BUN_INSTALL_CACHE_DIR="$CACHE/bun"
export PATH="\$HOME/.cargo/bin:\$HOME/.bun/bin:/usr/lib/llvm-$LLVM/bin:\$PATH"
EOF

say "versions"
for t in "rustc --version" "cargo --version" "sccache --version" "cargo nextest --version" "cargo deny --version" \
  "bun --version" "clang-$LLVM --version" "cmake --version" "ninja --version" "gh --version" "git --version"; do
  echo "$($t 2>&1 | head -1)"
done
