/**
 * Hard-coded safety rules of `yolo host`. They are not configurable by the policy file: the policy can only
 * make the tool more conservative. Pure functions, tested in test/host.test.ts.
 *
 *   1. Nothing is deleted unless it is regenerable (cache, build output, rotated log, unused docker layer,
 *      an unused swap file) or archived AND verified.
 *   2. Protected paths can only be touched through archive + verify, never by a reclaim rule.
 *   3. Nothing is ever wiped or formatted; there is no code path for it.
 *   4. No mutation while a build lock is held; the transport (ssh) and the keep-list are never stopped.
 */
import { posix } from "node:path";
import { hostLayout } from "../host/layout.ts";

// -------------------------------------------------------------------------------------------- paths

/** Directories that exist on every host and can never be removed, even after a verified archive. */
export const NEVER_REMOVE = [
  "/",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/home",
  "/lib",
  "/lib32",
  "/lib64",
  "/opt",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/sys",
  "/tmp",
  "/usr",
  "/var",
  "/var/lib",
  "/var/log",
  "/var/cache",
  "/mnt",
  "/media",
] as const;

/** Trees that only archive + verify may touch (and `--remove-source` only for their descendants). */
export const PROTECTED_TREES = [
  "/boot",
  "/etc",
  "/home",
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/lib64",
  "/root",
  "/var/lib",
  "/var/backups",
  "/proc",
  "/sys",
  "/dev",
  "/run",
] as const;

/** Directories holding database or container-engine state: archiving is allowed, removal never is. */
const DATABASE_TREES = [
  "/var/lib/postgresql",
  "/var/lib/mysql",
  "/var/lib/mariadb",
  "/var/lib/redis",
  "/var/lib/mongodb",
  "/var/lib/influxdb",
  "/var/lib/clickhouse",
  "/var/lib/docker",
  "/var/lib/containerd",
  "/var/lib/etcd",
] as const;

/** Reusable caches the project keeps on purpose (AGENTS.md, build-factory retention): relative to a home. */
export const KEEP_CACHES_UNDER_HOME = [
  ".cache/sccache",
  ".cargo/registry",
  ".cargo/git",
  ".cargo/bin",
  ".rustup",
  ".bun",
  ".cache/uv",
  ".ssh",
  ".gnupg",
] as const;

export interface PathContext {
  /** the account the commands run as; its home is "own", every other /home/* is "other users'" */
  readonly user: string;
  readonly home: string;
  /** extra preserved roots (build-factory cacheRoot/artifactRoot, policy `protect`) */
  readonly preserve?: readonly string[];
}

export function normalizePath(p: string): string {
  if (p.includes("\0") || p.includes("\n")) throw new Error("path contains a control character");
  if (!p.startsWith("/")) throw new Error(`path must be absolute: ${p}`);
  const n = posix.normalize(p);
  return n.length > 1 ? n.replace(/\/+$/, "") : n;
}

const within = (path: string, root: string): boolean =>
  root === "/" ? true : path === root || path.startsWith(`${root}/`);

export function isDatabasePath(path: string): boolean {
  const p = normalizePath(path);
  return (
    DATABASE_TREES.some(d => within(p, d)) ||
    /(^|\/)(pgdata|postgresql|mysql|mariadb|mongodb|clickhouse)(\/|$)/.test(p) ||
    /\.(sqlite3?|db|mdb)(-wal|-shm)?$/.test(p)
  );
}

/** Why a path is protected (null when it is not). A protected path is only reachable through archive + verify. */
export function protectedReason(path: string, ctx: PathContext): string | null {
  const p = normalizePath(path);
  if (p === "/") return "the filesystem root";
  // checked before /home so build output inside an app's persistent data is never reclaimed as "own home"
  const apps = hostLayout(ctx.home).apps;
  const app = p.startsWith(`${apps}/`) ? p.slice(apps.length + 1).split("/") : [];
  if (app.length >= 2 && (app[1] === "shared" || app[1] === "data")) return `an app data tree (${apps}/*/${app[1]})`;
  for (const extra of ctx.preserve ?? []) if (within(p, normalizePath(extra))) return `preserved by policy (${extra})`;
  for (const root of PROTECTED_TREES) {
    if (within(p, root)) {
      // own home is protected too, but reported precisely
      if (root === "/home") {
        const m = /^\/home\/([^/]+)/.exec(p);
        if (m !== null && m[1] !== ctx.user) return `another user's directory (/home/${m[1]})`;
        return "a home directory";
      }
      return `inside protected ${root}`;
    }
    if (within(root, p)) return `contains protected ${root}`;
  }
  if (isDatabasePath(p)) return "database or container-engine state";
  return null;
}

export function keptCacheReason(path: string, ctx: PathContext): string | null {
  const p = normalizePath(path);
  for (const rel of KEEP_CACHES_UNDER_HOME) {
    const root = posix.join(ctx.home, rel);
    if (within(p, root)) return `reusable cache kept on purpose (~/${rel})`;
    if (within(root, p)) return `contains a reusable cache (~/${rel})`;
  }
  return null;
}

export interface Verdict {
  readonly ok: boolean;
  readonly reason: string;
}

const ARTIFACT_NAMES: Readonly<Record<string, string>> = {
  cargo: "target",
  npm: "node_modules",
  next: ".next",
};

/**
 * May a reclaim rule delete this path? Only regenerable build output found with its project marker
 * (`target` next to Cargo.toml, `node_modules` next to package.json, `.next`), owned by the connecting
 * user, under a scan root, outside every protected or preserved tree.
 */
export function canDeleteBuildArtifact(
  path: string,
  marker: string,
  scanRoots: readonly string[],
  ctx: PathContext,
): Verdict {
  let p: string;
  try {
    p = normalizePath(path);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  if (ARTIFACT_NAMES[marker] !== posix.basename(p))
    return { ok: false, reason: `${p} is not a ${marker} build directory` };
  const kept = keptCacheReason(p, ctx);
  if (kept !== null) return { ok: false, reason: kept };
  const prot = protectedReason(p, ctx);
  // build output in the account's own home is the one place under a protected tree a rule may reach
  const ownHome = within(p, ctx.home) && ctx.home !== "" && ctx.home !== "/";
  if (prot !== null && !(ownHome && prot === "a home directory"))
    return { ok: false, reason: `${p} is ${prot}: archive + verify only` };
  if (!scanRoots.some(r => within(p, normalizePath(r)))) return { ok: false, reason: `${p} is outside the scan roots` };
  return { ok: true, reason: "regenerable build output" };
}

/** Option cache directories listed in the policy: never the kept caches, never outside the own home. */
export function canDeleteCacheDir(path: string, ctx: PathContext): Verdict {
  let p: string;
  try {
    p = normalizePath(path);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  if (ctx.home === "" || ctx.home === "/" || !within(p, ctx.home) || p === ctx.home)
    return {
      ok: false,
      reason: `${p} is not a cache below the account's home`,
    };
  const kept = keptCacheReason(p, ctx);
  if (kept !== null) return { ok: false, reason: kept };
  const rel = posix.relative(ctx.home, p);
  if (!(rel.startsWith(".cache/") || rel.startsWith(".npm/")))
    return { ok: false, reason: `${p} is not under ~/.cache or ~/.npm` };
  return { ok: true, reason: "regenerable cache" };
}

/** Is a process working inside (or above) the path? Such a path is skipped. */
export function pathInUse(path: string, cwds: readonly (string | null)[]): boolean {
  const p = normalizePath(path);
  // a daemon sitting in "/" is not working in every tree
  return cwds.some(c => c !== null && c !== "/" && (within(c, p) || within(p, c)));
}

// ------------------------------------------------------------------------------- removal after archive

export interface Verification {
  readonly zstdTest: boolean;
  readonly entryCountMatches: boolean;
  readonly manifestChecked: boolean;
  /** undefined when no database dump was requested */
  readonly dumpListed?: boolean;
  /** undefined when no off-host copy was requested */
  readonly pullChecksumMatches?: boolean;
}

/** Source removal is allowed only when every verification that applies has passed in this run. */
export function canRemoveSource(v: Verification): boolean {
  return (
    v.zstdTest && v.entryCountMatches && v.manifestChecked && v.dumpListed !== false && v.pullChecksumMatches !== false
  );
}

/** Reasons `--remove-source` is refused for this path regardless of verification. Empty = allowed. */
export function removalRefusals(path: string, ctx: PathContext): string[] {
  const out: string[] = [];
  let p: string;
  try {
    p = normalizePath(path);
  } catch (e) {
    return [(e as Error).message];
  }
  if ((NEVER_REMOVE as readonly string[]).includes(p)) out.push(`${p} is a system directory that is never removed`);
  if (isDatabasePath(p)) out.push("database state is archived with pg_dump, never removed by path");
  if (
    ctx.home !== "" &&
    (p === ctx.home || within(posix.join(ctx.home, ".ssh"), p) || within(p, posix.join(ctx.home, ".ssh")))
  )
    out.push("the home directory and ~/.ssh carry the transport and are never removed");
  if (within(p, "/etc/ssh") || within("/etc/ssh", p)) out.push("/etc/ssh carries the transport");
  if (/^\/home\/[^/]+$/.test(p)) out.push("home directories themselves are not removed");
  for (const root of ["/etc", "/boot", "/proc", "/sys", "/dev", "/run", "/usr", "/bin", "/sbin", "/lib", "/lib64"])
    if (within(p, root)) out.push(`${root} is never removed`);
  for (const extra of ctx.preserve ?? [])
    if (within(p, normalizePath(extra)) || within(normalizePath(extra), p)) out.push(`preserved by policy (${extra})`);
  return out;
}

// ----------------------------------------------------------------------------------------- services

/** Units that are never stopped or disabled: the transport and the base system. */
export const HARD_KEEP_UNITS = [
  "ssh",
  "ssh.service",
  "ssh.socket",
  "sshd",
  "sshd.service",
  "systemd-*",
  "dbus*",
  "user@*",
  "user-runtime-dir@*",
  "getty@*",
  "serial-getty@*",
  "console-getty*",
  "networking*",
  "NetworkManager*",
  "network*",
  "cloud-init*",
  "cron*",
  "rsyslog*",
] as const;

export function matchesGlob(name: string, pattern: string): boolean {
  const bare = name.replace(/\.service$/, "");
  const pat = pattern.replace(/\.service$/, "");
  return new Bun.Glob(pat).match(bare) || new Bun.Glob(pattern).match(name);
}

export function matchesAny(name: string, patterns: readonly string[]): boolean {
  return patterns.some(p => matchesGlob(name, p));
}

export type ServiceClass = "keep" | "candidate" | "unknown";

export interface ServicePolicy {
  readonly keep: readonly string[];
  readonly stop: readonly string[];
}

export function classifyService(name: string, policy: ServicePolicy): { cls: ServiceClass; why: string } {
  if (matchesAny(name, HARD_KEEP_UNITS)) return { cls: "keep", why: "transport or base system (hard-coded)" };
  if (matchesAny(name, policy.keep)) return { cls: "keep", why: "keep-list" };
  if (matchesAny(name, policy.stop)) return { cls: "candidate", why: "stop-candidate in the policy" };
  return {
    cls: "unknown",
    why: "not in the policy: reported, never stopped unless named with --stop",
  };
}

/** May this unit be stopped/disabled at all? (also guards explicit `--stop`) */
export function canStopUnit(name: string, policy: ServicePolicy): Verdict {
  const c = classifyService(name, policy);
  return c.cls === "keep" ? { ok: false, reason: `${name} is protected: ${c.why}` } : { ok: true, reason: c.why };
}

// ----------------------------------------------------------------------------------------- docker

/** docker commands the tool may build. `volume prune` and `--volumes` can destroy data and are never emitted. */
export function isForbiddenDockerCommand(cmd: string): boolean {
  return /\bdocker\b[^;&|]*\b(volume\s+(prune|rm)|system\s+prune[^;&|]*--volumes|--volumes|rm\s+-v|container\s+rm\s+-v)/.test(
    cmd,
  );
}

// --------------------------------------------------------------------------------------- whole command

/** Commands that would wipe or format a device. Used as a last guard on every command about to run. */
export function isDestructiveDeviceCommand(cmd: string): boolean {
  return /(^|[\s;&|(])(mkfs(\.\w+)?|wipefs|sgdisk|sfdisk|fdisk|parted|blkdiscard|shred|cryptsetup\s+(luksFormat|erase)|pvcreate|vgremove|lvremove|mdadm\s+--(create|zero))(\s|$)|\bdd\b[^;&|]*\bof=\/dev\//.test(
    cmd,
  );
}

/** The final gate: a command containing a device wipe or a forbidden docker form is never executed. */
export function assertSafeCommand(cmd: string): void {
  if (isDestructiveDeviceCommand(cmd))
    throw new Error(`refused: command would format or wipe a device: ${cmd.slice(0, 120)}`);
  if (isForbiddenDockerCommand(cmd))
    throw new Error(`refused: docker volume deletion is never issued: ${cmd.slice(0, 120)}`);
  if (/\brm\s+(-[a-zA-Z]*\s+)*\/(\s|$)/.test(cmd) || /\brm\b[^;&|]*\s\/(\*|\s|$)/.test(cmd))
    throw new Error(`refused: rm on the root directory: ${cmd.slice(0, 120)}`);
}

// ------------------------------------------------------------------------------------------ policy

export interface Policy {
  readonly services: ServicePolicy;
  readonly locks: readonly string[];
  readonly protect: readonly string[];
  readonly reclaim: {
    readonly buildArtifactMinAgeDays: number;
    readonly journalMaxSize: string;
    readonly journalMaxAgeDays: number;
    readonly rotatedLogAgeDays: number;
    readonly scanRoots: readonly string[];
    /** directory names the artifact scan never enters (not even to list them) */
    readonly excludeNames: readonly string[];
    readonly cacheDirs: readonly string[];
    readonly swapFileGlobs: readonly string[];
  };
  /** `yolo host space` and the build gate: free-space floor (a variable, see resolveMinFree) and scan shape */
  readonly space: {
    readonly minFree: number;
    readonly parallel: number;
    readonly splitDepth: number;
  };
  readonly tune: {
    readonly nginxWorkers: string;
    readonly governor: string;
    readonly thp: string;
    readonly swappiness: number;
  };
}

export const DEFAULT_POLICY: Policy = {
  services: {
    keep: [
      "nginx",
      "fail2ban",
      "aphrody-*",
      "yolo-*",
      "docker",
      "containerd",
      "postgresql*",
      "redis*",
      "certbot*",
      "chrony",
      "unattended-upgrades",
      "qemu-guest-agent",
      "polkit",
      "tailscale*",
      "wireguard*",
      "wg-quick@*",
      "tinyproxy",
    ],
    stop: [
      "snapd",
      "snapd.*",
      "ModemManager",
      "multipathd",
      "udisks2",
      "packagekit",
      "apport*",
      "motd-news",
      "ubuntu-advantage*",
      "esm-cache",
      "lxd*",
      "lxcfs",
      "irqbalance",
      "bluetooth",
      "cups*",
      "avahi-daemon",
      "wpa_supplicant",
    ],
  },
  locks: [],
  protect: [],
  reclaim: {
    buildArtifactMinAgeDays: 7,
    journalMaxSize: "500M",
    journalMaxAgeDays: 14,
    rotatedLogAgeDays: 30,
    scanRoots: ["~", "/tmp"],
    excludeNames: ["aphrody-ui", ".git", ".rustup", ".cargo"],
    cacheDirs: ["~/.cache/pip", "~/.cache/thumbnails", "~/.npm/_logs"],
    swapFileGlobs: ["/swapfile*", "/swap.img", "/var/swapfile*"],
  },
  space: { minFree: 0.2, parallel: 8, splitDepth: 2 },
  tune: {
    nginxWorkers: "auto",
    governor: "performance",
    thp: "madvise",
    swappiness: 10,
  },
};

type Json = Record<string, unknown>;
const strings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every(x => typeof x === "string") ? (v as string[]) : null;

const merge = (base: readonly string[], extra: unknown): string[] => [...new Set([...base, ...(strings(extra) ?? [])])];
const numberOr = (v: unknown, d: number): number => (typeof v === "number" && v >= 0 ? v : d);
const stringOr = (v: unknown, d: string): string => (typeof v === "string" ? v : d);

/**
 * Parse host-policy.toml (Bun.TOML). Top-level tables apply to every host; `[hosts.<name>.*]` add to them.
 * Lists are unioned with the defaults (the file can add to a keep-list, not empty it) and scalar values
 * override. The hard-coded rules above stay in force whatever the file says.
 */
export function parsePolicy(toml: string | null, host: string): Policy {
  if (toml === null || toml.trim() === "") return DEFAULT_POLICY;
  const root = Bun.TOML.parse(toml) as Json;
  const layers: Json[] = [root];
  const hosts = root["hosts"] as Json | undefined;
  if (hosts !== undefined && typeof hosts[host] === "object") layers.push(hosts[host] as Json);

  let p: Policy = DEFAULT_POLICY;
  for (const layer of layers) {
    const svc = (layer["services"] ?? {}) as Json;
    const rec = (layer["reclaim"] ?? {}) as Json;
    const tune = (layer["tune"] ?? {}) as Json;
    const space = (layer["space"] ?? {}) as Json;
    const locks = (layer["locks"] ?? {}) as Json;
    p = {
      services: {
        keep: merge(p.services.keep, svc["keep"]),
        stop: merge(p.services.stop, svc["stop"]),
      },
      locks: merge(p.locks, locks["paths"]),
      protect: merge(p.protect, layer["protect"] === undefined ? undefined : (layer["protect"] as Json)["paths"]),
      reclaim: {
        buildArtifactMinAgeDays: numberOr(rec["build_artifact_min_age_days"], p.reclaim.buildArtifactMinAgeDays),
        journalMaxSize: stringOr(rec["journal_max_size"], p.reclaim.journalMaxSize),
        journalMaxAgeDays: numberOr(rec["journal_max_age_days"], p.reclaim.journalMaxAgeDays),
        rotatedLogAgeDays: numberOr(rec["rotated_log_age_days"], p.reclaim.rotatedLogAgeDays),
        scanRoots: merge(p.reclaim.scanRoots, rec["scan_roots"]),
        excludeNames: merge(p.reclaim.excludeNames, rec["exclude_names"]),
        cacheDirs: merge(p.reclaim.cacheDirs, rec["cache_dirs"]),
        swapFileGlobs: merge(p.reclaim.swapFileGlobs, rec["swap_file_globs"]),
      },
      space: {
        minFree: ((v: unknown, d: number): number => (typeof v === "number" && v >= 0 && v <= 1 ? v : d))(
          space["min_free"],
          p.space.minFree,
        ),
        parallel: Math.max(1, Math.floor(numberOr(space["parallel"], p.space.parallel))),
        splitDepth: Math.floor(numberOr(space["split_depth"], p.space.splitDepth)),
      },
      tune: {
        nginxWorkers: stringOr(tune["nginx_workers"], p.tune.nginxWorkers),
        governor: stringOr(tune["governor"], p.tune.governor),
        thp: stringOr(tune["thp"], p.tune.thp),
        swappiness: numberOr(tune["swappiness"], p.tune.swappiness),
      },
    };
  }
  return p;
}
