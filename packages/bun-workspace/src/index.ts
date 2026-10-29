import { availableParallelism } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  assertRuntimeFacts,
  currentRuntimeFacts,
  nativeRuntimeTarget,
  runtimeFromFacts,
  runtimeVersionPattern,
  type Runtime,
  type RuntimePin,
  type RuntimeTarget,
} from "./runtime.ts";
import { runProcess } from "./process.ts";
import { inspectModuleCoverage, type ModuleCoverage } from "./coverage.ts";

export {
  allAppCapabilities,
  appCapabilities,
  appCapabilityFor,
  appHostname,
  capabilityFor,
  type AppCapability,
} from "./capabilities.ts";
export { inspectModuleCoverage, type ModuleCoverage } from "./coverage.ts";
export { hashContent, hashFile, hashStream, type FileHashOptions } from "./hash.ts";
export {
  ProcessError,
  runProcess,
  type ProcessErrorCode,
  type ProcessLimits,
  type ProcessOptions,
  type ProcessResult,
} from "./process.ts";
export {
  assertRuntimeFacts,
  currentRuntimeFacts,
  runtimeFromFacts,
  type Runtime,
  type RuntimeFacts,
  type RuntimePin,
  type RuntimeTarget,
} from "./runtime.ts";

/** Resolve from this checkout; no workstation or host path is embedded. */
export const repositoryRoot = resolve(import.meta.dir, "../../..");

export interface Module {
  id: string;
  path: string;
  upstream: string;
  fork: string;
  branch: string;
  revision: string;
  upstreamRevision: string;
  license: string;
  kind: "library";
  role?: "engine" | "shared" | "fonts";
  description: string;
  binary?: string;
  cargoPackage?: string;
  cargoPackages?: string[];
  sourceKind?: "workspace" | "submodule";
  manifestPath?: string;
  protocol?: "cli" | "cli-json" | "jsonl" | "mcp-stdio";
}

export interface Config {
  schemaVersion: 1;
  runtime: RuntimePin;
  runtimeTargets?: Partial<Record<RuntimeTarget, RuntimePin>>;
  modules: Module[];
  priorities?: string[];
  desktop: Record<string, unknown> & { source?: Source };
  deployment?: Deployment;
}

/** Application release settings reference the canonical Infra host owner. */
export interface Deployment {
  domain: string;
  appPrefix: string;
  assets: { bucket: string; url: string };
  host: string;
}

export interface Source {
  path: string;
  repository: string;
  revision: string;
}

export interface ModuleStatus {
  sourceKind: "workspace" | "submodule";
  id: string;
  path: string;
  initialized: boolean;
  revision: string | null;
  expectedRevision: string;
  indexRevision: string | null;
  pointerMatches: boolean;
  revisionMatches: boolean;
  clean: boolean | null;
  launchable: boolean;
  launchReason: string;
  error?: string;
}

export interface ExecutionOptions {
  root?: string;
  timeoutMs?: number;
}

export type RuntimePolicy = "release" | "development";

export interface RuntimeExecutionOptions extends ExecutionOptions {
  runtimePolicy?: RuntimePolicy;
  /** `flat-submodules` enforces the owner contract (every crate a pinned `crates/<name>` submodule); `members` only checks identity. */
  cargoContract?: "flat-submodules" | "members";
}

export interface NativeExecutionOptions extends RuntimeExecutionOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  serialize?: boolean;
}

export interface ModuleBinaryOptions extends ExecutionOptions {
  binary?: string;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

const shortDeadline = 20_000;
const syncDeadline = 300_000;
const cargoDeadline = 1_800_000;
const runDeadline = 43_200_000;
const revisionPattern = /^[0-9a-f]{40}$/;

export interface WorkspaceDiscoveryOptions {
  root?: string;
  starts?: readonly string[];
}

/** Discovery is shared by checkout shells; standalone applications use their manifest. */
export async function findWorkspace(options: WorkspaceDiscoveryOptions = {}): Promise<string> {
  const configured = options.root ?? Bun.env.APHRODY_ROOT;
  if (configured !== undefined) {
    const root = resolve(configured);
    if (await Bun.file(join(root, "aphrody.config.json")).exists()) return root;
    if (options.root !== undefined) {
      throw new Error("APHRODY_ROOT must contain aphrody.config.json.");
    }
  }
  for (const start of options.starts ?? [process.cwd(), import.meta.dir]) {
    let cursor = resolve(start);
    for (;;) {
      if (await Bun.file(join(cursor, "aphrody.config.json")).exists()) return cursor;
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  throw new Error("Run from the Aphrody checkout or set APHRODY_ROOT.");
}

/** A lexical path guard for trusted checkout files and manifest arguments. */
export function checkoutPath(root: string, path: string): string {
  if (!path || isAbsolute(path)) throw new Error(`Relative path required: ${path}`);
  const target = resolve(root, path);
  const local = relative(resolve(root), target);
  if (!local || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error(`Path outside checkout: ${path}`);
  }
  return target;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Only an explicit migrated workspace source can name the checkout itself. */
function moduleDirectory(root: string, path: string, sourceKind: unknown): string {
  return path === "." && sourceKind === "workspace" ? resolve(root) : checkoutPath(root, path);
}

export { object as isObject };

export async function loadConfig(root = repositoryRoot): Promise<Config> {
  const value: unknown = await Bun.file(join(root, "aphrody.config.json")).json();
  if (!object(value) || value.schemaVersion !== 1 || !object(value.runtime)) {
    throw new Error("aphrody.config.json: schemaVersion 1 and runtime required.");
  }
  if (
    typeof value.runtime.version !== "string" ||
    !runtimeVersionPattern.test(value.runtime.version) ||
    value.runtime.repository !== "oven-sh/bun" ||
    typeof value.runtime.revision !== "string" ||
    !revisionPattern.test(value.runtime.revision)
  ) {
    throw new Error("aphrody.config.json: Aphrody Bun 1.4.4 and full revision required.");
  }
  if (value.runtimeTargets !== undefined) {
    if (!object(value.runtimeTargets)) throw new Error("aphrody.config.json: invalid target runtime pins.");
    for (const [target, pin] of Object.entries(value.runtimeTargets)) {
      if (
        ![
          "windows-x64",
          "windows-arm64",
          "linux-x64",
          "linux-arm64",
          "linux-x64-musl",
          "linux-arm64-musl",
          "darwin-x64",
          "darwin-arm64",
        ].includes(target) ||
        !object(pin) ||
        typeof pin.version !== "string" ||
        !runtimeVersionPattern.test(pin.version) ||
        pin.repository !== "oven-sh/bun" ||
        typeof pin.revision !== "string" ||
        !revisionPattern.test(pin.revision)
      ) {
        throw new Error(`aphrody.config.json: invalid runtime pin for ${target}.`);
      }
    }
  }
  if (!Array.isArray(value.modules) || !object(value.desktop)) {
    throw new Error("aphrody.config.json: modules and desktop required.");
  }
  if (value.deployment !== undefined) {
    const deployment = value.deployment;
    if (
      !object(deployment) ||
      typeof deployment.domain !== "string" ||
      deployment.domain.length > 253 ||
      !deployment.domain.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      !deployment.domain.includes(".") ||
      typeof deployment.appPrefix !== "string" ||
      !/^[a-z0-9-]*$/.test(deployment.appPrefix) ||
      deployment.appPrefix.length > 40 ||
      typeof deployment.host !== "string" ||
      !/^[a-z][a-z0-9-]*$/.test(deployment.host) ||
      !object(deployment.assets) ||
      typeof deployment.assets.bucket !== "string" ||
      !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(deployment.assets.bucket) ||
      typeof deployment.assets.url !== "string"
    ) {
      throw new Error("aphrody.config.json: invalid application deployment settings.");
    }
    try {
      const url = new URL(deployment.assets.url);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
    } catch {
      throw new Error("aphrody.config.json: assets require an HTTPS URL without credentials.");
    }
  }
  if (value.desktop.source !== undefined) {
    const source = value.desktop.source;
    if (
      !object(source) ||
      typeof source.path !== "string" ||
      source.repository !== "oven-sh/bun" ||
      typeof source.revision !== "string" ||
      !revisionPattern.test(source.revision)
    ) {
      throw new Error("aphrody.config.json: invalid pinned Bun SDK source.");
    }
    checkoutPath(root, source.path);
  }
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const entry of value.modules) {
    if (!object(entry) || typeof entry.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(entry.id)) {
      throw new Error("aphrody.config.json: invalid library identifier.");
    }
    if (ids.has(entry.id)) throw new Error(`Duplicate library: ${entry.id}`);
    ids.add(entry.id);
    if (typeof entry.path !== "string") throw new Error(`Path required: ${entry.id}`);
    const modulePath = moduleDirectory(root, entry.path, entry.sourceKind);
    const rootOwner = entry.path === "." && entry.sourceKind === "workspace";
    if (rootOwner && typeof entry.manifestPath !== "string")
      throw new Error(`Root workspace source requires a manifest: ${entry.id}`);
    const sourcePath = rootOwner ? checkoutPath(modulePath, entry.manifestPath as string) : modulePath;
    if (paths.has(sourcePath)) throw new Error(`Duplicate path: ${entry.path}`);
    paths.add(sourcePath);
    if (entry.upstream !== `storytold/${entry.id}` || entry.fork !== `aphrody-labs/${entry.id}`) {
      throw new Error(`Invalid source owners: ${entry.id}`);
    }
    for (const key of ["revision", "upstreamRevision"] as const) {
      if (typeof entry[key] !== "string" || !revisionPattern.test(entry[key])) {
        throw new Error(`Full revision required: ${entry.id}.${key}`);
      }
    }
    if (
      typeof entry.branch !== "string" ||
      !entry.branch ||
      typeof entry.license !== "string" ||
      !entry.license ||
      typeof entry.description !== "string" ||
      entry.kind !== "library" ||
      (entry.sourceKind !== undefined && !["workspace", "submodule"].includes(String(entry.sourceKind))) ||
      (entry.role !== undefined && !["engine", "shared", "fonts"].includes(String(entry.role)))
    ) {
      throw new Error(`Invalid library metadata: ${entry.id}`);
    }
    for (const key of ["binary", "cargoPackage"] as const) {
      if (entry[key] !== undefined && (typeof entry[key] !== "string" || !/^[a-zA-Z0-9_-]+$/.test(entry[key]))) {
        throw new Error(`Invalid Cargo name: ${entry.id}.${key}`);
      }
    }
    if (
      entry.cargoPackages !== undefined &&
      (!Array.isArray(entry.cargoPackages) ||
        entry.cargoPackages.length === 0 ||
        entry.cargoPackages.some(name => typeof name !== "string" || !/^[a-zA-Z0-9_-]+$/.test(name)) ||
        new Set(entry.cargoPackages).size !== entry.cargoPackages.length)
    ) {
      throw new Error(`Invalid Cargo package group: ${entry.id}`);
    }
    if (entry.binary !== undefined && (entry.role !== "engine" || entry.binary !== `${entry.id}-cli`)) {
      throw new Error(`Only an explicit headless engine CLI is allowed: ${entry.id}`);
    }
    if (entry.manifestPath !== undefined) {
      if (typeof entry.manifestPath !== "string") throw new Error(`Invalid manifest: ${entry.id}`);
      checkoutPath(modulePath, entry.manifestPath);
    }
    if (entry.protocol !== undefined && !["cli", "cli-json", "jsonl", "mcp-stdio"].includes(String(entry.protocol))) {
      throw new Error(`Invalid native protocol: ${entry.id}`);
    }
  }
  if (
    value.priorities !== undefined &&
    (!Array.isArray(value.priorities) || value.priorities.some(id => typeof id !== "string" || !ids.has(id)))
  ) {
    throw new Error("Priorities must reference catalog libraries.");
  }
  return value as unknown as Config;
}

export function runtimePinFor(config: Config, target = nativeRuntimeTarget()): RuntimePin {
  if (!target) return config.runtime;
  const pin = config.runtimeTargets?.[target];
  if (!pin) throw new Error(`No Bun runtime pin is declared for ${target}.`);
  return pin;
}

export function inspectRuntime(config: Config, target = nativeRuntimeTarget(), allowRevisionDrift = false): Runtime {
  const expected = runtimePinFor(config, target);
  if (!allowRevisionDrift) return runtimeFromFacts(expected, currentRuntimeFacts());
  const runtime = runtimeFromFacts(config.runtime, currentRuntimeFacts());
  runtime.revisionMatches = runtime.recognizedFork && runtime.versionMatches;
  return runtime;
}

/** All commands require the declared release fork; SHA drift is explicit. */
export function assertRuntime(config: Config, allowRevisionDrift = false, target = nativeRuntimeTarget()): Runtime {
  return assertRuntimeFacts(runtimePinFor(config, target), currentRuntimeFacts(), allowRevisionDrift);
}

/** Compiled sidecars must use a separate, verified Bun executable. */
export async function resolveBunExecutable(config: Config, options: RuntimeExecutionOptions = {}): Promise<string> {
  const root = options.root ?? repositoryRoot;
  const configured = Bun.env.APHRODY_BUN_BINARY;
  let candidate = Bun.which("bun");
  if (configured) {
    if (isAbsolute(configured)) candidate = configured;
    else if (configured.includes("/") || configured.includes("\\")) candidate = checkoutPath(root, configured);
    else candidate = Bun.which(configured);
  }
  if (!candidate || !(await Bun.file(candidate).exists())) {
    throw new Error("Native Bun missing; set APHRODY_BUN_BINARY or provide bun on PATH.");
  }
  const probe = await command(
    [
      candidate,
      "--no-env-file",
      "-e",
      "console.log(JSON.stringify({version:Bun.version,revision:Bun.revision,sourceUrl:process.release.sourceUrl??null}))",
    ],
    root,
    Math.min(options.timeoutMs ?? 5_000, 5_000),
  );
  if (probe.code !== 0) throw new Error("Native Bun provenance probe failed.");
  let facts: unknown;
  try {
    facts = JSON.parse(probe.stdout.trim());
  } catch {
    throw new Error("Native Bun returned invalid provenance metadata.");
  }
  if (
    !object(facts) ||
    typeof facts.version !== "string" ||
    typeof facts.revision !== "string" ||
    (facts.sourceUrl !== null && typeof facts.sourceUrl !== "string")
  ) {
    throw new Error("Native Bun returned invalid provenance metadata.");
  }
  assertRuntimeFacts(
    runtimePinFor(config),
    {
      version: facts.version,
      revision: facts.revision,
      sourceUrl: facts.sourceUrl as string | null,
      executable: candidate,
    },
    options.runtimePolicy === "development",
  );
  return candidate;
}

async function command(
  argv: string[],
  cwd: string,
  timeoutMs = shortDeadline,
  inherit = false,
  env: Record<string, string | undefined> = Bun.env,
  captureStdout = false,
): Promise<CommandResult> {
  return runProcess(argv, cwd, {
    timeoutMs,
    maxOutputBytes: 64 * 1024 * 1024,
    stdin: inherit ? "inherit" : "ignore",
    stdout: inherit && !captureStdout ? "inherit" : "capture",
    stderr: inherit ? "inherit" : "capture",
    env,
  });
}

async function git(args: string[], root: string): Promise<string> {
  const result = await command(["git", ...args], root);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `Git failed (${result.code}).`);
  return result.stdout.trim();
}

export function findModule(config: Config, id: string): Module {
  const module = config.modules.find(entry => entry.id === id);
  if (!module) throw new Error(`Unknown library: ${id}`);
  return module;
}

export async function inspectSourceCoverage(config: Config, root = repositoryRoot): Promise<ModuleCoverage[]> {
  const result: ModuleCoverage[] = [];
  for (const module of config.modules) result.push(await inspectModuleCoverage(module, root));
  return result;
}

interface Pin {
  id: string;
  path: string;
  fork: string;
  revision: string;
}

function pinnedSources(config: Config): Pin[] {
  const pins: Pin[] = config.modules.filter(module => module.sourceKind !== "workspace");
  if (config.desktop.source) {
    pins.push({
      id: "bun-sdk",
      path: config.desktop.source.path,
      fork: config.desktop.source.repository,
      revision: config.desktop.source.revision,
    });
  }
  return pins;
}

/** Owner-selected local artifacts stay outside Git in .local/config.json. */
export async function localBinaries(config: Config, root = repositoryRoot): Promise<Record<string, string>> {
  const file = Bun.file(join(root, ".local", "config.json"));
  if (!(await file.exists())) return {};
  const value: unknown = await file.json();
  if (!object(value) || (value.binaries !== undefined && !object(value.binaries))) {
    throw new Error(".local/config.json: binaries must map library IDs to paths.");
  }
  const binaries: Record<string, string> = {};
  for (const [id, entry] of Object.entries(value.binaries ?? {})) {
    const module = findModule(config, id);
    if (
      module.role !== "engine" ||
      !module.binary ||
      module.binary !== `${id}-cli` ||
      typeof entry !== "string" ||
      !entry
    ) {
      throw new Error(`Invalid local headless CLI: ${id}`);
    }
    const path = isAbsolute(entry) ? resolve(entry) : checkoutPath(root, entry);
    const expected = nativeBinaryName(module);
    if (basename(path).toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`Local CLI ${id} must be named ${expected}.`);
    }
    if (!(await Bun.file(path).exists())) throw new Error(`Local CLI missing: ${id}`);
    binaries[id] = path;
  }
  return binaries;
}

/** Keep native engine names separate from public application identities. */
export function nativeBinaryName(module: Module, platform = process.platform): string {
  if (module.role !== "engine" || module.binary !== `${module.id}-cli`) {
    throw new Error(`Library has no headless CLI: ${module.id}`);
  }
  return `${module.binary}${platform === "win32" ? ".exe" : ""}`;
}

export async function listModuleStatus(config: Config, root = repositoryRoot): Promise<ModuleStatus[]> {
  const result: ModuleStatus[] = [];
  const binaries = await localBinaries(config, root);
  // Keep process and signal ownership bounded, even for a large catalogue.
  for (const module of pinnedSources(config)) {
    const library = config.modules.find(entry => entry.id === module.id);
    const hasHeadlessBinary = library?.role === "engine" && library.binary === `${module.id}-cli`;
    const status: ModuleStatus = {
      sourceKind: "submodule",
      id: module.id,
      path: module.path,
      initialized: false,
      revision: null,
      expectedRevision: module.revision,
      indexRevision: null,
      pointerMatches: false,
      revisionMatches: false,
      clean: null,
      launchable: false,
      launchReason: hasHeadlessBinary ? "Library source not initialized." : "Library has no headless CLI.",
    };
    try {
      const index = await git(["ls-files", "--stage", "--", module.path], root);
      const match = /^160000 ([0-9a-f]{40}) 0\t/.exec(index);
      status.indexRevision = match?.[1] ?? null;
      status.pointerMatches = status.indexRevision === module.revision;
      const directory = checkoutPath(root, module.path);
      status.initialized = await Bun.file(join(directory, ".git")).exists();
      if (status.initialized) {
        status.revision = await git(["rev-parse", "HEAD"], directory);
        status.revisionMatches = status.revision === module.revision;
        status.clean = (await git(["status", "--porcelain=v1", "--untracked-files=all"], directory)) === "";
        const manifestExists = library
          ? await Bun.file(checkoutPath(directory, library.manifestPath ?? "Cargo.toml")).exists()
          : false;
        status.launchable = Boolean(
          hasHeadlessBinary &&
          (manifestExists || binaries[module.id]) &&
          status.pointerMatches &&
          status.revisionMatches,
        );
        if (hasHeadlessBinary)
          status.launchReason = status.launchable
            ? binaries[module.id]
              ? "Headless artifact selected in .local/config.json."
              : "Headless CLI; native build may be required."
            : !manifestExists
              ? "Cargo manifest missing."
              : "Revision differs from catalog.";
      }
    } catch (error) {
      status.error = error instanceof Error ? error.message : String(error);
    }
    result.push(status);
  }
  for (const module of config.modules.filter(entry => entry.sourceKind === "workspace")) {
    const status: ModuleStatus = {
      sourceKind: "workspace",
      id: module.id,
      path: module.path,
      initialized: false,
      revision: null,
      expectedRevision: module.revision,
      indexRevision: null,
      pointerMatches: true,
      revisionMatches: false,
      clean: null,
      launchable: false,
      launchReason: "Library has no headless CLI.",
    };
    try {
      status.initialized = await Bun.file(
        checkoutPath(root, `${module.path}/${module.manifestPath ?? "Cargo.toml"}`),
      ).exists();
      status.revision = await git(["rev-parse", "HEAD"], root);
      // Preserve import ancestry and qualify every crate's independent Git pin.
      const ancestry = await command(["git", "merge-base", "--is-ancestor", module.revision, status.revision], root);
      if (ancestry.code > 1) throw new Error(`Imported source history is unavailable: ${module.id}`);
      status.revisionMatches = ancestry.code === 0;
      status.clean = (await git(["status", "--porcelain=v1", "--ignore-submodules=all"], root)) === "";
      for (const name of module.cargoPackages ?? []) {
        const cratePath = `crates/${name}`;
        const indexEntry = await git(["ls-files", "--stage", "--", cratePath], root);
        const pin = /^160000 ([0-9a-f]{40}) 0\t/.exec(indexEntry)?.[1];
        if (!pin) throw new Error(`Product crate lacks its Git submodule: ${name}`);
        const crateRoot = checkoutPath(root, cratePath);
        status.pointerMatches &&= (await git(["rev-parse", "HEAD"], crateRoot)) === pin;
        status.clean &&= (await git(["status", "--porcelain=v1"], crateRoot)) === "";
      }
      const headless = module.role === "engine" && module.binary === `${module.id}-cli`;
      status.launchable = headless && status.initialized && status.revisionMatches && status.pointerMatches;
      if (headless)
        status.launchReason = status.launchable
          ? "Workspace CLI; native build may be required."
          : "Imported source history differs.";
    } catch (error) {
      status.error = error instanceof Error ? error.message : String(error);
    }
    result.push(status);
  }
  return result;
}

async function requireModule(config: Config, id: string, root: string): Promise<Module> {
  const module = findModule(config, id);
  const status = (await listModuleStatus(config, root)).find(entry => entry.id === id)!;
  if (status.error || !status.initialized || !status.pointerMatches || !status.revisionMatches) {
    throw new Error(
      `${id} differs from the pinned source. Run aphrody-bun status and sync from a clean checkout. ${status.error ?? ""}`.trim(),
    );
  }
  return module;
}

export async function syncModules(config: Config, root = repositoryRoot): Promise<void> {
  assertRuntime(config);
  const states = await listModuleStatus(config, root);
  for (const state of states) {
    if (
      state.error ||
      !state.pointerMatches ||
      state.clean === false ||
      (state.initialized && !state.revisionMatches)
    ) {
      throw new Error(
        `Sync refused: ${state.id}; local changes or revision differs from catalog. ${state.error ?? ""}`.trim(),
      );
    }
  }
  if (await git(["status", "--porcelain=v1", "--untracked-files=all"], root)) {
    throw new Error("Sync refused: monorepo has local changes.");
  }
  const paths = await git(["config", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"], root);
  for (const module of pinnedSources(config)) {
    const line = paths.split("\n").find(entry => entry.endsWith(` ${module.path}`));
    if (!line) throw new Error(`Source missing from .gitmodules: ${module.id}`);
    const key = line.slice(0, line.indexOf(" ")).replace(/\.path$/, ".url");
    const url = await git(["config", "--file", ".gitmodules", "--get", key], root);
    const accepted = [
      `https://github.com/${module.fork}.git`,
      `https://github.com/${module.fork}`,
      `git@github.com:${module.fork}.git`,
    ];
    if (!accepted.includes(url)) throw new Error(`Unexpected fork URL: ${module.id}`);
  }
  for (const module of pinnedSources(config)) {
    const current = (await listModuleStatus(config, root)).find(entry => entry.id === module.id)!;
    if (
      current.error ||
      !current.pointerMatches ||
      current.clean === false ||
      (current.initialized && !current.revisionMatches)
    ) {
      throw new Error(`Sync stopped: ${module.id} changed during the operation.`);
    }
    if (current.initialized) continue;
    if (await git(["status", "--porcelain=v1", "--untracked-files=all"], root)) {
      throw new Error("Sync stopped: monorepo received local changes.");
    }
    const result = await command(
      ["git", "submodule", "update", "--init", "--checkout", "--", module.path],
      root,
      syncDeadline,
      true,
    );
    if (result.code !== 0) throw new Error(`Source initialization failed: ${module.id} (${result.code}).`);
  }
  const initialized = await listModuleStatus(config, root);
  if (
    initialized.some(
      state => state.error || !state.initialized || !state.revisionMatches || !state.pointerMatches || !state.clean,
    )
  ) {
    throw new Error("Initialized sources differ from the pinned catalog.");
  }
}

interface CargoModule {
  directory: string;
  manifest: string;
  cargoPackage: string | null;
  cargoPackages: string[];
  binary: string | null;
}

export async function resolveCargoModule(module: Module, root = repositoryRoot): Promise<CargoModule> {
  if (module.binary && (module.role !== "engine" || module.binary !== `${module.id}-cli`)) {
    throw new Error(`Only an explicit headless engine CLI is allowed: ${module.id}`);
  }
  const directory = moduleDirectory(root, module.path, module.sourceKind);
  const rootManifest = join(root, "Cargo.toml");
  if (await Bun.file(rootManifest).exists()) {
    const workspace = Bun.TOML.parse(await Bun.file(rootManifest).text()) as {
      workspace?: { members?: string[] };
    };
    const prefix = `${relative(root, directory).replaceAll("\\", "/")}/`;
    const members =
      workspace.workspace?.members?.filter(member =>
        module.sourceKind === "workspace" ? true : member.startsWith(prefix),
      ) ?? [];
    if (members.length) {
      const cargoPackages: string[] = [];
      for (const member of members) {
        const memberManifest = checkoutPath(root, `${member}/Cargo.toml`);
        const value = Bun.TOML.parse(await Bun.file(memberManifest).text()) as {
          package?: { name?: string };
        };
        if (!value.package?.name) throw new Error(`Cargo member lacks a package name: ${member}`);
        if (
          module.sourceKind !== "workspace" ||
          (module.cargoPackages ?? [module.cargoPackage]).includes(value.package.name)
        ) {
          cargoPackages.push(value.package.name);
        }
      }
      if (module.cargoPackages?.some(name => !cargoPackages.includes(name)))
        throw new Error(`Cargo package group is incomplete: ${module.id}`);
      if (!cargoPackages.length) throw new Error(`No root Cargo packages belong to the library: ${module.id}`);
      if (module.cargoPackage && !cargoPackages.includes(module.cargoPackage)) {
        throw new Error(`Cargo package is outside its library: ${module.id}`);
      }
      return {
        directory: module.sourceKind === "workspace" ? root : directory,
        manifest: rootManifest,
        cargoPackage: module.cargoPackage ?? null,
        cargoPackages,
        binary: module.binary ?? null,
      };
    }
  }
  const manifest = checkoutPath(directory, module.manifestPath ?? "Cargo.toml");
  if (!(await Bun.file(manifest).exists())) throw new Error(`Cargo manifest missing: ${module.id}`);
  const value = Bun.TOML.parse(await Bun.file(manifest).text()) as {
    package?: { name?: string };
  };
  const cargoPackage = module.cargoPackage ?? value.package?.name ?? null;
  if (!cargoPackage && module.binary) throw new Error(`cargoPackage required for the headless CLI: ${module.id}`);
  const binary = module.binary ?? null;
  return { directory, manifest, cargoPackage, cargoPackages: [], binary };
}

/** Discover an existing checkout artifact. Builds and native protocol validation stay explicit. */
export async function resolveModuleBinary(
  config: Config,
  id: string,
  options: ModuleBinaryOptions = {},
): Promise<string> {
  const root = options.root ?? repositoryRoot;
  const module = await requireModule(config, id, root);
  const expected = nativeBinaryName(module);
  const selected = options.binary ?? (await localBinaries(config, root))[id];
  if (selected) {
    const path = isAbsolute(selected) ? resolve(selected) : checkoutPath(root, selected);
    if (basename(path).toLowerCase() !== expected.toLowerCase())
      throw new Error(`Native CLI ${id} must be named ${expected}.`);
    if (!(await Bun.file(path).exists())) throw new Error(`Native CLI missing: ${id}`);
    return path;
  }
  const cargo = await resolveCargoModule(module, root);
  const executable = Bun.which("cargo");
  if (!executable) throw new Error("Native Cargo missing on this host.");
  const metadata = await runProcess(
    [executable, "metadata", "--offline", "--no-deps", "--format-version", "1", "--manifest-path", cargo.manifest],
    cargo.directory,
    {
      timeoutMs: Math.min(options.timeoutMs ?? shortDeadline, shortDeadline),
      maxOutputBytes: options.maxOutputBytes ?? 16 * 1024 * 1024,
      signal: options.signal,
    },
  );
  if (metadata.code !== 0) throw new Error(`Cargo artifact discovery failed: ${id}`);
  const value: unknown = JSON.parse(metadata.stdout);
  if (
    !object(value) ||
    typeof value.target_directory !== "string" ||
    !isAbsolute(value.target_directory) ||
    value.target_directory.includes("\0")
  ) {
    throw new Error(`Cargo returned an invalid artifact directory: ${id}`);
  }
  for (const profile of ["release", "debug"]) {
    const candidate = join(value.target_directory, profile, expected);
    if (await Bun.file(candidate).exists()) return candidate;
  }
  throw new Error(`Native CLI missing: ${id}; build its existing library owner.`);
}

/** Resolve the effective optional Rust cache wrapper before execution or proof capture. */
export function normalizeRustCacheEnvironment(
  environment: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const env = { ...environment };
  if (env.RUSTC_WRAPPER && !Bun.which(env.RUSTC_WRAPPER)) {
    const sccache = Bun.which("sccache");
    if (sccache) env.RUSTC_WRAPPER = sccache;
    else delete env.RUSTC_WRAPPER;
  }
  return env;
}

/** Serialize a native build owner, including the Tauri CLI, without a shell. */
export async function runNativeResult(
  config: Config,
  nativeArguments: string[],
  options: NativeExecutionOptions = {},
  captureStdout = false,
): Promise<CommandResult> {
  assertRuntime(config, options.runtimePolicy === "development");
  if (!nativeArguments.length || nativeArguments.some(arg => typeof arg !== "string" || arg.includes("\0"))) {
    throw new Error("Invalid native arguments.");
  }
  const root = options.root ?? repositoryRoot;
  const cwd = options.cwd ?? root;
  const timeoutMs = options.timeoutMs ?? cargoDeadline;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > runDeadline) {
    throw new Error("Invalid native deadline; maximum 12 hours.");
  }
  const requestedEnv: Record<string, string | undefined> = {
    ...Bun.env,
    ...options.env,
    // The native worker splits the host's cores between the admitted build slots.
    CARGO_BUILD_JOBS: options.env?.CARGO_BUILD_JOBS ?? String(availableParallelism()),
    CARGO_TARGET_DIR: join(root, "target"),
    CARGO_INSTALL_ROOT: join(root, "install"),
  };
  const env = normalizeRustCacheEnvironment(requestedEnv);
  const toolchainFile = Bun.file(join(root, "rust-toolchain.toml"));
  if (await toolchainFile.exists()) {
    const toolchain = Bun.TOML.parse(await toolchainFile.text()) as {
      toolchain?: { channel?: string };
    };
    if (!toolchain.toolchain?.channel) throw new Error("Root Rust toolchain channel is missing.");
    env.RUSTUP_TOOLCHAIN = toolchain.toolchain.channel;
  }
  if (requestedEnv.RUSTC_WRAPPER && !env.RUSTC_WRAPPER)
    console.error("Optional Rust cache unavailable; using a direct build.");
  if (options.serialize === false) {
    return command(nativeArguments, cwd, timeoutMs, true, env, captureStdout);
  }
  let argv: string[];
  if (process.platform === "win32") {
    const powershell = Bun.which("pwsh") ?? Bun.which("powershell");
    if (!powershell) throw new Error("Native PowerShell missing on this host.");
    // JSON travels in the environment, avoiding PowerShell's native argv re-quoting.
    env.APHRODY_NATIVE_ARGUMENTS = JSON.stringify(nativeArguments.slice(1));
    env.APHRODY_NATIVE_EXECUTABLE = Bun.which(nativeArguments[0]!) ?? nativeArguments[0];
    env.APHRODY_NATIVE_BUN = await resolveBunExecutable(config, {
      root,
      runtimePolicy: options.runtimePolicy,
    });
    env.APHRODY_NATIVE_WORKER = join(root, "scripts", "native-worker.ts");
    const wrapperSeconds = Math.max(1, Math.ceil(Math.min(timeoutMs, runDeadline - 5_000) / 1000));
    argv = [
      powershell,
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      join(root, "scripts", "cargo-serial.ps1"),
      "-WorkingDirectory",
      cwd,
      "-TimeoutSeconds",
      String(wrapperSeconds),
    ];
  } else {
    const flock = Bun.which("flock");
    if (!flock) throw new Error("Native flock required for build serialization on this Unix host.");
    const temporaryDirectory = Bun.env.TMPDIR ?? "/tmp";
    const identity = process.getuid?.() ?? "user";
    argv = [flock, "--nonblock", join(temporaryDirectory, `aphrody-bun-native-${identity}.lock`), ...nativeArguments];
  }
  // The wrapper kills its process tree before the outer Bun deadline.
  return command(
    argv,
    cwd,
    Math.min(runDeadline, timeoutMs + (process.platform === "win32" ? 5_000 : 0)),
    true,
    env,
    captureStdout,
  );
}

export async function runNative(config: Config, argv: string[], options: NativeExecutionOptions = {}): Promise<number> {
  return (await runNativeResult(config, argv, options)).code;
}

/** Resolve Bun's existing native MSVC owner, with an explicit checkout override. */
async function serializedCargo(
  config: Config,
  args: string[],
  cwd: string,
  root: string,
  timeoutMs: number,
  captureStdout = false,
  runtimePolicy: RuntimePolicy = "release",
): Promise<CommandResult> {
  const cargo = Bun.which("cargo");
  if (!cargo) throw new Error("Native Cargo missing on this host.");
  const argv = [cargo, ...args];
  // Cargo locates the host MSVC toolchain itself (vswhere); upstream Bun needs no wrapper.
  return runNativeResult(config, argv, { root, cwd, timeoutMs, runtimePolicy }, captureStdout);
}

export interface CargoWorkspaceReport {
  version: string;
  bunPackageNames: string[];
  workspaceRoot: string;
  targetDirectory: string;
  packageNames: string[];
}

/** Verify the actual Cargo owner and output path through the native admission wrapper. */
export async function inspectCargoWorkspace(
  config: Config,
  options: RuntimeExecutionOptions = {},
): Promise<CargoWorkspaceReport> {
  const root = resolve(options.root ?? repositoryRoot);
  const product = (await Bun.file(join(root, "package.json")).json()) as {
    version?: string;
    workspaces?: string[];
    workspaceVersionExceptions?: Record<string, { name: string; version: string; revision: string }>;
  };
  const manifest = Bun.TOML.parse(await Bun.file(join(root, "Cargo.toml")).text()) as {
    workspace?: { package?: { version?: string } };
  };
  if (!product.version || manifest.workspace?.package?.version !== product.version)
    throw new Error("Bun and Cargo product versions differ.");
  const bunPackageNames: string[] = [];
  const bunManifests = new Set<string>();
  const versionExceptions = product.workspaceVersionExceptions ?? {};
  if (!object(versionExceptions)) throw new Error("Invalid workspace version exceptions.");
  for (const [path, exception] of Object.entries(versionExceptions)) {
    if (
      !/^vendor\/[\w.-]+$/.test(path) ||
      !object(exception) ||
      typeof exception.name !== "string" ||
      !exception.name ||
      typeof exception.version !== "string" ||
      !exception.version ||
      typeof exception.revision !== "string" ||
      !/^[a-f0-9]{40}$/.test(exception.revision)
    )
      throw new Error(`Invalid independent workspace version: ${path}`);
    const pin = await command(["git", "ls-files", "--stage", "--", path], root);
    if (pin.code !== 0 || pin.stdout.trim() !== `160000 ${exception.revision} 0\t${path}`)
      throw new Error(`Independent workspace version requires its declared Git pin: ${path}`);
  }
  for (const member of product.workspaces ?? []) {
    const pattern = member.replaceAll("\\", "/").replace(/\/$/, "");
    checkoutPath(root, `${pattern}/package.json`);
    if (pattern.includes("**")) throw new Error("Recursive Bun workspace patterns are not product members.");
    let matched = false;
    for await (const path of new Bun.Glob(`${pattern}/package.json`).scan({
      cwd: root,
      onlyFiles: true,
      followSymlinks: false,
    })) {
      bunManifests.add(checkoutPath(root, path));
      matched = true;
    }
    if (!matched) throw new Error(`Bun workspace pattern has no package manifests: ${member}`);
  }
  for (const path of [...bunManifests].sort()) {
    const entry = (await Bun.file(path).json()) as {
      name?: string;
      version?: string;
    };
    const directory = relative(root, dirname(path)).replaceAll("\\", "/");
    const independent = versionExceptions[directory];
    if (
      !entry.name ||
      (independent
        ? entry.name !== independent.name || entry.version !== independent.version
        : entry.version !== product.version)
    )
      throw new Error(`Bun workspace package version differs: ${relative(root, path)}`);
    if (bunPackageNames.includes(entry.name))
      throw new Error(`Duplicate Bun workspace package identity: ${entry.name}`);
    bunPackageNames.push(entry.name);
  }
  for (const path of Object.keys(versionExceptions)) {
    if (!bunManifests.has(join(root, path, "package.json")))
      throw new Error(`Independent workspace version is not a declared member: ${path}`);
  }
  const result = await serializedCargo(
    config,
    ["metadata", "--locked", "--no-deps", "--format-version", "1", "--manifest-path", join(root, "Cargo.toml")],
    root,
    root,
    // The first cargo call on a fresh runner installs the pinned nightly toolchain before it reads ~500 manifests.
    options.timeoutMs ?? syncDeadline,
    true,
    options.runtimePolicy,
  );
  if (result.code !== 0)
    throw new Error(`Root Cargo workspace metadata failed: ${result.stderr.trim().split("\n").slice(-3).join(" ")}`);
  const value: unknown = JSON.parse(result.stdout);
  if (
    !object(value) ||
    typeof value.workspace_root !== "string" ||
    typeof value.target_directory !== "string" ||
    resolve(value.workspace_root) !== root ||
    resolve(value.target_directory) !== join(root, "target") ||
    !Array.isArray(value.workspace_members) ||
    !Array.isArray(value.packages)
  ) {
    throw new Error("Cargo workspace or target directory differs from the product root.");
  }
  const members = new Set(value.workspace_members);
  const gitlinks = await command(["git", "ls-files", "--stage", "--", "crates"], root);
  if (gitlinks.code !== 0) throw new Error("Crate Git index inspection failed.");
  const pinnedCrates = new Map<string, string>();
  for (const line of gitlinks.stdout.split("\n")) {
    const match = /^160000 ([0-9a-f]{40}) 0\t(crates\/[^/]+)$/.exec(line.trim());
    if (match?.[1] && match[2]) pinnedCrates.set(match[2], match[1]);
  }
  const packageNames: string[] = [];
  for (const entry of value.packages) {
    if (!object(entry) || !members.has(entry.id)) continue;
    if (
      typeof entry.name !== "string" ||
      typeof entry.manifest_path !== "string" ||
      typeof entry.version !== "string"
    ) {
      throw new Error("Cargo workspace member lacks its package identity.");
    }
    if (options.cargoContract === "members") {
      packageNames.push(entry.name);
      continue;
    }
    const cratePath = `crates/${entry.name}`;
    if (resolve(entry.manifest_path) !== join(root, cratePath, "Cargo.toml"))
      throw new Error(`Cargo crate must be flat under crates: ${entry.name}`);
    const expectedRevision = pinnedCrates.get(cratePath);
    if (!expectedRevision) throw new Error(`Cargo crate is not a pinned Git submodule: ${entry.name}`);
    const actualRevision = await command(["git", "rev-parse", "HEAD"], join(root, cratePath));
    if (actualRevision.code !== 0 || actualRevision.stdout.trim() !== expectedRevision)
      throw new Error(`Cargo crate revision differs from its Git pin: ${entry.name}`);
    packageNames.push(entry.name);
  }
  if (packageNames.length !== members.size || packageNames.length === 0) {
    throw new Error("Cargo workspace membership is incomplete.");
  }
  return {
    version: product.version,
    bunPackageNames: bunPackageNames.sort(),
    workspaceRoot: root,
    targetDirectory: join(root, "target"),
    packageNames: packageNames.sort(),
  };
}

export async function cargoModule(
  config: Config,
  id: string,
  action: "check" | "build" | "run",
  args: string[] = [],
  options: ExecutionOptions = {},
): Promise<number> {
  assertRuntime(config);
  const root = options.root ?? repositoryRoot;
  const module = await requireModule(config, id, root);
  const cargo = await resolveCargoModule(module, root);
  const flags = [action, "--locked", "--manifest-path", cargo.manifest];
  if (cargo.cargoPackage) flags.push("--package", cargo.cargoPackage);
  else if (cargo.cargoPackages.length) {
    for (const name of cargo.cargoPackages) flags.push("--package", name);
  } else flags.push("--workspace");
  if (action === "run") {
    if (!cargo.binary) throw new Error(`Library has no headless CLI: ${id}`);
    flags.push("--bin", cargo.binary, "--", ...args);
  } else {
    if (args.length) throw new Error(`${action} accepts only a library ID.`);
    if (action === "build") flags.push("--release");
  }
  return (await serializedCargo(config, flags, cargo.directory, root, options.timeoutMs ?? cargoDeadline)).code;
}

export async function runModule(
  config: Config,
  id: string,
  args: string[] = [],
  options: ExecutionOptions = {},
): Promise<number> {
  assertRuntime(config);
  const root = options.root ?? repositoryRoot;
  const module = await requireModule(config, id, root);
  const selected = (await localBinaries(config, root))[id];
  if (selected) {
    return (
      await command(
        [selected, ...args],
        moduleDirectory(root, module.path, module.sourceKind),
        options.timeoutMs ?? runDeadline,
        true,
      )
    ).code;
  }
  const cargo = await resolveCargoModule(module, root);
  if (!cargo.binary || module.role !== "engine" || cargo.binary !== `${id}-cli`)
    throw new Error(`Library has no headless CLI: ${id}`);
  const build = await serializedCargo(
    config,
    [
      "build",
      "--release",
      "--locked",
      "--manifest-path",
      cargo.manifest,
      "--package",
      cargo.cargoPackage!,
      "--bin",
      cargo.binary,
      "--message-format=json",
    ],
    cargo.directory,
    root,
    Math.min(cargoDeadline, options.timeoutMs ?? cargoDeadline),
    true,
  );
  let binary: string | null = null;
  for (const line of build.stdout.split("\n")) {
    try {
      const artifact = JSON.parse(line) as {
        reason?: string;
        executable?: string;
        target?: { name?: string; kind?: string[] };
        message?: { rendered?: string };
      };
      if (artifact.reason === "compiler-message" && artifact.message?.rendered) {
        console.error(artifact.message.rendered);
      }
      if (
        artifact.reason === "compiler-artifact" &&
        artifact.target?.name === cargo.binary &&
        artifact.target.kind?.includes("bin") &&
        typeof artifact.executable === "string"
      ) {
        binary = artifact.executable;
      }
    } catch {
      // Native owner diagnostics may accompany Cargo's JSON output.
    }
  }
  if (build.code !== 0) return build.code;
  if (!binary || !(await Bun.file(binary).exists())) {
    throw new Error(`Cargo did not report a headless CLI artifact: ${id}`);
  }
  // Release the build mutex before starting the headless CLI.
  return (await command([binary, ...args], cargo.directory, options.timeoutMs ?? runDeadline, true)).code;
}
