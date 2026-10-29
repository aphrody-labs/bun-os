> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Troubleshooting

Common pitfalls hit by engineers working on `aphrody`. Each entry follows a
**Cause** / **Fix** structure. Most of these have already been wired with
mitigations; this page exists to short-circuit the rediscovery loop.

If your issue is not here, see `FAQ.md` or open a GitHub issue
using `packages/rg/patreon-bun/.github/ISSUE_TEMPLATE/bug_report.yml` (not in repo).

## 1. `aphrody --version` panics with "No provider set"

- **Cause**: rustls 0.23 requires an explicit `CryptoProvider` install before
  any `reqwest::Client::new()` call. Without it the TLS stack panics on first
  use.
- **Fix**: This should NOT happen in the shipped binary — it is already wired
  in `crates/infra/aphrody/src/main.rs:177` via
  `rustls::crypto::ring::default_provider().install_default()`. If you observe
  the panic you are likely running an outdated binary. Confirm with
  `aphrody doctor` (rustls CryptoProvider section).

## 2. `cargo build` fails with `--icf=all rejected`

- **Cause**: `cargo-zigbuild` and the LLD `--icf=all` flag are incompatible.
  `zigcc` rejects the flag outright.
- **Fix**: Already removed from `.cargo/config.toml` for
  `x86_64-unknown-linux-gnu`. If you re-introduced it locally, drop it.
  `--gc-sections` (still enabled) covers most dead-code stripping.

## 3. `cargo machete` reports unused deps (false positive)

- **Cause**: `cfg`-gated transitive deps that machete cannot see (typical for
  WASM targets, `getrandom` feature plumbing, prost build helpers).
- **Fix**: Add an ignore list to the crate's `Cargo.toml`:
  ```toml
  [package.metadata.cargo-machete]
  ignored = ["serde", "..."]
  ```
  Example: see `Cargo.toml` and crate manifests in `crates/`.

## 4. `cargo vet --locked` fails with formatting errors

- **Cause**: `supply-chain/audits.toml` or `supply-chain/config.toml` drifted
  from the canonical form (whitespace, key order, trailing newlines).
- **Fix**: `cargo vet fmt` reformats in place. Caveat: it may strip
  comments — commit (or stash) before running, and review the diff.

## 5. Model execution fails with "out of memory" (CUDA / VRAM)

- **Cause**: The requested GGUF or ONNX model exceeds available GPU VRAM.
- **Fix**: Offload fewer layers (`--n-gpu-layers`), quantize the KV cache
  (`--ctk q8_0 --ctv q8_0`), or enable hybrid CPU offloading for MoE weights
  (`--n-cpu-moe 48` for Qwen3-MoE). See `LOCAL-AI-MODELS.md`.

## 6. `wasm-pack build` fails with "Cannot find module run.js"

- **Cause**: Bun's global install layout for `wasm-pack` can desync between
  Windows and Linux, leaving the shim pointing at a missing entry file.
- **Fix**: Direct `cargo build --target wasm32-unknown-unknown --release`
  works in all known cases and is what CI uses. `wasm-pack` is replaced by
  `bun wasm build` of the aphrody-labs/bun fork (https://bun.com/docs/bundler/wasm),
  which `scripts/build/rust/wasm-package.ts` uses.

## 7. `aphrody doctor` reports "A2A peer: offline" or "DEGRADED"

- **Cause**: A configured A2A peer listener is not currently running, so
  heartbeat / probe checks return stale data or connection refused.
- **Fix**: By design DEGRADED is non-fatal — `aphrody` operates standalone.
  If you want the peer active, verify peer registration in `aphrody-infra`'s
  peer catalog (`a2a-peers.json`) and start the coordinator:
  `aphrody a2a serve --bind 127.0.0.1:8788`.

## 8. `docs/reference/ai/SUMMARY.md` is out of date

- **Cause**: Hand edits or a doc was added/removed without regenerating.
- **Fix**: DO NOT hand-edit `docs/reference/ai/SUMMARY.md`. Re-run
  `aphrody summary` after any doc add, remove, or rename. The
  script is the single source of truth.

## 9. `a2a-pb` build fails with "build scripts must only write to $OUT_DIR"

- **Cause**: `../crates/os/kernel/comps/a2a-pb/src/gen/` (the crate lives in
  the system layer) is the authoritative pre-generated source for crates.io publish. The codegen path
  (`tonic_prost_build`) writes outside `$OUT_DIR`, which crates.io rejects;
  it is therefore gated behind the env var `A2A_PB_REGEN=1`.
- **Fix**: Do not set the env var unless you are regenerating protos. Plain
  `cargo build -p aphrody-a2a-pb` uses the committed `src/gen/` files and works
  everywhere.

## 10. `tokio` will not compile on `wasm32-unknown-unknown`

- **Cause**: tokio's full feature set is not WASM compatible (epoll, mio,
  thread parking, etc.).
- **Fix**: Use selective features. The proven combo is `tokio-stream` +
  `js-sys` + `wasm-bindgen-futures`.

## 11. GTK3 CVE warnings (RUSTSEC-2024-04xx)

- **Cause**: `tao` / `wry` on Linux pull GTK3 transitively for the desktop
  GUI surface in `aphrody-ui`.
- **Fix**: Ignored in `deny.toml` with justification — the `aphrody` CLI binary is
  NOT linked to GTK. Only the Tauri desktop surface in `aphrody-ui` links `wry`.
  Track GTK4 migration upstream in `tao`.

## 12. `bun install` vs `npm install`

- **Cause**: Repo policy: bun mandatory, node and npm forbidden across all
  JS/TS surfaces (scripts, vendor, MCP, build tooling).
- **Fix**: Always `bun install`, `bun run`, `bun x`, `bun build`. If a
  vendored `package.json` hardcodes `npm`, patch the vendor file rather than
  installing node.

## 13. `cargo check` succeeds but the editor still shows errors

- **Cause**: rust-analyzer keeps a cached diagnostics snapshot from the
  previous session, so fixes applied in this session may not be reflected
  until the LSP re-indexes.
- **Fix**: Run `cargo check --workspace --locked` and then trigger a
  workspace reload in the editor. The shell result is the source of truth,
  not the cached squiggles.

## 14. Got more?

Skim `FAQ.md` first. If still stuck, open a GitHub issue using
`packages/rg/patreon-bun/.github/ISSUE_TEMPLATE/bug_report.yml` (not in repo) and attach the output of
`aphrody doctor`.
