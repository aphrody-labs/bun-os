#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Cargo adapter for the canonical Bun OS build owner.
 *
 * Heavy compilation on the primary Unix VPS uses BunCC's independent lane locks and isolated targets. The Windows
 * MSVC and secondary factory hosts keep the serialized native-owner path. Fetch, metadata and lockfile commands rely
 * on Cargo's own package-cache lock.
 * `--msvc` selects the native Windows build context: the newest Visual Studio MSVC x64 developer environment
 * (vswhere + VsDevCmd, captured without a console), build output off the checkout, native sccache and the private
 * Git SSH alias mapped to HTTPS. The primary VPS Unix path uses BunCC lane admission; secondary hosts retain native flock.
 *
 * Usage: bun scripts/aphrody/build/rust/cargo-serial.ts [--msvc] <cargo arguments...>
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const HEAVY = new Set([
  "package",
  "publish",
  "build",
  "b",
  "check",
  "c",
  "test",
  "t",
  "clippy",
  "rustdoc",
  "doc",
  "d",
  "bench",
  "run",
  "r",
  "install",
  "rustc",
  "nextest",
  "xwin",
  "zigbuild",
]);
/** Cargo global options that consume the following argument. */
const VALUED_GLOBALS = new Set(["--config", "-Z", "-C", "--color", "--explain"]);
const sourceRoot = resolve(import.meta.dir, "../../../..");

type Env = Record<string, string | undefined>;

function environmentPath(env: Env): string {
  return Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
}

export class UsageError extends Error {}

/** Route only sccache through the Windows response-file adapter; preserve deliberate wrappers. */
export function routeSccacheWrapper(wrapper: string | undefined, router: string): string | undefined {
  if (!wrapper) return wrapper;
  const executable = wrapper.split(/[\\/]/).pop()?.toLowerCase();
  return executable === "sccache" || executable === "sccache.exe" ? router : wrapper;
}

/** The Cargo subcommand, skipping a `+toolchain` selector and global options. */
export function cargoSubcommand(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg.startsWith("+")) continue;
    if (VALUED_GLOBALS.has(arg)) {
      index++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return undefined;
}

export function isCloud(env: Env): boolean {
  return (
    env.CLAUDE_CODE_REMOTE === "true" ||
    env.APHRODY_CLOUD === "1" ||
    env.CI === "true" ||
    env.GITHUB_ACTIONS === "true" ||
    env.CODESPACES === "true" ||
    !!env.GITPOD_WORKSPACE_ID ||
    env.CLOUD_SHELL === "true" ||
    env.CONTAINER === "true"
  );
}

export interface CargoPlan {
  heavy: boolean;
  helpOnly: boolean;
  jobs: number;
  waitSeconds: number;
  env: Env;
}

/** Validate arguments and derive the Cargo environment; throws UsageError on a contract violation. */
export function planCargo(args: readonly string[], msvc: boolean, env: Env): CargoPlan {
  if (!args.length) throw new UsageError("usage: cargo-serial.ts [--msvc] <cargo arguments...>");
  const command = cargoSubcommand(args);
  const heavy = command !== undefined && HEAVY.has(command);
  const helpOnly = args.includes("--help") || args.includes("-h");
  if (args.some(arg => /^(-j\d*|--jobs(=.*)?)$/.test(arg)))
    throw new UsageError("Set Cargo worker count with APHRODY_CARGO_JOBS instead");
  const jobsText = env.APHRODY_CARGO_JOBS ?? String(availableParallelism());
  if (!/^[1-9][0-9]*$/.test(jobsText) || !Number.isSafeInteger(Number(jobsText)))
    throw new UsageError("APHRODY_CARGO_JOBS must be a positive safe integer");
  const waitText = env.APHRODY_CARGO_LOCK_TIMEOUT_SECS ?? "1800";
  if (!/^\d+$/.test(waitText)) throw new UsageError("APHRODY_CARGO_LOCK_TIMEOUT_SECS must be an integer");
  const next: Env = { ...env };
  if (env.APHRODY_CARGO_TARGET_DIR) {
    if (!isAbsolute(env.APHRODY_CARGO_TARGET_DIR))
      throw new UsageError("APHRODY_CARGO_TARGET_DIR must be an absolute path");
    if (args.some(arg => arg === "--target-dir" || arg.startsWith("--target-dir=")))
      throw new UsageError("Do not mix APHRODY_CARGO_TARGET_DIR with --target-dir");
    next.CARGO_TARGET_DIR = env.APHRODY_CARGO_TARGET_DIR;
  }
  if (
    env.RUSTC_WRAPPER &&
    !existsSync(env.RUSTC_WRAPPER) &&
    !Bun.which(env.RUSTC_WRAPPER, { PATH: environmentPath(env) })
  )
    throw new UsageError(`RUSTC_WRAPPER is not available on this host: ${env.RUSTC_WRAPPER}`);
  // Preserve the operator's wrapper, including an explicit deliberate opt-out (empty value).
  if (env.RUSTC_WRAPPER === undefined) {
    const sccache = Bun.which("sccache", { PATH: environmentPath(env) });
    if (sccache) next.RUSTC_WRAPPER = sccache;
  }
  if (process.platform === "win32" && env.USERPROFILE) {
    const router =
      env.APHRODY_RUSTC_WRAPPER_ROUTER ?? join(env.USERPROFILE, ".cargo", "bin", "aphrody-rustc-router.exe");
    if (existsSync(router)) {
      const cargoWrapper = next.CARGO_BUILD_RUSTC_WRAPPER;
      const rustcWrapper = next.RUSTC_WRAPPER;
      const routedCargoWrapper = routeSccacheWrapper(cargoWrapper, router);
      const routedRustcWrapper = routeSccacheWrapper(rustcWrapper, router);
      if (routedCargoWrapper !== cargoWrapper) next.CARGO_BUILD_RUSTC_WRAPPER = routedCargoWrapper;
      if (routedRustcWrapper !== rustcWrapper) next.RUSTC_WRAPPER = routedRustcWrapper;

      // Cargo's RUSTC_WRAPPER environment override wins when both variables are set.
      const selected = rustcWrapper !== undefined ? rustcWrapper : cargoWrapper;
      if (selected !== undefined && routeSccacheWrapper(selected, router) !== selected) {
        next.APHRODY_SCCACHE_EXE =
          (isAbsolute(selected) && existsSync(selected)
            ? selected
            : Bun.which(selected, { PATH: environmentPath(next) })) ?? selected;
      }
    }
  }
  if (msvc) {
    next.CARGO_TARGET_DIR ??= join(sourceRoot, "target");
    if (next.CARGO_BUILD_RUSTC_WRAPPER === undefined && next.RUSTC_WRAPPER)
      next.CARGO_BUILD_RUSTC_WRAPPER = next.RUSTC_WRAPPER;
    next.SCCACHE_SERVER_PORT ??= "4227";
    next.CARGO_NET_GIT_FETCH_WITH_CLI = "true";
    next.GIT_TERMINAL_PROMPT = "0";
    // Append to any inherited process-local Git configuration instead of replacing it.
    const count = /^\d+$/.test(env.GIT_CONFIG_COUNT ?? "") ? Number(env.GIT_CONFIG_COUNT) : 0;
    next[`GIT_CONFIG_KEY_${count}`] = "url.https://github.com/.insteadOf";
    next[`GIT_CONFIG_VALUE_${count}`] = "ssh://git@github-dev/";
    next.GIT_CONFIG_COUNT = String(count + 1);
  }
  if (heavy) {
    next.APHRODY_CARGO_JOBS = jobsText;
    next.CARGO_BUILD_JOBS = jobsText;
    // sccache refuses every compile while CARGO_INCREMENTAL is set; the opt-in unsets it so the profile
    // default keeps workspace members incremental while sccache still caches dependencies.
    if (env.APHRODY_CARGO_INCREMENTAL === "1") delete next.CARGO_INCREMENTAL;
    else next.CARGO_INCREMENTAL = "0";
    next.CARGO_TERM_COLOR = "never";
  }
  return {
    heavy,
    helpOnly,
    jobs: Number(jobsText),
    waitSeconds: Number(waitText),
    env: next,
  };
}

/** Call after acquiring the host's mutex, immediately before starting Cargo. */
export function admitCargoJobs(plan: CargoPlan, cpus = availableParallelism()): void {
  if (!Number.isSafeInteger(cpus) || cpus < 1 || plan.jobs > cpus)
    throw new UsageError("Cargo jobs exceed the executing host's available CPUs");
}

/** The Workspace build-factory owner decides whether heavy Cargo belongs to the factory. */
function factoryRoute(env: Env): "factory" | "local" {
  const owner = join(sourceRoot, "packages/bun-workspace/src/automation/build-factory.ts");
  if (!existsSync(join(sourceRoot, "tools/aphrody/config/build-factory.json")) || !existsSync(owner)) return "local";
  const result = Bun.spawnSync([process.execPath, owner, "status", "--route"], {
    cwd: sourceRoot,
    env,
    stdout: "pipe",
    stderr: "inherit",
    windowsHide: true,
  });
  if (result.exitCode !== 0) throw new Error("build-factory status --route failed");
  return result.stdout.toString().trim() === "factory" ? "factory" : "local";
}

/** Environment of the newest Visual Studio installation carrying the MSVC x64 tools. */
function msvcEnvironment(env: Env): Env {
  const programFiles = env["ProgramFiles(x86)"] ?? env.ProgramFiles ?? "C:\\Program Files (x86)";
  const vswhere = join(programFiles, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!existsSync(vswhere))
    throw new UsageError("vswhere.exe not found: install Visual Studio Build Tools through Bun OS system-packages.");
  const query = (all: boolean) =>
    Bun.spawnSync(
      [
        vswhere,
        ...(all ? ["-all"] : []),
        "-latest",
        "-products",
        "*",
        "-requires",
        "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "-property",
        "installationPath",
      ],
      { stdout: "pipe", stderr: "pipe", windowsHide: true },
    )
      .stdout.toString()
      .trim();
  const install = query(false) || query(true);
  if (!install) throw new UsageError("No Visual Studio installation with the MSVC x64 tools was found.");
  const devCmd = join(install, "Common7", "Tools", "VsDevCmd.bat");
  if (!existsSync(devCmd)) throw new UsageError(`VsDevCmd.bat missing: ${devCmd}`);
  // A batch file avoids cmd.exe quoting rules; `set` then prints the resulting environment.
  const dir = mkdtempSync(join(tmpdir(), "aphrody-msvc-"));
  try {
    const script = join(dir, "msvc-env.cmd");
    writeFileSync(
      script,
      `@echo off\r\nchcp 65001 >nul\r\ncall "${devCmd}" -arch=amd64 -host_arch=amd64 -no_logo >nul 2>&1\r\nif errorlevel 1 exit /b 1\r\nset\r\n`,
    );
    const result = Bun.spawnSync([env.ComSpec ?? "cmd.exe", "/d", "/c", script], {
      cwd: env.SystemDrive ? `${env.SystemDrive}\\` : undefined,
      env,
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    if (result.exitCode !== 0)
      throw new UsageError(`VsDevCmd.bat failed (${result.exitCode}): ${result.stderr.toString()}`);
    const captured: Env = {};
    for (const line of result.stdout.toString().split(/\r?\n/)) {
      const equals = line.indexOf("=", 1);
      if (equals > 0) captured[line.slice(0, equals)] = line.slice(equals + 1);
    }
    if (!captured.VCToolsInstallDir) throw new UsageError("VsDevCmd.bat did not provide the MSVC environment");
    return captured;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Windows environment variable names are case-insensitive: merge on the canonical existing key. */
function mergeEnv(base: Env, overlay: Env): Env {
  const keys = new Map(Object.keys(base).map(key => [key.toUpperCase(), key]));
  const merged: Env = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = keys.get(key.toUpperCase());
    if (existing && existing !== key) delete merged[existing];
    merged[key] = value;
  }
  return merged;
}

export async function main(argv: readonly string[], baseEnv: Env = process.env): Promise<number> {
  const msvc = argv[0] === "--msvc";
  const args = msvc ? argv.slice(1) : [...argv];
  if (process.platform !== "win32" && msvc) throw new UsageError("--msvc selects the native Windows MSVC context");
  let env: Env = { ...baseEnv };
  if (msvc) {
    env = mergeEnv(env, msvcEnvironment(env));
    const cargoBin = join(env.USERPROFILE ?? "", ".cargo", "bin");
    const pathKey = Object.keys(env).find(key => key.toUpperCase() === "PATH") ?? "PATH";
    if (env.USERPROFILE && !(env[pathKey] ?? "").toLowerCase().includes(cargoBin.toLowerCase()))
      env[pathKey] = `${env[pathKey] ?? ""};${cargoBin}`;
    if (pathKey !== "PATH") {
      env.PATH = env[pathKey];
      delete env[pathKey];
    }
  }
  const plan = planCargo(args, msvc, env);
  // Native Windows builds selected with --msvc are an explicit build context; plain heavy Cargo honours the factory.
  if (
    plan.heavy &&
    !msvc &&
    !plan.helpOnly &&
    env.APHRODY_BUILD_HOST !== "vps" &&
    env.APHRODY_BUILD_HOST !== "dbfr" &&
    env.APHRODY_LOCAL_CARGO !== "1" &&
    !isCloud(env) &&
    factoryRoute(env) === "factory"
  ) {
    console.error(
      "Heavy Cargo belongs to the build factory. Exact worktree state: bun scripts/aphrody/build/rust/vps-cargo.ts run -- <arguments>; native Windows build context: bun scripts/aphrody/build/rust/cargo-serial.ts --msvc <arguments>.",
    );
    console.error("APHRODY_LOCAL_CARGO=1 is only for an explicitly selected scoped diagnostic.");
    return 64;
  }
  const { loadConfig, runNativeResult, runCargo } = await import("@aphrody/bun-workspace");
  // The primary VPS has independent BunCC lanes with isolated targets. Bypass the generic native-owner flock,
  // which otherwise serializes every Cargo invocation around one shared target directory. Keep the Windows/MSVC
  // and secondary-host paths below on their existing serialized owners.
  if (
    process.platform !== "win32" &&
    !msvc &&
    env.APHRODY_BUILD_HOST === "vps" &&
    plan.heavy &&
    !plan.helpOnly
  ) {
    const laneEnv = { ...plan.env };
    const requestedTarget = laneEnv.APHRODY_CARGO_TARGET_DIR ?? laneEnv.CARGO_TARGET_DIR;
    if (!laneEnv.BUNCC_LANE_ROOT && requestedTarget) laneEnv.BUNCC_LANE_ROOT = requestedTarget;
    delete laneEnv.APHRODY_CARGO_TARGET_DIR;
    delete laneEnv.CARGO_TARGET_DIR;
    const result = await runCargo(args, {
      root: sourceRoot,
      cwd: process.cwd(),
      env: laneEnv,
      timeoutMs: plan.waitSeconds * 1000,
    });
    return result.code;
  }
  const cargo = Bun.which("cargo", { PATH: environmentPath(plan.env) });
  if (!cargo) throw new UsageError("Native Cargo is missing from the selected build context.");
  const result = await runNativeResult(await loadConfig(sourceRoot), [cargo, ...args], {
    root: sourceRoot,
    cwd: process.cwd(),
    env: plan.env,
    serialize: plan.heavy && !plan.helpOnly,
    runtimePolicy: "development",
    timeoutMs: 1_800_000,
  });
  return result.code;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(Bun.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof UsageError ? 64 : 1;
  }
}
