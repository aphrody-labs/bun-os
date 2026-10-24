# CEF Rust bindings owned by Bun OS

The public fork is [aphrody-labs/cef-rs](https://github.com/aphrody-labs/cef-rs),
based on [tauri-apps/cef-rs](https://github.com/tauri-apps/cef-rs).
`vendor/cef-rs` mounts the fork as a pinned submodule (`sources.lock.json`, `dev` branch)
with both licenses. It moved from `aphrody-labs/bun` `src/browser/cef-rs` (runtime-heavy-migration B1). The fork pin is
`b1bc46da11e9bc4aedec17d00e7d7a7b28f30f3d`; its upstream base is
`163744c8286d5f593d89202c7807751a7898db28`. Git verifies the submodule content.

Tauri's CEF runtime resolves `cef` and `cef-dll-sys` directly from this vendor.
The Cargo package identity remains upstream `154.5.0`; it does not select a
Chromium 154 binary. Its build script requires the selected source-built CEF
distribution for Chromium `157.0.8099.0` at
`ce0615a76d6347f1914d673f1da66285b328d494`, with CEF source at
`7e28cb05af72af8c0cdfafe7facfca97eed139c8`.
Missing or mismatched receipts fail before compiling the wrapper. The active
build path never downloads a prebuilt library, including the former CEF 152.

## Source generation

CEF owns its translated C API and generated version headers. The CEF source
workflow writes `.bun-cef-headers.json` alongside those headers, recording the
exact source pins, Rust target, Chromium version and actual
`CEF_API_VERSION_LAST`. The current translated header API is `15600`; a
Chromium 157 source target alone does not turn it into an invented API `15700`.

```sh
bun scripts/aphrody/build/cef-rs-bindings.ts plan x86_64-pc-windows-msvc <absolute-owner-headers>
bun scripts/aphrody/build/cef-rs-bindings.ts generate x86_64-pc-windows-msvc <absolute-owner-headers>
```

Use paths from the selected checkout and a qualified target host. `generate`
runs the upstream `update-bindings` utility through the serialized Cargo
owner. Windows uses its native MSVC environment. Generation sets the exact
`CEF_PATH_<os>_<arch>` and pins the stable header API, then updates raw, safe
and resource bindings for that target. It records their hashes and all header
inputs in `sys/src/bindings/<target>.bun-cef.json`.
The utility does not download headers or binaries.

Generated source changes must be published back to the fork and incorporated
into the `vendor/cef-rs` pin. Source generation is separate from compiling CEF and
from testing the Tauri application.

## Native qualification

A qualified source-built CEF distribution has `.bun-cef-build.json` with the
same pins and target, its binary SHA-256 and the result of the native
`cef_api_hash(apiVersion, 0)` probe. The source header hash is not a replacement
for that native probe.

```sh
bun scripts/aphrody/build/cef-rs-bindings.ts qualify x86_64-pc-windows-msvc <absolute-owner-distribution>
```

`qualify` verifies binary, generated binding and header hashes before attaching
the native API hash to the target's generation receipt. `cef-dll-sys` checks
both receipts again during its build. Existing upstream Chromium 154 bindings
fail that check until regenerated from the selected headers.

At source integration time, the CEF 156 to Chromium 157 native port remains
incomplete. The owner headers are generated, but no generated target bindings,
compiled CEF 157 distribution or Tauri native execution is claimed here.
