/**
 * WebAssembly toolchain for Rust crates (the job of the fork's `bun:wasm` / `bun wasm build`, i.e. wasm-pack):
 * rustup target, cargo build, wasm-bindgen at the version Cargo.lock pins, wasm-opt from Binaryen.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GithubToolSpec } from "./_github.ts";
import { toolProvider } from "./_tool.ts";

export const WASM_TARGETS = {
  unknown: "wasm32-unknown-unknown",
  p1: "wasm32-wasip1",
  p2: "wasm32-wasip2",
} as const;
export type WasmTarget = keyof typeof WASM_TARGETS;

/**
 * Features wasm-opt may use. Never `--all-features`: stringref/GC imports break JavaScriptCore (Bun, Safari) and older
 * engines. Carried over unchanged from the fork.
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

/** Version of `wasm-bindgen` locked in Cargo.lock text; the CLI must match it exactly. */
export function bindgenVersionFromLock(lock: string): string | undefined {
  return /\[\[package\]\]\s*\nname = "wasm-bindgen"\s*\nversion = "([^"]+)"/.exec(lock)?.[1];
}

export function bindgenVersion(crateDir: string): string | undefined {
  for (const dir of [crateDir, join(crateDir, ".."), join(crateDir, "..", "..")]) {
    const file = join(dir, "Cargo.lock");
    if (existsSync(file)) {
      const v = bindgenVersionFromLock(readFileSync(file, "utf8"));
      if (v) return v;
    }
  }
  return undefined;
}

export function rustupTargetArgs(target: WasmTarget): string[] {
  return ["target", "add", WASM_TARGETS[target]];
}

export function cargoBuildArgs(o: {
  target: WasmTarget;
  release?: boolean;
  package?: string;
  manifestPath?: string;
  features?: string[];
}): string[] {
  const a = ["build", "--target", WASM_TARGETS[o.target]];
  if (o.release ?? true) a.push("--release");
  if (o.package) a.push("-p", o.package);
  if (o.manifestPath) a.push("--manifest-path", o.manifestPath);
  if (o.features?.length) a.push("--features", o.features.join(","));
  return a;
}

export function wasmArtifact(targetDir: string, target: WasmTarget, crate: string, release = true): string {
  return join(targetDir, WASM_TARGETS[target], release ? "release" : "debug", `${crate.replace(/-/g, "_")}.wasm`);
}

export function bindgenArgs(o: {
  wasm: string;
  outDir: string;
  target: BindgenTarget;
  typescript?: boolean;
  keepDebug?: boolean;
}): string[] {
  const a = [o.wasm, "--out-dir", o.outDir, "--target", o.target];
  if (o.typescript === false) a.push("--no-typescript");
  if (o.keepDebug) a.push("--keep-debug");
  return a;
}

export function wasmOptArgs(o: {
  input: string;
  output: string;
  level?: "-O" | "-O2" | "-O3" | "-O4" | "-Os" | "-Oz";
}): string[] {
  return [o.input, o.level ?? "-Oz", ...WASM_OPT_FEATURES, "-o", o.output];
}

export const wasmBindgenProvider = toolProvider({
  id: "wasm-bindgen",
  description: "wasm-bindgen CLI (must match the crate's wasm-bindgen version)",
  binary: "wasm-bindgen",
  versionArgs: ["--version"],
  manual: "cargo install wasm-bindgen-cli --version <version from Cargo.lock> --locked",
});

export function bindgenInstallCommand(version: string): string[] {
  return ["cargo", "install", "wasm-bindgen-cli", "--version", version, "--locked"];
}

export const binaryenRelease: GithubToolSpec = {
  id: "wasm-opt",
  repo: "WebAssembly/binaryen",
  binary: "wasm-opt",
  version: tag => tag.replace(/^version_/, ""),
  asset(tag, platform, arch) {
    const os = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux";
    const cpu =
      platform === "darwin"
        ? arch === "arm64"
          ? "arm64"
          : "x86_64"
        : arch === "arm64"
          ? platform === "win32"
            ? "arm64"
            : "aarch64"
          : "x86_64";
    return `binaryen-${tag}-${cpu}-${os}.tar.gz`;
  },
};

export const wasmOptProvider = toolProvider({
  id: "wasm-opt",
  description: "Binaryen wasm-opt",
  binary: "wasm-opt",
  versionArgs: ["--version"],
  packages: { pacman: "binaryen", apt: "binaryen", dnf: "binaryen", apk: "binaryen", brew: "binaryen" },
  github: binaryenRelease,
});
