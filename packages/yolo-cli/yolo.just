# Yolo recipes, a module of the root Justfile: `just yolo::<recipe>` (recipes run from the repository root).
# Bridges Cargo (Rust), Bun (TS7/Native), and Just orchestrator

set shell := ["bash", "-l", "-c"]
set working-directory := "../../.."

# Local/factory builds use Aphrody's shared Cargo lock, cache and resource guard.
# The factory may override this with its installed owner wrapper.
cargo_owner := env("YOLO_CARGO_WRAPPER", env("HOME") / "aphrody/scripts/aphrody/build/rust/cargo-serial.sh")
# The Bun fork has its own toolchain and build graph.
bun_toolchain := "nightly-2026-09-15"
bun_python_manifest := env("APHRODY_BUN_CHECKOUT", "") / "packages/bun-runtime-sdk/Cargo.toml"

default: status

# Status & Diagnostics
status:
    @echo -e "\033[1;36m=== YOLO Monorepo Status ===\033[0m"
    @bun run packages/engine/yolo/src/index.ts status
    @echo -e "\n\033[1;36m=== Cargo Workspace ===\033[0m"
    @"{{cargo_owner}}" check --locked --no-default-features -p yolo-core -p yolo-runtime --message-format=short

# Quality gates & verification
check: typecheck lint fmt-check rust-fmt-check check-core clippy
    @echo -e "\033[1;32m[OK] Quality gates passed\033[0m"

typecheck:
    tsc -p packages/engine/yolo/tsconfig.json --noEmit

# Run the installed toolchain binaries directly, without package execution/download runners.
lint:
    oxlint packages/engine/yolo/src/ packages/engine/yolo/test/ packages/engine/

fmt:
    oxfmt --write packages/engine/yolo/src/ packages/engine/yolo/test/ packages/engine/

fmt-check:
    oxfmt --check packages/engine/yolo/src/ packages/engine/yolo/test/ packages/engine/

# Minimal owned source formatting; imported engines keep an explicit upstream gate.
rust-fmt:
    "{{cargo_owner}}" fmt -p yolo-core -p yolo-runtime

rust-fmt-check:
    "{{cargo_owner}}" fmt --check -p yolo-core -p yolo-runtime

rust-fmt-upstream-check:
    "{{cargo_owner}}" fmt --all --check

rust-fmt-python-check:
    bun -e 'if (!process.env.APHRODY_BUN_CHECKOUT) throw new Error("Set APHRODY_BUN_CHECKOUT for Bun-owned Python sources")'
    "{{cargo_owner}}" fmt --manifest-path "{{bun_python_manifest}}" --check -p yolo-pyo3

# Minimal native server graph: no desktop, Python, browser or compiler provider.
check-core:
    "{{cargo_owner}}" check --locked --no-default-features -p yolo-core -p yolo-runtime --all-targets

# Clippy is strict on the core; optional owned providers have their own gates below.
clippy:
    "{{cargo_owner}}" clippy --locked --no-default-features -p yolo-core -p yolo-runtime --all-targets -- -D warnings

# Licenses, advisories, sources (cargo-deny, policy in deny.toml)
deny:
    cargo deny check

# The cargo-deny gate of CI: licenses and sources (advisories change daily, see `just deny`)
deny-ci:
    cargo deny check licenses sources

# Explicit imported desktop graph and tools, preserving the former workspace gate.
# Compiler and CEF engines retain separate opt-in selections.
check-upstream:
    "{{cargo_owner}}" check --locked --workspace --exclude aphrody-tauri-runtime-cef --all-targets

check-workspace: check-upstream

# Test the former desktop/default-member selection explicitly, including upstream helpers.
test-upstream:
    "{{cargo_owner}}" nextest run --locked --no-fail-fast --lib --bins --tests -p 'aphrody-tauri' -p 'aphrody-tauri-build' -p 'aphrody-tauri-codegen' -p 'aphrody-tauri-macros' -p 'aphrody-tauri-plugin' -p 'aphrody-tauri-plugin-*' -p 'aphrody-tauri-runtime' -p 'aphrody-tauri-utils' -p aphrody-create-tauri-app

# Default gates cover the minimal core; provider/upstream gates are explicit below.
ci: check deny-ci test-all

test:
    bun test test/

# Explicit packages keep this contract stable when other workspace members are added.
test-crates:
    "{{cargo_owner}}" nextest run --locked --no-default-features --no-fail-fast --lib --bins --tests -p yolo-core -p yolo-runtime

test-all: test test-crates

# Applications
cli *args:
    bun run packages/engine/yolo/src/index.ts {{args}}

web-build:
    cd m3/packages/app-ui && bun run build

web-dev:
    cd m3/packages/app-ui && bun run dev

# Requires a producer revision containing the optional browser feature. This selection
# does not assert that the feature or its installed artifact is already qualified.
check-browser:
    "{{cargo_owner}}" check --locked -p yolo-runtime --no-default-features --features browser --all-targets

clippy-browser:
    "{{cargo_owner}}" clippy --locked -p yolo-runtime --no-default-features --features browser --all-targets -- -D warnings

test-browser:
    "{{cargo_owner}}" test --locked -p yolo-runtime --no-default-features --features browser --lib

qualify-browser: rust-fmt-check check-browser clippy-browser test-browser

check-python:
    bun -e 'if (!process.env.APHRODY_BUN_CHECKOUT) throw new Error("Set APHRODY_BUN_CHECKOUT for Bun-owned Python sources")'
    "{{cargo_owner}}" check --manifest-path "{{bun_python_manifest}}" --locked -p yolo-pyo3 --all-targets

clippy-python:
    bun -e 'if (!process.env.APHRODY_BUN_CHECKOUT) throw new Error("Set APHRODY_BUN_CHECKOUT for Bun-owned Python sources")'
    "{{cargo_owner}}" clippy --manifest-path "{{bun_python_manifest}}" --locked -p yolo-pyo3 --all-targets -- -D warnings

test-python-crate:
    bun -e 'if (!process.env.APHRODY_BUN_CHECKOUT) throw new Error("Set APHRODY_BUN_CHECKOUT for Bun-owned Python sources")'
    "{{cargo_owner}}" test --manifest-path "{{bun_python_manifest}}" --locked -p yolo-pyo3 --lib --bins --tests

# uv invokes Maturin/Cargo; run it inside the factory's shared heavy lock.
test-python:
    @test "${APHRODY_BUILD_HOST:-}" = vps || { echo 'Python native build requires the declared factory; use just factory python <sha>.' >&2; exit 64; }
    just test-python-crate
    uv sync --locked --package yolo --extra dev
    uv run --package yolo --extra dev --no-sync -- python -m pytest packages/engine/python/tests

qualify-python: rust-fmt-python-check check-python clippy-python test-python

# `rustup run` without --install refuses an absent toolchain instead of acquiring it.
qualify-upstream: rust-fmt-upstream-check check-upstream test-upstream

# Native Workspace owner pins the source revision and serializes heavy provider builds.
[positional-arguments]
factory profile revision:
    #!/usr/bin/env bash
    set -euo pipefail
    source_scope=()
    case "$1" in
      core) recipe=ci ;;
      bun) recipe=qualify-bun ;;
      browser|python|tooling|upstream) recipe="qualify-$1" ;;
      *) echo 'Unknown profile: expected core, bun, browser, python, tooling or upstream.' >&2; exit 64 ;;
    esac
    [[ "$2" =~ ^[0-9a-f]{40}$ ]] || { echo 'Factory revision must be a full Git SHA.' >&2; exit 64; }
    exec ./scripts/dev/cli/aphrody ops build-factory run --repo yolo --revision "$2" "${source_scope[@]}" -- just "$recipe"

# Install the forked Tauri CLI (`cargo tauri`) from the Bun fork.
install-cli:
    "{{cargo_owner}}" install --path ../../bun/packages/bun-tauri/crates/aphrody-tauri-cli --locked

# Autonomous Code Generation Engine (from Bun upstream)
generate:
    bun run packages/engine/yolo/src/index.ts generate

# Native runtime (docs/architecture/runtime-native/RUNTIME-ABI.md): the artifact uses the `runtime` profile (unwinding panics)
runtime-build:
    "{{cargo_owner}}" build --locked --no-default-features --profile runtime -p aphrody-ffi --features browser,tooling

# Unified native Oxc/n2b implementation: the same aphrody_ffi artifact as the runtime.
tooling-build: runtime-build

qualify-tooling:
    "{{cargo_owner}}" check --locked -p aphrody-ffi --features tooling -p aphrody-toolchains -p yolo-core --features yolo-core/repository-tools
    "{{cargo_owner}}" test --locked -p aphrody-ffi --features tooling -p aphrody-bun-docs -p aphrody-toolchains -p yolo-core --features yolo-core/repository-tools --lib --tests
    "{{cargo_owner}}" clippy --locked -p aphrody-ffi --features tooling -p aphrody-bun-docs -p aphrody-toolchains -p yolo-core --features yolo-core/repository-tools --all-targets -- -D warnings
    just tooling-build

runtime-test: runtime-build
    "{{cargo_owner}}" test --locked --no-default-features -p yolo-runtime -p yolo-core
    bun run scripts/release/runtime_artifact.ts
    YOLO_RUNTIME_LIB="$(bun -e 'import { libraryFile } from "./packages/engine/runtime/src/index.ts"; console.log("target/runtime/" + libraryFile())')" bun test packages/engine/runtime/test/runtime_sdk.test.ts packages/engine/runtime/test/runtime_release.test.ts

# dist/runtime/<target>/: library + C header + manifest (target, toolchain, ABI, revisions, hashes)
runtime-package: runtime-build
    bun run scripts/release/runtime_artifact.ts

# Install the packaged artifact (verified, versioned, previous kept) and roll back
runtime-install: runtime-package
    bun run scripts/release/runtime_release.ts install

runtime-rollback:
    bun run scripts/release/runtime_release.ts rollback

runtime-list:
    bun run scripts/release/runtime_release.ts list

# Browse oven-sh/awesome-bun (README cached in .cache/awesome): just awesome search react
awesome *args:
    bun run packages/engine/yolo/src/index.ts awesome {{args}}

# Scaffold an Aphrody stack project: just create ../my-app --with web,desktop --framework hono
create *args:
    bun run packages/engine/yolo/src/index.ts create {{args}}

# Manage a Linux server (plan by default, --apply to execute): just host audit --host vps
host *args:
    bun run packages/engine/yolo/src/index.ts host {{args}}

# Re-audit and re-curate awesome-bun for the Rust-based Bun (network): docs/reference/yolo/AWESOME.md + JSON
awesome-curate:
    bun run packages/engine/yolo/src/index.ts awesome curate

# Documentation (mdBook)
docs-build:
    mdbook build docs

docs-serve:
    mdbook serve docs --open

# Cleaning
clean:
    @echo -e "\033[1;32m[OK] Yolo build outputs cleaned\033[0m"

# Publishing (dry-run by default; real publish needs explicit *-run recipes)
publish-crates-dry:
    cargo publish --workspace --exclude aphrody-tauri-runtime-cef --dry-run --allow-dirty

publish-crates-run:
    cargo publish --workspace --exclude aphrody-tauri-runtime-cef

# Plugins Management & Auditing
plugin-status:
    bun run packages/engine/yolo/src/index.ts plugin status

plugin-check:
    bun run packages/engine/yolo/src/index.ts plugin check

plugin-purge:
    bun run packages/engine/yolo/src/index.ts plugin purge
