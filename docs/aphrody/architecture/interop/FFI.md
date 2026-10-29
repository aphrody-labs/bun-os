> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

# Rust to Bun FFI layer

> Path reconciliation (2026-10-07): `packages/engine/n2b-plugin/src/index.ts` (not in repo) → `packages/engine/n2b-client/src/plugin.ts` (not in repo). Original dated observations below retain their historical scope.

State on 2026-10-02 (runtime note 2026-10-08). The Bun runtime is the [aphrody-labs/bun fork](../../reference/upstream-bun/APHRODY-FORK.md); it has no `bun:aphrody` module and links no Aphrody library. Everything goes through `bun:ffi` `dlopen` over one native library. Per-crate facts are in `docs/reference/interop/FFI-CRATE-STATE.md`.

## Structure

```
crates/interop/ffi            aphrody-ffi, the only cdylib/rlib handed to Bun (libaphrody_ffi.so | aphrody_ffi.dll | libaphrody_ffi.dylib)
  src/lib.rs                  aphrody_* run/version/free/error + manga_* adapters (27 symbols)
  src/web/*.rs                aphrody_web_* adapters (extract, dom, index, media, net, jobs, embed, cookies, http)
  src/zerocopy.rs             caller-buffer exports: aphrody_zerocopy_*, aphrody_toolcall_*, aphrody_raster_*
  re-exports (pub use)        aphrody-bun (bun_rs_*), aphrody-n2b-native (node2bun_*, find_newlines_u16), aphrody-oxc-bridge (aphrody_oxc_*)
packages/interop/native       @aphrody/bun
  src/library.ts              SYMBOLS table (the dlopen definitions), path resolution, ABI checks, shared handle
  src/engine.ts               Web/CLI wrappers (index, DOM trees, jobs, embeddings, HTTP, X, Gemini)
  src/{manga,n2b,oxc,svg,render,icons,reproduce,zerocopy}.ts   one module per exported domain
  test/                       ffi-drift.test.ts (static, always runs), zerocopy.test.ts (skips without the cdylib)
```

Exported symbols per Rust module (static count of `no_mangle` functions, 119 in total): `ffi/src/lib.rs` 27, `web/mod.rs` 22, `web/net_aliases.rs` 15, `web/index.rs` 12, `web/extract.rs` 3, `web/media.rs` 2, `web/native_http.rs` 2, `zerocopy.rs` 4, `ui/bun/src/lib.rs` 14, `render.rs` 3, `icons_ffi.rs` 2, `reproduce.rs` 2, `svg.rs` 1, `n2b-native` 5, `oxc-bridge` 5. Each domain has its own ABI version function: `aphrody_abi_version` (1), `aphrody_web_bridge_abi_version` (4), `manga_abi_version` (1), `bun_rs_abi_version` (1), `node2bun_abi_version` (2), `aphrody_oxc_abi_version` (1), `aphrody_zerocopy_abi_version` (1).

## Library resolution (`library.ts`)

Order: `APHRODY_FFI_LIB`, then `packages/interop/native/native/<triple>/<file>`, then `native/<file>`, then, only with `APHRODY_FFI_DEV=1`, `target/<triple>/{release,debug}` and `target/{release,debug}` (`CARGO_TARGET_DIR` honoured). Artifacts are verified against their manifest (`native-artifact.ts`) before `dlopen`. One handle is shared by every subpath through `Symbol.for("aphrody.ffi.library.v1")`; importing a module never opens the library. After `dlopen`, each ABI version is compared with the expected one and the handle is closed on mismatch.

## Conventions

1. Zero allocation across the boundary for new exports: JavaScript allocates (`Uint8Array`, `Float32Array`), passes `ptr()`; Rust borrows and mutates in place. Rust never returns a pointer it allocated for these functions, so no free function exists.
2. Primitive types only in `extern "C"`: `*const u8`/`*mut u8`/`*const c_char`, `usize`, `u32`, `i32`, `i64`, `f32`. Every entry point wraps its body in `catch_unwind` and maps a panic to `-3`.
3. Pointer plus length for binary and text input (no NUL terminator needed). Older exports take NUL-terminated `cstring` and return library-owned strings freed by the domain's `*_string_free` / `aphrody_web_free_string` / `aphrody_oxc_free` (all backed by the same `CString` allocator in this cdylib).
4. JSON in, JSON out. Zero-copy text results are written into a caller buffer `(out, out_cap)`; the return value is the document length. If it exceeds `out_cap`, nothing is written and the caller retries with a larger buffer (`zerocopy.ts` keeps a growable scratch buffer). Failures inside Rust are `{"error": "..."}`; negative returns mean invalid argument (`-1`) or panic (`-3`).
5. Long operations use `*_submit` returning a job id, polled with `aphrody_web_job_*`.
6. Adding a symbol: write the Rust function, add its entry to `SYMBOLS` in `library.ts` with the same arity and widths (`usize` is the string `"usize"`; `FFIType.usize` does not exist), add a typed wrapper, then run `bun test test/ffi-drift.test.ts`. Do not change `NATIVE_ABI_VERSIONS` for additive symbols: it invalidates existing artifact manifests. Only bump a domain ABI for a breaking change.
7. New dependencies go in the root `[workspace.dependencies]` and are consumed with `{ workspace = true }`; `aphrody-ffi` keeps them under `[target.'cfg(not(target_arch = "wasm32"))'.dependencies]` so the wasm check stays empty.

## Drift between Rust exports and Bun definitions

Checked by `packages/interop/native/test/ffi-drift.test.ts` (set equality of names, then arity, argument widths and return type, with `cstring`/`ptr` and `u64_fast`/`u64` treated as equal).

| | Before this change | After |
|---|---|---|
| Rust exports without a dlopen definition | 7: `web_internal_{extract_links,extract_text,extract_title,get_chromium_cookies,html_to_markdown,normalize_url,strip_tags}` (internal duplicates of the canonical `aphrody_web_*`, exported by accident) | 0: the `#[no_mangle]` was removed from these seven functions; they stay `pub` for the in-crate callers |
| dlopen definitions without a Rust export | 0 | 0 |
| Width mismatches | 2: `manga_detect_bubbles` and `manga_pipeline_run` declared the length as `u64_fast` while Rust takes `usize` | 0: declared as `"usize"` |
| Stale fork references | `bun:aphrody` in `crates/os/kernel/core/src/runtimes.rs:23`, `packages/engine/n2b-client/src/plugin.ts` (not in repo) (former source location packages/engine/n2b-plugin/src/index.ts:79), `packages/interop/native/src/library.ts:293`, `fixtures/bun-fork-native.ts` | removed (see below) |

Stale fork removal: the kernel runtime report probes stock `bun:ffi` and publishes `ffi_available` (replacing `aphrody_module_version`; no other consumer of the old key was found by `rg`); the n2b plugin imports `@aphrody/bun/n2b`; `library.ts` no longer has a builtin-first handle owner; the fork fixture and its two `APHRODY_BUN_FORK_BIN` tests are deleted. `docs/` and `PLAN.md` still mention the fork historically and were not rewritten. The n2b plugin does not list `@aphrody/bun` in its `package.json` (adding it changes `bun.lock`); without the package resolvable it falls back to the CLI in `auto` mode.

## Added exports (`zerocopy.rs`)

| Symbol | Crate | Behaviour |
|---|---|---|
| `aphrody_toolcall_repair_json(in, in_len, out, cap) -> i64` | `aphrody-toolcall-repair` | Repairs malformed model JSON, writes `{"value","repairs"}` or `{"error"}` |
| `aphrody_toolcall_validate_json(args, n, schema, m, out, cap) -> i64` | `aphrody-toolcall-repair` | JSON-Schema-subset check, writes `{"violations":[{pointer,message}]}` |
| `aphrody_raster_fill_triangle(px, zbuf, w, h, verts, uv, tex, tex_w, tex_h, shade, base_rgb) -> i32` | `aphrody-softraster` | Z-buffered triangle fill into the caller's RGBA8 and `f32` depth buffers, no allocation |
| `aphrody_zerocopy_abi_version() -> u32` | `aphrody-ffi` | Version 1, checked at load |

TypeScript: `repairJson`, `validateArguments`, `createFramebuffer`, `fillTriangle` from `@aphrody/bun/zerocopy`.

## Build and gates

The lead builds with `scripts/build/rust/cargo-serial.sh` only. The new dependency edges change `Cargo.lock` for `aphrody-ffi`, so the first build must not use `--locked` (the package script `build` uses `--locked`); the lock is then re-resolved by cargo, never edited by hand. Bun side: `bunx tsc --noEmit` and `bun test` in `packages/interop/native`; runtime tests skip while no cdylib exists.

## Not exposed yet

Crates reachable from the cdylib that would fit the same conventions but were not exported in this change: `aphrody-sprite-sheet` (CSS/SVG/JSON sheet generation), `aphrody-web-detect`, `aphrody-patch`, `aphrody-execpolicy`. Reason: each export needs compiling and testing through the serialized wrapper, which this session may not run.
