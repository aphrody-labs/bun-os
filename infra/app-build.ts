// SPDX-License-Identifier: MIT
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { hostname } from "node:os";
import { isBuiltin } from "node:module";
import { appCapabilityForLibrary, appHostnamesForLibrary } from "@aphrody/bun-workspace/capabilities";
import { loadConfig as loadLibraryConfig, runtimePinFor, type RuntimeTarget } from "@aphrody/bun-workspace";
import { runProcess } from "@aphrody/bun-workspace/process";
import { command, identity, packageRoot, type RuntimeReceipt } from "../src/distribution.ts";
import { inspectLinuxABI } from "../src/elf.ts";
import { abi } from "../packages/package-converter/src/abi.ts";
import {
  collectAssets,
  MAX_OBJECT_BYTES,
  inside,
  protectedInput,
  readInventory,
  workspace,
  type AssetInventory,
  type AssetPlan,
} from "./assets.ts";

export type AppTarget = "windows-x64" | "linux-x64" | "linux-arm64" | "macos-arm64";
export interface RuntimeSnapshot {
  path: string;
  sha256: string;
  revision: string;
  version: string;
  qualificationReceipt?: string;
}
export interface NativeDependency {
  path: string;
  sha256: string;
  name?: string;
  role?: "library" | "executable";
  abi?: string;
  minimumGlibc?: string;
}
export interface NativeArtifact extends NativeDependency {
  sourceRevision: string;
  qualificationReceipt: string;
  dependencies?: NativeDependency[];
  systemLibraries?: string[];
  abi?: string;
  minimumGlibc?: string;
}
export interface AppEntry {
  id: string;
  kind: "native-cli" | "bun-cli" | "bun-server";
  hostname?: string;
  hostnames?: string[];
  workspace: string;
  entrypoint: string;
  entrypointWorkspace?: string;
  assetRoots: string[];
  source?: { repository: string; revision?: string; path: string; license: string };
  native: {
    required: boolean;
    binary?: string | null;
    artifactsByTarget?: Partial<Record<AppTarget, NativeArtifact>>;
  };
  externalContext?: string[];
}
export interface AppInventory extends AssetInventory {
  targets: AppTarget[];
  apps: AppEntry[];
  runtimeSnapshots?: Partial<Record<AppTarget, RuntimeSnapshot>>;
}
export interface OwnerWorkspace {
  repository: "aphrody-labs/bun-distribution";
  checkout: string;
  expectedRevision: string;
  revision: string;
  clean: boolean;
}
export interface EmbeddedNativeFile {
  path: string;
  name: string;
  sha256: string;
  bytes: number;
  kind: "backend" | "dependency";
  role: "library" | "executable";
  abi?: string;
  minimumGlibc?: string;
}
export interface NativeLaunchContract {
  appId: string;
  target: AppTarget;
  files: Omit<EmbeddedNativeFile, "path">[];
}
export interface AppPlan {
  schemaVersion: 1;
  kind: "app-build-plan";
  configPath: string;
  configSHA256: string;
  app: AppEntry;
  hostnames: string[];
  target: AppTarget;
  cwd: string;
  entrypoint: string;
  outputRoot: string;
  status: "prepared" | "blocked";
  reasons: string[];
  ownerWorkspace?: OwnerWorkspace;
  buildOwner?: { repository: "aphrody-labs/bun-distribution"; capability: string };
  compiler?: {
    repository: "aphrody-labs/bun-distribution";
    checkout: string;
    path: "packages/bun-artifacts/src/compiler.ts";
    revision: string;
    sha256: string;
  };
  runtime?: {
    path: string;
    bytes: number;
    sha256: string;
    version: string;
    revision: string;
    metadataExecution: string;
    reportedSourceUrl?: string;
  };
  nativeFiles: EmbeddedNativeFile[];
  nativeEvidence?: unknown;
  assets: AssetPlan;
  qualification: { binaryBuilt: false; deployed: false };
}
function runtimePath(configPath: string, path: string | undefined): string {
  if (!path) return process.execPath;
  const installRelative = /^\$BUN_INSTALL[\\/](.+)$/.exec(path);
  if (installRelative) {
    const install = Bun.env.BUN_INSTALL?.trim();
    if (!install) throw new Error("BUN_INSTALL is required by the configured runtime snapshot");
    return resolve(install, installRelative[1]!);
  }
  return resolve(dirname(configPath), path);
}
export function nativeTarget(): AppTarget | undefined {
  if (process.platform === "win32" && process.arch === "x64") return "windows-x64";
  if (process.platform === "linux" && ["x64", "arm64"].includes(process.arch))
    return ("linux-" + process.arch) as AppTarget;
  if (process.platform === "darwin" && process.arch === "arm64") return "macos-arm64";
}
function libraryRuntimeTarget(target: AppTarget): RuntimeTarget {
  return (target === "macos-arm64" ? "darwin-arm64" : target) as RuntimeTarget;
}
export async function executableABI(path: string, target: AppTarget, library = false) {
  const size = (await lstat(path)).size;
  if (size > 512 * 1024 * 1024) throw new Error("Executable exceeds the pinned inspection limit");
  const actual = abi(await Bun.file(path).bytes());
  const expected = target.endsWith("arm64") ? "arm64" : "x64";
  if (target === "macos-arm64") throw new Error("The shared ABI owner does not yet qualify Mach-O");
  if (actual.architecture !== expected || actual.bits !== 64)
    throw new Error("Executable architecture differs from its target");
  if (target === "windows-x64") {
    if (actual.format !== "pe" || actual.runtime !== "windows" || (library ? !actual.library : !actual.executable))
      throw new Error("Windows target needs a qualified native PE artifact; alternate runtimes remain distinct");
    return actual;
  }
  if (actual.format !== "elf") throw new Error("Linux target needs ELF artifact evidence");
  return library ? actual : { ...actual, ...(await inspectLinuxABI(path, expected)) };
}
async function snapshot(configPath: string, config: AppInventory, target: AppTarget) {
  const selected = config.runtimeSnapshots?.[target];
  const path = await realpath(runtimePath(configPath, selected?.path));
  if (protectedInput(path)) throw new Error("Runtime snapshot points to a protected store");
  const digest = await identity(path);
  await executableABI(path, target);
  if (selected && (!/^[a-f0-9]{64}$/.test(selected.sha256) || selected.sha256 !== digest.sha256))
    throw new Error("Runtime snapshot checksum mismatch");
  if (!selected && target !== nativeTarget())
    throw new Error("Cross-target builds need an explicitly qualified runtime snapshot");
  if (target === nativeTarget()) {
    const metadata = JSON.parse(
      await command(
        [
          path,
          "--eval",
          "console.log(JSON.stringify({version:Bun.version,revision:Bun.revision,sourceUrl:process.release.sourceUrl,platform:process.platform,arch:process.arch}))",
        ],
        dirname(path),
        15_000,
      ),
    );
    if (
      !/^[a-f0-9]{40}$/.test(metadata.revision) ||
      !String(metadata.sourceUrl).startsWith("https://github.com/oven-sh/bun/releases/download/") ||
      metadata.revision !== Bun.revision ||
      (selected && (selected.revision !== metadata.revision || selected.version !== metadata.version))
    )
      throw new Error("The selected runtime and compiler provenance do not agree");
    const after = await identity(path);
    if (after.sha256 !== digest.sha256) throw new Error("Runtime changed during metadata qualification");
    return {
      path,
      ...digest,
      version: metadata.version as string,
      revision: metadata.revision as string,
      metadataExecution: "native-host",
      reportedSourceUrl: metadata.sourceUrl as string,
    };
  }
  if (!selected?.qualificationReceipt)
    throw new Error("Cross-target runtime needs native target qualification evidence");
  const receiptPath = await realpath(resolve(dirname(configPath), selected.qualificationReceipt));
  if (protectedInput(receiptPath)) throw new Error("Runtime receipt points to a protected store");
  const receipt = (await Bun.file(receiptPath).json()) as RuntimeReceipt;
  if (
    receipt.schemaVersion !== 1 ||
    receipt.repository !== "oven-sh/bun" ||
    receipt.target !== target ||
    receipt.sha256 !== digest.sha256 ||
    receipt.bytes !== digest.bytes ||
    receipt.revision !== selected.revision ||
    receipt.version !== selected.version ||
    receipt.revision !== Bun.revision ||
    !receipt.qualification?.passed ||
    !receipt.qualification.gates.includes("native-runtime")
  )
    throw new Error("Cross-target snapshot receipt does not match its exact bytes, target and compiler");
  return {
    path,
    ...digest,
    version: receipt.version,
    revision: receipt.revision,
    metadataExecution: "qualified-target-receipt",
  };
}
async function nativeArtifacts(configPath: string, app: AppEntry, target: AppTarget) {
  const source = app.source;
  if (!source) throw new Error("Native artifact source metadata is missing");
  const descriptor = app.native.artifactsByTarget?.[target];
  if (!app.native.binary) throw new Error("No native executable capability owner is configured for this app");
  if (!descriptor) throw new Error("Native backend has no qualified artifact descriptor");
  if (!source.revision || descriptor.sourceRevision !== source.revision) throw new Error("Native source pin mismatch");
  const files: EmbeddedNativeFile[] = [],
    basenames = new Set<string>();
  for (const [index, input] of [descriptor, ...(descriptor.dependencies ?? [])].entries()) {
    const path = await realpath(resolve(dirname(configPath), input.path));
    if (protectedInput(path)) throw new Error("Native payload points to a protected store");
    const digest = await identity(path);
    if (digest.bytes < 1 || digest.bytes > MAX_OBJECT_BYTES)
      throw new Error("Native payload exceeds the standalone materialization limit");
    if (digest.sha256 !== input.sha256) throw new Error("Native payload checksum mismatch");
    const name = input.name ?? basename(path);
    if (!/^[a-zA-Z0-9_.+-]+$/.test(name) || basenames.has(name.toLowerCase()))
      throw new Error("Native loader filenames must be unique");
    basenames.add(name.toLowerCase());
    await executableABI(path, target, index > 0 && input.role !== "executable");
    files.push({
      path,
      name,
      ...digest,
      kind: index ? "dependency" : "backend",
      role: index ? (input.role ?? "library") : "executable",
      abi: input.abi,
      minimumGlibc: input.minimumGlibc,
    });
  }
  const receiptPath = await realpath(resolve(dirname(configPath), descriptor.qualificationReceipt));
  if (protectedInput(receiptPath)) throw new Error("Native receipt points to a protected store");
  const receipt = await Bun.file(receiptPath).json();
  if (
    receipt.schemaVersion !== 1 ||
    receipt.target !== target ||
    receipt.sha256 !== files[0]!.sha256 ||
    receipt.source?.repository !== source.repository ||
    receipt.source?.revision !== descriptor.sourceRevision ||
    !receipt.qualification?.passed ||
    !receipt.qualification.gates?.includes("native-backend") ||
    !receipt.qualification.gates?.includes("native-dependency-closure")
  )
    throw new Error("Native backend needs a matching source, artifact and dependency qualification receipt");
  const dependencies = files
    .slice(1)
    .map(({ name, sha256, bytes, role, abi, minimumGlibc }) => ({
      name,
      sha256,
      bytes,
      role,
      abi,
      minimumGlibc,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const declared = (receipt.dependencies ?? [])
    .map(
      (file: {
        name: string;
        sha256: string;
        bytes: number;
        role?: "library" | "executable";
        abi?: string;
        minimumGlibc?: string;
      }) => ({
        name: file.name,
        sha256: file.sha256,
        bytes: file.bytes,
        role: file.role ?? "library",
        abi: file.abi,
        minimumGlibc: file.minimumGlibc,
      }),
    )
    .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
  if (
    JSON.stringify(dependencies) !== JSON.stringify(declared) ||
    JSON.stringify([...(descriptor.systemLibraries ?? [])].sort()) !==
      JSON.stringify([...(receipt.systemLibraries ?? [])].sort()) ||
    (descriptor.abi && receipt.abi !== descriptor.abi) ||
    (descriptor.minimumGlibc && receipt.minimumGlibc !== descriptor.minimumGlibc)
  )
    throw new Error("Native dependency closure or ABI version differs from its qualified producer receipt");
  return {
    files,
    evidence: {
      receipt: descriptor.qualificationReceipt,
      abi: descriptor.abi,
      minimumGlibc: descriptor.minimumGlibc,
      systemLibraries: descriptor.systemLibraries ?? [],
      source: receipt.source,
    },
  };
}
export async function planApp(configPath: string, appId: string, target: AppTarget): Promise<AppPlan> {
  configPath = resolve(configPath);
  const config = (await readInventory(configPath)) as AppInventory;
  const app = config.apps.find(app => app.id === appId);
  if (!app || !config.targets.includes(target)) throw new Error("Unknown app or target");
  const ownsNativeBuild = app.workspace === "os" && app.kind === "native-cli";
  const artifactRoot = await workspace(configPath, config, "os");
  const libraryRoot = ownsNativeBuild ? artifactRoot : undefined;
  const root = libraryRoot ?? (await workspace(configPath, config, app.entrypointWorkspace ?? app.workspace));
  const reasons: string[] = [];
  let ownerWorkspace: OwnerWorkspace | undefined;
  try {
    ownerWorkspace = await inspectOwnerWorkspace(artifactRoot);
    if (!ownerWorkspace.clean) throw new Error("Bun OS workspace has uncommitted or untracked source changes");
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "Bun OS workspace revision is unavailable");
  }
  let resolvedHostnames: string[];
  let librarySourceRevision: string | undefined;
  let resolvedSource = app.source;
  if (ownsNativeBuild) {
    const libraryConfig = await loadLibraryConfig(libraryRoot!);
    const capability = appCapabilityForLibrary(app.id);
    const module = libraryConfig.modules.find(module => module.id === app.id);
    resolvedHostnames = appHostnamesForLibrary(app.id, libraryConfig);
    if (!capability || !module?.binary) reasonsForMissingOwner(app.id);
    if (!module.fork || !module.path || !module.license || !module.revision)
      throw new Error("Bun OS source metadata is incomplete");
    resolvedSource = {
      repository: module.fork,
      revision: module.revision,
      path: module.path,
      license: module.license,
    };
    librarySourceRevision = module.revision;
    if (app.hostname && !resolvedHostnames.includes(app.hostname))
      throw new Error("Configured application hostname differs from the library owner");
  } else {
    if (!resolvedSource) throw new Error("A source record is required for non-library applications");
    if (!app.hostname) throw new Error("A hostname is required for non-library applications");
    resolvedHostnames = [app.hostname];
  }
  const capability = ownsNativeBuild ? appCapabilityForLibrary(app.id) : undefined;
  const resolvedApp = {
    ...app,
    source: resolvedSource,
    hostname: resolvedHostnames[0]!,
    hostnames: resolvedHostnames,
  };
  let entrypoint = inside(root, resolve(root, ownsNativeBuild ? "scripts/build-apps.ts" : app.entrypoint));
  let compiler: AppPlan["compiler"] | undefined;
  try {
    const compilerPath = inside(artifactRoot, join(artifactRoot, "packages/bun-artifacts/src/compiler.ts"));
    const compilerRevision = await command(["git", "rev-parse", "HEAD"], artifactRoot);
    const compilerStatus = await command(
      ["git", "status", "--porcelain", "--", "packages/bun-artifacts/src/compiler.ts"],
      artifactRoot,
    );
    const compilerOrigin = await command(["git", "remote", "get-url", "origin"], artifactRoot);
    if (!(await Bun.file(compilerPath).exists())) throw new Error("Shared compiler source is absent");
    if (compilerStatus) throw new Error("Bun OS compiler checkout has uncommitted changes");
    assertProductOrigin(compilerOrigin);
    if (compilerRevision !== ownerWorkspace?.revision)
      throw new Error("Shared compiler revision differs from the planned product");
    compiler = {
      repository: "aphrody-labs/bun-distribution",
      checkout: artifactRoot,
      path: "packages/bun-artifacts/src/compiler.ts",
      revision: compilerRevision,
      sha256: (await identity(compilerPath)).sha256,
    };
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "Shared standalone compiler unavailable");
  }
  if (!(await Bun.file(entrypoint).exists())) reasons.push("Configured entrypoint is absent");
  else entrypoint = inside(root, await realpath(entrypoint));
  if (protectedInput(entrypoint)) reasons.push("Entrypoint points to a protected store");
  if (app.externalContext?.length) reasons.push("Unresolved external context: " + app.externalContext.join(", "));
  let assets: AssetPlan;
  try {
    assets = await collectAssets(configPath, [app.id]);
  } catch (error) {
    reasons.push(
      error instanceof Error ? `Asset inventory unavailable: ${error.message}` : "Asset inventory unavailable",
    );
    assets = {
      schemaVersion: 1,
      kind: "app-asset-plan",
      configSHA256: (await identity(configPath)).sha256,
      storage: config.storage.assets,
      objects: [],
      apps: [{ id: app.id, assets: [] }],
      qualification: { uploaded: false, publicDelivery: false },
    };
  }
  let runtime: AppPlan["runtime"],
    nativeFiles: EmbeddedNativeFile[] = [],
    nativeEvidence: unknown;
  try {
    runtime = await snapshot(configPath, config, target);
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "Runtime snapshot unavailable");
  }
  if (capability) {
    nativeEvidence = {
      owner: "@aphrody/bun-artifacts",
      capability: capability.id,
      sourceRevision: librarySourceRevision,
    };
  } else if (app.native.required) {
    try {
      const selected = await nativeArtifacts(configPath, resolvedApp, target);
      nativeFiles = selected.files;
      nativeEvidence = selected.evidence;
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : "Native backend unqualified");
    }
  }
  return {
    schemaVersion: 1,
    kind: "app-build-plan",
    configPath,
    configSHA256: (await identity(configPath)).sha256,
    app: resolvedApp,
    hostnames: resolvedHostnames,
    target,
    cwd: root,
    entrypoint,
    outputRoot: resolve(dirname(configPath), config.build?.outputRoot ?? "../../build/bun-os-apps"),
    status: reasons.length ? "blocked" : "prepared",
    reasons,
    ...(ownerWorkspace ? { ownerWorkspace } : {}),
    ...(capability
      ? {
          buildOwner: {
            repository: "aphrody-labs/bun-distribution" as const,
            capability: capability.id,
          },
        }
      : {}),
    ...(compiler ? { compiler } : {}),
    runtime,
    nativeFiles,
    nativeEvidence,
    assets,
    qualification: { binaryBuilt: false, deployed: false },
  };
}
function reasonsForMissingOwner(appId: string): never {
  throw new Error("Bun OS has no native application capability for " + appId);
}

function assertProductOrigin(origin: string): void {
  const knownOrigins = new Set([
    "https://github.com/aphrody-labs/bun-distribution",
    "https://github.com/aphrody-labs/bun-distribution.git",
    "git@github.com:aphrody-labs/bun-distribution",
    "git@github.com:aphrody-labs/bun-distribution.git",
    "bun-forge:aphrody-dev/bun-distribution.git",
    "https://source.aphrody.app/aphrody-dev/bun-distribution.git",
    "ssh://git@source.aphrody.app/aphrody-dev/bun-distribution.git",
    "git@source.aphrody.app:aphrody-dev/bun-distribution.git",
    // aphrody-labs/bun-distribution was renamed aphrody-labs/bun-os on 2026-10-25.
    "https://github.com/aphrody-labs/bun-os",
    "https://github.com/aphrody-labs/bun-os.git",
    "git@github.com:aphrody-labs/bun-os",
    "git@github.com:aphrody-labs/bun-os.git",
    "bun-forge:aphrody-dev/bun-os.git",
    "git@bun-forge:aphrody-dev/bun-os.git",
    "https://source.aphrody.app/aphrody-dev/bun-os.git",
    "ssh://git@source.aphrody.app/aphrody-dev/bun-os.git",
    "git@source.aphrody.app:aphrody-dev/bun-os.git",
  ]);
  if (!knownOrigins.has(origin)) throw new Error("Bun OS workspace is outside its product owner");
}

async function inspectOwnerWorkspace(checkout: string, expectedRevision?: string): Promise<OwnerWorkspace> {
  const [revision, status, origin] = await Promise.all([
    command(["git", "rev-parse", "HEAD"], checkout),
    command(["git", "status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"], checkout),
    command(["git", "remote", "get-url", "origin"], checkout),
  ]);
  assertProductOrigin(origin);
  const pinnedRevision = expectedRevision ?? revision;
  if (!/^[a-f0-9]{40}$/.test(pinnedRevision)) throw new Error("A full product source revision is required");
  await command(["git", "merge-base", "--is-ancestor", pinnedRevision, revision], checkout);
  return {
    repository: "aphrody-labs/bun-distribution",
    checkout,
    expectedRevision: pinnedRevision,
    revision,
    clean: status === "",
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function buildLibraryApp(configPath: string, appId: string, target: AppTarget, requestedOutput?: string) {
  const config = (await readInventory(configPath)) as AppInventory;
  const app = config.apps.find(entry => entry.id === appId);
  const capability = appCapabilityForLibrary(appId);
  if (!app || app.kind !== "native-cli" || !capability) throw new Error("No Bun OS app owner is configured");
  const plan = await planApp(configPath, appId, target);
  if (plan.status !== "prepared" || !plan.runtime) throw new Error(plan.reasons.join("; "));
  const libraryRoot = await workspace(configPath, config, "os");
  const currentOwnerWorkspace = await inspectOwnerWorkspace(libraryRoot, plan.ownerWorkspace!.expectedRevision);
  if (!currentOwnerWorkspace.clean || currentOwnerWorkspace.revision !== plan.ownerWorkspace!.revision)
    throw new Error("Bun OS workspace changed after app planning; plan the build again");
  const libraryConfig = await loadLibraryConfig(libraryRoot);
  const targetRuntime = runtimePinFor(libraryConfig, libraryRuntimeTarget(target));
  if (targetRuntime.version !== plan.runtime.version || targetRuntime.revision !== plan.runtime.revision)
    throw new Error("Bun OS and distribution runtime pins differ");
  const output = resolve(
    requestedOutput ?? join(packageRoot, "build/apps", appId, new Date().toISOString().replace(/[:.]/g, "")),
  );
  try {
    await lstat(output);
    throw new Error("Choose a fresh app output directory");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(join(output, "logs"), { recursive: true });
  const ownerOutput = join(
    libraryRoot,
    "build/staging/app-owner",
    appId + "-" + new Date().toISOString().replace(/[:.]/g, ""),
  );
  const ownerRelative = relative(libraryRoot, ownerOutput).replaceAll("\\", "/");
  if (ownerRelative.startsWith("../") || isAbsolute(ownerRelative))
    throw new Error("Bun OS output left its owner checkout");
  const pinPath = join(ownerOutput, "runtime-pin.json");
  const outputRelative = join(ownerRelative, "artifacts").replaceAll("\\", "/");
  const reportRelative = join(ownerRelative, "build-report.json").replaceAll("\\", "/");
  const targetName = target === "macos-arm64" ? "bun-darwin-arm64" : (("bun-" + target) as string);
  const artifactTarget = join(libraryRoot, "scripts/build-apps.ts");
  await mkdir(ownerOutput, { recursive: true });
  await Bun.write(
    pinPath,
    JSON.stringify(
      {
        version: targetRuntime.version,
        repository: targetRuntime.repository,
        revision: targetRuntime.revision,
      },
      null,
      2,
    ) + "\n",
  );
  const sharedAssets = join(libraryRoot, ".local/assets/reference.json");
  if (!(await Bun.file(sharedAssets).exists()))
    throw new Error("The shared R2 asset manifest reference is unavailable");
  const args = [
    process.execPath,
    artifactTarget,
    "build",
    "--app",
    capability.id,
    "--target",
    targetName,
    "--bun",
    plan.runtime.path,
    "--runtime-pin",
    pinPath,
    "--shared-assets",
    sharedAssets,
    "--root",
    libraryRoot,
    "--output",
    outputRelative,
    "--report",
    reportRelative,
    "--host",
    hostname(),
    "--mode",
    "native",
  ];
  const result = await runProcess(args, libraryRoot, {
    timeoutMs: Math.min(Math.max(config.build?.timeoutSeconds ?? 600, 2_580), 43_200) * 1000,
    maxOutputBytes: 4 * 1024 * 1024,
    env: { ...Bun.env, BUN_BE_BUN: undefined },
  });
  const finishedOwner = await inspectOwnerWorkspace(libraryRoot, plan.ownerWorkspace!.expectedRevision);
  if (!finishedOwner.clean || finishedOwner.revision !== plan.ownerWorkspace!.revision)
    throw new Error("Bun OS workspace changed during application compilation");
  await Bun.write(join(output, "logs/build.stdout"), result.stdout);
  await Bun.write(join(output, "logs/build.stderr"), result.stderr);
  const reportValue: unknown = (await Bun.file(join(libraryRoot, reportRelative)).json()) as unknown;
  if (!record(reportValue) || reportValue.complete !== true || !Array.isArray(reportValue.results))
    throw new Error("Bun OS artifact build did not produce a complete report");
  const built = reportValue.results[0];
  if (!record(built) || built.appId !== capability.id || built.status !== "built" || built.extraction !== "qualified")
    throw new Error("Bun OS did not qualify the standalone application artifact");
  if (!record(built.artifact)) throw new Error("Bun OS artifact receipt is incomplete");
  const artifact = built.artifact;
  if (!record(artifact.manifest) || !Array.isArray(artifact.manifest.native))
    throw new Error("Bun OS artifact manifest is incomplete");
  const manifest = artifact.manifest;
  if (
    typeof artifact.path !== "string" ||
    typeof artifact.sha256 !== "string" ||
    typeof artifact.size !== "number" ||
    typeof manifest.runtime !== "object" ||
    !record(manifest.runtime)
  )
    throw new Error("Bun OS artifact identity or runtime receipt is invalid");
  const runtime = manifest.runtime;
  if (typeof runtime.version !== "string" || typeof runtime.revision !== "string" || typeof runtime.sha256 !== "string")
    throw new Error("Bun OS runtime receipt is invalid");
  if (
    runtime.version !== plan.runtime.version ||
    runtime.revision !== plan.runtime.revision ||
    !record(manifest.app) ||
    manifest.app.id !== capability.id ||
    manifest.target !== targetName ||
    !record(manifest.source) ||
    manifest.source.revision !== plan.app.source?.revision ||
    manifest.hostname !== plan.app.hostname
  )
    throw new Error("Bun OS artifact manifest differs from the prepared distribution plan");
  const artifactPath = resolve(libraryRoot, artifact.path);
  const artifactRelative = relative(libraryRoot, artifactPath);
  if (
    artifactRelative === ".." ||
    artifactRelative.startsWith("..\\") ||
    artifactRelative.startsWith("../") ||
    isAbsolute(artifactRelative)
  )
    throw new Error("Bun OS artifact path left its owner checkout");
  const artifactFile = Bun.file(artifactPath);
  if (!(await artifactFile.exists()) || artifactFile.size !== artifact.size)
    throw new Error("Bun OS artifact file size differs from its manifest");
  const artifactHash = new Bun.CryptoHasher("sha256");
  for await (const chunk of artifactFile.stream()) artifactHash.update(chunk);
  if (artifactHash.digest("hex") !== artifact.sha256)
    throw new Error("Bun OS artifact file hash differs from its manifest");
  const nativeFiles = (manifest.native as unknown[]).map(file => {
    if (
      !record(file) ||
      typeof file.path !== "string" ||
      typeof file.sha256 !== "string" ||
      typeof file.size !== "number" ||
      typeof file.kind !== "string"
    )
      throw new Error("Bun OS native file receipt is invalid");
    const backend = file.kind === "engine";
    return {
      name: basename(file.path),
      sha256: file.sha256,
      bytes: file.size,
      kind: backend ? "backend" : "dependency",
      role: backend ? "executable" : "library",
    };
  });
  const abiValue = await executableABI(artifact.path, target);
  const receipt = {
    schemaVersion: 1,
    kind: "app-build",
    status: "complete",
    appId,
    target,
    source: plan.app.source,
    artifact: { path: artifact.path, bytes: artifact.size, sha256: artifact.sha256, abi: abiValue },
    runtime: { version: runtime.version, revision: runtime.revision, sha256: runtime.sha256 },
    compiler: plan.compiler,
    nativeContract: { appId, target, files: nativeFiles },
    assets: {
      id: appId,
      assets: plan.assets.apps[0]?.assets ?? [],
      sharedAssets: manifest.sharedAssets ?? null,
    },
    qualification: {
      binaryBuilt: true,
      artifactHeaders: true,
      runtimeSnapshot: true,
      bundledJavaScript: true,
      nativeBackendRequired: true,
      nativeBackendEmbedded: true,
      nativeExecution: false,
      appBehavior: false,
      assetsPublicDelivery: false,
      deployed: false,
      extraction: "qualified",
    },
    buildOwner: {
      repository: "aphrody-labs/bun-distribution",
      capability: capability.id,
      report: join(libraryRoot, reportRelative),
    },
  };
  await Bun.write(join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}
async function compileWorker(planPath: string, output: string) {
  const plan = (await Bun.file(planPath).json()) as AppPlan;
  if (plan.status !== "prepared" || !plan.runtime || !plan.compiler)
    throw new Error("Prepared app plan, runtime snapshot and shared compiler pin required");
  const current = await planApp(plan.configPath, plan.app.id, plan.target);
  if (JSON.stringify(current) !== JSON.stringify(plan)) throw new Error("App inputs changed before compilation");
  const proofs = new Map<string, { bytes: number; sha256: string }>();
  const contract: NativeLaunchContract = {
    appId: plan.app.id,
    target: plan.target,
    files: plan.nativeFiles.map(({ path: _path, ...file }) => file),
  };
  const outfile = join(output, plan.app.id + (plan.target === "windows-x64" ? ".exe" : ""));
  const target = (plan.target === "macos-arm64" ? "bun-darwin-arm64" : "bun-" + plan.target) as Bun.Build.CompileTarget;
  const compilerPath = inside(plan.compiler.checkout, join(plan.compiler.checkout, plan.compiler.path));
  if ((await identity(compilerPath)).sha256 !== plan.compiler.sha256)
    throw new Error("Shared compiler changed after planning");
  const compilerModule = (await import(compilerPath)) as {
    compileStandaloneApp: (options: {
      entrypoint: string;
      target: Bun.Build.CompileTarget;
      executablePath: string;
      outfile: string;
      assets: string[];
      define: Record<string, string>;
      onInput: (path: string) => Promise<void>;
    }) => Promise<{
      metafile?: Awaited<ReturnType<typeof Bun.build>>["metafile"];
    }>;
  };
  const result = await compilerModule.compileStandaloneApp({
    entrypoint: plan.entrypoint,
    target,
    executablePath: plan.runtime.path,
    outfile,
    assets: [
      ...plan.nativeFiles.map(file => file.path),
      ...plan.assets.objects.flatMap(object => object.sources.slice(0, 1)),
    ],
    define: { __BUN_OS_NATIVE_CONTRACT__: JSON.stringify(contract) },
    onInput: async path => {
      if (protectedInput(path)) throw new Error("Bundler input points to a protected store");
      proofs.set(path, await identity(path));
    },
  });
  if (!result.metafile) throw new Error("Shared compiler emitted no source graph");
  const provenPaths = new Set([...proofs.keys()].map(path => resolve(path)));
  for (const path of Object.keys(result.metafile.inputs)) {
    if (path.startsWith("<") || path.startsWith("bun:") || path === "bun" || isBuiltin(path)) continue;
    if (!provenPaths.has(resolve(plan.cwd, path)))
      throw new Error("Bundler source graph lacks an input checksum proof");
  }
  const sources = [];
  for (const [path, before] of proofs) {
    const after = await identity(path);
    if (before.sha256 !== after.sha256 || before.bytes !== after.bytes)
      throw new Error("A source input changed during compilation");
    sources.push({ path, ...after });
  }
  for (const input of [
    ...plan.nativeFiles,
    ...plan.assets.objects.map(object => ({ path: object.sources[0]!, ...object })),
  ]) {
    const after = await identity(input.path);
    if (after.sha256 !== input.sha256 || after.bytes !== input.bytes)
      throw new Error("An embedded payload changed during compilation");
  }
  if ((await identity(plan.runtime.path)).sha256 !== plan.runtime.sha256)
    throw new Error("Runtime changed during compilation");
  if ((await identity(compilerPath)).sha256 !== plan.compiler.sha256)
    throw new Error("Shared compiler changed during compilation");
  const finishedOwner = await inspectOwnerWorkspace(plan.compiler.checkout, plan.ownerWorkspace!.expectedRevision);
  if (!finishedOwner.clean || finishedOwner.revision !== plan.compiler.revision)
    throw new Error("Bun OS workspace changed during compilation");
  const artifactABI = await executableABI(outfile, plan.target);
  const artifact = { path: outfile, ...(await identity(outfile)), abi: artifactABI };
  const receipt = {
    schemaVersion: 1,
    kind: "app-build",
    status: "complete",
    appId: plan.app.id,
    target: plan.target,
    source: plan.app.source,
    sources,
    runtime: plan.runtime,
    compiler: plan.compiler,
    artifact,
    nativeFiles: plan.nativeFiles,
    nativeEvidence: plan.nativeEvidence,
    assets: plan.assets.apps[0],
    nativeContract: contract,
    qualification: {
      binaryBuilt: true,
      artifactHeaders: true,
      runtimeSnapshot: true,
      bundledJavaScript: true,
      nativeBackendRequired: plan.app.native.required,
      nativeBackendEmbedded: plan.app.native.required && !!plan.nativeFiles.length,
      nativeExecution: false,
      appBehavior: false,
      assetsPublicDelivery: false,
      deployed: false,
    },
  };
  await Bun.write(join(output, "metafile.json"), JSON.stringify(result.metafile, null, 2) + "\n");
  await Bun.write(join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}

async function buildLibraryAppUnderLocks(
  configPath: string,
  appId: string,
  target: AppTarget,
  requestedOutput?: string,
) {
  const config = (await readInventory(configPath)) as AppInventory;
  if (!config.build?.sharedHeavyLock || !config.build.lockKind)
    throw new Error("Configure the existing host heavy lock owner");
  const timeoutSeconds = Math.min(Math.max(config.build.timeoutSeconds ?? 600, 2_580), 43_200);
  if (!Number.isSafeInteger(timeoutSeconds)) throw new Error("Invalid finite native app deadline");
  const output = resolve(
    requestedOutput ?? join(packageRoot, "build/apps", appId, new Date().toISOString().replace(/[:.]/g, "")),
  );
  const factoryLockPath = join(packageRoot, ".factory.lock");
  const factoryLock = await open(factoryLockPath, "wx");
  const token = JSON.stringify({ pid: process.pid, operation: "native-app-build", appId, target, output });
  await factoryLock.writeFile(token + "\n");
  let heavy: Awaited<ReturnType<typeof open>> | undefined;
  let heavyPath: string | undefined;
  try {
    try {
      await lstat(output);
      throw new Error("Choose a fresh app output directory");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(join(output, "logs"), { recursive: true });
    const args = [
      process.execPath,
      import.meta.path,
      "_library",
      appId,
      "--config",
      resolve(configPath),
      "--target",
      target,
      "--out",
      output,
    ];
    const lock = resolve(dirname(configPath), config.build.sharedHeavyLock);
    if (config.build.lockKind === "exclusive-file") {
      heavyPath = lock;
      heavy = await open(lock, "wx");
      await heavy.writeFile(process.pid + "\nnative-app-build " + appId + "\n" + hostname() + "\n");
    } else {
      if (process.platform !== "linux" || !Bun.which("flock"))
        throw new Error("Selected host has no native flock owner");
      args.unshift("flock", "-n", lock);
    }
    const result = await runProcess(args, packageRoot, {
      env: { ...Bun.env },
      stdin: "ignore",
      stdout: "capture",
      stderr: "capture",
      timeoutMs: timeoutSeconds * 1000,
      maxOutputBytes: 128 * 1024 * 1024,
    });
    await Bun.write(join(output, "logs/build.stdout"), result.stdout);
    await Bun.write(join(output, "logs/build.stderr"), result.stderr);
    if (result.code !== 0) throw new Error("Bounded native app build failed; inspect its owned logs");
    return Bun.file(join(output, "receipt.json")).json();
  } finally {
    if (heavy) {
      await heavy.close();
      if ((await Bun.file(heavyPath!).text()).startsWith(process.pid + "\n")) await unlink(heavyPath!);
    }
    await factoryLock.close();
    if ((await Bun.file(factoryLockPath).text()).trim() === token) await unlink(factoryLockPath);
  }
}

export async function buildApp(configPath: string, appId: string, target: AppTarget, requestedOutput?: string) {
  const config = (await readInventory(configPath)) as AppInventory,
    selected = config.apps.find(app => app.id === appId);
  if (selected?.kind === "native-cli") return buildLibraryAppUnderLocks(configPath, appId, target, requestedOutput);
  const plan = await planApp(configPath, appId, target);
  if (plan.status !== "prepared") throw new Error(plan.reasons.join("; "));
  const output = resolve(
    requestedOutput ?? join(plan.outputRoot, target, appId, new Date().toISOString().replace(/[:.]/g, "")),
  );
  try {
    await lstat(output);
    throw new Error("Choose a fresh app output directory");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const timeout = (config.build?.timeoutSeconds ?? 600) * 1000;
  if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 3_600_000)
    throw new Error("Invalid finite compile deadline");
  if (!config.build?.sharedHeavyLock || !config.build.lockKind)
    throw new Error("Configure the existing host heavy lock owner");
  await mkdir(output, { recursive: true });
  for (const directory of ["tmp", "logs"]) await mkdir(join(output, directory));
  const factoryLock = await open(join(packageRoot, ".factory.lock"), "wx");
  const token = JSON.stringify({ pid: process.pid, operation: "app-build", appId, target, output });
  await factoryLock.writeFile(token + "\n");
  let heavy: Awaited<ReturnType<typeof open>> | undefined;
  let heavyPath: string | undefined;
  try {
    const planPath = join(output, "plan.json");
    await Bun.write(planPath, JSON.stringify(plan, null, 2) + "\n");
    const args = [process.execPath, import.meta.path, "_compile", "--plan", planPath, "--out", output];
    const lock = resolve(dirname(configPath), config.build.sharedHeavyLock);
    if (config.build.lockKind === "exclusive-file") {
      heavyPath = lock;
      heavy = await open(lock, "wx");
      await heavy.writeFile(process.pid + "\napp-build " + appId + "\n" + hostname() + "\n");
    } else {
      if (process.platform !== "linux" || !Bun.which("flock"))
        throw new Error("Selected host has no native flock owner");
      args.unshift("flock", "-n", lock);
    }
    const [stdout, stderr] = await Promise.all([
      open(join(output, "logs/compile.stdout"), "w"),
      open(join(output, "logs/compile.stderr"), "w"),
    ]);
    try {
      let childPid: number | undefined;
      const result = await runProcess(args, plan.cwd, {
        env: {
          ...Bun.env,
          TMPDIR: join(output, "tmp"),
          TMP: join(output, "tmp"),
          TEMP: join(output, "tmp"),
          BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(output, "tmp/transpiler"),
        },
        stdin: "ignore",
        stdout: "discard",
        stderr: "discard",
        timeoutMs: timeout,
        maxOutputBytes: 128 * 1024 * 1024,
        onStart: async pid => {
          childPid = pid;
          await Bun.write(
            join(output, "status.json"),
            JSON.stringify(
              {
                status: "running",
                pid: process.pid,
                childPid,
                output,
                appId,
                target,
                deadlineSeconds: timeout / 1000,
              },
              null,
              2,
            ) + "\n",
          );
        },
        onOutput: async (channel, bytes) => {
          const file = channel === "stdout" ? stdout : stderr;
          let offset = 0;
          while (offset < bytes.byteLength) {
            const { bytesWritten } = await file.write(bytes.subarray(offset));
            if (bytesWritten === 0) throw new Error("App build log write made no progress");
            offset += bytesWritten;
          }
        },
      });
      await Bun.write(
        join(output, "status.json"),
        JSON.stringify(
          {
            status: result.code === 0 ? "complete" : "failed",
            exitCode: result.code,
            pid: process.pid,
            childPid,
            output,
            appId,
            target,
          },
          null,
          2,
        ) + "\n",
      );
      if (result.code !== 0) throw new Error("Bounded app compilation failed; inspect its owned logs");
    } finally {
      await Promise.all([stdout.close(), stderr.close()]);
    }
    return Bun.file(join(output, "receipt.json")).json();
  } finally {
    if (heavy) {
      await heavy.close();
      if ((await Bun.file(heavyPath!).text()).startsWith(process.pid + "\n")) await unlink(heavyPath!);
    }
    await factoryLock.close();
    if ((await Bun.file(join(packageRoot, ".factory.lock")).text()).trim() === token)
      await unlink(join(packageRoot, ".factory.lock"));
  }
}
export async function stageAppRelease(configPath: string, receiptPath: string) {
  const config = (await readInventory(configPath)) as AppInventory,
    receipt = await Bun.file(receiptPath).json();
  if (
    receipt.schemaVersion !== 1 ||
    receipt.kind !== "app-build" ||
    receipt.status !== "complete" ||
    !receipt.qualification?.binaryBuilt ||
    !config.apps.some(app => app.id === receipt.appId)
  )
    throw new Error("An actual app build receipt is required");
  const digest = await identity(receipt.artifact.path);
  if (digest.sha256 !== receipt.artifact.sha256 || digest.bytes !== receipt.artifact.bytes)
    throw new Error("Release artifact changed");
  await executableABI(receipt.artifact.path, receipt.target);
  return {
    schemaVersion: 1,
    kind: "app-release-stage",
    appId: receipt.appId,
    target: receipt.target,
    source: receipt.source,
    artifact: {
      ...digest,
      objectKey: config.storage.artifacts.prefix + digest.sha256,
      url: config.storage.artifacts.origin.replace(/\/$/, "") + "/" + config.storage.artifacts.prefix + digest.sha256,
    },
    runtime: {
      version: receipt.runtime.version,
      revision: receipt.runtime.revision,
      sha256: receipt.runtime.sha256,
    },
    compiler: receipt.compiler,
    native: receipt.nativeContract,
    assets: receipt.assets,
    qualification: { ...receipt.qualification, uploaded: false },
    catalogPublication: "owned by the edge/catalog capability",
  };
}
async function main() {
  const [action = "--help", ...args] = Bun.argv.slice(2);
  if (action === "--help") {
    console.log(
      "bun infra/app-build.ts plan|build|release APP --config FILE --target TARGET [--out NEW_DIRECTORY] [--receipt FILE]",
    );
    return;
  }
  const values: Record<string, string> = {},
    positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const value = args[++index];
    if (!["--config", "--target", "--out", "--plan", "--receipt"].includes(arg) || !value || values[arg])
      throw new Error("Invalid app build option");
    values[arg] = value;
  }
  if (action === "_compile") {
    await compileWorker(resolve(values["--plan"]!), resolve(values["--out"]!));
    return;
  }
  if (action === "_library") {
    if (!values["--config"] || !values["--target"] || !values["--out"] || positional.length !== 1)
      throw new Error("Native app worker needs an explicit app, config, target and output");
    const result = await buildLibraryApp(
      resolve(values["--config"]),
      positional[0]!,
      values["--target"] as AppTarget,
      resolve(values["--out"]),
    );
    console.log(JSON.stringify(result));
    return;
  }
  if (!values["--config"] || positional.length !== 1) throw new Error("Explicit config and one app required");
  const config = resolve(values["--config"]),
    id = positional[0]!;
  if (action === "release") {
    if (!values["--receipt"] || !values["--out"])
      throw new Error("Release staging needs an artifact receipt and output file");
    const staged = await stageAppRelease(config, resolve(values["--receipt"]));
    if (staged.appId !== id) throw new Error("Release app identity mismatch");
    await Bun.write(resolve(values["--out"]), JSON.stringify(staged, null, 2) + "\n");
    return;
  }
  if (!values["--target"]) throw new Error("Explicit app target required");
  const target = values["--target"] as AppTarget;
  const result =
    action === "plan"
      ? await planApp(config, id, target)
      : action === "build"
        ? await buildApp(config, id, target, values["--out"])
        : null;
  if (!result) throw new Error("Unknown app build action");
  console.log(JSON.stringify(result, null, 2));
}
if (import.meta.main)
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "App build failed");
    process.exitCode = 1;
  });
