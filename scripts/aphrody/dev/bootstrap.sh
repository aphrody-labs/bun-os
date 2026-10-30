#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Full Ubuntu/WSL developer bootstrap for a fresh Aphrody checkout.
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
skip_sources=0
skip_python=0
install_canary=0
for arg in "$@"; do
  case "$arg" in
    --skip-sources) skip_sources=1 ;;
    --skip-python) skip_python=1 ;;
    --canary) install_canary=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
command -v apt-get >/dev/null || { echo 'This bootstrap currently supports Ubuntu/WSL (apt-get).' >&2; exit 2; }
packages_file="$root/infra/config/system-packages.json"
if ! command -v jq >/dev/null; then
  sudo apt-get update
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y jq
fi
mapfile -t packages < <(jq -r '.common[], .wsl[], .workstationLinux.packages[]' "$packages_file")
sudo apt-get update
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"

if ! command -v rustup >/dev/null; then
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --default-toolchain none
fi
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"
channel="$(sed -nE 's/^channel[[:space:]]*=[[:space:]]*"([^"]+)"/\1/p' "$root/rust-toolchain.toml" | head -1)"
[[ -n "$channel" ]] || { echo 'rust-toolchain.toml has no pinned channel' >&2; exit 1; }
rustup toolchain install "$channel" --profile minimal -c rustfmt -c clippy -c rust-src -c rust-analyzer
rustup target add --toolchain "$channel" x86_64-unknown-linux-gnu x86_64-pc-windows-msvc wasm32-unknown-unknown wasm32-wasip1
if (( install_canary == 1 )); then
  rustup toolchain install nightly --profile minimal -c rustfmt -c clippy -c rust-src -c rust-analyzer
  rustup target add --toolchain nightly x86_64-unknown-linux-gnu x86_64-pc-windows-msvc wasm32-unknown-unknown wasm32-wasip1
fi

bun_pin="$(jq -r '.toolchains.bun.version' "$packages_file")"
if ! command -v bun >/dev/null || [[ "$(bun --version)" != "$bun_pin" ]]; then
  # Unmodified upstream Bun, installed from its npm package at the exact pin (see infra/config/system-packages.json).
  npm install -g "bun@${bun_pin}"
fi
uv_pin="$(jq -r '.toolchains.uv.version' "$packages_file")"
if ! command -v uv >/dev/null || [[ "$(uv --version)" != *"${uv_pin}"* ]]; then
  curl -LsSf "https://astral.sh/uv/${uv_pin}/install.sh" | env UV_INSTALL_DIR="$HOME/.local/bin" INSTALLER_NO_MODIFY_PATH=1 sh
fi
command -v cargo-binstall >/dev/null || "$root/scripts/aphrody/build/rust/cargo-serial.sh" install --locked cargo-binstall
mapfile -t cargo_tools < <(jq -r '.cargoTools[]' "$packages_file")
"$root/scripts/aphrody/build/rust/cargo-serial.sh" binstall -y --locked nu "${cargo_tools[@]}"

cd "$root"
bun install --frozen-lockfile
if (( skip_sources == 0 )); then bun run sources:sync; fi
cargo fetch --locked
if (( skip_python == 0 )); then
  py_root="$root/py"
  if [[ -f "$py_root/pyproject.toml" ]]; then (cd "$py_root" && uv sync --all-packages --locked); fi
fi
printf 'Bootstrap complete for %s (Rust %s, Bun %s, uv %s).\n' "$root" "$channel" "$bun_pin" "$uv_pin"
