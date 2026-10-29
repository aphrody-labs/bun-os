// Run WebAssembly on upstream Bun: global WebAssembly for plain modules, `bun ./program.wasm`
// for WASI commands (upstream Bun runs them directly), node:wasi for reactors.
import { readFileSync } from "node:fs";
import { inspect, type WasmInfo } from "./inspect.ts";
import { run as spawnRun } from "./tools.ts";

export interface InstantiateResult {
  instance: WebAssembly.Instance;
  module: WebAssembly.Module;
  info: WasmInfo;
}

/** Compile and instantiate a core module from a path or bytes with the global `WebAssembly`. */
export async function instantiate(
  source: string | Uint8Array | ArrayBuffer,
  imports: WebAssembly.Imports = {},
): Promise<InstantiateResult> {
  const bytes = typeof source === "string" ? readFileSync(source) : source;
  const info = inspect(bytes);
  if (info.format === "component")
    throw new Error("components cannot be instantiated: transpile with jco (build({ wasi: 'p2' }))");
  const module = await WebAssembly.compile(bytes as BufferSource);
  const instance = await WebAssembly.instantiate(module, imports);
  return { instance, module, info };
}

export interface WasiOptions {
  args?: string[];
  env?: Record<string, string>;
  preopens?: Record<string, string>;
  imports?: WebAssembly.Imports;
}

/**
 * Instantiate a WASI preview 1 reactor (or any module importing `wasi_snapshot_preview1`) with
 * `node:wasi` as upstream Bun implements it: `wasiImport`, with `_initialize` called here.
 * Commands exit the process through `proc_exit`: use {@link runCommand} for those.
 */
export async function instantiateWasi(
  source: string | Uint8Array | ArrayBuffer,
  options: WasiOptions = {},
): Promise<InstantiateResult & { wasi: import("node:wasi").WASI }> {
  const { WASI } = await import("node:wasi");
  const wasi = new WASI({
    version: "preview1",
    args: options.args ?? [],
    env: options.env ?? {},
    preopens: options.preopens ?? {},
  });
  const result = await instantiate(source, { ...options.imports, wasi_snapshot_preview1: wasi.wasiImport });
  const initialize = result.instance.exports._initialize;
  if (typeof initialize === "function") initialize();
  return { ...result, wasi };
}

export interface CommandOptions {
  args?: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
  /** Command line of the runtime. Defaults to the current Bun executable. */
  bun?: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a WASI command module (`_start`) in a Bun subprocess. Upstream Bun runs `bun ./program.wasm`
 * directly, and a subprocess keeps `proc_exit` from ending the caller.
 */
export async function runCommand(file: string, options: CommandOptions = {}): Promise<CommandResult> {
  return spawnRun([options.bun ?? process.execPath, file, ...(options.args ?? [])], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
  });
}
