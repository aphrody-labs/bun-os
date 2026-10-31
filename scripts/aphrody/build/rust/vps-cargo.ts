#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Windows/native -> VPS Cargo tunnel. Heavy Cargo runs on the SSH build host:
 * the exact local worktree (HEAD plus uncommitted and untracked files, `.gitignore` respected) is
 * snapshotted into the configured workspace ref, sent to a dedicated VPS checkout and built through
 * `scripts/aphrody/build/rust/cargo-serial.sh` under the factory heavy lock, inside the remote tmux session.
 * Logs stream back live; artifacts come back with `fetch`. Configuration: infra/config/host/vps-cargo.json.
 *
 *   bun scripts/aphrody/build/rust/vps-cargo.ts tunnel up|down|status   local tmux: SSH master + git daemon
 *   bun scripts/aphrody/build/rust/vps-cargo.ts sync [--pull]           snapshot + checkout on the VPS
 *   bun scripts/aphrody/build/rust/vps-cargo.ts run [--jobs N] [--pull] -- <cargo args>
 *   bun scripts/aphrody/build/rust/vps-cargo.ts logs <job>              replay a remote job log
 *   bun scripts/aphrody/build/rust/vps-cargo.ts fetch --bin <name> [--profile release] [--target <triple>] [--dest <dir>]
 *   bun scripts/aphrody/build/rust/vps-cargo.ts attach                  attach the remote tmux session
 *
 * `--repo <name>` (sync, run, fetch) builds an external repository declared under `repositories` in the config
 * (for example the private vu runtime repository) through the same tunnel, locks and wrapper: its own worktree is
 * snapshotted into its own ref, pushed to its own VPS checkout and built into its own target directory. The
 * repository does not carry a copy of `cargo-serial.sh`; the wrapper of the Aphrody checkout on the VPS is used.
 */
import { $ } from "bun";
import { mkdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, posix, resolve } from "node:path";
import { factoryTransientShell } from "@aphrody/bun-workspace/automation/build-factory-cleanup.ts";
import {
  factoryResourceAdmissionProgram,
  factoryResourcePolicy,
} from "@aphrody/bun-workspace/automation/build-factory.ts";

export type Forward = { bind: string; to: string; purpose?: string };
/** An external repository built through the tunnel (`--repo <name>`). */
export type RepositoryConfig = {
  /** Owner-assigned host; overrides the generic primary host for this repository. */
  host?: string;
  /** Local worktree, `~` expanded. */
  root: string;
  remoteWorkspace: string;
  /** Optional factory checkout to share objects with; empty or absent starts from an empty repository. */
  remoteSeed?: string;
  remoteTargetDir: string;
  snapshotRef: string;
  /** Absolute path of cargo-serial.sh on the VPS (an Aphrody checkout). */
  cargoSerial: string;
  remoteEnv?: Record<string, string>;
};

export type VpsCargoConfig = {
  host: string;
  controlPath: string;
  localSession: string;
  remoteSession: string;
  remoteWorkspace: string;
  remoteSeed: string;
  remoteTargetDir: string;
  remoteLockDir: string;
  remoteHeavyLock: string;
  remoteLogDir: string;
  remoteEnv: Record<string, string>;
  jobs: number;
  /** Largest `--jobs` the host accepts (a production host stays below its core count). */
  maxJobs?: number;
  resources?: {
    reserveMemoryGiB?: number;
    reserveDiskGiB?: number;
    memoryPerJobGiB?: number;
  };
  remoteTransientRoot?: string;
  /**
   * False when the host has no GTK 4 development libraries (the CEF desktop runtime; a production server keeps a minimum
   * surface, infra/config/system-packages.json): packages that need them stay on the primary host. Default true.
   */
  desktopLibraries?: boolean;
  /** Crates whose presence in a package's dependency closure means the desktop libraries are needed. */
  desktopSysCrates?: string[];
  /** Per-host overrides merged over this config: secondary build hosts such as dbfr. */
  hosts?: Record<string, Partial<Omit<VpsCargoConfig, "hosts" | "repositories">>>;
  /** External repositories, by name, for `--repo`: primary host only. */
  repositories?: Record<string, RepositoryConfig>;
  /** Wrapper path on the VPS; the Aphrody default is relative to the remote workspace. Set by `--repo`. */
  cargoSerial?: string;
  forwards: { remote: Forward[]; local: Forward[] };
  gitDaemon: {
    listen: string;
    port: number;
    basePath: string;
    repository: string;
  };
  snapshotRef: string;
  refuseSnapshotPaths: string[];
};

const ROOT = resolve(import.meta.dir, "../../../../");
const CONFIG_PATH = join(ROOT, "infra/config/host/vps-cargo.json");
const MAX_SNAPSHOT_FILE_BYTES = 50 * 1024 * 1024;

export function expandHome(path: string, home = homedir()): string {
  if (path === "~") return home;
  return path.startsWith("~/") ? posix.join(home, path.slice(2)) : path;
}

/** POSIX single-quote for remote shell commands. */
export function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=@%+,-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

export async function loadConfig(path = CONFIG_PATH, host?: string): Promise<VpsCargoConfig> {
  const base = (await Bun.file(path).json()) as VpsCargoConfig;
  // Local paths follow this worktree instead of a particular user's machine.
  if (!base.gitDaemon.basePath) base.gitDaemon.basePath = dirname(ROOT);
  if (!base.gitDaemon.repository) base.gitDaemon.repository = basename(ROOT);
  for (const repository of Object.values(base.repositories ?? {})) {
    if (!repository.root.startsWith("~") && !/^(?:[A-Za-z]:[\\/]|\/)/.test(repository.root)) {
      repository.root = resolve(ROOT, repository.root);
    }
  }
  if (host === undefined || host === base.host) return base;
  const override = base.hosts?.[host];
  if (!override)
    throw new Error(`unknown build host "${host}" (infra/config/host/vps-cargo.json hosts)`);
  return {
    ...base,
    ...override,
    remoteEnv: { ...base.remoteEnv, ...override.remoteEnv },
    host,
  };
}

/**
 * The configuration of one external repository: its checkout, ref, target directory and wrapper replace the
 * Aphrody ones, everything else (host, locks, tunnel) is shared. Returns the local worktree root with it.
 */
export function repositoryConfig(
  config: VpsCargoConfig,
  name: string,
): { config: VpsCargoConfig; root: string } {
  const repository = config.repositories?.[name];
  if (!repository)
    throw new Error(`unknown repository "${name}" (infra/config/host/vps-cargo.json repositories)`);
  if (repository.host && repository.host !== config.host) {
    const host = config.hosts?.[repository.host];
    if (!host) throw new Error(`repository "${name}" requires unknown host "${repository.host}"`);
    config = {
      ...config,
      ...host,
      host: repository.host,
      remoteEnv: { ...config.remoteEnv, ...host.remoteEnv },
    };
  }
  const secondaries = Object.keys(config.hosts ?? {});
  if (!repository.host && secondaries.includes(config.host)) {
    throw new Error(
      `repository "${name}" is configured for the primary host only, not ${config.host}`,
    );
  }
  return {
    root: expandHome(repository.root),
    config: {
      ...config,
      remoteWorkspace: repository.remoteWorkspace,
      remoteSeed: repository.remoteSeed ?? "",
      remoteTargetDir: repository.remoteTargetDir,
      snapshotRef: repository.snapshotRef,
      cargoSerial: repository.cargoSerial,
      remoteEnv: { ...config.remoteEnv, ...repository.remoteEnv },
    },
  };
}

/** True when the primary host's heavy lock is held: a build is running there. */
export function heavyLockBusy(config: VpsCargoConfig): boolean {
  const probe = Bun.spawnSync(
    [...sshBase(config), config.host, `flock -n ${shellQuote(config.remoteHeavyLock)} true`],
    { windowsHide: true, stdout: "ignore", stderr: "ignore" },
  );
  return probe.exitCode === 1;
}

/** Workspace packages that need the GTK 4 (CEF runtime) development libraries: for plain builds, and with test/dev targets. */
export type DesktopRequirements = { build: Set<string>; all: Set<string> };

type CargoMetadata = {
  packages: { id: string; name: string }[];
  workspace_members: string[];
  resolve: {
    nodes: {
      id: string;
      deps: { pkg: string; dep_kinds?: { kind: string | null }[] }[];
    }[];
  };
};

/**
 * Which workspace members reach one of `sysCrates` through their dependency graph (`cargo metadata`, Linux
 * target): `build` follows normal and build dependencies (check, build, clippy), `all` also dev dependencies
 * (test, `--all-targets`).
 */
export function desktopRequirements(
  metadata: CargoMetadata,
  sysCrates: readonly string[],
): DesktopRequirements {
  const name = new Map(metadata.packages.map((p) => [p.id, p.name] as const));
  const reaching = (kinds: ReadonlySet<string>) => {
    const parents = new Map<string, string[]>();
    for (const node of metadata.resolve.nodes) {
      for (const dep of node.deps) {
        if (!(dep.dep_kinds ?? []).some((k) => kinds.has(k.kind ?? "normal"))) continue;
        const list = parents.get(dep.pkg) ?? [];
        list.push(node.id);
        parents.set(dep.pkg, list);
      }
    }
    const seen = new Set(
      metadata.resolve.nodes
        .filter((n) => sysCrates.includes(name.get(n.id) ?? ""))
        .map((n) => n.id),
    );
    const stack = [...seen];
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      for (const parent of parents.get(id) ?? []) {
        if (!seen.has(parent)) {
          seen.add(parent);
          stack.push(parent);
        }
      }
    }
    return new Set(
      metadata.workspace_members.filter((id) => seen.has(id)).map((id) => name.get(id) ?? id),
    );
  };
  return {
    build: reaching(new Set(["normal", "build"])),
    all: reaching(new Set(["normal", "build", "dev"])),
  };
}

const DEV_TARGET_FLAGS = new Set([
  "--all-targets",
  "--tests",
  "--benches",
  "--examples",
  "--test",
  "--bench",
  "--example",
]);
const DEV_SUBCOMMANDS = new Set(["test", "bench", "nextest"]);

/** What a cargo command line selects: its packages, whether it is workspace-wide, and whether it compiles dev targets. */
export function cargoSelection(cargoArgs: readonly string[]) {
  const packages: string[] = [];
  const excluded: string[] = [];
  let workspace = false;
  let devTargets = false;
  let subcommand = "";
  for (let i = 0; i < cargoArgs.length; i++) {
    const arg = cargoArgs[i] as string;
    if (arg === "--") break;
    const next = cargoArgs[i + 1] ?? "";
    if (arg === "-p" || arg === "--package") {
      packages.push(next);
      i++;
    } else if (arg.startsWith("--package=")) packages.push(arg.slice("--package=".length));
    else if (arg === "--exclude") {
      excluded.push(next);
      i++;
    } else if (arg.startsWith("--exclude=")) excluded.push(arg.slice("--exclude=".length));
    else if (arg === "--workspace" || arg === "--all") workspace = true;
    else if (DEV_TARGET_FLAGS.has(arg) || /^--(test|bench|example)=/.test(arg)) devTargets = true;
    else if (!subcommand && !arg.startsWith("-") && !arg.startsWith("+")) subcommand = arg;
  }
  if (DEV_SUBCOMMANDS.has(subcommand)) devTargets = true;
  return { subcommand, packages, excluded, workspace, devTargets };
}

/** `name`, `name@version` or a glob such as `aphrody-tauri-*` against one package name. */
export function matchesPackageSpec(spec: string, name: string): boolean {
  const bare = spec.split(/[@:]/, 1)[0] as string;
  if (!/[*?[]/.test(bare)) return bare === name;
  const regex = bare
    .replace(/[.+^${}()|\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regex}$`).test(name);
}

/** The packages of this cargo command line that need the desktop libraries (empty: any host can build it). */
export function desktopOffenders(
  cargoArgs: readonly string[],
  requirements: DesktopRequirements,
): string[] {
  const selection = cargoSelection(cargoArgs);
  const needed = selection.devTargets ? requirements.all : requirements.build;
  const scoped = selection.packages.length > 0 && !selection.workspace;
  return [...needed]
    .filter((pkg) =>
      scoped
        ? selection.packages.some((spec) => matchesPackageSpec(spec, pkg))
        : !selection.excluded.some((spec) => matchesPackageSpec(spec, pkg)),
    )
    .sort();
}

/** The cargo arguments of a `run` command line (everything after the first `--`). */
function cargoArgsOf(options: readonly string[]): string[] {
  const separator = options.indexOf("--");
  return separator < 0 ? [] : options.slice(separator + 1);
}

/** Desktop requirements of the worktree, from `cargo metadata` (light, offline), cached by Cargo.lock hash. */
async function worktreeDesktopRequirements(
  sysCrates: readonly string[],
): Promise<DesktopRequirements> {
  const lock = await Bun.file(join(ROOT, "Cargo.lock")).text();
  const key = new Bun.CryptoHasher("sha256")
    .update(lock)
    .update(sysCrates.join(","))
    .digest("hex")
    .slice(0, 16);
  const cache = join(tmpdir(), `vps-cargo-desktop-${key}.json`);
  const cached = Bun.file(cache);
  if (await cached.exists()) {
    const saved = (await cached.json()) as { build: string[]; all: string[] };
    return { build: new Set(saved.build), all: new Set(saved.all) };
  }
  const json =
    await $`cargo metadata --offline --format-version 1 --filter-platform x86_64-unknown-linux-gnu`
      .cwd(ROOT)
      .quiet()
      .text();
  const requirements = desktopRequirements(JSON.parse(json) as CargoMetadata, sysCrates);
  await Bun.write(
    cache,
    JSON.stringify({
      build: [...requirements.build],
      all: [...requirements.all],
    }),
  );
  return requirements;
}

/** A host without the desktop libraries refuses (explicit `--host`) or yields (`auto`) to packages that need them. */
async function ensureHostCanBuild(
  candidate: VpsCargoConfig,
  primary: VpsCargoConfig,
  options: readonly string[],
  requested: string,
): Promise<VpsCargoConfig> {
  if (candidate.desktopLibraries !== false) return candidate;
  const cargoArgs = cargoArgsOf(options);
  if (cargoArgs.length === 0) return candidate;
  const offenders = desktopOffenders(
    cargoArgs,
    await worktreeDesktopRequirements(primary.desktopSysCrates ?? ["gdk4-sys", "gtk4-sys"]),
  );
  if (offenders.length === 0) return candidate;
  const sample = `${offenders.slice(0, 3).join(", ")}${offenders.length > 3 ? `, … (${offenders.length})` : ""}`;
  if (requested === "auto") {
    console.log(
      `${candidate.host} has no desktop libraries (needed by ${sample}): staying on ${primary.host}`,
    );
    return primary;
  }
  throw new Error(
    `${candidate.host} has no GTK 4 development libraries (minimum host surface); needed by ${sample}. Use --host ${primary.host} or select other packages.`,
  );
}

/** `--host <name|auto>` or VPS_CARGO_HOST: the primary host, a named secondary, or the first idle one. */
export async function selectConfig(options: readonly string[]): Promise<VpsCargoConfig> {
  const requested = flag(options, "--host") ?? process.env["VPS_CARGO_HOST"];
  const configPath = flag(options, "--config") ?? process.env["VPS_CARGO_CONFIG"] ?? CONFIG_PATH;
  const primary = await loadConfig(configPath);
  if (requested === undefined || requested === primary.host) return primary;
  if (requested !== "auto") {
    return ensureHostCanBuild(await loadConfig(configPath, requested), primary, options, requested);
  }
  if (!heavyLockBusy(primary)) return primary;
  const fallback = Object.keys(primary.hosts ?? {})[0];
  if (!fallback) return primary;
  const candidate = await ensureHostCanBuild(
    await loadConfig(configPath, fallback),
    primary,
    options,
    requested,
  );
  if (candidate.host !== fallback) return candidate;
  console.log(`${primary.host} is busy, building on ${fallback}`);
  return candidate;
}

/** Snapshot paths that look like secrets: the snapshot leaves the machine, so it fails closed. */
export function secretLikePaths(paths: readonly string[], patterns: readonly string[]): string[] {
  const regexes = patterns.map((pattern) => new RegExp(pattern, "i"));
  return paths.filter((path) => regexes.some((regex) => regex.test(path)));
}

export function sshBase(config: VpsCargoConfig, platform = process.platform): string[] {
  return [
    "ssh",
    ...(platform === "win32"
      ? []
      : [
          "-o",
          `ControlPath=${expandHome(config.controlPath)}`,
          "-o",
          "ControlMaster=auto",
          "-o",
          "ControlPersist=8h",
        ]),
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
  ];
}

/** The persistent, self-reconnecting SSH master carrying both forward directions. */
export function localQuote(value: string, platform = process.platform): string {
  return platform === "win32" ? `'${value.replaceAll("'", "''")}'` : shellQuote(value);
}

export function tunnelCommand(config: VpsCargoConfig, platform = process.platform): string {
  if (platform === "win32") {
    const args = [
      ...sshBase(config, platform),
      "-o",
      "ExitOnForwardFailure=yes",
      "-N",
      ...config.forwards.remote.flatMap((f) => ["-R", `${f.bind}:${f.to}`]),
      ...config.forwards.local.flatMap((f) => ["-L", `${f.bind}:${f.to}`]),
      config.host,
    ];
    const code = `while(true){const p=Bun.spawn(${JSON.stringify(args)},{stdin:"ignore",stdout:"inherit",stderr:"inherit"});await p.exited;console.error("tunnel lost, reconnecting in 5s");await Bun.sleep(5000)}`;
    return `& ${localQuote(process.execPath, platform)} -e ${localQuote(code, platform)}`;
  }
  const forwards = [
    ...config.forwards.remote.map((forward) => `-R ${forward.bind}:${forward.to}`),
    ...config.forwards.local.map((forward) => `-L ${forward.bind}:${forward.to}`),
  ];
  const ssh = [
    ...sshBase(config, platform).map(shellQuote),
    "-o",
    "ControlMaster=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-N",
    ...forwards,
    config.host,
  ].join(" ");
  return `while true; do ${ssh}; echo "tunnel lost, reconnecting in 5s"; sleep 5; done`;
}

/** Read-only git daemon on loopback: the VPS reaches it through the reverse forward. */
export function gitDaemonCommand(config: VpsCargoConfig, platform = process.platform): string {
  const base = expandHome(config.gitDaemon.basePath);
  const normalizedBase = base.replaceAll("\\", "/");
  // Git daemon appends /<repository>. A drive root ending in / produces C://repo,
  // which fails its repository allowlist even though Windows accepts that path.
  const daemonBase =
    platform === "win32" && /^[A-Za-z]:\/$/.test(normalizedBase)
      ? normalizedBase.slice(0, -1)
      : normalizedBase;
  return [
    "git daemon --reuseaddr --export-all --informative-errors",
    `--listen=${config.gitDaemon.listen}`,
    `--port=${config.gitDaemon.port}`,
    `--base-path=${localQuote(daemonBase, platform)}`,
    localQuote(join(base, config.gitDaemon.repository).replaceAll("\\", "/"), platform),
  ].join(" ");
}

/** Remote script that creates the dedicated VPS checkout (sharing the factory objects) once. */
export function remoteSeedScript(config: VpsCargoConfig): string {
  const ws = shellQuote(config.remoteWorkspace);
  return [
    "set -euo pipefail",
    `mkdir -p ${shellQuote(config.remoteLockDir)} ${shellQuote(config.remoteLogDir)} ${shellQuote(config.remoteTargetDir)}`,
    // A host without a factory seed checkout starts from an empty repository: the push is a full pack.
    `test -d ${ws}/.git || { test -d ${shellQuote(config.remoteSeed)}/.git && git clone --quiet --shared --no-checkout ${shellQuote(config.remoteSeed)} ${ws} || git init --quiet ${ws}; }`,
  ].join("\n");
}

/**
 * Per-snapshot ref that keeps a pushed snapshot reachable on the VPS. `snapshotRef` is shared by every session
 * and force-updated, so without a pin the objects of a snapshot become unreachable (and collectable) as soon as
 * another session pushes, while a job may still be waiting for the factory lock to check it out.
 */
export function pinRef(config: VpsCargoConfig, sha: string): string {
  return `${config.snapshotRef.replace(/\/[^/]+$/, "")}/pin/${sha.slice(0, 12)}`;
}

/** Pins older than this are removed by the checkout script (a job never waits that long). */
export const PIN_RETENTION_DAYS = 3;

/** Remote script: fail (exit 3) when the snapshot misses any object (a commit whose blobs were collected). */
export function remoteVerifyScript(config: VpsCargoConfig, sha: string): string {
  return [
    `cd ${shellQuote(config.remoteWorkspace)}`,
    // `--quiet` prints nothing and exits non-zero when an object is missing: fast, no checkout needed.
    `git rev-list --objects --quiet ${sha} || { echo "snapshot ${sha.slice(0, 12)} is incomplete on the VPS" >&2; exit 3; }`,
  ].join("\n");
}

/**
 * Remote script that drops the snapshot refs (shared ref and pins) whose history misses objects, so the next push
 * resends them (git never resends what a remote ref says the remote has). Healthy pins of other sessions stay.
 */
export function remoteForgetScript(config: VpsCargoConfig): string {
  const base = config.snapshotRef.replace(/\/[^/]+$/, "");
  return [
    `cd ${shellQuote(config.remoteWorkspace)}`,
    `git for-each-ref --format='%(refname)' ${shellQuote(config.snapshotRef)} ${shellQuote(`${base}/pin`)} | while read -r ref; do git rev-list --objects --quiet "$ref" 2>/dev/null || git update-ref -d "$ref"; done`,
  ].join("\n");
}

/** Remote script that moves the dedicated VPS checkout to the snapshot commit. */
export function remoteCheckoutScript(config: VpsCargoConfig, sha: string, pull: boolean): string {
  const port = config.forwards.remote[0]?.bind.split(":").at(-1) ?? "19418";
  const fetch = pull
    ? `git fetch --quiet git://127.0.0.1:${port}/${config.gitDaemon.repository} ${config.snapshotRef}`
    : ":";
  return [
    remoteSeedScript(config),
    `cd ${shellQuote(config.remoteWorkspace)}`,
    fetch,
    // Drop the pins of old snapshots; the pin of this one (and of every job still waiting) is recent.
    `git for-each-ref --format='%(refname) %(committerdate:unix)' ${shellQuote(`${config.snapshotRef.replace(/\/[^/]+$/, "")}/pin`)} | while read -r ref when; do test "$when" -lt "$(( $(date +%s) - ${PIN_RETENTION_DAYS * 86400} ))" && git update-ref -d "$ref"; done || true`,
    // Moving the shared checkout under a running job would corrupt its build: when the factory lock is held, the move
    // is deferred to the job itself (remoteRunScript checks out the snapshot once it owns the lock).
    `if flock -n ${shellQuote(config.remoteHeavyLock)} true; then`,
    `git checkout --quiet --detach --force ${sha}`,
    // Untracked leftovers of a previous snapshot go; ignored outputs (node_modules) stay.
    "git clean -fdq",
    `test "$(git rev-parse HEAD)" = ${sha}`,
    `echo "vps checkout at ${sha.slice(0, 12)}"`,
    "else",
    `git cat-file -e ${sha}^{commit}`,
    `echo "vps factory busy: checkout of ${sha.slice(0, 12)} deferred to the job"`,
    "fi",
  ].join("\n");
}

/** Remote script that runs one cargo-serial job in the remote tmux session and streams its log. */
export function remoteRunScript(
  config: VpsCargoConfig,
  sha: string,
  job: string,
  cargoArgs: readonly string[],
  jobs: number | "auto",
): string {
  const selectedJobs = cargoJobsSetting(String(jobs), config);
  const policy = factoryResourcePolicy({
    rust: {
      maxJobs: selectedJobs === "auto" ? (config.maxJobs ?? config.jobs) : selectedJobs,
    },
    resources: config.resources,
  });
  const admission = factoryResourceAdmissionProgram(
    policy,
    { cache: config.remoteTargetDir, artifacts: config.remoteLogDir },
    { autoJobs: jobs === "auto", reportJobs: true },
  );
  const log = `${config.remoteLogDir}/${job}.log`;
  const exit = `${config.remoteLogDir}/${job}.exit`;
  const env = Object.entries({
    ...config.remoteEnv,
    APHRODY_CARGO_JOBS: String(jobs),
    APHRODY_CARGO_LOCK_DIR: config.remoteLockDir,
    CARGO_TARGET_DIR: config.remoteTargetDir,
    APHRODY_CARGO_TARGET_DIR: config.remoteTargetDir,
  }).map(([key, value]) => `${key}=${shellQuote(value)}`);
  const body = [
    // Deterministic file modes: tests assert 0o644/0o600 and the builder user's default umask is 002.
    "umask 022",
    `cd ${shellQuote(config.remoteWorkspace)}`,
    `git cat-file -e ${sha}^{commit} || { echo "snapshot ${sha} is not in the checkout" >&2; exit 2; }`,
    `export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"`,
    // The shared checkout is moved to the job snapshot only once this job holds the factory lock: another session may
    // have synced its own snapshot while this job waited, and building then would compile the wrong tree.
    `exec env ${env.join(" ")} flock --close ${shellQuote(config.remoteHeavyLock)} flock --close ${shellQuote(posix.join(config.remoteLockDir, `${posix.basename(config.remoteWorkspace)}.source.lock`))} bash -c ${shellQuote(`set -euo pipefail; git checkout -q -f ${sha} || { echo "checkout moved away from ${sha}" >&2; exit 2; }; mkdir -p -- ${shellQuote(config.remoteTargetDir)}; ${factoryTransientShell(config.remoteTransientRoot ?? posix.resolve(posix.dirname(config.remoteHeavyLock), "../transient"), "docker", config.remoteHeavyLock).join("; ")}; factory_jobs=$(bun --no-env-file -e ${shellQuote(admission)}); export APHRODY_CARGO_JOBS="$factory_jobs" CARGO_BUILD_JOBS="$factory_jobs"; "$@"`)} bash ${shellQuote(config.cargoSerial ?? "scripts/aphrody/build/rust/cargo-serial.sh")} ${cargoArgs.map(shellQuote).join(" ")}`,
  ].join("; ");
  const scriptFile = `${log}.sh`;
  const heredoc = `APHRODY_CARGO_${job.replaceAll(/[^A-Za-z0-9_]/g, "_")}`;
  const window = [
    "#!/usr/bin/env bash",
    "set +e",
    `(${body}) > ${shellQuote(log)} 2>&1`,
    "status=$?",
    `printf '%s\\n' "$status" > ${shellQuote(exit)}`,
    'exit "$status"',
  ].join("\n");
  const session = shellQuote(config.remoteSession);
  return [
    "set -euo pipefail",
    `mkdir -p ${shellQuote(config.remoteLogDir)}`,
    `rm -f ${shellQuote(exit)}; : > ${shellQuote(log)}`,
    `cat > ${shellQuote(scriptFile)} <<'${heredoc}'`,
    window,
    heredoc,
    `chmod 700 ${shellQuote(scriptFile)}`,
    `tmux has-session -t ${session} 2>/dev/null || tmux new-session -d -s ${session} -n idle`,
    `tmux new-window -d -t ${session} -n ${shellQuote(job)} bash ${shellQuote(scriptFile)}`,
    `tail -n +1 -F ${shellQuote(log)} 2>/dev/null & tailer=$!`,
    `while [ ! -f ${shellQuote(exit)} ]; do sleep 1; done`,
    "sleep 1; kill $tailer 2>/dev/null || true",
    `exit "$(cat ${shellQuote(exit)})"`,
  ].join("\n");
}

async function ssh(config: VpsCargoConfig, script: string): Promise<number> {
  const child = Bun.spawn([...sshBase(config), config.host, "bash -s"], {
    windowsHide: true,
    stdin: new Blob([script]),
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

/** A git operation of the snapshot lost a race with another session (lock held, ref moved): retry it. */
export class SnapshotCollision extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotCollision";
  }
}

const COLLISION_PATTERN =
  /index\.lock|index file (smaller|corrupt)|bad index file|cannot lock ref|Unable to create '.*\.lock'|File exists|another git process|unable to write|cannot update the ref/i;

/**
 * Whether an error is a snapshot collision: git exits 128 when it cannot take a lock or update a ref that
 * another session holds (the configured snapshot ref is shared by worktrees of the repository).
 * A rejected push can instead exit 1 when the remote ref changed during the transaction.
 */
export function isSnapshotCollision(error: unknown): boolean {
  if (error instanceof SnapshotCollision) return true;
  if (typeof error !== "object" || error === null) return false;
  const { exitCode, stderr, message } = error as {
    exitCode?: unknown;
    stderr?: unknown;
    message?: unknown;
  };
  const text = `${stderr ?? ""} ${message ?? ""}`;
  if (exitCode === 1)
    return /\[remote rejected\].*\((incorrect old value provided|cannot lock ref[^)]*)\)/i.test(
      text,
    );
  if (exitCode !== 128) return false;
  // Exit 128 is also git's generic fatal error: only lock and ref races are worth retrying.
  return text.trim() === "" || COLLISION_PATTERN.test(text);
}

export type BackoffOptions = {
  /** Total tries, first one included. */
  attempts?: number;
  /** Delay before the second try; doubles each time, plus jitter. */
  baseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Jitter source in [0, 1): injectable for tests. */
  random?: () => number;
};

/** Retry `operation` with exponential backoff and jitter while it fails with a snapshot collision. */
export async function withSnapshotBackoff<T>(
  operation: () => Promise<T>,
  options: BackoffOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 6;
  const baseMs = options.baseMs ?? 250;
  const sleep = options.sleep ?? Bun.sleep;
  const random = options.random ?? Math.random;
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !isSnapshotCollision(error)) throw error;
      const delay = baseMs * 2 ** (attempt - 1) * (1 + random());
      console.error(
        `vps-cargo: snapshot collision, retry ${attempt}/${attempts - 1} in ${Math.round(delay)} ms`,
      );
      await sleep(delay);
    }
  }
}

/** Commit the exact worktree (tracked + untracked, ignores honoured) without touching index or HEAD. */
export function snapshot(config: VpsCargoConfig, cwd = ROOT): Promise<string> {
  return withSnapshotBackoff(() => snapshotOnce(config, cwd));
}

async function snapshotOnce(config: VpsCargoConfig, cwd: string): Promise<string> {
  // `.git` is a file in a linked worktree: ask git for the per-worktree directory holding the index.
  const gitDir = (await $`git rev-parse --absolute-git-dir`.cwd(cwd).text()).trim();
  // One scratch index per call: concurrent runs (other processes, or this one) never share an index file.
  const index = join(gitDir, `vps-cargo.${process.pid}.${crypto.randomUUID().slice(0, 8)}.index`);
  try {
    await Bun.write(index, Bun.file(join(gitDir, "index")));
    const env = { ...process.env, GIT_INDEX_FILE: index };
    await $`git add -A`.cwd(cwd).env(env).quiet();
    const changed = (await $`git diff --cached --name-only HEAD`.cwd(cwd).env(env).text())
      .split("\n")
      .filter(Boolean);
    const refused = secretLikePaths(changed, config.refuseSnapshotPaths);
    if (refused.length > 0) {
      throw new Error(`refusing to snapshot secret-like paths: ${refused.join(", ")}`);
    }
    const large: string[] = [];
    for (const path of changed) {
      const file = Bun.file(join(cwd, path));
      if ((await file.exists()) && file.size > MAX_SNAPSHOT_FILE_BYTES) large.push(path);
    }
    if (large.length > 0) {
      throw new Error(`refusing files over 50 MiB (ignore them first): ${large.join(", ")}`);
    }
    const tree = (await $`git write-tree`.cwd(cwd).env(env).text()).trim();
    const head = (await $`git rev-parse HEAD`.cwd(cwd).text()).trim();
    const headTree = (await $`git rev-parse HEAD^{tree}`.cwd(cwd).text()).trim();
    const message = "workspace snapshot";
    const sha =
      tree === headTree
        ? head
        : (
            await $`git -c user.name=aphrody-dev -c user.email=contact@aphrody.com commit-tree ${tree} -p ${head} -m ${message}`
              .cwd(cwd)
              .text()
          ).trim();
    await $`git update-ref ${config.snapshotRef} ${sha}`.cwd(cwd);
    return sha;
  } finally {
    await rm(index, { force: true });
  }
}

async function sync(config: VpsCargoConfig, pull: boolean, root = ROOT): Promise<string> {
  if (pull && root !== ROOT)
    throw new Error("--pull reads the Aphrody git daemon: not available with --repo");
  const sha = await snapshot(config, root);
  if (!pull) {
    // Seed the dedicated checkout first so the push has a repository to land in.
    if ((await ssh(config, remoteSeedScript(config))) !== 0) {
      throw new Error("cannot prepare the VPS checkout");
    }
    const pushOnce = () =>
      withSnapshotBackoff(async () => {
        const push = Bun.spawn(
          [
            "git",
            "push",
            "--quiet",
            "--force",
            // The VPS checkout is seeded shallow: a thin pack may delta against bases it lacks.
            "--no-thin",
            `${config.host}:${config.remoteWorkspace}`,
            `${sha}:${config.snapshotRef}`,
            // Pin this snapshot: other sessions overwrite the shared ref while a job may still be queued.
            `${sha}:${pinRef(config, sha)}`,
          ],
          {
            windowsHide: true,
            cwd: root,
            env: { ...process.env, GIT_SSH_COMMAND: sshBase(config).join(" ") },
            stdout: "inherit",
            stderr: "pipe",
          },
        );
        const [code, stderr] = await Promise.all([push.exited, new Response(push.stderr).text()]);
        if (stderr) process.stderr.write(stderr);
        if (code !== 0)
          throw Object.assign(new Error("git push of the snapshot failed"), {
            exitCode: code,
            stderr,
          });
      });
    await pushOnce();
    // A remote ref can advertise history whose objects were collected (another session's snapshot, since
    // overwritten): git then never resends them. Verify, and on damage forget the refs and push in full.
    if ((await ssh(config, remoteVerifyScript(config, sha))) !== 0) {
      console.error("vps-cargo: the snapshot is incomplete on the VPS, resending it in full");
      await ssh(config, remoteForgetScript(config));
      await pushOnce();
      if ((await ssh(config, remoteVerifyScript(config, sha))) !== 0) {
        throw new Error("the snapshot is still incomplete on the VPS after a full resend");
      }
    }
  }
  if ((await ssh(config, remoteCheckoutScript(config, sha, pull))) !== 0) {
    throw new Error("VPS checkout failed");
  }
  return sha;
}

function tmuxLocal(args: string[]): Promise<number> {
  return Bun.spawn(["tmux", ...args], {
    windowsHide: true,
    stdout: "inherit",
    stderr: "inherit",
  }).exited;
}

async function tunnel(config: VpsCargoConfig, action: string | undefined): Promise<number> {
  const session = config.localSession;
  const has = Bun.spawn(["tmux", "has-session", "-t", session], {
    windowsHide: true,
    stderr: "ignore",
  });
  const alive = (await has.exited) === 0;
  if (action === "up") {
    if (alive) {
      console.log(`tmux session ${session} already running`);
      return 0;
    }
    await mkdir(dirname(expandHome(config.controlPath)), {
      recursive: true,
      mode: 0o700,
    });
    await tmuxLocal(["new-session", "-d", "-s", session, "-n", "ssh", tunnelCommand(config)]);
    await tmuxLocal([
      "new-window",
      "-d",
      "-t",
      session,
      "-n",
      "git-daemon",
      gitDaemonCommand(config),
    ]);
    console.log(`tunnel up: tmux attach -t ${session}`);
    return 0;
  }
  if (action === "down") {
    if (alive) await tmuxLocal(["kill-session", "-t", session]);
    if (process.platform !== "win32") {
      await Bun.spawn([...sshBase(config), "-O", "exit", config.host], {
        windowsHide: true,
        stderr: "ignore",
      }).exited;
    }
    console.log("tunnel down");
    return 0;
  }
  const check = Bun.spawn(
    process.platform === "win32"
      ? [...sshBase(config), "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", config.host, "true"]
      : [...sshBase(config), "-O", "check", config.host],
    { windowsHide: true, stderr: "ignore" },
  );
  const master = (await check.exited) === 0;
  console.log(
    `tmux session ${session}: ${alive ? "up" : "down"}; ssh connection: ${master ? "up" : "down"}`,
  );
  return alive && master ? 0 : 1;
}

function flag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function fetchArtifact(
  config: VpsCargoConfig,
  args: readonly string[],
  root = ROOT,
): Promise<number> {
  const bin = flag(args, "--bin");
  if (!bin || !/^[A-Za-z0-9_.+-]+$/.test(bin)) throw new Error("fetch needs --bin <name>");
  const profile = flag(args, "--profile") ?? "release";
  if (!/^[A-Za-z0-9_-]+$/.test(profile))
    throw new Error("fetch --profile must be a Cargo profile name");
  const target = flag(args, "--target");
  if (target && !/^[A-Za-z0-9_.-]+$/.test(target))
    throw new Error("fetch --target must be a target triple");
  const sha = (await $`git rev-parse ${config.snapshotRef}`.cwd(root).text()).trim();
  const defaultDest =
    process.platform === "win32"
      ? join(
          process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"),
          "Aphrody",
          "artifacts",
          sha.slice(0, 12),
        )
      : `~/.local/lib/aphrody/workspace-${sha.slice(0, 12)}`;
  const dest = expandHome(flag(args, "--dest") ?? defaultDest);
  const remote = `${config.remoteTargetDir}/${target ? `${target}/` : ""}${profile}/${bin}`;
  await mkdir(dest, { recursive: true });
  const control = `ControlPath=${expandHome(config.controlPath)}`;
  const copy = Bun.spawn(
    [
      "scp",
      ...(process.platform === "win32" ? [] : ["-o", control]),
      `${config.host}:${remote}`,
      dest,
    ],
    { windowsHide: true, stdout: "inherit", stderr: "inherit" },
  );
  if ((await copy.exited) !== 0) return 1;
  const local = join(dest, bin);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(local).arrayBuffer());
  const digest = hasher.digest("hex");
  const remoteSum = Bun.spawn(
    [...sshBase(config), config.host, `sha256sum ${shellQuote(remote)}`],
    {
      windowsHide: true,
      stdout: "pipe",
    },
  );
  const remoteDigest = (await new Response(remoteSum.stdout).text()).split(/\s+/)[0];
  if (digest !== remoteDigest) throw new Error(`sha256 mismatch for ${bin}`);
  // Non-executable artifacts and target-qualified binaries are copies, not local programs to execute.
  // In particular, a Linux ELF fetched by the Windows workstation must be qualified on the VPS/container.
  const targetParts = target?.split("-") ?? [];
  const targetOS = ["android", "windows", "darwin", "freebsd", "linux"].find((part) =>
    targetParts.includes(part),
  );
  const localOS =
    process.platform === "win32"
      ? "windows"
      : process.platform === "darwin"
        ? "darwin"
        : process.platform;
  const targetArch = targetParts[0];
  const localArch =
    process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch;
  if (
    /\.(wasm|so|dll|dylib)$/.test(bin) ||
    (target && (targetOS !== localOS || targetArch !== localArch)) ||
    (!target && process.platform === "win32")
  ) {
    console.log(`${local} sha256=${digest} (not executed${target ? `; target=${target}` : ""})`);
    return 0;
  }
  const runs = Bun.spawnSync([local, "--version"], { windowsHide: true }).exitCode === 0;
  console.log(`${local} sha256=${digest} ${runs ? "runs here" : "does NOT run here (ABI)"}`);
  return runs ? 0 : 3;
}

const USAGE =
  "usage: vps-cargo <tunnel up|down|status | sync [--pull] | run [--jobs N|auto] [--pull] -- <cargo args> | logs <job> | fetch --bin <name> [--profile p] [--target <triple>] [--dest d] | attach> [--host <name|auto>] [--repo <name>]";

export function cargoJobsSetting(
  requested: string | undefined,
  config: Pick<VpsCargoConfig, "jobs" | "maxJobs" | "host">,
): number | "auto" {
  const limit = config.maxJobs ?? config.jobs;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1024)
    throw new Error("Host maxJobs must be an integer from 1 through 1024");
  if (requested === "auto") return "auto";
  const jobs = Number(requested ?? Math.min(config.jobs, limit));
  if (!Number.isSafeInteger(jobs) || jobs < 1 || jobs > limit)
    throw new Error(`--jobs must be 1..${limit}, or auto, on ${config.host}`);
  return jobs;
}

export async function main(argv: readonly string[]): Promise<number> {
  if (argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    console.log(`${USAGE} [--config <path>]`);
    return 0;
  }
  const [command, ...rest] = argv;
  const selected = await selectConfig(rest);
  const repo = flag(rest, "--repo");
  const { config, root } = repo
    ? repositoryConfig(selected, repo)
    : { config: selected, root: ROOT };
  switch (command) {
    case "tunnel":
      return tunnel(config, rest[0]);
    case "sync":
      console.log(await sync(config, rest.includes("--pull"), root));
      return 0;
    case "run": {
      const separator = rest.indexOf("--");
      if (separator < 0 || separator === rest.length - 1) throw new Error(USAGE);
      const options = rest.slice(0, separator);
      const jobs = cargoJobsSetting(flag(options, "--jobs"), config);
      const sha = await sync(config, options.includes("--pull"), root);
      const job = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${sha.slice(0, 12)}`;
      console.log(`job ${job} (attach: bun scripts/aphrody/build/rust/vps-cargo.ts attach)`);
      return ssh(config, remoteRunScript(config, sha, job, rest.slice(separator + 1), jobs));
    }
    case "logs":
      if (!rest[0]) throw new Error("usage: vps-cargo logs <job>");
      return ssh(config, `cat ${shellQuote(`${config.remoteLogDir}/${rest[0]}.log`)}`);
    case "fetch":
      return fetchArtifact(config, rest, root);
    case "attach":
      return Bun.spawn(
        [...sshBase(config), "-t", config.host, "tmux", "attach", "-t", config.remoteSession],
        {
          windowsHide: true,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        },
      ).exited;
    default:
      console.error(USAGE);
      return 64;
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`vps-cargo: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
