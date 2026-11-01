// SPDX-License-Identifier: Apache-2.0
import { $ } from "bun";
import { existsSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { infraRoot, runInfra } from "./runtime.ts";
import { factoryTransientShell, validateFactoryCleanup, type FactoryCleanupPolicy } from "./build-factory-cleanup.ts";
import {
  factorySourceScope,
  selectedSourceClean,
  selectedSourcePrelude,
  selectedSourceSetup,
  selectedSourceVerify,
} from "./build-factory-source.ts";

export interface BuildFactoryConfig {
  schemaVersion: number;
  enabled: boolean;
  target: string;
  windowsFactory?: {
    host: string;
    target: string;
    enabled: boolean;
    nativeArchitectures: string[];
    crossArchitectures: string[];
    maxJobs: number;
    reserveMemoryGiB: number;
    reserveDiskGiB: number;
    scope: string[];
    execution: "local-windows";
  };
  executionOnlyTargets?: string[];
  cacheRoot: string;
  artifactRoot: string;
  lockPath: string;
  repositories: Record<string, string>;
  rust: { maxJobs: number };
  resources?: {
    reserveMemoryGiB?: number;
    reserveDiskGiB?: number;
    memoryPerJobGiB?: number;
  };
  commandTimeoutSeconds?: number;
  /** Local activation of built binaries (defaults: ~/.local/bin, ~/.local/lib/aphrody). */
  install?: unknown;
  cleanup?: FactoryCleanupPolicy;
}

function shellQuote(value: string): string {
  if (value.includes("\0")) throw new Error("Build argument contains NUL");
  return $.escape(value);
}

function absolutePath(value: string, field: string): string {
  if (!value || !value.startsWith("/") || posix.normalize(value) !== value)
    throw new Error(`Invalid build factory ${field}: expected a normalized absolute path`);
  return value;
}

function sourceLockPath(config: BuildFactoryConfig, repository: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(repository)) throw new Error("Invalid factory repository lock identity");
  return posix.join(posix.dirname(config.lockPath), `${repository}.source.lock`);
}

export function factoryResourcePolicy(config: Pick<BuildFactoryConfig, "rust" | "resources">) {
  const policy = {
    jobs: config.rust.maxJobs,
    reserveMemoryGiB: config.resources?.reserveMemoryGiB ?? 4,
    reserveDiskGiB: config.resources?.reserveDiskGiB ?? 20,
    memoryPerJobGiB: config.resources?.memoryPerJobGiB ?? 1,
  };
  if (!Number.isSafeInteger(policy.jobs) || policy.jobs < 1)
    throw new Error("Build factory rust.maxJobs must be a positive safe integer");
  for (const value of [policy.reserveMemoryGiB, policy.reserveDiskGiB, policy.memoryPerJobGiB])
    if (!Number.isFinite(value) || value < 0 || value > 1024) throw new Error("Invalid build factory resource reserve");
  return policy;
}

/** Fresh measurements belong to the executing host, after its kernel leases are held. */
export function admitFactoryResources(
  policy: ReturnType<typeof factoryResourcePolicy>,
  observed: {
    cpus: number;
    availableMemoryGiB: number;
    cacheDiskGiB: number;
    artifactDiskGiB: number;
  },
) {
  if (
    !Number.isSafeInteger(observed.cpus) ||
    observed.cpus < 1 ||
    [observed.availableMemoryGiB, observed.cacheDiskGiB, observed.artifactDiskGiB].some(
      value => !Number.isFinite(value) || value < 0,
    )
  )
    throw new Error("Build factory host resource measurements are unavailable");
  if (
    policy.jobs > observed.cpus ||
    observed.availableMemoryGiB < policy.reserveMemoryGiB + policy.jobs * policy.memoryPerJobGiB ||
    Math.min(observed.cacheDiskGiB, observed.artifactDiskGiB) < policy.reserveDiskGiB
  )
    throw new Error("Build factory host capacity cannot preserve its declared CPU, memory or disk reserves");
  return { policy, observed };
}

/** Generated for the execution host; measurements happen only when its locks are held. */
export function factoryResourceAdmissionProgram(
  policy: ReturnType<typeof factoryResourcePolicy>,
  paths: { cache: string; artifacts: string },
  options: { autoJobs?: boolean; reportJobs?: boolean } = {},
): string {
  return String.raw`
const {availableParallelism}=await import('node:os');
const {statfs}=await import('node:fs/promises');
const memory=await Bun.file('/proc/meminfo').text();
const available=/^MemAvailable:\s+(\d+)\s+kB$/m.exec(memory)?.[1];
if(!available)throw Error('Build factory available memory unknown');
const cpus=availableParallelism();
const policy=${JSON.stringify(policy)};
${options.autoJobs ? "policy.jobs=Math.min(policy.jobs,cpus);" : ""}
const disks=await Promise.all(${JSON.stringify([paths.cache, paths.artifacts])}.map(async path=>{const s=await statfs(path);return Number(s.bavail)*Number(s.bsize)/1073741824}));
(${admitFactoryResources.toString()})(policy,{cpus,availableMemoryGiB:Number(available)/1048576,cacheDiskGiB:disks[0],artifactDiskGiB:disks[1]});
${options.reportJobs ? "console.log(policy.jobs);" : ""}
`;
}

/** Builds share the heavy lock and hold their source lock; Cargo retains its owner lock. */
export function buildFactoryPlan(
  config: BuildFactoryConfig,
  repository: string,
  revision: string,
  command: readonly string[],
  options: { submodules?: readonly string[] } = {},
) {
  const sourceScope = factorySourceScope(options.submodules);
  if (config.executionOnlyTargets?.includes(config.target))
    throw new Error(`Build target ${config.target} is execution-only; designate a new factory host`);
  if (config.schemaVersion !== 1 || !config.enabled || config.target !== "vps")
    throw new Error("Build factory must be enabled on the canonical vps target");
  if (!Object.hasOwn(config.repositories, repository))
    throw new Error(`Unknown build factory repository: ${repository}`);
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("A full pinned Git revision is required");
  if (!command.length || !command[0]) throw new Error("An owner command is required after --");
  const resources = factoryResourcePolicy(config);
  const commandTimeoutSeconds = config.commandTimeoutSeconds ?? 21600;
  if (!Number.isSafeInteger(commandTimeoutSeconds) || commandTimeoutSeconds < 1 || commandTimeoutSeconds > 86400)
    throw new Error("Build factory commandTimeoutSeconds must be between 1 and 86400");
  const root = absolutePath(config.repositories[repository]!, "repository");
  const cache = absolutePath(config.cacheRoot, "cacheRoot");
  const artifacts = absolutePath(config.artifactRoot, "artifactRoot");
  const lock = absolutePath(config.lockPath, "lockPath");
  if (config.cleanup) validateFactoryCleanup(config, config.cleanup);
  const environment = [
    "APHRODY_BUILD_HOST=vps",
    `APHRODY_CARGO_JOBS=${config.rust.maxJobs}`,
    `CARGO_BUILD_JOBS=${config.rust.maxJobs}`,
    "CARGO_INCREMENTAL=0",
    "CARGO_NET_GIT_FETCH_WITH_CLI=true",
    `APHRODY_CARGO_LOCK_DIR=${posix.dirname(lock)}`,
    `SCCACHE_DIR=${cache}/sccache`,
    `BUN_INSTALL_CACHE_DIR=${cache}/bun`,
    `UV_CACHE_DIR=${cache}/uv`,
    `APHRODY_ARTIFACT_ROOT=${artifacts}`,
  ];
  // Yolo/IECODE packaging consumes canonical target/ layouts; retain them while sharing sccache.
  if (repository === "aphrody")
    environment.push(
      `CARGO_TARGET_DIR=${cache}/cargo/${repository}`,
      `APHRODY_CARGO_TARGET_DIR=${cache}/cargo/${repository}`,
    );
  // Verify inside the lock: no queued job can consume a changed source revision.
  const body = [
    "set -euo pipefail",
    'export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"',
    `cd -- ${shellQuote(root)}`,
    `test "$(git rev-parse HEAD)" = ${shellQuote(revision)} || { echo 'Build factory source revision differs from the requested pin' >&2; exit 2; }`,
    ...(sourceScope.kind === "gitlinks"
      ? [...selectedSourcePrelude(sourceScope, revision), ...selectedSourceClean(), ...selectedSourceVerify()]
      : [
          "test -z \"$(git status --porcelain --untracked-files=all --ignore-submodules=none)\" || { echo 'Build factory source checkout is dirty' >&2; exit 2; }",
          `git submodule foreach --quiet --recursive 'test -z "$(git status --porcelain --untracked-files=all --ignore-submodules=none)"'`,
        ]),
    ...(config.cleanup
      ? factoryTransientShell(config.cleanup.transientRoot, "docker", config.lockPath, config.cleanup.privilegeBinary)
      : []),
    // Execute the same admission owner natively; planning never substitutes controller capacity.
    `bun --no-env-file -e ${shellQuote(factoryResourceAdmissionProgram(resources, { cache, artifacts }))}`,
    `${config.cleanup ? "" : "exec "}env ${environment.map(shellQuote).join(" ")} ${command.map(shellQuote).join(" ")}`,
  ].join("\n");
  // The supervisor owns the descriptor; long-lived cache daemons must not inherit it.
  const remoteCommand = `flock --close -- ${shellQuote(lock)} flock --close -- ${shellQuote(sourceLockPath(config, repository))} bash -c ${shellQuote(body)}`;
  return {
    repository,
    revision,
    target: config.target,
    workspace: root,
    command: [...command],
    sourceScope,
    serialized: true,
    commandTimeoutSeconds,
    transport: ["ssh", "exec", "--host", config.target, "--cmd", remoteCommand],
  };
}

export interface FactorySource {
  path: string;
  remote: string;
  url: string;
  owners: readonly string[];
  repositoryName: string;
  branch: string;
}

/** Keep credentials out of plans and reject undeclared Git hosts, aliases and repositories. */
export function factoryRemoteUrl(url: string, repository: string, owners: readonly string[]): string {
  const match =
    /^(?:https:\/\/github\.com\/|git@(?:github\.com|github-dev):|ssh:\/\/git@(?:github\.com|github-dev)\/)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/u.exec(
      url,
    );
  if (!match || !owners.includes(match[1]!) || match[2] !== repository) {
    throw new Error("Factory source remote is not the declared private owner repository");
  }
  return `https://github.com/${match[1]}/${match[2]}.git`;
}

const FACTORY_GIT = `git() { command git -c credential.helper= -c 'credential.helper=!gh auth git-credential' -c 'url.https://github.com/.insteadOf=git@github-dev:' -c 'url.https://github.com/.insteadOf=git@github.com:' -c 'url.https://github.com/.insteadOf=ssh://git@github-dev/' -c 'url.https://github.com/.insteadOf=ssh://git@github.com/' "$@"; }`;

function factoryDirectory(path: string): string {
  const quoted = shellQuote(path);
  return `test "$(realpath -m -- ${quoted})" = ${quoted} || { echo 'Factory path resolves outside its declared location; preserved' >&2; exit 2; }; if [ ! -e ${quoted} ]; then install -d -- ${quoted} 2>/dev/null || sudo -n install -d -o "$(id -un)" -g "$(id -gn)" -- ${quoted}; fi; test -d ${quoted} || { echo 'Factory path is not a directory; preserved' >&2; exit 2; }`;
}

/** Verify the declared canonical checkout without changing its branch, files or gitlinks. */
export function buildFactoryPreparePlan(
  config: BuildFactoryConfig,
  repository: string,
  revision: string,
  source: FactorySource,
  options: { initializeSubmodules?: boolean; submodules?: readonly string[] } = {},
) {
  const sourceScope = factorySourceScope(options.submodules);
  if (sourceScope.kind === "gitlinks" && options.initializeSubmodules === false)
    throw new Error("Selected submodules cannot be combined with --no-submodules");
  const validation = buildFactoryPlan(config, repository, revision, ["git", "status"], options);
  if (validation.workspace === "/") throw new Error("Factory repository cannot be the filesystem root");
  for (const path of [config.cacheRoot, config.artifactRoot, config.lockPath]) {
    if (path === validation.workspace || path.startsWith(`${validation.workspace}/`))
      throw new Error("Factory caches, artifacts and locks must stay outside source checkouts");
  }
  if (!source.path || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(source.remote) || source.remote === "legacy-aphrody")
    throw new Error("Invalid declared factory source path or remote");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(source.repositoryName) ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(source.branch) ||
    source.branch.includes("..") ||
    source.branch.endsWith("/") ||
    source.branch.includes("//")
  )
    throw new Error("Invalid declared factory repository name or branch");
  const remote = factoryRemoteUrl(source.url, source.repositoryName, source.owners);
  const normalizedExisting = [
    remote,
    remote.replace(/\.git$/, ""),
    remote.replace("https://github.com/", "git@github-dev:"),
    remote.replace("https://github.com/", "git@github.com:"),
    remote.replace("https://github.com/", "ssh://git@github-dev/"),
    remote.replace("https://github.com/", "ssh://git@github.com/"),
  ];
  const clean = `test -z "$(git status --porcelain --untracked-files=all --ignore-submodules=none)" || { echo 'Factory source checkout is dirty; preserved' >&2; exit 2; }`;
  const pinnedChild = `${clean}\ntest "$(git rev-parse HEAD)" = "$sha1" || { echo 'Factory submodule revision differs from its gitlink; preserved' >&2; exit 2; }`;
  const remoteRef = `refs/remotes/${source.remote}/${source.branch}`;
  const body = [
    "set -euo pipefail",
    'export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH" GIT_TERMINAL_PROMPT=0',
    FACTORY_GIT,
    `root=${shellQuote(validation.workspace)}`,
    `test "$(realpath -m -- "$root")" = "$root" || { echo 'Factory source path resolves elsewhere; preserved' >&2; exit 2; }`,
    'test -d "$root" && { [ -d "$root/.git" ] || [ -f "$root/.git" ]; } || { echo "Canonical factory checkout is absent; synchronize its owner first" >&2; exit 2; }',
    'cd -- "$root"',
    `test "$(git rev-parse --show-toplevel)" = "$root" || { echo 'Factory source is not its declared Git root; preserved' >&2; exit 2; }`,
    `origin=$(git config --get-all ${shellQuote(`remote.${source.remote}.url`)})`,
    `case "$origin" in ${normalizedExisting.map(shellQuote).join("|")}) ;; *) echo 'Existing factory origin differs from the declared private repository; preserved' >&2; exit 2 ;; esac`,
    `test "$(git symbolic-ref --quiet --short HEAD)" = ${shellQuote(source.branch)} || { echo 'Canonical factory branch differs from its declaration; preserved' >&2; exit 2; }`,
    `test "$(git rev-parse HEAD)" = ${shellQuote(revision)} || { echo 'Canonical factory HEAD differs from requested pin; synchronize its owner first; preserved' >&2; exit 2; }`,
    ...(sourceScope.kind === "gitlinks"
      ? [...selectedSourceSetup(sourceScope, revision), ...selectedSourceClean()]
      : [clean]),
    `git fetch --prune --tags --filter=blob:none ${shellQuote(source.remote)} ${shellQuote(`refs/heads/${source.branch}:${remoteRef}`)}`,
    `git merge-base --is-ancestor ${shellQuote(revision)} ${shellQuote(remoteRef)} || { echo 'Requested source revision is not on the declared remote branch history' >&2; exit 2; }`,
    ...(sourceScope.kind === "gitlinks"
      ? selectedSourceVerify()
      : [
          `git submodule foreach --quiet --recursive ${shellQuote(pinnedChild)}`,
          "factory_module_status=$(git submodule status --recursive)",
          ...(options.initializeSubmodules === false
            ? []
            : [
                'while IFS= read -r line; do case "$line" in [-+U]*) echo "Factory closure contains an uninitialized or mismatched submodule; preserved" >&2; exit 2 ;; esac; done <<< "$factory_module_status"',
              ]),
        ]),
    `test "$(git rev-parse HEAD)" = ${shellQuote(revision)}`,
    `test "$(git symbolic-ref --quiet --short HEAD)" = ${shellQuote(source.branch)}`,
    ...(sourceScope.kind === "gitlinks" ? selectedSourceClean() : [clean]),
    "echo 'Canonical factory source verified; no checkout or build started'",
  ].join("\n");
  const lockPath = sourceLockPath(config, repository);
  const remoteCommand = `set -euo pipefail\n${factoryDirectory(posix.dirname(lockPath))}\nflock --close -- ${shellQuote(lockPath)} bash -c ${shellQuote(body)}`;
  return {
    operation: "prepare" as const,
    initializesSubmodules: false,
    sourceScope,
    lockPath,
    repository,
    revision,
    target: validation.target,
    workspace: validation.workspace,
    source: {
      path: resolve(source.path),
      remote: source.remote,
      url: remote,
      repositoryName: source.repositoryName,
      branch: source.branch,
    },
    serialized: true,
    commandTimeoutSeconds: validation.commandTimeoutSeconds,
    transport: ["ssh", "exec", "--host", validation.target, "--cmd", remoteCommand],
  };
}
async function declaredFactorySource(root: string, repository: string, revision: string): Promise<FactorySource> {
  const { loadSourceSyncConfig } = await import("./source-sync.ts");
  const config = await loadSourceSyncConfig(root);
  const source = config.repositories.find(entry => entry.id === repository);
  if (!source) throw new Error("Factory source must be a declared repository");
  const git = async (args: string[]): Promise<string> => {
    const child = Bun.spawn(["git", ...args], {
      windowsHide: true,
      cwd: source.path,
      stdout: "pipe",
      stderr: "ignore",
      timeout: config.commandTimeoutMs,
    });
    const output = await new Response(child.stdout).text();
    if ((await child.exited) !== 0) throw new Error("Cannot inspect declared factory source");
    return output.trim();
  };
  if (resolve(await git(["rev-parse", "--show-toplevel"])) !== resolve(source.path)) {
    throw new Error("Declared factory source must be the repository root");
  }
  await git(["cat-file", "-e", `${revision}^{commit}`]);
  const urls = (await git(["config", "--get-all", `remote.${source.remote}.url`])).split("\n");
  if (urls.length !== 1) throw new Error("Factory source requires one declared remote URL");
  return {
    path: source.path,
    remote: source.remote,
    url: urls[0]!,
    owners: config.owners,
    repositoryName: source.repositoryName ?? source.id,
    branch: source.destinationBranch,
  };
}

export interface BuildFactoryStatus {
  configured: boolean;
  enabled: boolean;
  target: string | null;
  host: string | null;
  localCargo: boolean;
  route: "factory" | "local";
  reason: string;
}

export async function readFactoryConfig(root: string): Promise<BuildFactoryConfig | null> {
  const file = Bun.file(join(root, "tools/aphrody/config/build-factory.json"));
  return (await file.exists()) ? ((await file.json()) as BuildFactoryConfig) : null;
}

/** Heavy-work route; `localCargo` honours the scoped cargo-serial diagnostic override only. */
export function heavyBuildStatus(
  config: BuildFactoryConfig | null,
  env: Record<string, string | undefined>,
  honourLocalCargo = true,
): BuildFactoryStatus {
  const host = env.APHRODY_BUILD_HOST || null;
  const localCargo = honourLocalCargo && env.APHRODY_LOCAL_CARGO === "1";
  const status = {
    configured: config !== null,
    enabled: config?.enabled === true,
    target: config?.target ?? null,
    host,
    localCargo,
  };
  const local = (reason: string) => ({
    ...status,
    route: "local" as const,
    reason,
  });
  if (!config) return local("tools/aphrody/config/build-factory.json is absent");
  if (env.CLAUDE_CODE_REMOTE === "true") return local("Claude Code cloud session: builds run in the session");
  if (env.APHRODY_CLOUD === "1") return local("APHRODY_CLOUD=1 (cloud session or container): builds run in place");
  if (env.GITHUB_ACTIONS === "true" || env.CI === "true") return local("CI/GitHub Actions runner: builds run in place");
  if (env.CODESPACES === "true" || env.GITPOD_WORKSPACE_ID !== undefined || env.CLOUD_SHELL === "true")
    return local("Cloud developer environment: builds run in place");
  if (existsSync("/.dockerenv") || env.CONTAINER === "true") return local("Container runtime: builds run in place");
  if (config.executionOnlyTargets?.includes(config.target)) {
    if (localCargo && host !== config.target) return local("APHRODY_LOCAL_CARGO=1 selects a scoped local diagnostic");
    return {
      ...status,
      route: "factory" as const,
      reason: `${config.target} is execution-only; a new factory host is required`,
    };
  }
  if (host === "vps") return local("running on the factory host");
  if (!status.enabled) return local("build factory disabled");
  if (localCargo) return local("APHRODY_LOCAL_CARGO=1 selects a scoped local diagnostic");
  return {
    ...status,
    route: "factory",
    reason: `heavy work runs on ${config.target}`,
  };
}

/** Source-owner gates use this before heavy work; static/planning callers never dispatch. */
export async function routeHeavyBuild(command: string[], root: string): Promise<number | undefined> {
  const config = await readFactoryConfig(root);
  if (!config || heavyBuildStatus(config, process.env, false).route === "local") return undefined;
  const git = async (args: string[]): Promise<string> => {
    const child = Bun.spawn(["git", ...args], {
      windowsHide: true,
      cwd: root,
      stdout: "pipe",
      stderr: "inherit",
    });
    const output = await new Response(child.stdout).text();
    if ((await child.exited) !== 0) throw new Error("Cannot qualify the build factory source revision");
    return output.trim();
  };
  const revision = await git(["rev-parse", "HEAD"]);
  if (await git(["status", "--porcelain", "--untracked-files=normal"]))
    throw new Error(
      "Heavy builds run on vps from committed source. The local checkout is dirty; commit the scoped batch before dispatch, or inspect build-factory plan with an explicit revision. Uncommitted source will not be silently omitted.",
    );
  const plan = buildFactoryPlan(config, "aphrody", revision, command);
  console.error(`Build factory: ${plan.repository} ${revision} on ${plan.target}`);
  const built = (
    await runInfra({
      args: plan.transport,
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
      env: {
        APHRODY_SSH_COMMAND_TIMEOUT_SECS: String(plan.commandTimeoutSeconds),
      },
    })
  ).exitCode;
  // Routed release builds activate their binaries locally; APHRODY_FACTORY_INSTALL=0 opts out.
  if (built !== 0 || process.env.APHRODY_FACTORY_INSTALL === "0" || !isReleaseBuild(command)) return built;
  return installFactoryBuild(config, "aphrody", revision, command, [], root);
}

function isReleaseBuild(command: readonly string[]): boolean {
  const build = command.findIndex(arg => arg === "build" || arg === "b");
  return (
    build !== -1 &&
    command.slice(build + 1).some(arg => arg === "--release" || arg === "-r" || arg === "--profile=release")
  );
}

interface FactoryJobTransport {
  operation: "submit" | "status";
  jobId: string;
  target: string;
  transport: string[];
  fingerprint?: string;
  repository?: string;
  revision?: string;
  installRequested?: boolean;
}

/** Transport failures are ambiguous after submission; a stable job is never automatically replayed. */
async function runFactoryJobTransport(plan: FactoryJobTransport, root: string): Promise<number> {
  const unknown = (error: string, transportExitCode?: number) => {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        success: false,
        operation: plan.operation,
        jobId: plan.jobId,
        target: plan.target,
        ...(plan.fingerprint ? { fingerprint: plan.fingerprint } : {}),
        status: "unknown",
        dispatchConfirmed: false,
        reconciliationRequired: true,
        ...(transportExitCode === undefined ? {} : { transportExitCode }),
        error: error.slice(-16384),
      }),
    );
    return transportExitCode && transportExitCode > 0 && transportExitCode <= 255 ? transportExitCode : 2;
  };
  let result;
  try {
    result = await runInfra({
      args: plan.transport,
      cwd: root,
      env: { APHRODY_SSH_COMMAND_TIMEOUT_SECS: "60" },
    });
  } catch (error) {
    return unknown(error instanceof Error ? error.message : "Factory job transport failed");
  }
  if (result.exitCode !== 0)
    return unknown(result.stderr.slice(-16384) || "Factory job transport failed", result.exitCode);
  try {
    if (Buffer.byteLength(result.stdout, "utf8") > 1048576) throw new Error("Factory job receipt exceeds its budget");
    const receipt = JSON.parse(result.stdout);
    if (
      !receipt ||
      typeof receipt !== "object" ||
      receipt.schemaVersion !== 1 ||
      receipt.jobId !== plan.jobId ||
      receipt.target !== plan.target ||
      !/^[a-f0-9]{64}$/u.test(receipt.fingerprint ?? "") ||
      (plan.fingerprint !== undefined && receipt.fingerprint !== plan.fingerprint) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(receipt.repository ?? "") ||
      !/^[a-f0-9]{40}$/u.test(receipt.revision ?? "") ||
      (plan.repository !== undefined && receipt.repository !== plan.repository) ||
      (plan.revision !== undefined && receipt.revision !== plan.revision) ||
      !["queued", "active", "succeeded", "failed", "indeterminate"].includes(receipt.status) ||
      !["dispatch", "complete"].includes(receipt.phase) ||
      typeof receipt.requestedAt !== "string" ||
      !Number.isFinite(Date.parse(receipt.requestedAt)) ||
      (plan.operation === "submit" && !["created", "existing"].includes(receipt.submission))
    )
      throw new Error("Factory job receipt does not match the requested identity");
    if (
      receipt.status === "active" &&
      (!Number.isSafeInteger(receipt.pid) || receipt.pid < 1 || receipt.processAlive !== true)
    )
      throw new Error("Factory active receipt lacks a live supervisor identity");
    const terminal = receipt.status === "succeeded" || receipt.status === "failed";
    if (
      terminal &&
      (receipt.phase !== "complete" ||
        !Number.isSafeInteger(receipt.exitCode) ||
        receipt.exitCode < 0 ||
        receipt.exitCode > 255 ||
        (receipt.exitCode === 0) !== (receipt.status === "succeeded") ||
        typeof receipt.finishedAt !== "string" ||
        !Number.isFinite(Date.parse(receipt.finishedAt)))
    )
      throw new Error("Factory job terminal receipt is invalid");
    if (!terminal && (receipt.phase !== "dispatch" || receipt.exitCode !== undefined))
      throw new Error("Factory job receipt asserts an unproven exit");
    console.log(
      JSON.stringify(
        {
          ...receipt,
          operation: plan.operation,
          success: true,
          dispatchConfirmed: plan.operation === "submit",
          reconciliationRequired: receipt.status === "indeterminate",
          ...(plan.operation === "submit" && plan.installRequested
            ? {
                install: {
                  status: "pending",
                  next: "Poll build-factory status --job <id>; after succeeded, run the matching build-factory install --job <id> command.",
                },
              }
            : {}),
        },
        null,
        2,
      ),
    );
    return 0;
  } catch (error) {
    return unknown(error instanceof Error ? error.message : "Cannot decode factory job receipt");
  }
}

/** Quiet terminal-state poll of a detached job; transport errors are retried until the deadline. */
async function waitFactoryJob(
  config: BuildFactoryConfig,
  jobId: string,
  root: string,
  deadlineSeconds: number,
): Promise<"succeeded" | "failed" | "indeterminate"> {
  const { factoryJobStatusPlan } = await import("./build-factory-jobs.ts");
  const plan = factoryJobStatusPlan(config, jobId);
  const deadline = Date.now() + deadlineSeconds * 1000;
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- polling is sequential by definition.
    const result = await runInfra({
      args: plan.transport,
      cwd: root,
      env: { APHRODY_SSH_COMMAND_TIMEOUT_SECS: "60" },
    }).catch(() => null);
    if (result?.exitCode === 0) {
      const status = (() => {
        try {
          return JSON.parse(result.stdout).status as string;
        } catch {
          return "";
        }
      })();
      if (status === "succeeded" || status === "failed" || status === "indeterminate") return status;
    }
    if (Date.now() > deadline) return "indeterminate";
    // oxlint-disable-next-line no-await-in-loop -- polling interval.
    await Bun.sleep(30_000);
  }
}

/** Download, verify, probe and atomically link the binaries a successful factory build produced. */
async function installFactoryBuild(
  config: BuildFactoryConfig,
  repository: string,
  revision: string,
  command: readonly string[],
  only: readonly string[],
  root: string,
): Promise<number> {
  const { factoryArtifacts, factoryInstallConfig, infraRemote, installFactoryArtifacts } =
    await import("./build-factory-install.ts");
  const artifacts = await factoryArtifacts(config, repository, command, root, only);
  const records = await installFactoryArtifacts(
    artifacts,
    revision,
    infraRemote(config.target, args =>
      runInfra({
        args,
        cwd: root,
        env: { APHRODY_SSH_COMMAND_TIMEOUT_SECS: "900" },
      }),
    ),
    factoryInstallConfig(config.install),
  );
  const success = records.every(record => record.status !== "refused");
  console.log(JSON.stringify({ operation: "install", success, revision, records }, null, 2));
  return success ? 0 : 1;
}

/** Plan by default; run dispatches exclusively through the installed Infra SSH owner. */
async function runBuildFactoryAction(args: string[], root: string): Promise<number> {
  const separator = args.indexOf("--");
  const options = separator === -1 ? args : args.slice(0, separator);
  if (options.includes("--help") || options.includes("-h")) {
    console.log(
      "Usage: yolo ops build-factory <plan|run> --repo <aphrody|yolo|iecode> --revision <full-git-sha> [--submodules <gitlink[,gitlink]>] [--detach --job <stable-id>] -- <owner command> [arguments...]\n       yolo ops build-factory prepare --repo <aphrody|yolo> --revision <full-git-sha> [--apply] [--no-submodules | --submodules <gitlink[,gitlink]>]\n       yolo ops build-factory cleanup [--apply]\n       yolo ops build-factory status [--route]\n       yolo ops build-factory status --job <stable-id> [--tail <0..200>]\n       yolo ops build-factory run ... --install [--bin a,b] -- <cargo build command>\n       yolo ops build-factory install --repo <repo> --revision <sha> [--job <id>] [--bin a,b] -- <cargo build command>\n--install (run, including --detach which then waits for the job) and install download each derived binary over SFTP, verify its SHA-256 against the factory copy, refuse it unless `<bin> --version` runs on this host (glibc/ABI), then atomically relink it in install.binDir (default ~/.local/bin, on PATH) from install.libRoot/factory-<rev12>/. Previous links are recorded in install.stateFile for rollback.\nPreparation prints a plan by default; --apply verifies the existing canonical checkout at its declared remote branch and requested revision under its source lock. It never clones, switches branches, detaches HEAD or updates gitlinks; synchronize the owner first. Verification of disjoint sources can run concurrently; builds retain their shared heavy lock. --no-submodules permits uninitialized modules (initialized modules remain checked and pinned). It starts no build and preserves dirty, unowned and ignored files.\n--submodules verifies only selected root-tree gitlinks and their recursive descendants, plus parent source files/index. Unselected gitlinks are preserved; whole repository cleanliness is not asserted. Combine the same scope with plan/run. Selected scope cannot be combined with --no-submodules. Detached jobs retain the selected source scope in their request fingerprint.\nDetached jobs retain all owner locks and the requested pin, survive client disconnects and enforce the command timeout on the host including lease wait. Use an explicit stable id; the same id/request is idempotent, a conflicting request is refused. Status is read-only; active includes lease wait. Transport failure requires status reconciliation and never automatically replays a job.",
    );
    return 0;
  }
  const [action = "plan", ...rest] = args;
  if (action === "cleanup") {
    if (rest.some(arg => arg !== "--apply")) throw new Error("Usage: build-factory cleanup [--apply]");
    const config = await readFactoryConfig(root);
    if (!config?.cleanup) throw new Error("The factory cleanup policy is not declared");
    const { factoryCleanupScript } = await import("./build-factory-cleanup.ts");
    const script = factoryCleanupScript(config, config.cleanup, rest.includes("--apply"));
    const result = await runInfra({
      args: ["ssh", "exec", "--host", config.target, "--cmd", script],
      cwd: root,
      env: { APHRODY_SSH_COMMAND_TIMEOUT_SECS: "900" },
    });
    console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    return result.exitCode;
  }
  if (action === "status") {
    if (!rest.includes("--job")) {
      if (rest.some(arg => arg !== "--route"))
        throw new Error("Usage: build-factory status [--route] or --job <id> [--tail <0..200>]");
      const status = heavyBuildStatus(await readFactoryConfig(root), process.env);
      console.log(rest.length ? status.route : JSON.stringify(status, null, 2));
      return 0;
    }
    let jobId = "";
    let tailLines = 0;
    const seen = new Set<string>();
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i]!;
      if (!["--job", "--tail"].includes(arg) || seen.has(arg))
        throw new Error("Usage: build-factory status --job <id> [--tail <0..200>]");
      seen.add(arg);
      const value = rest[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--job") jobId = value;
      else {
        if (!/^\d+$/u.test(value)) throw new Error("Factory log tail requires 0..200 lines");
        tailLines = Number(value);
      }
    }
    const config = await readFactoryConfig(root);
    if (!config) throw new Error("tools/aphrody/config/build-factory.json is absent");
    const { factoryJobStatusPlan } = await import("./build-factory-jobs.ts");
    return runFactoryJobTransport(factoryJobStatusPlan(config, jobId, { tailLines }), root);
  }
  if (action !== "plan" && action !== "run" && action !== "prepare" && action !== "install")
    throw new Error("Expected build-factory plan, run, prepare or install");
  let repository = "aphrody";
  let revision = "";
  let command: string[] = [];
  let apply = false;
  let initializeSubmodules = true;
  let submodules: readonly string[] | undefined;
  let detach = false;
  let jobId = "";
  let install = action === "install";
  let only: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--") {
      if (action === "prepare") throw new Error("Factory preparation does not accept a build command");
      command = rest.slice(i + 1);
      break;
    }
    if (seen.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
    seen.add(arg);
    if (action === "prepare" && arg === "--no-submodules") {
      initializeSubmodules = false;
      continue;
    }
    if (action === "prepare" && arg === "--apply") {
      apply = true;
      continue;
    }
    if (action === "run" && arg === "--install") {
      install = true;
      continue;
    }
    if ((action === "run" || action === "install") && arg === "--bin") {
      const value = rest[++i];
      if (!value || value.startsWith("--")) throw new Error("--bin requires a value");
      only = value.split(",").filter(Boolean);
      continue;
    }
    if (action !== "prepare" && action !== "install" && arg === "--detach") {
      detach = true;
      continue;
    }
    if (
      arg !== "--repo" &&
      arg !== "--revision" &&
      arg !== "--submodules" &&
      !(action !== "prepare" && arg === "--job")
    )
      throw new Error(`Unknown argument: ${arg}`);
    const value = rest[++i];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    if (arg === "--repo") repository = value;
    else if (arg === "--revision") revision = value;
    else if (arg === "--submodules") {
      const scope = factorySourceScope(value.split(","));
      if (scope.kind === "gitlinks") submodules = scope.paths;
    } else jobId = value;
  }
  if (action !== "install" && detach !== Boolean(jobId))
    throw new Error("Detached jobs require both --detach and an explicit --job <stable-id>");
  if (only.length && !install) throw new Error("--bin selects binaries for --install");
  const config = await readFactoryConfig(root);
  if (!config) throw new Error("tools/aphrody/config/build-factory.json is absent");
  if (action === "prepare") {
    if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("A full pinned Git revision is required");
    const source = await declaredFactorySource(root, repository, revision);
    const plan = buildFactoryPreparePlan(config, repository, revision, source, {
      initializeSubmodules,
      submodules,
    });
    if (!apply) {
      console.log(JSON.stringify({ executed: false, ...plan }, null, 2));
      return 0;
    }
    const result = await runInfra({
      args: plan.transport,
      cwd: root,
      env: {
        APHRODY_SSH_COMMAND_TIMEOUT_SECS: String(plan.commandTimeoutSeconds),
      },
    });
    console.log(
      JSON.stringify(
        {
          executed: true,
          success: result.exitCode === 0,
          repository: plan.repository,
          revision: plan.revision,
          target: plan.target,
          workspace: plan.workspace,
          sourceScope: plan.sourceScope,
          stdout: result.stdout,
          stderr: result.stderr,
        },
        null,
        2,
      ),
    );
    return result.exitCode;
  }
  const plan = buildFactoryPlan(config, repository, revision, command, {
    submodules,
  });
  if (action === "install") {
    if (jobId && (await waitFactoryJob(config, jobId, root, 0)) !== "succeeded")
      throw new Error(`Factory job ${jobId} has not succeeded; nothing installed`);
    return installFactoryBuild(config, repository, revision, command, only, root);
  }
  if (detach) {
    const { factoryJobPlan } = await import("./build-factory-jobs.ts");
    const job = factoryJobPlan(config, plan, jobId);
    if (action === "plan") {
      console.log(
        JSON.stringify(
          {
            executed: false,
            detached: true,
            repository: plan.repository,
            revision: plan.revision,
            workspace: plan.workspace,
            command: plan.command,
            serialized: plan.serialized,
            ...job,
          },
          null,
          2,
        ),
      );
      return 0;
    }
    return runFactoryJobTransport(
      {
        ...job,
        repository: plan.repository,
        revision: plan.revision,
        installRequested: install,
      },
      root,
    );
  }
  if (action === "plan") {
    console.log(JSON.stringify({ executed: false, ...plan }, null, 2));
    return 0;
  }
  const built = (
    await runInfra({
      args: plan.transport,
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
      env: {
        APHRODY_SSH_COMMAND_TIMEOUT_SECS: String(plan.commandTimeoutSeconds),
      },
    })
  ).exitCode;
  if (built !== 0 || !install) return built;
  return installFactoryBuild(config, repository, revision, command, only, root);
}

export async function runBuildFactory(args: string[], root = infraRoot()): Promise<number> {
  try {
    return await runBuildFactoryAction(args, root);
  } catch (error) {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        success: false,
        executed: false,
        error: error instanceof Error ? error.message : "Build factory request failed",
      }),
    );
    return 2;
  }
}

if (import.meta.main) process.exit(await runBuildFactory(process.argv.slice(2)));
