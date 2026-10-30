// External tool resolution and process helpers for @aphrody/wasm.
// Versions verified against crates.io, npm and GitHub releases on 2026-10-29.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/** Pinned fallbacks, used only when the tool is not already on PATH. */
export const PINS = {
  /** npm `binaryen` (wasm-opt compiled to wasm); GitHub has version_133 (2026-09-21) but npm latest is 132.0.0. */
  binaryen: "132.0.0",
  /** npm `@bytecodealliance/jco`, transpiles WASI preview 2 components to JavaScript. */
  jco: "1.40.0",
  /** crates.io: the newest wasm-bindgen; builds use the version a crate's Cargo.lock pins. */
  wasmBindgen: "0.2.129",
  wasmPack: "0.15.0",
  witBindgen: "0.63.0",
  wasmtime: "50.0.0",
  wasmTools: "1.262.0",
} as const;

export const TRIPLES = {
  unknown: "wasm32-unknown-unknown",
  p1: "wasm32-wasip1",
  p2: "wasm32-wasip2",
} as const;

/**
 * Features rustc and current engines accept. Never `--all-features`: stringref and GC imports
 * break JavaScriptCore (Bun, Safari) and older engines.
 */
export const WASM_OPT_FEATURES = [
  "--enable-bulk-memory",
  "--enable-nontrapping-float-to-int",
  "--enable-sign-ext",
  "--enable-mutable-globals",
  "--enable-multivalue",
  "--enable-reference-types",
] as const;

export const BINDGEN_TARGETS = [
  "web",
  "bundler",
  "nodejs",
  "deno",
  "no-modules",
  "experimental-nodejs-module",
] as const;
export type BindgenTarget = (typeof BINDGEN_TARGETS)[number];

export function exe(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

/** `$APHRODY_WASM_TOOLS_DIR`, else `$BUN_INSTALL/tools`, else `~/.bun/tools`. */
export function toolsDir(): string {
  const { APHRODY_WASM_TOOLS_DIR, BUN_INSTALL } = process.env;
  if (APHRODY_WASM_TOOLS_DIR) return APHRODY_WASM_TOOLS_DIR;
  return join(BUN_INSTALL || join(homedir(), ".bun"), "tools");
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  inherit?: boolean;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function run(cmd: string[], options: RunOptions = {}): Promise<RunResult> {
  const proc = Bun.spawn({
    cmd,
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdin: "ignore",
    stdout: options.inherit ? "inherit" : "pipe",
    stderr: options.inherit ? "inherit" : "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    options.inherit ? "" : new Response(proc.stdout as ReadableStream).text(),
    options.inherit ? "" : new Response(proc.stderr as ReadableStream).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

/** Like {@link run} but throws with the tool output on a non-zero exit. */
export async function checked(cmd: string[], options: RunOptions = {}): Promise<RunResult> {
  let result: RunResult;
  try {
    result = await run(cmd, options);
  } catch (error) {
    throw new Error(`${cmd[0]} could not be started: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (result.exitCode !== 0) {
    const output = (result.stderr || result.stdout || "").trim();
    throw new Error(
      `${basename(cmd[0]!)} ${cmd[1] ?? ""} failed (exit ${result.exitCode})${output ? `\n${output}` : ""}`,
    );
  }
  return result;
}

export async function versionOf(bin: string): Promise<string | undefined> {
  try {
    const result = await run([bin, "--version"]);
    return result.exitCode === 0 ? result.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** The command that runs wasm-opt: `$APHRODY_WASM_OPT`, PATH, else binaryen's npm package through `bun x`. */
export function wasmOptCommand(): string[] {
  const override = process.env.APHRODY_WASM_OPT;
  if (override) return [override];
  const onPath = Bun.which("wasm-opt");
  if (onPath) return [onPath];
  return [process.execPath, "x", "--bun", "--package", `binaryen@${PINS.binaryen}`, "wasm-opt"];
}

/** The command that runs jco: `$APHRODY_JCO`, else the npm package through `bun x`. */
export function jcoCommand(): string[] {
  const override = process.env.APHRODY_JCO;
  if (override) return [override];
  return [process.execPath, "x", "--bun", `@bytecodealliance/jco@${PINS.jco}`];
}

/** True when `cargo` is on PATH and `rustup` reports `triple` installed (or rustup is absent). */
export async function canBuildFor(triple: string): Promise<boolean> {
  if (!Bun.which("cargo")) return false;
  if (!Bun.which("rustup")) return true;
  const installed = await run(["rustup", "target", "list", "--installed"]).catch(() => undefined);
  return !!installed && installed.exitCode === 0 && installed.stdout.split(/\r?\n/).includes(triple);
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}
