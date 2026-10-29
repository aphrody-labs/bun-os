#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Build a wasm-bindgen crate into a web package. Cargo runs where this repository builds:
 * the canonical serialized root Cargo owner in local/cloud sessions, and the
 * checksum-verifying VPS factory on the explicitly selected remote route. Packaging runs the wasm-bindgen CLI
 * (its version must equal the wasm-bindgen crate pinned by Cargo.lock), wasm-opt -Oz when binaryen is installed with
 * the JavaScriptCore-safe feature set (never --all-features), `WebAssembly.validate`, the size ratchet and an
 * atomic replacement of the output that keeps the last usable package.
 *
 * bun scripts/aphrody/build/rust/wasm-package.ts --crate <package> --out <dir> [--manifest-path <Cargo.toml>] [--name <name>] [--profile <p>] [--max-bytes <N>] [--skip-cargo] [--no-opt]
 *
 * --manifest-path builds a crate excluded from the root workspace (its own [workspace] and Cargo.lock); the
 * artifact still lands in the repository target directory.
 */
import { $ } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const repositoryRoot = resolve(import.meta.dir, "../../../..");
const triple = "wasm32-unknown-unknown";

export type ToolResult = { exitCode: number; stdout: string; stderr?: string };
export type ToolRunner = (command: string[], cwd: string) => Promise<ToolResult>;
export type BuildOptions = {
  crate: string;
  out: string;
  manifestPath?: string;
  name?: string;
  profile?: string;
  maxBytes?: number;
  skipCargo?: boolean;
  noOpt?: boolean;
};
/** What the packer needs to turn a cargo artifact into a web package. */
export type PackOptions = {
  crate: string;
  package: string;
  artifact: string;
  outdir: string;
  name: string;
  target: "web";
  optimize: "Oz" | false;
  maxBytes?: number;
  packageJson: false;
  quiet: true;
};
export type Packer = (options: PackOptions) => Promise<{ wasm: string; bytes: number; rawBytes?: number }>;
export type BuildDependencies = {
  root?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  run?: ToolRunner;
  pack?: Packer;
};

const runTool: ToolRunner = async (command, cwd) => {
  const result = await $`${command}`.cwd(cwd).nothrow().quiet();
  return {
    exitCode: result.exitCode,
    stdout: result.text(),
    stderr: result.stderr.toString(),
  };
};

/** The wasm-bindgen crate version pinned by the Cargo.lock that belongs to `manifest`. */
export function pinnedBindgenVersion(manifest: string, root: string): string | undefined {
  for (const lock of [join(dirname(manifest), "Cargo.lock"), join(root, "Cargo.lock")]) {
    if (!existsSync(lock)) continue;
    const match = /name = "wasm-bindgen"\r?\nversion = "([^"]+)"/.exec(readFileSync(lock, "utf8"));
    if (match) return match[1];
  }
  return undefined;
}

/** Features wasm-opt may use: the set JavaScriptCore runs. Never --all-features. */
const WASM_OPT_FEATURES = [
  "--enable-bulk-memory",
  "--enable-sign-ext",
  "--enable-mutable-globals",
  "--enable-nontrapping-float-to-int",
];

async function tool(command: string[]): Promise<void> {
  const result = await $`${command}`.nothrow().quiet();
  if (result.exitCode !== 0)
    throw new Error(`${command[0]} failed (${result.exitCode}): ${result.stderr.toString() || result.text()}`);
}

const bindgenPack: Packer = async options => {
  const bindgen = Bun.which("wasm-bindgen");
  if (!bindgen)
    throw new Error("wasm-bindgen CLI not found: cargo install wasm-bindgen-cli --locked --version <Cargo.lock pin>");
  const pinned = pinnedBindgenVersion(options.crate, repositoryRoot);
  const version = (await $`${bindgen} --version`.quiet().text()).trim().split(/\s+/).at(-1);
  if (pinned && version !== pinned)
    throw new Error(`wasm-bindgen CLI ${version} differs from the Cargo.lock pin ${pinned}`);
  // Build beside the output and swap in only a validated package, so a failure keeps the last usable one.
  const staging = `${options.outdir}.partial-${crypto.randomUUID()}`;
  try {
    await tool([
      bindgen,
      "--target",
      options.target,
      "--out-dir",
      staging,
      "--out-name",
      options.name,
      options.artifact,
    ]);
    const wasm = join(staging, `${options.name}_bg.wasm`);
    const rawBytes = Bun.file(wasm).size;
    if (options.optimize) {
      const wasmOpt = Bun.which("wasm-opt");
      if (wasmOpt) await tool([wasmOpt, `-${options.optimize}`, ...WASM_OPT_FEATURES, "-o", wasm, wasm]);
    }
    const bytes = new Uint8Array(await Bun.file(wasm).arrayBuffer());
    if (!WebAssembly.validate(bytes)) throw new Error(`${options.name}_bg.wasm is not a valid WebAssembly module`);
    if (options.maxBytes !== undefined && bytes.length > options.maxBytes)
      throw new Error(`${options.name}_bg.wasm is ${bytes.length} bytes, over the ${options.maxBytes} byte limit`);
    const retired = `${options.outdir}.previous-${crypto.randomUUID()}`;
    const hadPrevious = existsSync(options.outdir);
    if (hadPrevious) await rename(options.outdir, retired);
    try {
      await rename(staging, options.outdir);
    } catch (error) {
      if (hadPrevious) await rename(retired, options.outdir);
      throw error;
    }
    if (hadPrevious) await rm(retired, { recursive: true, force: true });
    return { wasm: join(options.outdir, `${options.name}_bg.wasm`), bytes: bytes.length, rawBytes };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
};

/**
 * Rust prefixes that name this machine (checkout, rustup, cargo registry) are remapped so the wasm
 * carries no host path: panic and debug locations would otherwise expose the build user's home.
 */
export function remapFlags(root: string, env: NodeJS.ProcessEnv): string[] {
  const home = env.USERPROFILE ?? env.HOME ?? "";
  const cargoHome = env.CARGO_HOME ?? join(home, ".cargo");
  const rustupHome = env.RUSTUP_HOME ?? join(home, ".rustup");
  return [
    `--remap-path-prefix=${root}=/aphrody`,
    `--remap-path-prefix=${rustupHome}=/rustup`,
    `--remap-path-prefix=${cargoHome}=/cargo`,
  ];
}

export async function buildWasmPackage(options: BuildOptions, dependencies: BuildDependencies = {}) {
  const root = dependencies.root ?? repositoryRoot;
  const env = dependencies.env ?? process.env;
  const run = dependencies.run ?? runTool;
  const pack = dependencies.pack ?? bindgenPack;
  const platform = dependencies.platform ?? process.platform;
  env.RUSTFLAGS = [env.RUSTFLAGS, ...remapFlags(root, env)].filter(Boolean).join(" ");
  const crate = options.crate;
  const name = options.name ?? crate.replaceAll("-", "_");
  const profile = options.profile ?? "release";
  if (!/^[a-zA-Z0-9_-]+$/.test(crate) || !/^[a-zA-Z0-9_-]+$/.test(name))
    throw new Error("crate and output name must contain only letters, digits, underscores or hyphens");
  const out = resolve(root, options.out);
  if (out === root || out === dirname(out) || root.startsWith(`${out}${sep}`))
    throw new Error("output must be a package directory, not the repository or its parent");
  const checked = async (command: string[]) => {
    const result = await run(command, root);
    if (result.exitCode !== 0)
      throw new Error(`${command[0]} failed (${result.exitCode}): ${result.stderr || result.stdout}`);
    return result;
  };

  const manifest = options.manifestPath
    ? relative(root, resolve(root, options.manifestPath)).replaceAll("\\", "/")
    : undefined;
  if (manifest !== undefined && (manifest.startsWith("..") || isAbsolute(manifest) || !manifest.endsWith("Cargo.toml")))
    throw new Error("--manifest-path must be a Cargo.toml inside the repository");

  const artifactName = `${crate.replaceAll("-", "_")}.wasm`;
  const manifestArgs = manifest ? ["--manifest-path", manifest] : [];
  const cargoArgs =
    profile === "release"
      ? ["build", "--locked", ...manifestArgs, "-p", crate, "--target", triple, "--release"]
      : ["build", "--locked", ...manifestArgs, "-p", crate, "--target", triple, "--profile", profile];
  const targetDir = resolve(root, env.CARGO_TARGET_DIR ?? "target");
  // The VPS factory sets CARGO_TARGET_DIR remotely; local builds of an excluded crate must not use its own target/.
  const localArgs = [...cargoArgs, "--target-dir", targetDir];
  let fetchDir: string | undefined;
  try {
    let artifact: string;
    if (
      env.CLAUDE_CODE_REMOTE === "true" ||
      env.APHRODY_CLOUD === "1" ||
      platform === "win32" ||
      env.APHRODY_LOCAL_CARGO === "1"
    ) {
      if (!options.skipCargo)
        await checked([process.execPath, join(repositoryRoot, "scripts/cargo.ts"), "exec", "--", ...localArgs]);
      artifact = join(targetDir, triple, profile, artifactName);
    } else {
      const vps = join(repositoryRoot, "scripts/aphrody/build/rust/vps-cargo.ts");
      if (!options.skipCargo) await checked(["bun", vps, "run", "--", ...cargoArgs]);
      fetchDir = await mkdtemp(join(tmpdir(), "aphrody-wasm-fetch-"));
      // Exit 3 means a checksum-verified file was fetched but cannot run on the local host (WASM).
      const fetched = await run(
        ["bun", vps, "fetch", "--profile", `${triple}/${profile}`, "--bin", artifactName, "--dest", fetchDir],
        root,
      );
      if (fetched.exitCode !== 0 && fetched.exitCode !== 3)
        throw new Error(`fetching the wasm artifact failed (${fetched.exitCode})`);
      artifact = join(fetchDir, artifactName);
    }

    const existing = Bun.file(join(out, `${name}_bg.wasm`));
    const previousBytes = (await existing.exists()) ? existing.size : undefined;
    const built = await pack({
      crate: manifest ? join(root, manifest) : join(root, "Cargo.toml"),
      package: crate,
      artifact,
      outdir: out,
      name,
      target: "web",
      optimize: options.noOpt ? false : "Oz",
      maxBytes: options.maxBytes,
      packageJson: false,
      quiet: true,
    });
    const raw = built.rawBytes ?? built.bytes;
    return {
      wasm: built.wasm,
      rawBytes: raw,
      bytes: built.bytes,
      previousBytes,
      delta: previousBytes !== undefined ? built.bytes - previousBytes : undefined,
      optimization: options.noOpt
        ? "skipped (--no-opt)"
        : built.bytes < raw
          ? `optimized (-Oz converged; saved ${raw - built.bytes} bytes)`
          : "validated (-Oz; original size retained)",
    };
  } finally {
    if (fetchDir) await rm(fetchDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const at = argv.indexOf(name);
    const value = at >= 0 ? argv[at + 1] : undefined;
    return value?.startsWith("--") ? undefined : value;
  };
  const crate = flag("--crate");
  const out = flag("--out");
  if (!crate || !out)
    throw new Error(
      "usage: wasm-package.ts --crate <package> --out <dir> [--manifest-path <Cargo.toml>] [--name <n>] [--profile <p>] [--max-bytes <N>] [--skip-cargo] [--no-opt]",
    );
  const maxBytesStr = flag("--max-bytes");
  const result = await buildWasmPackage({
    crate,
    out,
    manifestPath: flag("--manifest-path"),
    name: flag("--name"),
    profile: flag("--profile"),
    maxBytes: maxBytesStr ? Number.parseInt(maxBytesStr, 10) : undefined,
    skipCargo: argv.includes("--skip-cargo"),
    noOpt: argv.includes("--no-opt"),
  });
  const deltaStr =
    result.delta !== undefined
      ? ` (previous: ${result.previousBytes} B, ${result.delta >= 0 ? `+${result.delta}` : result.delta} B)`
      : "";
  console.log(
    `${result.wasm}: ${result.rawBytes} bytes from wasm-bindgen -> ${result.bytes} bytes ${result.optimization}${deltaStr}`,
  );
}
