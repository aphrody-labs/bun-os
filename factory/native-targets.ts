#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
import { mkdir, open, lstat, realpath, statfs, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readLock } from "../src/distribution.ts";
import { abi } from "../packages/package-converter/src/abi.ts";
import { runProcess } from "@aphrody/bun-workspace/process";
import { hashFile } from "@aphrody/bun-workspace/hash";
import { findVisualStudio } from "@aphrody/buncc/msvc";

interface Step {
  cmd?: string[];
  copy?: string;
  to?: string;
  timeoutMs?: number;
  capture?: string;
  env?: Record<string, string>;
  checkKernelConfig?: boolean;
}

interface NativeTarget {
  id: string;
  sourceId: string;
  revision: string;
  branch?: string;
  host: "linux" | "win32";
  architecture: "x64";
  abi: string;
  license: string;
  ownerFiles: string[];
  tools: string[];
  pkgConfig: string[];
  externalSources?: { path: string; repository: string; buildArg: string }[];
  portRequired?: boolean;
  requirements: string[];
  steps: Step[];
  artifacts: string[];
  unqualified: string[];
}

interface TargetCatalog {
  schemaVersion: 1;
  minimumFreeBytes: number;
  jobs: 2;
  targets: NativeTarget[];
}

interface NativeConfig {
  baseImage?: string;
  version?: string;
  windowsToolchain?: string;
  externalPins?: Record<string, string>;
}

export interface NativePlan {
  target: NativeTarget;
  variables: Record<string, string>;
  steps: Step[];
  minimumFreeBytes: number;
}

const packageRoot = resolve(import.meta.dir, "..");
const usage = `Pinned native source-owner factory
  plan TARGET [--source CHECKOUT --out NEW_DIRECTORY --config FILE --kernel-config FILE]
  status TARGET --source CHECKOUT --out NEW_DIRECTORY [--config FILE --kernel-config FILE]
  build TARGET --source CHECKOUT --out NEW_DIRECTORY [--factory DIRECTORY --config FILE --kernel-config FILE]
Targets: linux-aphrody-bun, wsl-windows, wslg-system, wsl-kernel, apt-gnu, apt-windows-msvc
Run Linux targets on their Linux factory. Native Windows recipes never start WSL.
APT MSVC steps are a source-port plan; the pinned official revision cannot execute them.`;

function contained(root: string, path: string): string {
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
    throw new Error("Factory path escapes its selected root");
  return target;
}

async function run(
  cmd: string[],
  cwd: string,
  timeout: number,
  log?: string,
  env?: Record<string, string>,
): Promise<string> {
  const writer = log ? await open(log, "wx") : undefined;
  let writes = Promise.resolve();
  try {
    const result = await runProcess(cmd, cwd, {
      env: { ...Bun.env, ...env },
      stdin: "ignore",
      stdout: log ? "discard" : "capture",
      stderr: "discard",
      timeoutMs: timeout,
      maxOutputBytes: log ? 32 * 1024 * 1024 : 1024 * 1024,
      onOutput: writer
        ? async (_channel, bytes) => {
            writes = writes.then(() => writer.writeFile(bytes));
            await writes;
          }
        : undefined,
    });
    if (result.code !== 0) throw new Error(`Factory command failed: ${cmd[0]}${log ? `; log: ${log}` : ""}`);
    return result.stdout.trim();
  } finally {
    await writer?.close();
  }
}

async function cleanPin(source: string, revision: string) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Invalid exact source pin");
  const head = await run(["git", "-C", source, "rev-parse", "HEAD"], packageRoot, 15_000);
  if (head !== revision) throw new Error(`Source HEAD differs from ${revision}`);
  const changes = await run(
    ["git", "-C", source, "status", "--porcelain", "--untracked-files=normal"],
    packageRoot,
    15_000,
  );
  if (changes) throw new Error("Source checkout has concurrent/uncommitted work; select the exact clean owner source");
}

async function digest(path: string) {
  const file = Bun.file(path);
  if (!(await file.exists()) || file.size === 0) throw new Error(`Missing or empty native artifact: ${path}`);
  const bytes = file.size;
  return { bytes, sha256: await hashFile(path, { expectedBytes: bytes }) };
}

export async function nativePlan(id: string, flags: Record<string, string>): Promise<NativePlan> {
  const catalog: TargetCatalog = await Bun.file(join(import.meta.dir, "native-targets.json")).json();
  if (catalog.schemaVersion !== 1 || catalog.jobs !== 2) throw new Error("Invalid native target catalog");
  const target = catalog.targets.find(target => target.id === id);
  if (!target) throw new Error(`Unknown native target: ${id}`);
  const lock = await readLock();
  const source = lock.repositories.find(source => source.id === target.sourceId);
  if (!source || source.revision !== target.revision)
    throw new Error("Native recipe source pin differs from the current source lock");
  const configPath = flags.config ? resolve(flags.config) : undefined;
  const config: NativeConfig = configPath ? await Bun.file(configPath).json() : {};
  const configDirectory = configPath ? dirname(configPath) : packageRoot;
  const variables: Record<string, string> = {
    source: flags.source ? resolve(flags.source) : "{source}",
    out: flags.out ? resolve(flags.out) : "{out}",
    revision: target.revision,
    kernelConfig: flags["kernel-config"] ? resolve(flags["kernel-config"]) : "{kernelConfig}",
    windowsToolchain: config.windowsToolchain
      ? resolve(configDirectory, config.windowsToolchain)
      : "{windowsToolchain}",
    baseImage: config.baseImage ?? "{baseImage}",
    version: config.version ?? "{version}",
    image: `bun-os-wslg:${target.revision.slice(0, 12)}`,
    container: `bun-os-wslg-${crypto.randomUUID()}`,
  };
  for (const external of target.externalSources ?? [])
    variables[external.buildArg] = config.externalPins?.[external.path] ?? `{${external.buildArg}}`;
  const expand = (value: string) =>
    value.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (token, name) => variables[name] ?? token);
  const steps = target.steps.map(step => ({
    ...step,
    cmd: step.cmd?.map(expand),
    copy: step.copy ? expand(step.copy) : undefined,
    to: step.to ? expand(step.to) : undefined,
    env: step.env
      ? Object.fromEntries(Object.entries(step.env).map(([name, value]) => [name, expand(value)]))
      : undefined,
  }));
  return { target, variables, steps, minimumFreeBytes: catalog.minimumFreeBytes };
}

async function prerequisites(plan: NativePlan, flags: Record<string, string>) {
  const { target, variables } = plan;
  if (process.platform !== target.host || process.arch !== target.architecture)
    throw new Error(`Target requires a native ${target.host}/${target.architecture} execution context`);
  if (!flags.source || !flags.out) throw new Error("Factory execution requires explicit --source and --out paths");
  if (target.portRequired)
    throw new Error(`Official APT source needs its native MSVC/UCRT port first:\n${target.requirements.join("\n")}`);
  const source = variables.source!;
  const out = variables.out!;
  await cleanPin(source, target.revision);
  for (const file of target.ownerFiles)
    if (!(await Bun.file(join(source, file)).exists())) throw new Error(`Missing owner source: ${file}`);
  for (const tool of target.tools) if (!Bun.which(tool)) throw new Error(`Missing native prerequisite: ${tool}`);
  for (const module of target.pkgConfig) await run(["pkg-config", "--exists", module], source, 15_000);
  if (target.id === "linux-aphrody-bun" || target.id === "wsl-kernel") {
    if (target.id === "linux-aphrody-bun" && !flags["kernel-config"])
      throw new Error("Linux aphrody-bun requires --kernel-config");
    const file = Bun.file(
      target.id === "wsl-kernel" ? join(source, "arch/x86/configs/aphrody_wsl_defconfig") : variables.kernelConfig!,
    );
    if (!(await file.exists()) || file.size > 1024 * 1024) throw new Error("Missing or oversized kernel configuration");
    const config = await file.text();
    if (
      !/^CONFIG_RUST=y$/m.test(config) ||
      !/^CONFIG_BUN_ACCEL=[ym]$/m.test(config) ||
      (target.id === "linux-aphrody-bun" && !/^CONFIG_X86_64=y$/m.test(config)) ||
      (target.id === "wsl-kernel" && !/^CONFIG_BUN_ACCEL=y$/m.test(config))
    )
      throw new Error("Kernel configuration must select Rust and Bun acceleration for the owner architecture");
    const sysroot = await run(["rustc", "--print", "sysroot"], source, 15_000);
    if (Bun.env.RUST_LIB_SRC && !isAbsolute(Bun.env.RUST_LIB_SRC))
      throw new Error("RUST_LIB_SRC must be absolute when configured");
    const rustSources = Bun.env.RUST_LIB_SRC ?? join(sysroot, "lib/rustlib/src/rust/library");
    if (!(await Bun.file(join(rustSources, "core/src/lib.rs")).exists()))
      throw new Error("Kernel Rust requires matching rust-src or an explicit RUST_LIB_SRC");
  }
  if (target.id === "wsl-windows") {
    if (await Bun.file(join(source, "UserConfig.cmake")).exists())
      throw new Error("UserConfig.cmake may enable automatic deployment; select a clean build source without it");
    // Upstream Bun has no MSVC command: buncc's msvc provider asks vswhere for a Visual Studio with the x64 C++ tools.
    if (!(await findVisualStudio()))
      throw new Error("WSL requires Visual Studio with the MSVC v143 x64 tools (vswhere found none)");
    const version = await run(["cmake", "--version"], source, 15_000);
    const match = /cmake version (\d+)\.(\d+)/.exec(version);
    if (!match || Number(match[1]) < 3 || (Number(match[1]) === 3 && Number(match[2]) < 25))
      throw new Error("WSL requires CMake 3.25 or newer");
  }
  if (target.id === "apt-gnu") {
    if (!Bun.which("getconf")) throw new Error("GNU APT needs a glibc host and getconf");
    const libc = await run(["getconf", "GNU_LIBC_VERSION"], source, 15_000);
    if (!/^glibc \d+\.\d+/.test(libc)) throw new Error("APT GNU recipe requires glibc");
    await run(["perl", "-MDpkg", "-e", "print $Dpkg::DATADIR"], source, 15_000);
    for (const library of ["libdb.so", "libbz2.so"]) {
      const path = await run(["g++", `-print-file-name=${library}`], source, 15_000);
      if (!isAbsolute(path) || !(await Bun.file(path).exists())) throw new Error(`Missing GNU APT library: ${library}`);
    }
  }
  if (target.id === "wslg-system") {
    if (!/@sha256:[a-f0-9]{64}$/.test(variables.baseImage!) || /[{}]/.test(variables.baseImage!))
      throw new Error("WSLg requires an immutable baseImage digest in --config");
    if (!/^[0-9][0-9A-Za-z.+-]*$/.test(variables.version!))
      throw new Error("WSLg requires an explicit version in --config");
    for (const external of target.externalSources!)
      await cleanPin(join(source, external.path), variables[external.buildArg]!);
    const system = await run(["docker", "info", "--format", "{{.OSType}}"], source, 30_000);
    if (system !== "linux") throw new Error("WSLg requires a live Linux Docker daemon on this factory");
  }
  try {
    await lstat(out);
    throw new Error("Native output directory already exists; refusing replacement");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let parent = dirname(out);
  for (;;) {
    try {
      await lstat(parent);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const next = dirname(parent);
      if (next === parent) throw error;
      parent = next;
    }
  }
  const filesystem = await statfs(parent, { bigint: true });
  const canonicalOut = join(await realpath(parent), relative(parent, out));
  const rel = relative(await realpath(source), canonicalOut);
  if (!rel || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`)))
    throw new Error("Build output must be outside the source checkout, including resolved links");
  const free = filesystem.bavail * filesystem.bsize;
  if (free < BigInt(plan.minimumFreeBytes)) throw new Error("Native factory requires at least 50 GiB free");
  return { freeBytes: free.toString(), sourcePinVerified: true, runtimeQualified: false };
}

export async function nativeBuild(plan: NativePlan, flags: Record<string, string>) {
  const state = await prerequisites(plan, flags);
  const out = plan.variables.out!;
  const factory = flags.factory ? resolve(flags.factory) : dirname(out);
  const factoryRel = relative(factory, out);
  if (!factoryRel || factoryRel === ".." || factoryRel.startsWith(`..${sep}`) || isAbsolute(factoryRel))
    throw new Error("Output must be inside its selected factory directory");
  if (plan.target.host === "linux") {
    const profile: { sharedHeavyLockRelative: string } = await Bun.file(join(import.meta.dir, "profile.json")).json();
    if (!profile.sharedHeavyLockRelative || isAbsolute(profile.sharedHeavyLockRelative))
      throw new Error("Missing relative shared Linux factory lock");
    const heavyLock = resolve(factory, profile.sharedHeavyLockRelative);
    if (!Bun.which("flock"))
      throw new Error("Linux native builds require flock to coordinate the existing heavy owner");
    if (!(await lstat(dirname(heavyLock))).isDirectory())
      throw new Error("Shared heavy lock directory must already be provisioned by the factory owner");
    if (Bun.env.BUN_OS_NATIVE_LOCK_HELD !== heavyLock) {
      const args = Object.entries(flags).flatMap(([name, value]) => [`--${name}`, value]);
      const timeout = plan.steps.reduce((total, step) => total + (step.timeoutMs ?? 0), 300_000);
      const output = await run(
        ["flock", "-n", heavyLock, process.execPath, import.meta.path, "build", plan.target.id, ...args],
        packageRoot,
        timeout,
        undefined,
        { BUN_OS_NATIVE_LOCK_HELD: heavyLock },
      );
      return JSON.parse(output);
    }
  }
  await mkdir(factory, { recursive: true });
  const lockPath = join(factory, ".factory.lock");
  const lock = await open(lockPath, "wx");
  const token = JSON.stringify({ pid: process.pid, target: plan.target.id, out, token: crypto.randomUUID() });
  try {
    await lock.writeFile(token + "\n");
    await mkdir(out);
    await mkdir(join(out, "logs"));
    await mkdir(join(out, "build"));
    if (plan.target.id === "wsl-kernel") await mkdir(join(out, "perf-build"));
    await Bun.write(join(out, "plan.json"), JSON.stringify({ ...plan, state }, null, 2) + "\n");
    const variables = { ...plan.variables };
    for (let index = 0; index < plan.steps.length; index++) {
      const step = plan.steps[index]!;
      const expand = (value: string) =>
        value.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (token, name) => variables[name] ?? token);
      if (step.copy && step.to) {
        const destination = contained(out, expand(step.to));
        const input = Bun.file(expand(step.copy));
        if (!(await input.exists()) || input.size > 1024 * 1024)
          throw new Error("Missing or oversized configuration input");
        const file = await open(destination, "wx");
        try {
          await file.writeFile(new Uint8Array(await input.arrayBuffer()));
        } finally {
          await file.close();
        }
      } else if (step.cmd && step.timeoutMs) {
        const cmd = step.cmd.map(expand);
        if (cmd.some(arg => /\{[A-Za-z_][A-Za-z0-9_]*\}/.test(arg)))
          throw new Error("Native build command has unresolved inputs");
        const env = step.env
          ? Object.fromEntries(Object.entries(step.env).map(([name, value]) => [name, expand(value)]))
          : undefined;
        const output = await run(
          cmd,
          out,
          step.timeoutMs,
          step.capture ? undefined : join(out, "logs", `${index + 1}.log`),
          env,
        );
        if (step.capture) {
          if (!/^[A-Za-z0-9._+-]+$/.test(output)) throw new Error("Unexpected captured kernel release");
          variables[step.capture] = output;
        }
        if (step.checkKernelConfig) {
          const config = await Bun.file(join(out, "build/.config")).text();
          if (
            !/^CONFIG_X86_64=y$/m.test(config) ||
            !/^CONFIG_RUST=y$/m.test(config) ||
            !/^CONFIG_BUN_ACCEL=[ym]$/m.test(config) ||
            (plan.target.id === "wsl-kernel" && !/^CONFIG_BUN_ACCEL=y$/m.test(config))
          )
            throw new Error(
              "Resolved kernel configuration dropped its required architecture, Rust or Bun acceleration",
            );
        }
      } else throw new Error("Invalid native build step");
    }
    const artifacts = [];
    for (const path of plan.target.artifacts) {
      const artifact = contained(out, path);
      const identity = await digest(artifact);
      const pe = path.endsWith("wsl.exe");
      if (pe && identity.bytes > 256 * 1024 * 1024)
        throw new Error("Native PE artifact exceeds the bounded inspection size");
      const bytes = pe
        ? new Uint8Array(await Bun.file(artifact).arrayBuffer())
        : new Uint8Array(await Bun.file(artifact).slice(0, 64).arrayBuffer());
      const inspected = pe || path.endsWith("vmlinux") || path.startsWith("stage/usr/bin/") ? abi(bytes) : undefined;
      if (
        pe &&
        (inspected?.format !== "pe" ||
          inspected.architecture !== "x64" ||
          inspected.runtime !== "windows" ||
          !inspected.executable)
      )
        throw new Error("WSL artifact is not the expected native Windows PE x64 executable");
      if (
        (path.endsWith("vmlinux") || path.startsWith("stage/usr/bin/")) &&
        (inspected?.format !== "elf" || inspected.architecture !== "x64")
      )
        throw new Error("GNU/kernel artifact is not the expected ELF x64 file");
      artifacts.push({ path, ...identity, abi: inspected });
    }
    const receipt = {
      schemaVersion: 1,
      target: plan.target.id,
      revision: plan.target.revision,
      artifactAbi: plan.target.abi,
      artifacts,
      sourcePinVerified: true,
      runtimeQualified: false,
      unqualified: plan.target.unqualified,
    };
    await Bun.write(join(out, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
    return receipt;
  } finally {
    await lock.close();
    const file = Bun.file(lockPath);
    if ((await file.exists()) && (await file.text()).trim() === token) await unlink(lockPath);
  }
}

async function main() {
  const args = Bun.argv.slice(2);
  const action = args.shift();
  if (!action || action === "--help" || action === "help") {
    console.log(usage);
    return;
  }
  const id = args.shift();
  if (!id || !["plan", "status", "build"].includes(action)) throw new Error(usage);
  const flags: Record<string, string> = Object.create(null);
  while (args.length) {
    const flag = args.shift()!;
    const value = args.shift();
    const name = flag.slice(2);
    if (
      !flag.startsWith("--") ||
      !["source", "out", "config", "kernel-config", "factory"].includes(name) ||
      !value ||
      value.startsWith("--") ||
      flags[name]
    )
      throw new Error(`Invalid native factory option ${flag}`);
    flags[name] = value;
  }
  const plan = await nativePlan(id, flags);
  const result =
    action === "plan" ? plan : action === "status" ? await prerequisites(plan, flags) : await nativeBuild(plan, flags);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main)
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
