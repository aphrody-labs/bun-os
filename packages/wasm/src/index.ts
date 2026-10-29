// @aphrody/wasm: the WebAssembly helpers of Bun OS on unmodified upstream Bun.
// Replaces the fork-only `bun:wasm`, `bun wasm` and `bun build --target=wasm`.
export { build, cargoCommand, findManifest, pinnedBindgen, rawLoader, resolveBindgen } from "./build.ts";
export type { BuildOptions, BuildResult } from "./build.ts";
export { init } from "./init.ts";
export type { InitOptions } from "./init.ts";
export { inspect, validate } from "./inspect.ts";
export type { ExternKind, WasmExport, WasmImport, WasmInfo } from "./inspect.ts";
export { optimize } from "./optimize.ts";
export type { OptimizeLevel, OptimizeOptions, OptimizeResult } from "./optimize.ts";
export { wasmPlugin } from "./plugin.ts";
export { instantiate, instantiateWasi, runCommand } from "./run.ts";
export type { CommandOptions, CommandResult, InstantiateResult, WasiOptions } from "./run.ts";
export { BINDGEN_TARGETS, canBuildFor, PINS, TRIPLES, WASM_OPT_FEATURES } from "./tools.ts";
export type { BindgenTarget } from "./tools.ts";
