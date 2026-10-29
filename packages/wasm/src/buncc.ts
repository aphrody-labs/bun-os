// `buncc wasm` backend hooks. buncc calls these; this module owns the cargo / wasm-bindgen / wasm-opt
// pipeline and keeps requests and results plain JSON so buncc can log, cache and replay them.
import { build, type BuildOptions } from "./build.ts";
import { inspect, type WasmInfo } from "./inspect.ts";
import { optimize, type OptimizeLevel } from "./optimize.ts";
import { TRIPLES } from "./tools.ts";
import { toolchain } from "./toolchain.ts";
import { runCli } from "./commands.ts";
import { readFileSync } from "node:fs";

export type BunccWasmMode = "web" | "bundler" | "nodejs" | "wasi-p1" | "wasi-p2" | "raw";

export interface BunccWasmBuildRequest {
  /** Crate directory, `Cargo.toml` or `.rs` file. */
  crate: string;
  outdir: string;
  /** `web`, `bundler` and `nodejs` are wasm-bindgen targets; `raw` is `wasm32-unknown-unknown` without bindgen. Defaults to `web`. */
  mode?: BunccWasmMode;
  package?: string;
  profile?: string;
  optimize?: false | OptimizeLevel;
  maxBytes?: number;
  features?: string[];
  /** Replace the `cargo` command (cross, a build-server wrapper). */
  cargo?: string | string[];
  /** Package a `.wasm` cargo already built, without running cargo. */
  artifact?: string;
}

export interface BunccWasmBuildResult {
  ok: true;
  triple: string;
  mode: BunccWasmMode;
  outdir: string;
  wasm: string;
  js: string;
  dts?: string;
  bytes: number;
  rawBytes?: number;
  info: Pick<WasmInfo, "format" | "wasi" | "bindgen" | "features"> & { imports: number; exports: number };
}

function toBuildOptions(request: BunccWasmBuildRequest): {
  options: BuildOptions;
  triple: string;
  mode: BunccWasmMode;
} {
  const mode = request.mode ?? "web";
  const options: BuildOptions = {
    crate: request.crate,
    outdir: request.outdir,
    package: request.package,
    profile: request.profile,
    optimize: request.optimize,
    maxBytes: request.maxBytes,
    features: request.features,
    cargo: request.cargo,
    artifact: request.artifact,
    quiet: true,
  };
  if (mode === "wasi-p1") options.wasi = "p1";
  else if (mode === "wasi-p2") options.wasi = "p2";
  else if (mode === "raw") options.bindgen = false;
  else options.target = mode;
  const triple = mode === "wasi-p1" ? TRIPLES.p1 : mode === "wasi-p2" ? TRIPLES.p2 : TRIPLES.unknown;
  return { options, triple, mode };
}

/** Build a crate into a package. Rejects with the tool output when cargo, wasm-bindgen or wasm-opt fail. */
export async function buildWasm(request: BunccWasmBuildRequest): Promise<BunccWasmBuildResult> {
  const { options, triple, mode } = toBuildOptions(request);
  const built = await build(options);
  const info = inspect(readFileSync(built.wasm));
  return {
    ok: true,
    triple,
    mode,
    outdir: built.outdir,
    wasm: built.wasm,
    js: built.js,
    dts: built.dts,
    bytes: built.bytes,
    rawBytes: built.rawBytes,
    info: {
      format: info.format,
      wasi: info.wasi,
      bindgen: info.bindgen,
      features: info.features,
      imports: info.imports.length,
      exports: info.exports.length,
    },
  };
}

/** wasm-opt a module; the output is never larger than the input. */
export async function optimizeWasm(
  input: string,
  options: { output?: string; level?: OptimizeLevel; debug?: boolean } = {},
) {
  return optimize(input, options);
}

/** The backend object buncc registers under `wasm`. */
export const bunccWasm = {
  id: "wasm",
  triples: TRIPLES,
  build: buildWasm,
  optimize: optimizeWasm,
  inspect: (file: string) => inspect(readFileSync(file)),
  toolchain,
} as const;

export default main;

export { toolchain };
export type { BunccWasmToolchain } from "./toolchain.ts";

/** Entry point of `buncc wasm <args>`: build, opt, inspect, validate, run, init, tools. Returns the exit code. */
export async function main(args: string[]): Promise<number> {
  return runCli(args);
}
