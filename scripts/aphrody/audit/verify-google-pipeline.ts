#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const HELP =
  "Usage: bun scripts/aphrody/audit/verify-google-pipeline.ts [--static | --rust-only | --sdk-only] [--root <bun-os checkout>]";

/** The flat crates of the OS Google domain, in qualification order. */
export const GOOGLE_CRATES = [
  "aphrody-boq",
  "aphrody-google",
  "aphrody-antigravity",
  "aphrody-gemini-runtime",
  "aphrody-gemini-web",
  "aphrody-model-antigravity",
];

export interface CargoPackage {
  name: string;
  manifest_path: string;
  targets: { name: string; kind: string[] }[];
}

export interface Owners {
  root: string;
  googleWorkspace: string;
  cargoManifest: string;
  rustCli: string;
  boqManifest: string;
  facadeManifest: string;
  facadeEntry: string;
  facadeTests: string;
  cargoSerial: string;
}

export function owners(root = resolve(import.meta.dir, "../../..")): Owners {
  root = resolve(root);
  return {
    root,
    googleWorkspace: join(root, "."),
    cargoManifest: join(root, "crates/aphrody-google/Cargo.toml"),
    rustCli: join(root, "crates/aphrody-google/src/cli.rs"),
    boqManifest: join(root, "crates/aphrody-boq/Cargo.toml"),
    facadeManifest: join(root, "packages/google/package.json"),
    facadeEntry: join(root, "packages/google/src/index.ts"),
    facadeTests: join(root, "packages/google/test"),
    cargoSerial: join(root, "scripts/aphrody/build/rust/cargo-serial.ts"),
  };
}

export function literalKeyFiles(dir: string): string[] {
  const hits: string[] = [];
  for (const file of new Bun.Glob("**/*.{ts,rs,py}").scanSync({ cwd: dir, dot: false })) {
    if (file.split(/[\\/]/).some(part => part === "node_modules" || part === "target")) continue;
    const text = readFileSync(join(dir, file), "utf8");
    if (text.includes("GEMINI_API_KEY=") || text.includes("GOOGLE_API_KEY=")) hits.push(file);
  }
  return hits.toSorted();
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function requireFile(path: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Owner file missing: ${path}`);
}

function hasScripts(manifest: string, name: string, scripts: string[]): void {
  const json = readJson<{ name?: string; scripts?: Record<string, string> }>(manifest);
  if (json.name !== name) throw new Error(`Unexpected Bun package owner: ${json.name} (${manifest})`);
  for (const script of scripts) {
    if (!json.scripts?.[script]) throw new Error(`${name} has no '${script}' script.`);
  }
}

function cargoMetadata(root: string): CargoPackage[] {
  const result = Bun.spawnSync(
    [
      "cargo",
      "metadata",
      "--format-version",
      "1",
      "--no-deps",
      "--locked",
      "--manifest-path",
      join(root, "Cargo.toml"),
    ],
    { cwd: root, windowsHide: true, stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) throw new Error(`cargo metadata failed for ${root}: ${result.stderr.toString()}`);
  return (JSON.parse(result.stdout.toString()) as { packages: CargoPackage[] }).packages;
}

function same(left: string, right: string): boolean {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export interface StaticResult {
  crates: string[];
  rustOwners: { name: string; manifest: string }[];
}

function verifyRustOwners(paths: Owners, metadata: (root: string) => CargoPackage[]) {
  for (const path of [join(paths.googleWorkspace, "Cargo.toml"), paths.cargoManifest, paths.rustCli, paths.boqManifest])
    requireFile(path);
  const packages = metadata(paths.googleWorkspace);
  const google = packages.find(item => item.name === "aphrody-google");
  if (!google?.targets.some(target => target.kind.includes("lib"))) {
    throw new Error("Current Cargo metadata does not expose the aphrody-google library.");
  }
  if (!same(google.manifest_path, paths.cargoManifest)) {
    throw new Error(`Cargo package aphrody-google is not owned by ${paths.cargoManifest}.`);
  }
  const rustOwners = GOOGLE_CRATES.map(name => ({ name, manifest: join(paths.root, "crates", name, "Cargo.toml") }))
    .filter(owner => existsSync(owner.manifest))
    .map(owner => {
      const found = packages.filter(item => item.name === owner.name && same(owner.manifest, item.manifest_path));
      if (found.length !== 1) throw new Error(`Cargo package ${owner.name} is not owned by ${owner.manifest}.`);
      return owner;
    });
  for (const dir of rustOwners.map(owner => join(dirname(owner.manifest), "src"))) {
    if (literalKeyFiles(dir).length) throw new Error(`Literal API key assignment found under ${dir}.`);
  }
  return rustOwners;
}

export function verifyStatic(paths: Owners, metadata = cargoMetadata, scope: Scope = "all"): StaticResult {
  requireFile(join(paths.root, "package.json"));
  const rustOwners = scope === "sdk" ? [] : verifyRustOwners(paths, metadata);
  if (scope !== "rust") {
    for (const path of [paths.facadeManifest, paths.facadeEntry]) requireFile(path);
    hasScripts(paths.facadeManifest, "@aphrody/google", ["test", "build", "verify"]);
    const rootPackage = readJson<{ workspaces?: string[]; scripts?: Record<string, string> }>(
      join(paths.root, "package.json"),
    );
    for (const manifest of [paths.facadeManifest]) {
      const directory = dirname(manifest);
      if (
        !rootPackage.workspaces?.some(pattern =>
          new Bun.Glob(pattern.replace(/^\.\//, "")).match(
            directory.slice(paths.root.length + 1).replaceAll("\\", "/"),
          ),
        )
      ) {
        throw new Error(`Bun package is not owned by the root workspace: ${manifest}`);
      }
    }
    for (const dir of [join(dirname(paths.facadeManifest), "src")]) {
      if (literalKeyFiles(dir).length) throw new Error(`Literal API key assignment found under ${dir}.`);
    }
  }
  rustOwners.sort((a, b) => a.name.localeCompare(b.name));
  return { crates: rustOwners.map(owner => owner.name), rustOwners };
}

export type Scope = "all" | "rust" | "sdk";
export interface Qualification {
  stage: "rust-source" | "facade-tests" | "facade-build";
  name: string;
  argv: string[];
  cwd: string;
}

export function qualificationPlan(
  paths: Owners,
  result: StaticResult,
  scope: Scope,
  platform = process.platform,
  bun = process.execPath,
): Qualification[] {
  const plan: Qualification[] = [];
  if (scope !== "sdk") {
    const cargo = [bun, paths.cargoSerial, ...(platform === "win32" ? ["--msvc"] : [])];
    for (const owner of result.rustOwners) {
      const args = ["--locked", "--manifest-path", owner.manifest, "-p", owner.name];
      plan.push({
        stage: "rust-source",
        name: `${owner.name} standalone Clippy`,
        argv: [...cargo, "clippy", ...args, "--all-targets", "--", "-D", "warnings"],
        cwd: dirname(owner.manifest),
      });
      plan.push({
        stage: "rust-source",
        name: `${owner.name} standalone tests`,
        argv: [...cargo, "test", ...args],
        cwd: dirname(owner.manifest),
      });
    }
  }
  if (scope !== "rust") {
    plan.push({
      stage: "facade-tests",
      name: "@aphrody/google fixture tests",
      argv: [bun, "test", paths.facadeTests],
      cwd: paths.root,
    });
    plan.push({
      stage: "facade-build",
      name: "@aphrody/google source bundle",
      argv: [bun, "run", "build"],
      cwd: dirname(paths.facadeManifest),
    });
  }
  return plan;
}

export async function verify(paths: Owners, staticOnly: boolean, scope: Scope = "all"): Promise<void> {
  const result = verifyStatic(paths, cargoMetadata, scope);
  console.log(
    `GOOGLE_PIPELINE ${scope} source ownership verified${result.crates.length ? `: ${result.crates.join(", ")}` : "."}`,
  );
  if (staticOnly) return;
  if (scope !== "sdk") requireFile(paths.cargoSerial);
  for (const qualification of qualificationPlan(paths, result, scope)) {
    console.log(`${qualification.stage}: ${qualification.name}`);
    const child = Bun.spawn(qualification.argv, {
      cwd: qualification.cwd,
      windowsHide: true,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await child.exited;
    if (code !== 0) throw new Error(`${qualification.stage}: ${qualification.name} failed (exit ${code}).`);
  }
  console.log(`GOOGLE_PIPELINE requested qualification passed: ${scope}.`);
}

if (import.meta.main) {
  let root = resolve(import.meta.dir, "../../..");
  let staticOnly = false;
  let scope: Scope = "all";
  try {
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (arg === "--static") staticOnly = true;
      else if (arg === "--rust-only" || arg === "--sdk-only") {
        const requested = arg === "--rust-only" ? "rust" : "sdk";
        if (scope !== "all" && scope !== requested)
          throw new Error(`Choose either --rust-only or --sdk-only.\n${HELP}`);
        scope = requested;
      } else if (arg === "--root") {
        const value = args[++index];
        if (!value || value.startsWith("--")) throw new Error(`--root requires a Bun checkout path.\n${HELP}`);
        root = resolve(value);
      } else if (arg === "--help" || arg === "-h") {
        console.log(HELP);
        process.exit(0);
      } else throw new Error(`Unknown argument: ${arg}\n${HELP}`);
    }
    await verify(owners(root), staticOnly, scope);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
