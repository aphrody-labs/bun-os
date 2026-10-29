<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-ffi

**aphrody, as a native library.** A thin, stable **C ABI** over the `aphrody-command`
library crate so the *entire* command surface is reachable in-process from Bun
(`bun:ffi`) and any other C-ABI host (C / C++ / Zig / Python `ctypes` / .NET
P/Invoke) — not only by spawning the `aphrody` binary.

## How it works

All command logic lives in the `aphrody-command` library
(`crates/infra/aphrody-command`); the `aphrody` package (`crates/infra/aphrody`) is a thin
binary facade over it. This crate depends on `aphrody-command` and wraps its
async entry point — `aphrody_command::run_async`, driven on a persistent `tokio`
runtime — behind a handful of `extern "C"` symbols. The library defines no
`#[global_allocator]`, so `aphrody-ffi` installs its own `mimalloc`.

The wrapped command surface is **exit-free** (commands return a `SubprocessExit`
error rather than calling `process::exit`) and every FFI entry **catches
panics**, so running aphrody inside a host process never tears the host down.

The Web extraction, DOM/text and HNSW index adapters also live in this crate
and link the shared `aphrody-web-extract`, `obscura-dom` and `aphrody-web-index` libraries. The Web
source bridge's v4 symbol catalog now lives here. Historical aliases in
this crate are temporary while Bun and MCP consumers move to canonical names.
All owned strings use this library's `aphrody_string_free` allocator pair.
Web jobs and embedding adapters reuse this crate's process-wide Tokio runtime.
The Chromium cookie ABI calls the shared `aphrody-web-chromium` crate; profile
data remains in each user's protected browser store.
The HTTP ABI calls the shared `obscura-net` crate. A submitted fetch uses the
same job registry and Tokio runtime as embeddings; `native-stealth` enables
the optional transport feature in this one library.
The native X client and ranking adapters link shared Rust crates from
`crates/web/`; the network calls have asynchronous job entry points.
The Bun binding opens this library on first native use and checks the ABI then;
importing its module does not require a built native library.

## Exported symbols

| Symbol | Purpose |
|---|---|
| `uint32_t aphrody_abi_version(void)` | ABI version for the host to check. |
| `const char *aphrody_version(void)` | aphrody version (owned by lib, no free). |
| `int aphrody_run(int argc, const char *const *argv)` | run any command, inherited stdio. |
| `int aphrody_run_json(const char *args_json)` | same, args as a JSON array. |
| `char *aphrody_run_captured(const char *args_json)` | run + capture stdout/stderr; returns `{"code","stdout","stderr"}` JSON (free with `aphrody_string_free`). |
| `void aphrody_string_free(char *ptr)` | free a string this library returned. |
| `const char *aphrody_last_error(void)` | last error on this thread (owned by lib, no free). |

The RAG call surface (`aphrody_rag_*`: manifest, `call_json`, `call_vec`, `take`, `last_error`) is
exported by `src/rag_ffi.rs`, an adapter without logic over `aphrody_rag_core::api` (chunking, fusion,
MMR, eval, vector kernels). Caller-owned buffers, no `free`. Typed Bun binding: `@aphrody/rag-core/ffi`
(`packages/ai/rag-core`); contract: Shenron targets.

Arguments exclude the program name — a synthetic `argv[0]` is prepended
internally — e.g. `["doctor", "--json"]`. The C header is `include/aphrody.h`.

## The C header

`include/aphrody.h` is a hand-written, self-contained, Doxygen-documented C23
header (it also compiles clean as C17 and C++17, with `-Wall -Wextra -Werror`):

- `#define APHRODY_ABI_VERSION` — compile-time ABI revision, kept in lock-step
  with the runtime `aphrody_abi_version()` symbol (a Rust unit test parses the
  header and asserts they agree, so they cannot drift).
- `enum AphrodyStatus` — typed, `int32_t`-backed status codes (`OK` = 0,
  `USAGE` = 64, `SOFTWARE` = 70) documenting the values the FFI layer injects.
  The run functions still return a plain `int` because a wrapped command may
  exit with any process code, not only this closed set.
- `APHRODY_NODISCARD` — `[[nodiscard]]` on C23/C++17, else
  `__attribute__((warn_unused_result))` (GCC/Clang) or `_Check_return_` (MSVC),
  applied to every function returning a status or an owned pointer.
- `APHRODY_API` — `__declspec(dllimport/dllexport)` on Windows,
  `__attribute__((visibility("default")))` on GCC/Clang.
- `APHRODY_NONNULL` / `APHRODY_RETURNS_NONNULL` / `APHRODY_MALLOC` — portable
  attribute helpers that degrade to nothing on compilers without them.

These are purely additive diagnostics: the symbol set, signatures, and the ABI
version are unchanged (still `1`).

## Build

```sh
# Dynamic library for Bun / dlopen (target/release/{lib,}aphrody_ffi.{so,dll,dylib})
cargo build --release -p aphrody-ffi

# With aphrody-command's opt-in command features forwarded into the cdylib:
cargo build --release -p aphrody-ffi --features forensics,index
```

`crate-type = ["cdylib", "rlib"]`: the `cdylib` is what Bun loads; the `rlib`
lets `cargo test`/`nextest` unit-test the marshaling helpers in-process.

## Use from Bun

The Bun binding is the `@aphrody/bun` workspace package
([`packages/interop/native`](../../packages/aphrody-bun)); its
`bun:ffi` symbol table is drift-tested against the Rust exports
(`test/ffi-drift.test.ts`, `test/header-drift.test.ts`).

```ts
import { run, runCaptured, version } from "@aphrody/bun/web";

console.log(version());

// Capture output in-process and parse it:
const r = runCaptured(["version", "--json"]);
console.log(JSON.parse(r.stdout));

// Or inherit stdio (output goes straight to the terminal):
run(["doctor"]);
```

The loader resolves the cdylib from `target/{release,debug}/` (with
`APHRODY_FFI_DEV=1`), or from `APHRODY_FFI_LIB` when set. Smoke run:

```sh
cargo build --release -p aphrody-ffi
APHRODY_FFI_DEV=1 bun run packages/interop/native/test-ffi.ts
```

The app-server client (`AgentClient`) is `@aphrody/bun/agent`
([`packages/interop/native/AGENT.md`](../../packages/aphrody-bun/AGENT.md)).
This crate stays the engine and the ABI source of truth.

## Ownership rules (read before binding from another language)

- A `char *` from `aphrody_run_captured` is **owned by the caller** — release it
  with `aphrody_string_free` exactly once.
- `const char *` results (`aphrody_version`, `aphrody_last_error`) are **owned by
  the library** — never free them. `aphrody_last_error` is thread-local and only
  valid until the next library call on the same thread.
- All strings are UTF-8, NUL-terminated.

## Platforms

Native only (Linux / Windows / macOS): the wrapped surface links tokio +
reqwest + rustls, which do not build on wasm32. On `wasm32-*` the crate compiles
to an empty module so `cargo check --target wasm32-unknown-unknown` stays green.

## yolo_* runtime ABI

`aphrody_ffi` re-exports the versioned `yolo_*` and `ffi_sum_squares` symbols of
`crates/engine/yolo-runtime` (see `src/yolo.rs`), declared in the yolo_* section of
`include/aphrody.h` (header revision `APHRODY_HEADER_VERSION` 2; the standalone
`yolo_runtime.h` is gone, release artifacts keep a `yolo_runtime.h` that includes `aphrody.h`).
The `bun_rs_*` exports of `crates/ui/bun` are declared in the same header.
`@aphrody/runtime` loads whichever library its verified artifact manifest names, so an
`aphrody_ffi` artifact is a drop-in. Browser exports require the `browser` feature.
