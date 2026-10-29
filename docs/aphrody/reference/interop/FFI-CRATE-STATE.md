<!-- docs-links: external-paths — backtick paths in this dated document name files of the repository at the time it records (Koharu moved out of this repository on 2026-10-05), not of this checkout. -->
# FFI crate state (factual inventory)

Generated 2026-10-02 by static inspection only (no cargo run). Method and limits are at the end. Counts are the output of the scripts described in "Method"; "unverified" marks what was not checked.

Path maintenance, 2026-10-03: the subsystem row follows its move into OS;
the historical counts and static inspection claims are unchanged.

## Summary

- Cargo manifests under `crates/` and `apps/`: 211 found; 187 are workspace members (directory matches a `members` glob of the root `Cargo.toml`); 23 are excluded by the root `exclude` list or live under the excluded `crates/os/kernel/comps/drive` tree (`crates/os/kernel/comps/drive`, `crates/contracts/schema` and `crates/web/drive-server` (not in repo) are excluded explicitly; `crates/contracts/schema` has no `Cargo.toml`); 1 manifest without `[package]` (`crates/os/kernel/comps/drive`).
- Member crates with at least one `#[test]`/`#[tokio::test]` (static count, tests not run): 171; with none: 16.
- Member crates linked into the `aphrody-ffi` cdylib according to `Cargo.lock` reachability from `aphrody-ffi`: 148 (15 as direct dependencies). Only 4 library crates plus `aphrody-ffi` itself define C symbols (see the FFI map).
- Member crates with their own `cdylib` crate-type: 5. Member crates with a binary target: 37.
- Member crates with a wasm32 gate (`target_arch = "wasm32"` or `wasm32` in the manifest): 40; with a Windows `cfg` gate: 37.
- `todo!()` in member crates (comment lines excluded): 0; `unimplemented!()`: 1 (`crates/koharu/koharu-torch/src/error.rs:74`).
- Stub-free is not parity: no claim is made that an exported symbol is fully functional.

## Table

Columns: Kind = lib/bin/cdylib targets; FFI = how the crate reaches the single `aphrody-ffi` cdylib; Bun consumer = module of `@aphrody/bun` (`packages/interop/native`) that calls it; Tests = static count of test attributes in `src/` and `tests/`; Stubs = `todo!`/`unimplemented!`; Gates = count of wasm32 / Windows cfg occurrences; Membership as defined above.

| Path | Package | Kind | FFI | Bun consumer | Tests | Stubs | Gates (wasm/win) | Membership |
|---|---|---|---|---|---:|---:|---|---|
| `crates/infra/aphrody` | `aphrody` | lib+bin*1 | aphrody_run / run_json / run_captured (CLI surface in-process; direct dep) | @aphrody/bun (engine.ts) | 231 | 0/0 | 173/41 | member(glob) |
| `crates/ai/agent-home` | `aphrody-agent-home` | lib | linked (direct dep) | @aphrody/bun (engine.ts) | 111 | 0/0 | 17/2 | member(glob) |
| `crates/ai/agent-runtime` | `aphrody-agent-runtime` | lib | linked transitively, no C symbols | - | 37 | 0/0 | 0/6 | member(glob) |
| `crates/ai/agent-tools` | `aphrody-agent-tools` | lib | linked transitively, no C symbols | - | 39 | 0/0 | 0/13 | member(glob) |
| `crates/ai/ai` | `aphrody-ai` | lib | linked transitively, no C symbols | - | 0 | 0/0 | 0/0 | member(glob) |
| `crates/ai/app-server` | `aphrody-app-server` | lib | linked transitively, no C symbols | - | 40 | 0/0 | 0/0 | member(glob) |
| `crates/ai/chat` | `aphrody-chat` | lib | linked transitively, no C symbols | - | 39 | 0/0 | 0/0 | member(glob) |
| `crates/ai/config` | `aphrody-config` | lib | linked transitively, no C symbols | - | 105 | 0/0 | 4/0 | member(glob) |
| `crates/ai/context` | `aphrody-context` | lib | linked transitively, no C symbols | - | 18 | 0/0 | 6/0 | member(glob) |
| `crates/ai/ecosystem` | `aphrody-ecosystem` | lib | linked transitively, no C symbols | - | 4 | 0/0 | 0/0 | member(glob) |
| `crates/ai/embed` | `aphrody-embed` | lib+bin*1 | linked transitively, no C symbols | - | 47 | 0/0 | 15/0 | member(glob) |
| `crates/ai/engine` | `aphrody-engine` | lib | linked transitively, no C symbols | - | 26 | 0/0 | 0/0 | member(glob) |
| `crates/ai/engine-mistralrs` | `aphrody-engine-mistralrs` | lib | not linked | - | 96 | 0/0 | 9/0 | member(glob) |
| `crates/ai/exec-events` | `aphrody-exec-events` | lib | linked transitively, no C symbols | - | 2 | 0/0 | 0/0 | member(glob) |
| `crates/ai/firefly` | `aphrody-firefly` | lib | linked transitively, no C symbols | - | 51 | 0/0 | 0/0 | member(glob) |
| `crates/ai/gateway` | `aphrody-gateway` | lib | linked transitively, no C symbols | - | 91 | 0/0 | 0/0 | member(glob) |
| `crates/ai/http-error` | `aphrody-http-error` | lib | linked transitively, no C symbols | - | 2 | 0/0 | 0/0 | member(glob) |
| `crates/ai/infer` | `aphrody-infer` | lib | linked transitively, no C symbols | - | 32 | 0/0 | 8/0 | member(glob) |
| `crates/ai/jev` | `aphrody-jev` | lib+bin*2 | linked transitively, no C symbols | - | 26 | 0/0 | 2/0 | member(glob) |
| `crates/ai/llama-server` | `aphrody-llama-server` | lib+bin*3 | linked transitively, no C symbols | - | 60 | 0/0 | 0/0 | member(glob) |
| `crates/ai/llm-infra` | `aphrody-llm-infra` | lib | linked transitively, no C symbols | - | 20 | 0/0 | 0/0 | member(glob) |
| `crates/ai/manga` | `aphrody-manga` | lib | manga_* adapters in aphrody-ffi lib.rs (direct dep) | @aphrody/bun/manga | 9 | 0/0 | 14/0 | member(glob) |
| `crates/ai/marketplace` | `aphrody-marketplace` | lib | not linked | - | 17 | 0/0 | 0/0 | member(glob) |
| `crates/ai/mcp` | `aphrody-mcp` | bin*2 | not linked | - | 150 | 0/0 | 96/9 | member(glob) |
| `crates/ai/mcp-client` | `aphrody-mcp-client` | lib | linked transitively, no C symbols | - | 27 | 0/0 | 22/0 | member(glob) |
| `crates/ai/mcp-oauth` | `aphrody-mcp-oauth` | lib | linked transitively, no C symbols | - | 17 | 0/0 | 0/0 | member(glob) |
| `crates/ai/mcp-smoke` | `aphrody-mcp-smoke` | bin*2 | not linked | - | 0 | 0/0 | 0/0 | member(glob) |
| `crates/ai/memory` | `aphrody-memory` | lib+bin*1 | linked transitively, no C symbols | - | 104 | 0/0 | 0/0 | member(glob) |
| `crates/ai/messaging` | `aphrody-messaging` | lib | linked transitively, no C symbols | - | 83 | 0/0 | 10/0 | member(glob) |
| `crates/ai/model-client` | `aphrody-model-client` | lib | linked transitively, no C symbols | - | 125 | 0/0 | 0/0 | member(glob) |
| `crates/ai/models` | `aphrody-models` | lib | linked transitively, no C symbols | - | 120 | 0/0 | 18/0 | member(glob) |
| `crates/ai/ocr` | `aphrody-ocr` | lib | linked transitively, no C symbols | - | 0 | 0/0 | 0/0 | member(glob) |
| `crates/ai/ocr-core` | `aphrody-ocr-core` | lib | linked transitively, no C symbols | - | 68 | 0/0 | 0/0 | member(glob) |
| `crates/ai/ocr-onnx` | `aphrody-ocr-onnx` | lib | linked transitively, no C symbols | - | 8 | 0/0 | 0/0 | member(glob) |
| `crates/ai/ocr-vlm` | `aphrody-ocr-vlm` | lib | linked transitively, no C symbols | - | 13 | 0/0 | 0/0 | member(glob) |
| `crates/ai/patch` | `aphrody-patch` | lib | linked transitively, no C symbols | - | 39 | 0/0 | 0/0 | member(glob) |
| `crates/ai/project-doc` | `aphrody-project-doc` | lib | linked transitively, no C symbols | - | 13 | 0/0 | 0/0 | member(glob) |
| `crates/ai/prompts` | `aphrody-prompts` | lib | linked transitively, no C symbols | - | 14 | 0/0 | 0/0 | member(glob) |
| `crates/ai/providers` | `aphrody-providers` | lib | linked transitively, no C symbols | - | 12 | 0/0 | 0/0 | member(glob) |
| `crates/ai/rag` | `aphrody-rag` | lib | linked transitively, no C symbols | - | 54 | 0/0 | 0/0 | member(glob) |
| `crates/ai/rag-core` | `aphrody-rag-core` | lib | rag adapters in aphrody-ffi (direct dep) | @aphrody/bun (engine.ts) | 71 | 0/0 | 1/0 | member(glob) |
| `crates/ai/rag-eval` | `aphrody-rag-eval` | lib+bin*1 | linked transitively, no C symbols | - | 21 | 0/0 | 0/0 | member(glob) |
| `crates/ai/rag-python` | `aphrody-rust` | lib+cdylib | pyo3 cdylib (Python, not Bun) | - | 0 | 0/0 | 0/0 | member(glob) |
| `crates/ai/rollout` | `aphrody-rollout` | lib | linked transitively, no C symbols | - | 14 | 0/0 | 0/0 | member(glob) |
| `crates/ai/router` | `aphrody-router` | lib | linked transitively, no C symbols | - | 30 | 0/0 | 0/0 | member(glob) |
| `crates/ai/sdk` | `aphrody-sdk` | lib | not linked | - | 37 | 0/0 | 8/2 | member(glob) |
| `crates/ai/session` | `aphrody-session` | lib | linked transitively, no C symbols | - | 38 | 0/0 | 2/0 | member(glob) |
| `crates/ai/skills` | `aphrody-skills` | lib+bin*1 | linked transitively, no C symbols | - | 65 | 0/0 | 0/4 | member(glob) |
| `crates/ai/skills-forge` | `aphrody-skills-forge` | lib | not linked | - | 18 | 0/0 | 0/0 | member(glob) |
| `crates/ai/summary` | `aphrody-summary` | lib+bin*2 | not linked | - | 3 | 0/0 | 0/0 | member(glob) |
| `crates/ai/supervisor` | `aphrody-supervisor` | lib | linked transitively, no C symbols | - | 8 | 0/0 | 0/0 | member(glob) |
| `crates/ai/toolcall` | `aphrody-toolcall` | lib | linked transitively, no C symbols | - | 15 | 0/0 | 0/0 | member(glob) |
| `crates/ai/toolcall-repair` | `aphrody-toolcall-repair` | lib | aphrody_toolcall_* via aphrody-ffi zerocopy.rs (new) | @aphrody/bun/zerocopy | 83 | 0/0 | 0/0 | member(glob) |
| `crates/ai/tools` | `aphrody-tools` | lib | linked transitively, no C symbols | - | 79 | 0/0 | 2/0 | member(glob) |
| `crates/ai/train` | `aphrody-train` | lib+bin*1 | linked transitively, no C symbols | - | 14 | 0/0 | 0/0 | member(glob) |
| `crates/ai/translate` | `aphrody-translate` | lib+bin*2 | wasm-bindgen dep (not Bun FFI) | - | 23 | 0/0 | 23/0 | member(glob) |
| `crates/ai/vision` | `aphrody-vision` | lib | not linked | - | 59 | 0/0 | 0/2 | member(glob) |
| `crates/ai/voice` | `aphrody-voice` | lib | wasm-bindgen dep (not Bun FFI) | - | 43 | 0/0 | 36/0 | member(glob) |
| `crates/compat/bun-docs` | `aphrody-bun-docs` | lib | linked transitively, no C symbols | - | 12 | 0/0 | 0/2 | member(glob) |
| `crates/compat/n2b` | `aphrody-n2b` | lib+bin*2 | 19 no_mangle (not C ABI to Bun) | - | 21 | 0/0 | 2/0 | member(glob) |
| `crates/compat/n2b-core` | `aphrody-n2b-core` | lib | linked transitively, no C symbols | - | 55 | 0/0 | 0/0 | member(glob) |
| `crates/compat/n2b-native` | `aphrody-n2b-native` | lib | node2bun_*, find_newlines_u16 (5; re-exported by aphrody-ffi) | @aphrody/bun/n2b (n2b.ts); @aphrody/n2b-plugin (via @aphrody/bun/n2b) | 3 | 0/0 | 0/0 | member(glob) |
| `crates/compat/n2b-registry` | `aphrody-n2b-registry` | lib | linked transitively, no C symbols | - | 8 | 0/0 | 0/0 | member(glob) |
| `crates/compat/n2b-types` | `aphrody-n2b-types` | lib | linked transitively, no C symbols | - | 0 | 0/0 | 0/0 | member(glob) |
| `crates/compat/oxc-bridge` | `aphrody-oxc-bridge` | lib | aphrody_oxc_* (5; re-exported by aphrody-ffi) | @aphrody/bun/oxc (oxc.ts) | 2 | 0/0 | 0/0 | member(glob) |
| `crates/compat/toolchains` | `aphrody-toolchains` | lib | linked transitively, no C symbols | - | 7 | 0/0 | 0/0 | member(glob) |
| `crates/contracts/a2a` | `aphrody-a2a` | lib | linked transitively, no C symbols | - | 90 | 0/0 | 0/0 | member(glob) |
| `crates/os/kernel/comps/a2a-pb` | `aphrody-a2a-pb` | lib | linked transitively, no C symbols | - | 67 | 0/0 | 0/0 | member(glob) |
| `crates/contracts/agent-proto` | `aphrody-agent-proto` | lib | linked transitively, no C symbols | - | 10 | 0/0 | 4/0 | member(glob) |
| `crates/contracts/app-protocol` | `aphrody-app-protocol` | lib | linked transitively, no C symbols | - | 17 | 0/0 | 1/0 | member(glob) |
| `crates/os/ostd/subsystem` | `aphrody-subsystem` | lib | linked transitively, no C symbols | - | 4 | 0/0 | 0/0 | member(glob) |
| `crates/discord/aphrody-discord-compiler` | `aphrody-discord-compiler` | lib | linked transitively, no C symbols | - | 7 | 0/0 | 0/0 | member(glob) |
| `crates/google/antigravity` | `aphrody-antigravity` | lib | linked transitively, no C symbols | - | 65 | 0/0 | 17/17 | member(glob) |
| `crates/google/gcs` | `aphrody-gcs` | lib | linked transitively, no C symbols | - | 8 | 0/0 | 0/0 | member(glob) |
| `crates/google/gemini-runtime` | `aphrody-gemini-runtime` | lib | linked transitively, no C symbols | - | 61 | 0/0 | 0/4 | member(glob) |
| `crates/google/gemini-web` | `aphrody-gemini-web` | lib+bin*2 | aphrody_web_gemini_web_ask* adapters (direct dep) | @aphrody/bun (engine.ts) | 35 | 0/0 | 14/0 | member(glob) |
| `crates/google/google` | `aphrody-google` | lib+bin*2 | linked transitively, no C symbols | - | 26 | 0/0 | 5/0 | member(glob) |
| `crates/google/mcp` | `aphrody-google-mcp` | lib | not linked | - | 7 | 0/0 | 1/0 | member(glob) |
| `crates/google/model-antigravity` | `aphrody-model-antigravity` | lib | linked transitively, no C symbols | - | 4 | 0/0 | 0/0 | member(glob) |
| `crates/google/notebooklm` | `aphrody-notebooklm` | lib | linked transitively, no C symbols | - | 27 | 0/0 | 0/0 | member(glob) |
| `crates/infra/git` | `aphrody-git` | lib | linked transitively, no C symbols | - | 45 | 0/0 | 0/0 | member(glob) |
| `crates/infra/infra` | `aphrody-infra` | lib+bin*2 | not linked | - | 67 | 0/0 | 0/0 | member(glob) |
| `crates/infra/ovh` | `aphrody-ovh` | lib | not linked | - | 4 | 0/0 | 0/0 | member(glob) |
| `crates/infra/sql` | `aphrody-sql` | lib | linked transitively, no C symbols | - | 36 | 0/0 | 0/0 | member(glob) |
| `crates/infra/ssh` | `aphrody-ssh` | lib+bin*1 | linked transitively, no C symbols | - | 45 | 0/0 | 0/4 | member(glob) |
| `crates/infra/vpn` | `aphrody-vpn` | lib | linked transitively, no C symbols | - | 3 | 0/0 | 0/4 | member(glob) |
| `crates/infra/yolo` | `aphrody-yolo` | lib+bin*2 | not linked | - | 10 | 0/0 | 0/1 | member(glob) |
| `crates/interop/ffi` | `aphrody-ffi` | lib+cdylib | aphrody_run*, manga_*, aphrody_web_*, aphrody_zerocopy_* (own C symbols) | @aphrody/bun: library.ts, engine.ts, manga.ts, n2b.ts, zerocopy.ts | 50 | 0/0 | 11/0 | member(glob) |
| `crates/koharu/koharu` | `koharu` | lib+bin*1 | 1 no_mangle but not linked into aphrody-ffi | - | 10 | 0/0 | 0/3 | member(glob) |
| `crates/koharu/koharu-agent` | `koharu-agent` | lib | linked transitively, no C symbols | - | 1 | 0/0 | 0/0 | member(glob) |
| `crates/koharu/koharu-app` | `koharu-app` | lib+bin*1 | not linked | - | 0 | 0/0 | 0/1 | member(glob) |
| `crates/koharu/koharu-bindgen` | `koharu-bindgen` | lib+bin*1 | linked transitively, no C symbols | - | 0 | 0/0 | 0/2 | member(glob) |
| `crates/koharu/koharu-canvas` | `koharu-canvas` | lib+cdylib | wasm-bindgen dep (not Bun FFI) | - | 2 | 0/0 | 5/0 | member(glob) |
| `crates/koharu/koharu-config` | `koharu-config` | lib | linked transitively, no C symbols | - | 12 | 0/0 | 0/0 | member(glob) |
| `crates/koharu/koharu-desktop` | `koharu-desktop` | lib | linked transitively, no C symbols | - | 2 | 0/0 | 0/0 | member(glob) |
| `crates/koharu/koharu-diffusion` | `koharu-diffusion` | lib | linked transitively, no C symbols | - | 9 | 0/0 | 0/0 | member(glob) |
| `crates/koharu/koharu-diffusion-sys` | `koharu-diffusion-sys` | lib | linked transitively, no C symbols | - | 0 | 0/0 | 0/0 | member(glob) |
| `crates/koharu/koharu-library` | `koharu-library` | lib+bin*2 | linked transitively, no C symbols | - | 8 | 0/0 | 2/0 | member(glob) |
| `crates/koharu/koharu-llama` | `koharu-llama` | lib | linked transitively, no C symbols | - | 5 | 0/0 | 0/0 | member(glob) |
| `crates/koharu/koharu-llama-sys` | `koharu-llama-sys` | lib | linked transitively, no C symbols | - | 0 | 0/0 | 0/0 | member(glob) |
| `crates/koharu/koharu-metrics` | `koharu-metrics` | lib | not linked | - | 7 | 0/0 | 0/5 | member(glob) |
| `crates/koharu/koharu-ml` | `koharu-ml` | lib+bin*19 | linked transitively, no C symbols | - | 63 | 0/0 | 0/0 | member(glob) |
| `crates/koharu/koharu-pipeline` | `koharu-pipeline` | lib | linked transitively, no C symbols | - | 54 | 0/0 | 0/9 | member(glob) |
| `crates/koharu/koharu-psd` | `koharu-psd` | lib | linked transitively, no C symbols | - | 17 | 0/0 | 0/0 | member(glob) |
| `crates/koharu/koharu-rasterizer` | `koharu-rasterizer` | lib | linked transitively, no C symbols | - | 7 | 0/0 | 2/0 | member(glob) |
| `crates/koharu/koharu-renderer` | `koharu-renderer` | lib | linked transitively, no C symbols | - | 101 | 0/0 | 0/0 | member(glob) |
| `crates/koharu/koharu-runtime` | `koharu-runtime` | lib | linked transitively, no C symbols | - | 5 | 0/0 | 0/12 | member(glob) |
| `crates/koharu/koharu-scene` | `koharu-scene` | lib | linked transitively, no C symbols | - | 33 | 0/0 | 0/0 | member(glob) |
| `crates/koharu/koharu-secrets` | `koharu-secrets` | lib | linked transitively, no C symbols | - | 0 | 0/0 | 0/2 | member(glob) |
| `crates/koharu/koharu-storage` | `koharu-storage` | lib | linked transitively, no C symbols | - | 6 | 0/0 | 0/0 | member(glob) |
| `crates/koharu/koharu-torch` | `koharu-torch` | lib | linked transitively, no C symbols | - | 5 | 0/1 | 0/0 | member(glob) |
| `crates/koharu/koharu-torch-sys` | `koharu-torch-sys` | lib | linked transitively, no C symbols | - | 0 | 0/0 | 0/0 | member(glob) |
| `crates/koharu/koharu-translator` | `koharu-translator` | lib+bin*1 | linked transitively, no C symbols | - | 48 | 0/0 | 0/0 | member(glob) |
| `crates/native/native` | `aphrody-native` | lib | linked transitively, no C symbols | - | 10 | 0/0 | 0/8 | member(glob) |
| `crates/os/kernel/comps/a2a-client` | `aphrody-a2a-client` | lib+bin*2 | linked transitively, no C symbols | - | 106 | 0/0 | 3/0 | member(glob) |
| `crates/os/kernel/comps/a2a-coord` | `aphrody-a2a-coord` | lib | linked transitively, no C symbols | - | 38 | 0/0 | 0/0 | member(glob) |
| `crates/os/kernel/comps/a2a-grpc` | `aphrody-a2a-grpc` | lib | not linked | - | 29 | 0/0 | 0/0 | member(glob) |
| `crates/os/kernel/comps/a2a-server` | `aphrody-a2a-server` | lib | linked transitively, no C symbols | - | 142 | 0/0 | 0/2 | member(glob) |
| `crates/os/aphrody-wsl` | `aphrody-wsl` | lib+bin*1 | not linked | - | 3 | 0/0 | 0/0 | member(glob) |
| `crates/os/ostd/backend` | `aphrody-backend` | lib+bin*1 | linked transitively, no C symbols | - | 0 | 0/0 | 0/0 | member(glob) |
| `crates/os/base` | `aphrody-base` | lib | linked transitively, no C symbols | - | 0 | 0/0 | 1/7 | member(glob) |
| `crates/os/kernel/libs/capture` | `aphrody-capture` | lib | linked transitively, no C symbols | - | 7 | 0/0 | 0/57 | member(glob) |
| `crates/os/compat` | `aphrody-compat` | lib | linked transitively, no C symbols | - | 4 | 0/0 | 0/0 | member(glob) |
| `crates/os/coreutils` | `aphrody-coreutils` | lib | linked transitively, no C symbols | - | 3 | 0/0 | 0/0 | member(glob) |
| `crates/os/kernel/comps/cron` | `aphrody-cron` | lib | not linked | - | 14 | 0/0 | 0/0 | member(glob) |
| `crates/os/kernel/comps/drive/crates/infra/aphrody` | `sd-cli` | bin*1 | not linked | - | 0 | 0/0 | 0/0 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/core` | `sd-core` | lib+bin*6 | not linked | - | 599 | 8/1 | 0/67 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/core/benchmarks` | `sd-bench` | lib+bin*2 | not linked | - | 0 | 0/0 | 0/0 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/crates/actors` | `sd-actors` | lib | not linked | - | 0 | 0/0 | 0/0 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/crates/archive` | `sd-archive` | lib | not linked | - | 3 | 0/0 | 0/0 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/crates/crypto` | `sd-crypto` | lib | not linked | - | 49 | 0/0 | 0/0 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/crates/fda` | `sd-fda` | lib | not linked | - | 1 | 0/0 | 0/0 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/crates/ffmpeg` | `sd-ffmpeg` | lib | not linked | - | 1 | 0/0 | 0/0 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/crates/fs-watcher` | `sd-fs-watcher` | lib | not linked | - | 23 | 0/0 | 0/9 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/crates/images` | `sd-images` | lib | not linked | - | 0 | 0/0 | 0/1 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/crates/job-derive` | `job-derive` | lib+proc-macro | not linked | - | 0 | 0/0 | 0/0 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/crates/log-analyzer` | `log-analyzer` | lib | not linked | - | 24 | 0/0 | 0/0 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/crates/media-metadata` | `sd-media-metadata` | lib | not linked | - | 2 | 0/0 | 0/0 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/crates/sd-client` | `sd-client` | lib | not linked | - | 1 | 0/0 | 0/0 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/crates/sdk` | `spacedrive-sdk` | lib | 2 no_mangle but not linked into aphrody-ffi | - | 0 | 0/0 | 0/0 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/crates/sdk-macros` | `spacedrive-sdk-macros` | lib+proc-macro | 3 no_mangle but not linked into aphrody-ffi | - | 0 | 0/0 | 0/0 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/crates/task-system` | `sd-task-system` | lib | not linked | - | 10 | 0/0 | 0/0 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/crates/task-validator` | `task-validator` | bin*1 | not linked | - | 0 | 0/0 | 0/0 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/crates/utils` | `sd-utils` | lib | not linked | - | 3 | 0/0 | 0/0 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/patches/ffmpeg-sys-next` | `ffmpeg-sys-next` | lib | not linked | - | 0 | 0/0 | 0/0 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/patches/whisper-rs-sys` | `whisper-rs-sys` | lib | linked transitively, no C symbols | - | 0 | 0/0 | 0/0 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/kernel/comps/drive/xtask` | `xtask` | bin*1 | not linked | - | 0 | 0/0 | 0/1 | EXCLUDED (crates/os/kernel/comps/drive) |
| `crates/os/events` | `aphrody-events` | lib | linked transitively, no C symbols | - | 11 | 0/0 | 0/0 | member(glob) |
| `crates/os/execpolicy` | `aphrody-execpolicy` | lib | linked transitively, no C symbols | - | 9 | 0/0 | 0/0 | member(glob) |
| `crates/os/kernel/libs/fsindex` | `aphrody-fsindex` | lib | linked transitively, no C symbols | - | 13 | 0/0 | 0/4 | member(glob) |
| `crates/os/ostd/guard` | `aphrody-guard` | lib | linked transitively, no C symbols | - | 13 | 0/0 | 0/0 | member(glob) |
| `crates/os/kernel/comps/jobs` | `aphrody-jobs` | lib | linked transitively, no C symbols | - | 43 | 0/0 | 0/0 | member(glob) |
| `crates/os/kernel/core` | `aphrody-kernel` | lib+bin*3 | linked transitively, no C symbols | - | 93 | 0/0 | 0/17 | member(glob) |
| `crates/os/kernel/client` | `aphrody-kernel-client` | lib | linked transitively, no C symbols | - | 11 | 0/0 | 0/2 | member(glob) |
| `crates/os/ostd/proc` | `aphrody-proc` | lib | linked transitively, no C symbols | - | 12 | 0/0 | 9/7 | member(glob) |
| `crates/os/kernel/comps/re` | `aphrody-re` | lib | linked transitively, no C symbols | - | 112 | 0/0 | 0/0 | member(glob) |
| `crates/os/kernel/comps/sandbox` | `aphrody-sandbox` | lib | not linked | - | 14 | 0/0 | 17/15 | member(glob) |
| `crates/os/search` | `aphrody-search` | lib | not linked | - | 21 | 0/0 | 0/4 | member(glob) |
| `crates/os/ostd/secrets` | `aphrody-secrets` | lib | linked transitively, no C symbols | - | 16 | 0/0 | 0/0 | member(glob) |
| `crates/os/settings` | `aphrody-settings` | lib | not linked | - | 21 | 0/0 | 0/0 | member(glob) |
| `crates/os/stdio-capture` | `aphrody-stdio-capture` | lib | used by aphrody_run_captured (direct dep) | - | 2 | 0/0 | 5/4 | member(glob) |
| `crates/os/systemd` | `aphrody-systemd` | lib | linked transitively, no C symbols | - | 6 | 0/0 | 0/0 | member(glob) |
| `crates/os/kernel/comps/task-runner` | `aphrody-task-runner` | lib | not linked | - | 15 | 0/0 | 0/0 | member(glob) |
| `crates/os/kernel/comps/telemetry` | `aphrody-telemetry` | lib | not linked | - | 15 | 0/0 | 0/0 | member(glob) |
| `crates/os/kernel/comps/winclean` | `aphrody-winclean` | lib | linked transitively, no C symbols | - | 46 | 0/0 | 0/156 | member(glob) |
| `crates/shell/nu` | `aphrody-nu` | lib | linked transitively, no C symbols | - | 14 | 0/0 | 0/0 | member(glob) |
| `crates/shell/session` | `aphrody-shell-session` | lib | not linked | - | 12 | 0/0 | 0/0 | member(glob) |
| `crates/shell/shell` | `aphrody-shell` | lib | linked transitively, no C symbols | - | 0 | 0/0 | 0/0 | member(glob) |
| `crates/shell/tauri` | `aphrody-shell-tauri` | lib | not linked | - | 2 | 0/0 | 0/0 | member(glob) |
| `crates/shell/tauri-e2e` | `aphrody-shell-tauri-e2e` | bin*1 | not linked | - | 0 | 0/0 | 0/0 | member(glob) |
| `crates/shell/terminal-backend` | `aphrody-terminal-backend` | lib | linked transitively, no C symbols | - | 35 | 0/0 | 0/10 | member(glob) |
| `crates/shell/terminal-core` | `aphrody-terminal-core` | lib | linked transitively, no C symbols | - | 5 | 0/0 | 0/0 | member(glob) |
| `crates/shell/tui` | `aphrody-tui` | lib | linked transitively, no C symbols | - | 21 | 0/0 | 0/0 | member(glob) |
| `crates/shell/vfs` | `aphrody-shell-vfs` | lib | not linked | - | 9 | 0/0 | 0/0 | member(glob) |
| `crates/shell/web` | `aphrody-shell-web` | lib+cdylib | wasm-bindgen dep (not Bun FFI) | - | 3 | 0/0 | 0/0 | member(glob) |
| `crates/ui/a2a-ui` | `aphrody-a2a-ui` | lib+cdylib | wasm-bindgen dep (not Bun FFI) | - | 4 | 0/0 | 3/0 | member(glob) |
| `crates/ui/app` | `aphrody-app` | lib+bin*2 | not linked | - | 29 | 0/0 | 0/5 | member(glob) |
| `crates/ui/bun` | `aphrody-bun` | lib | bun_rs_* (22 no_mangle; rlib re-exported by aphrody-ffi) | @aphrody/bun: index.ts, svg.ts, render.ts, icons.ts, reproduce.ts | 29 | 0/0 | 2/0 | member(glob) |
| `crates/ui/drive` | `aphrody-drive` | lib | 1 no_mangle but not linked into aphrody-ffi | - | 44 | 0/0 | 0/20 | member(glob) |
| `crates/ui/gui-core` | `aphrody-gui-core` | lib | not linked | - | 10 | 0/0 | 0/0 | member(glob) |
| `crates/ui/identity` | `aphrody-identity` | lib+bin*6 | linked transitively, no C symbols | - | 60 | 0/0 | 0/0 | member(glob) |
| `crates/ui/local-ai` | `aphrody-local-ai` | lib | not linked | - | 12 | 0/0 | 0/0 | member(glob) |
| `crates/ui/m3-reproduce` | `aphrody-m3-reproduce` | lib+bin*2 | linked transitively, no C symbols | - | 8 | 0/0 | 1/0 | member(glob) |
| `crates/aphrody-m3-tokens` | `aphrody-m3-tokens` | lib | linked transitively, no C symbols | - | 132 | 0/0 | 0/0 | member(glob) |
| `crates/ui/render` | `aphrody-render` | lib+bin*2 | linked transitively, no C symbols | - | 69 | 0/0 | 3/0 | member(glob) |
| `crates/ui/softraster` | `aphrody-softraster` | lib | aphrody_raster_fill_triangle via aphrody-ffi zerocopy.rs (new) | @aphrody/bun/zerocopy | 5 | 0/0 | 0/0 | member(glob) |
| `crates/ui/sprite-sheet` | `aphrody-sprite-sheet` | lib | linked transitively, no C symbols | - | 7 | 0/0 | 0/0 | member(glob) |
| `crates/ui/svg` | `aphrody-svg` | lib | linked transitively, no C symbols | - | 21 | 0/0 | 0/0 | member(glob) |
| `crates/ui/tauri-mcp` | `aphrody-tauri-mcp` | bin*1 | not linked | - | 0 | 0/0 | 0/0 | member(glob) |
| `crates/ui/tauri-wrap` | `aphrody-tauri-wrap` | lib | not linked | - | 28 | 0/0 | 0/0 | member(glob) |
| `crates/web/drive-server` (not in repo) | `sd-server` | bin*2 | not linked | - | 0 | 0/0 | 0/0 | EXCLUDED |
| `crates/web/obscura` | `obscura` | lib | linked transitively, no C symbols | - | 33 | 0/0 | 0/0 | member(glob) |
| `crates/web/obscura-browser` | `obscura-browser` | lib | linked transitively, no C symbols | - | 108 | 0/0 | 0/0 | member(glob) |
| `crates/web/obscura-cdp` | `obscura-cdp` | lib | not linked | - | 235 | 0/0 | 0/0 | member(glob) |
| `crates/web/obscura-dom` | `obscura-dom` | lib | aphrody_web_parse_html / query_selector adapters (direct dep) | @aphrody/bun (engine.ts) | 82 | 0/0 | 0/0 | member(glob) |
| `crates/web/obscura-js` | `obscura-js` | lib | linked transitively, no C symbols | - | 530 | 0/0 | 0/0 | member(glob) |
| `crates/web/obscura-mcp` | `obscura-mcp` | lib | linked transitively, no C symbols | - | 20 | 0/0 | 0/0 | member(glob) |
| `crates/web/obscura-net` | `obscura-net` | lib | aphrody_web_obscura_fetch*, http_request adapters (direct dep) | @aphrody/bun (engine.ts) | 121 | 0/0 | 0/0 | member(glob) |
| `crates/web/obscura-render` | `obscura-render` | lib+bin*2 | linked transitively, no C symbols | - | 607 | 0/0 | 0/0 | member(glob) |
| `crates/web/taffy` | `taffy` | lib | linked transitively, no C symbols | - | 120 | 0/0 | 0/0 | member(glob) |
| `crates/web/web-bridge` | `aphrody-web-bridge` | lib | linked transitively, no C symbols | - | 55 | 0/0 | 14/0 | member(glob) |
| `crates/web/web-chromium` | `aphrody-web-chromium` | lib | aphrody_web_get_chromium_cookies adapter (direct dep) | @aphrody/bun (engine.ts) | 3 | 0/0 | 0/4 | member(glob) |
| `crates/web/web-crawl` | `aphrody-web-crawl` | lib | linked transitively, no C symbols | - | 35 | 0/0 | 0/0 | member(glob) |
| `crates/web/web-detect` | `aphrody-web-detect` | lib | linked transitively, no C symbols | - | 14 | 0/0 | 0/0 | member(glob) |
| `crates/web/web-engine` | `aphrody-web-engine` | bin*3 | not linked | - | 42 | 0/0 | 0/0 | member(glob) |
| `crates/web/web-extract` | `aphrody-web-extract` | lib | aphrody_web_extract_* adapters (direct dep) | @aphrody/bun (engine.ts) | 65 | 0/0 | 0/0 | member(glob) |
| `crates/web/web-frames` | `aphrody-web-frames` | lib | linked transitively, no C symbols | - | 9 | 0/0 | 0/0 | member(glob) |
| `crates/web/web-index` | `aphrody-web-index` | lib | aphrody_web_index_* adapters (direct dep) | @aphrody/bun (engine.ts) | 23 | 0/0 | 0/0 | member(glob) |
| `crates/web/web-service` | `aphrody-web-service` | lib | linked transitively, no C symbols | - | 5 | 0/0 | 0/0 | member(glob) |
| `crates/web/x` | `aphrody-x` | lib+bin*2 | aphrody_web_x_* adapters (direct dep) | @aphrody/bun (engine.ts) | 73 | 0/0 | 0/0 | member(glob) |

## Method and limits

- Membership: root `Cargo.toml` `[workspace] members` globs and `exclude`. Cargo also admits path dependencies inside the root as members; `Cargo.lock` was used only to read the dependency graph for the "linked" column. Whether every member actually builds is unverified (no cargo was run).
- Linked = reachable from `aphrody-ffi` in the `Cargo.lock` package graph (all targets and features, so it over-approximates what a default build links). It was read before the in-progress n2b crate merge by another session removed `aphrody-n2b-{ai,github,report,rules,scanners,util}`; the lock may still list them until the lead re-resolves.
- Bun consumer: only the `@aphrody/bun` modules that bind to the cdylib are listed. Other Bun packages that spawn the `aphrody` binary or mention a crate name in docs/manifests are not FFI consumers and are not listed. A "-" means no FFI consumer was found, not that no consumer exists.
- Tests, stubs, gates are regex counts over `src/**/*.rs` (and `tests/**/*.rs` for tests); they miss macro-generated tests and `build.rs`.
- `crates/os/kernel/comps/drive/**` is excluded from the workspace and treated as orphaned here; its `no_mangle` symbols (`sdk`, `sdk-macros`) are not part of the Bun FFI.
- `crates/compat/n2b` has 19 `no_mangle` occurrences in code-template strings (`rust_cmd.rs`, `*_templates.rs`), not exports; `crates/koharu/koharu/src/mallinfo.rs` exports 1 allocator-statistics symbol and `crates/ui/drive/src/macos.rs` 1 (macOS only); neither is bound from Bun (unverified for the template strings: counted by regex, not read in full).
