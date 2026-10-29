/**
 * Git at monorepo scale: recommended per-clone configuration, sparse-checkout profiles with shallow submodules,
 * diagnostics and measurements. Every setting is documented in git's own manual (git-config, git-sparse-checkout,
 * git-maintenance, gitmodules); docs/MONOREPO-SCALE.md records the sources and the measured effect.
 * Mutations shell out to the git CLI: gix (used by crates/bun-os-git) reads repositories but has no sparse-checkout
 * or maintenance writers.
 */
import { resolve } from "node:path";
import { runProcess } from "./process.ts";

export interface GitResult {
  code: number;
  out: string;
  err: string;
}

export async function git(cwd: string, args: string[], timeoutMs = 1_800_000): Promise<GitResult> {
  const r = await runProcess(["git", ...args], cwd, { timeoutMs, maxOutputBytes: 256 * 1024 * 1024 });
  return { code: r.code, out: r.stdout.replace(/\r/g, ""), err: r.stderr.replace(/\r/g, "") };
}

export interface Setting {
  key: string;
  value: string;
  /** Platforms the setting applies to (default: all). */
  platforms?: NodeJS.Platform[];
  why: string;
}

/** `git config` keys of the recommended clone; each `why` names the git manual entry it comes from. */
export const RECOMMENDED: Setting[] = [
  {
    key: "core.fsmonitor",
    value: "true",
    platforms: ["win32", "darwin"],
    why: "git-config core.fsmonitor: built-in fsmonitor daemon, available on Windows and macOS only",
  },
  {
    key: "core.untrackedCache",
    value: "true",
    why: "git-config feature.manyFiles: untracked cache (needs working mtime)",
  },
  {
    key: "feature.manyFiles",
    value: "true",
    why: "git-config feature.manyFiles: index.version=4, index.skipHash, untracked cache",
  },
  {
    key: "core.preloadIndex",
    value: "true",
    why: "git-config core.preloadIndex: parallel lstat while refreshing the index",
  },
  { key: "core.longpaths", value: "true", platforms: ["win32"], why: "git-for-windows: paths over MAX_PATH" },
  {
    key: "core.multiPackIndex",
    value: "true",
    why: "git-config core.multiPackIndex: read the multi-pack-index (incremental-repack needs it)",
  },
  {
    key: "fetch.writeCommitGraph",
    value: "true",
    why: "git-config fetch.writeCommitGraph: commit-graph refreshed after each fetch",
  },
  {
    key: "protocol.version",
    value: "2",
    why: "git-config protocol.version: wire protocol v2 (ref filtering, partial clone)",
  },
  {
    key: "submodule.fetchJobs",
    value: "8",
    why: "git-config submodule.fetchJobs: parallel submodule fetch/clone (default 1)",
  },
  {
    key: "submodule.recurse",
    value: "false",
    why: "git-config submodule.recurse: do not recurse into 180+ submodules by default",
  },
  {
    key: "maintenance.strategy",
    value: "incremental",
    why: "git-maintenance: prefetch+commit-graph hourly, loose-objects+incremental-repack daily",
  },
];

export function applicable(platform: NodeJS.Platform = process.platform) {
  return RECOMMENDED.filter(s => !s.platforms || s.platforms.includes(platform));
}

const norm = (v: string) => v.trim().toLowerCase();

export async function readLocal(root: string, key: string) {
  const r = await git(root, ["config", "--local", "--get", key]);
  return r.code === 0 ? r.out.trim() : undefined;
}

/** Idempotent: writes only keys whose local value differs. Returns the keys it changed. */
export async function applyConfig(root: string, dryRun = false) {
  const changed: string[] = [];
  for (const s of applicable()) {
    const cur = await readLocal(root, s.key);
    if (cur !== undefined && norm(cur) === norm(s.value)) continue;
    changed.push(`${s.key}=${s.value}`);
    if (!dryRun) await git(root, ["config", "--local", s.key, s.value]);
  }
  return changed;
}

export interface Profile {
  description: string;
  paths: string[];
  submodules: string[];
  full?: boolean;
  includeOptional?: boolean;
  verify?: string[];
}
export interface ProfileFile {
  alwaysPaths: string[];
  optionalSubmodules: string[];
  profiles: Record<string, Profile>;
}

export const loadProfiles = (): Promise<ProfileFile> =>
  Bun.file(resolve(import.meta.dir, "../config/git-profiles.json")).json();

export async function gitlinks(root: string): Promise<string[]> {
  const r = await git(root, ["ls-files", "-s"]);
  return r.out
    .split("\n")
    .filter(l => l.startsWith("160000"))
    .map(l => l.split("\t")[1]!)
    .sort();
}

/** Pure: which gitlinks a profile initialises. Unmatched patterns are reported, never guessed. */
export function selectSubmodules(file: ProfileFile, profile: Profile, links: string[]) {
  const optional = new Set(file.optionalSubmodules);
  const chosen = new Set<string>();
  const unmatched: string[] = [];
  for (const pat of profile.submodules) {
    const hits =
      pat === "*"
        ? links
        : pat.endsWith("/*")
          ? links.filter(l => l.startsWith(pat.slice(0, -1)))
          : links.filter(l => l === pat);
    if (!hits.length) unmatched.push(pat);
    for (const h of hits)
      if (profile.includeOptional || !optional.has(h) || profile.submodules.includes(h)) chosen.add(h);
  }
  return { submodules: [...chosen].sort(), unmatched };
}

/** Pure: cone directories of a profile (alwaysPaths + profile paths). */
/** Cone mode takes directories only: gitlink paths (submodules) are dropped, git rejects them. */
export const conePaths = (file: ProfileFile, profile: Profile, links: string[] = []) =>
  [...new Set([...file.alwaysPaths, ...profile.paths])].filter(p => !links.includes(p)).sort();

export async function applyProfile(root: string, name: string, opts: { submodules?: boolean; dryRun?: boolean } = {}) {
  const file = await loadProfiles();
  const profile = file.profiles[name];
  if (!profile) throw new Error(`Unknown profile ${name}. Known: ${Object.keys(file.profiles).join(", ")}`);
  const links = await gitlinks(root);
  const { submodules, unmatched } = selectSubmodules(file, profile, links);
  const cone = conePaths(file, profile, links);
  const plan = { profile: name, sparse: !profile.full, cone, submodules, unmatched };
  if (opts.dryRun) return plan;
  if (profile.full) {
    const r = await git(root, ["sparse-checkout", "disable"]);
    if (r.code) throw new Error(r.err);
  } else {
    const r = await git(root, ["sparse-checkout", "set", "--cone", ...cone]);
    if (r.code) throw new Error(r.err);
  }
  if (opts.submodules !== false && submodules.length) {
    // A local override beats the `update = none` that `submodule init` copies from .gitmodules.
    for (const s of submodules) await git(root, ["config", "--local", `submodule.${s}.update`, "checkout"]);
    const r = await git(root, ["submodule", "update", "--init", "--depth", "1", "--jobs", "8", "--", ...submodules]);
    if (r.code) throw new Error(r.err.trim() || r.out.trim());
  }
  return plan;
}

export async function backfillAvailable(root: string) {
  const r = await git(root, ["backfill", "-h"]);
  return (r.err + r.out).includes("usage: git backfill");
}

export async function setupMaintenance(root: string, scheduler: boolean) {
  const r = await git(root, ["maintenance", scheduler ? "start" : "register"]);
  return r.code === 0 ? "ok" : r.err.trim();
}

export interface DoctorReport {
  ok: boolean;
  git: string;
  scalar: boolean;
  backfill: boolean;
  settings: { key: string; want: string; have?: string; ok: boolean }[];
  partialClone?: string;
  sparse: boolean;
  fsmonitorRunning?: boolean;
  gitlinks: number;
  initializedSubmodules: number;
  commitGraph: boolean;
  multiPackIndex: boolean;
  maintenanceRegistered: boolean;
}

export async function doctor(root: string): Promise<DoctorReport> {
  const gitDir = resolve(root, (await git(root, ["rev-parse", "--git-dir"])).out.trim());
  const settings = [];
  for (const s of applicable()) {
    const have = (await git(root, ["config", "--get", s.key])).out.trim() || undefined;
    settings.push({ key: s.key, want: s.value, have, ok: have !== undefined && norm(have) === norm(s.value) });
  }
  const links = await gitlinks(root);
  const status = await git(root, ["submodule", "status"]);
  const initialized = status.out.split("\n").filter(l => l && !l.startsWith("-")).length;
  const registered = (await git(root, ["config", "--get-all", "maintenance.repo"])).out
    .split("\n")
    .map(p => p.trim().replace(/\\/g, "/").toLowerCase())
    .includes(root.replace(/\\/g, "/").toLowerCase());
  const fsm =
    process.platform === "linux"
      ? undefined
      : (await git(root, ["fsmonitor--daemon", "status"])).out.includes("is watching");
  const exists = (p: string) => Bun.file(resolve(gitDir, p)).exists();
  const graph =
    (await exists("objects/info/commit-graph")) || (await exists("objects/info/commit-graphs/commit-graph-chain"));
  const report: DoctorReport = {
    ok: false,
    git: (await git(root, ["--version"])).out.trim(),
    scalar: Boolean(Bun.which("scalar")),
    backfill: await backfillAvailable(root),
    settings,
    partialClone: (await git(root, ["config", "--get", "remote.origin.partialclonefilter"])).out.trim() || undefined,
    sparse: norm((await git(root, ["config", "--get", "core.sparseCheckout"])).out) === "true",
    fsmonitorRunning: fsm,
    gitlinks: links.length,
    initializedSubmodules: initialized,
    commitGraph: graph,
    multiPackIndex: await exists("objects/pack/multi-pack-index"),
    maintenanceRegistered: registered,
  };
  report.ok = settings.every(s => s.ok) && report.commitGraph && report.maintenanceRegistered;
  return report;
}

/**
 * Maintenance pass: deinitialise submodules outside the named profile (git refuses dirty ones without --force, and
 * nothing here forces), reapply the cone, refresh commit-graph and multi-pack-index. Deletes no commits.
 */
export async function prune(root: string, name: string | undefined) {
  const file = await loadProfiles();
  const keep = new Set<string>();
  if (name) {
    const p = file.profiles[name];
    if (!p) throw new Error(`Unknown profile ${name}`);
    for (const s of selectSubmodules(file, p, await gitlinks(root)).submodules) keep.add(s);
  }
  const done: string[] = [];
  if (name)
    for (const l of (await git(root, ["submodule", "status"])).out.split("\n")) {
      const m = l.match(/^[ +U]\S+ (\S+)/);
      if (!m || keep.has(m[1]!)) continue;
      if ((await git(root, ["submodule", "deinit", m[1]!])).code === 0) done.push(m[1]!);
    }
  await git(root, ["sparse-checkout", "reapply"]);
  await git(root, ["commit-graph", "write", "--reachable", "--changed-paths", "--split"]);
  await git(root, ["multi-pack-index", "write"]);
  await git(root, ["maintenance", "run", "--task=loose-objects", "--task=incremental-repack"]);
  return { deinitialized: done };
}

async function timeGit(root: string, args: string[]) {
  const t = performance.now();
  const r = await git(root, args);
  return { ms: Math.round(performance.now() - t), code: r.code };
}

/** Median-of-3 wall clock of the read paths that dominate developer time, without and with the recommended settings. */
export async function measure(root: string) {
  const off = [
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    "-c",
    "feature.manyFiles=false",
    "-c",
    "core.preloadIndex=false",
  ];
  const rows: { mode: string; label: string; ms: number }[] = [];
  for (const [mode, flags] of [
    ["baseline", off],
    ["tuned", [] as string[]],
  ] as const) {
    await git(root, [...flags, "status", "--porcelain"]); // warm-up: builds the untracked cache / starts the daemon
    for (const [label, args] of [
      ["status", ["status", "--porcelain"]],
      ["ls-files", ["ls-files"]],
      ["log -n 1000 -- crates", ["log", "-n", "1000", "--format=%H", "--", "crates"]],
      ["fetch --dry-run", ["fetch", "--dry-run", "origin", "os"]],
    ] as const) {
      const samples: number[] = [];
      for (let i = 0; i < 3; i++) samples.push((await timeGit(root, [...flags, ...args])).ms);
      samples.sort((a, b) => a - b);
      rows.push({ mode, label, ms: samples[1]! });
    }
  }
  return rows;
}
