#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Runs on the build factory host inside the `yolo ship` systemd unit, behind the heavy lock, on a checkout of
# <sha>. It is the whole pipeline of the repository and its CI while GitHub Actions are unavailable:
#   toolchain bootstrap; the gates of .github/workflows/ci.yml; the runtime artifact and the tests that load it;
#   the release assets of this host's target; the D0/D2 acceptance (install from those assets into an empty HOME,
#   doctor, scaffold, compile, pack, run the archive); the GitHub release when <sha> is the v<VERSION> tag on main.
# usage: ship_remote.sh <sha> <workspace> <artifact-dir>
set -uo pipefail
# The historical systemd launcher does not establish this owner environment.
# Refuse before bootstrap; use the native Workspace factory route to supply it.
if [[ "${APHRODY_BUILD_HOST:-}" != vps ]]; then
  echo "Full ship requires the native Workspace factory environment (APHRODY_BUILD_HOST=vps)." >&2
  exit 64
fi
ship_cargo_wrapper=${YOLO_CARGO_WRAPPER:-$HOME/aphrody/scripts/aphrody/build/rust/cargo-serial.sh}
if [[ ! -x "$ship_cargo_wrapper" ]]; then
  echo "Full ship requires the installed Aphrody Cargo owner wrapper (YOLO_CARGO_WRAPPER)." >&2
  exit 64
fi
export YOLO_CARGO_WRAPPER="$ship_cargo_wrapper"
sha=$1; ws=$2; out=$3
cache=${APHRODY_BUILD_CACHE:-/home/ubuntu/build/cache}
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:/usr/lib/llvm-${YOLO_LLVM:-23}/bin:$HOME/.local/bin:$PATH"
jobs=$(nproc)
export CARGO_BUILD_JOBS=$jobs CARGO_INCREMENTAL=0 CARGO_TERM_COLOR=never
export SCCACHE_DIR="$cache/sccache" SCCACHE_CACHE_SIZE=60G BUN_INSTALL_CACHE_DIR="$cache/bun"
status() { echo "$1" > "$out/STATUS"; }
step() { # name command...
  local name=$1
  shift
  status "running: $name"
  echo "=== $name ($(date -u +%FT%TZ))"
  "$@" || { status "failed: $name"; echo "FAILED: $name"; exit 1; }
}
cd "$ws" || exit 1
version=$(cat packages/engine/yolo/VERSION)
step "toolchain bootstrap" bash scripts/release/bootstrap_remote.sh
command -v sccache >/dev/null && export RUSTC_WRAPPER=sccache
step "bun install" bun install --frozen-lockfile
step "check: types, lint, format, rustfmt, clippy" just yolo::check
step "imported providers: format, workspace check and tests" just yolo::qualify-upstream
step "Python adapter native tests" just yolo::test-python-crate
step "licenses and sources (cargo deny)" just yolo::deny-ci
step "runtime artifact (build + package)" just yolo::runtime-package
step "tests (bun + nextest)" just yolo::test-all
step "release assets" bun run scripts/release/release.ts
step "install and deploy smoke (D0, D2)" bash scripts/release/smoke_remote.sh "dist/release/$version"
if git tag --points-at "$sha" | grep -qx "v$version"; then
  if git merge-base --is-ancestor "$sha" origin/main; then
    step "GitHub release v$version" bash scripts/release/publish_remote.sh "v$version" "dist/release/$version"
  else
    echo "=== v$version points at $sha but main does not contain it: not published"
  fi
fi
mkdir -p "$out/release" && cp -r "dist/release/$version" "$out/release/"
echo "$sha" > "$out/SHA"
status "ok"
echo "OK $sha"
