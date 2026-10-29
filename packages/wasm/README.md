# @aphrody/wasm

Rust to WebAssembly on unmodified upstream Bun. It replaces the fork-only
`bun:wasm`, `bun wasm build` and `bun build --target=wasm`; the JavaScript side
uses only upstream APIs: the global `WebAssembly`, `import x from "./a.wasm"`
(the bundler's `wasm` loader), `node:wasi` and `bun ./program.wasm`.

```ts
import { build, inspect, optimize, runCommand, validate } from "@aphrody/wasm";

const result = await build({
  crate: "./crates/hello",
  outdir: "./pkg",
  maxBytes: 200_000,
});
const { default: init, greet } = await import(result.js);
await init();
```

| Fork                            | Here                                                        |
| ------------------------------- | ----------------------------------------------------------- |
| `bun:wasm` `build()`            | `build()`                                                   |
| `bun:wasm` `optimize()`         | `optimize()`                                                |
| `bun:wasm` `plugin()`           | `wasmPlugin()` (`Bun.plugin` or `Bun.build`)                |
| `bun wasm build`                | `bun packages/wasm/src/cli.ts build` (`aphrody-wasm build`) |
| `bun wasm opt`                  | `aphrody-wasm opt`                                          |
| `node:wasi` `getImportObject()` | `wasi.wasiImport` as `wasi_snapshot_preview1` (upstream)    |
| `node:wasi` `initialize()`      | `instance.exports._initialize()` called by hand (upstream)  |
| (none)                          | `inspect()`, `validate()`, `instantiate()`, `runCommand()`  |

## Pipeline

1. `cargo build` for `wasm32-unknown-unknown`, `wasm32-wasip1` or `wasm32-wasip2`
   (`rustup target add` runs when a target is missing). A crate with a `cdylib`
   target builds `--lib`, a binary crate builds `--bin`.
2. `wasm-bindgen` at the exact version `Cargo.lock` pins (PATH, else installed once
   into `$APHRODY_WASM_TOOLS_DIR` or `$BUN_INSTALL/tools`).
3. `wasm-opt -Oz` with the JavaScriptCore-safe feature set, never `--all-features`
   (PATH, else binaryen through `bun x`). An optimization that grows the module is
   discarded.
4. `wasm32-wasip2` components are transpiled with jco through `bun x`.
5. The package is staged next to `outdir`, validated and renamed into place, so a
   failed build keeps the last usable package.

Overrides: `APHRODY_WASM_BINDGEN`, `APHRODY_WASM_OPT`, `APHRODY_JCO`.

## buncc

`@aphrody/wasm/buncc` exports the hooks of the `wasm` backend: `buildWasm()`,
`optimizeWasm()`, `toolchain()` and the `bunccWasm` object. Requests and results
are plain JSON.

## Tests

`bun test` compiles the fixture crates (`crates/aphrody-wasm-raw`,
`aphrody-wasm-wasi-hello`, `aphrody-wasm-bindgen-hello`) with the pinned nightly and
runs the output. Set `APHRODY_WASM_TEST_NETWORK=1` to also run the tests that
install wasm-bindgen-cli or fetch binaryen and jco.
