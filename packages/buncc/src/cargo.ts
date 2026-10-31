import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism } from "node:os";
import { basename, join, resolve } from "node:path";
import { overlayEnv, sanitizeEnv, type Env } from "./env.ts";
import { acquireSlot, cacheDir, lockPathFor, withLock } from "./lock.ts";
import { run, type RunResult } from "./process.ts";
import { captureVcvars, findVisualStudio } from "./providers/msvc.ts";
import { decideWrapper, sccacheProbe } from "./sccache.ts";

export interface PreparedEnv {
  env: Env;
  notes: string[];
}

/** `x86_64-pc-windows-msvc` to the upper-case form used in CARGO_TARGET_<TRIPLE>_LINKER. */
export function tripleUpper(triple: string): string {
  return triple.toUpperCase().replaceAll("-", "_");
}

/** Variables that point cc-rs and CMake at the buncc driver shims. */
export function driverEnv(triple: string, shims: { cc: string; cxx: string; ar: string }): Record<string, string> {
  const lower = triple.replaceAll("-", "_");
  return { [`CC_${lower}`]: shims.cc, [`CXX_${lower}`]: shims.cxx, [`AR_${lower}`]: shims.ar };
}

/** Write cc/c++/ar/link launchers that run this CLI under the Bun that is running now. Returns their paths. */
export function writeShims(
  cli: string,
  dir = join(cacheDir(), "shims"),
): { cc: string; cxx: string; ar: string; link: string } {
  mkdirSync(dir, { recursive: true });
  const out: Record<string, string> = {};
  for (const kind of ["cc", "c++", "ar", "link"] as const) {
    const win = process.platform === "win32";
    const file = join(dir, `buncc-${kind === "c++" ? "cxx" : kind}${win ? ".cmd" : ""}`);
    const body = win
      ? `@echo off\r\n"${process.execPath}" "${cli}" ${kind} %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${cli}" ${kind} "$@"\n`;
    writeFileSync(file, body);
    if (!win) chmodSync(file, 0o755);
    out[kind === "c++" ? "cxx" : kind] = file;
  }
  return out as { cc: string; cxx: string; ar: string; link: string };
}

/**
 * Build environment for cargo: stale paths removed, MSVC entered on Windows, a crashing sccache bypassed.
 * sccache is only injected when BUNCC_SCCACHE=on; a RUSTC_WRAPPER the user set is kept only while it is healthy.
 */
export async function prepareEnv(
  base: Env = Bun.env,
  options: { driver?: boolean; cli?: string } = {},
): Promise<PreparedEnv> {
  const notes: string[] = [];
  const sanitized = sanitizeEnv(base);
  let env = sanitized.env;
  for (const entry of sanitized.dropped) notes.push(`dropped ${entry.name} (${entry.reason}): ${entry.value}`);
  if (process.platform === "win32" && !env.VSCMD_VER) {
    const instance = await findVisualStudio(env);
    if (instance) {
      const captured = await captureVcvars(instance, { arch: "x64" }, env);
      env = overlayEnv(env, captured.env);
      notes.push(`MSVC from ${instance.displayName || instance.path} (${captured.cached ? "cached" : "captured"})`);
    } else notes.push("no Visual Studio C++ toolset found; using whatever link.exe is on PATH");
  }
  const wrapper = env.RUSTC_WRAPPER;
  const wantsSccache = env.BUNCC_SCCACHE === "on" || (wrapper ? /sccache/i.test(basename(wrapper)) : false);
  if (wantsSccache && env.BUNCC_SCCACHE !== "off") {
    const decision = decideWrapper(await sccacheProbe(env), env.BUNCC_SCCACHE);
    notes.push(decision.note);
    if (decision.wrapper) env.RUSTC_WRAPPER = decision.wrapper;
    else {
      delete env.RUSTC_WRAPPER;
      delete env.CARGO_BUILD_RUSTC_WRAPPER;
    }
  } else if (env.BUNCC_SCCACHE === "off") {
    delete env.RUSTC_WRAPPER;
    delete env.CARGO_BUILD_RUSTC_WRAPPER;
  }
  if (options.driver || env.BUNCC_DRIVER === "1") {
    const cli = options.cli ?? resolve(import.meta.dir, "cli.ts");
    const shims = writeShims(cli);
    const triple = env.CARGO_BUILD_TARGET ?? (process.platform === "win32" ? "x86_64-pc-windows-msvc" : "");
    if (triple) env = overlayEnv(env, driverEnv(triple, shims));
    notes.push("cc-rs routed through the buncc driver");
  }
  return { env, notes };
}

export interface CargoOptions {
  root: string;
  cwd?: string;
  timeoutMs?: number;
  capture?: boolean;
  env?: Env;
  driver?: boolean;
  log?: (line: string) => void;
}

/** Default no-progress window: a build that burns no CPU for this long is hung and is killed. */
export const DEFAULT_CARGO_STALL = 30 * 60_000;
/** Compiler jobs per lane: the owner's limit, never exceeded. */
export const MAX_LANE_JOBS = 4;
/** Fast local disk holding one build directory per lane on the VPS. */
export const DEFAULT_LANE_ROOT = "/var/cache/aphrody-target";

export interface LanePlan {
  lanes: number;
  jobs: number;
  root: string | undefined;
}

/**
 * Lanes sized to the host: one lane per four CPUs (12 cores -> 3 lanes of 4 jobs), BUNCC_SLOTS overrides the count,
 * BUNCC_LANE_ROOT (default /var/cache/aphrody-target when it exists) holds lane-N build and target directories.
 */
export function planLanes(env: Env, cpus = availableParallelism(), laneRootExists = existsSync): LanePlan {
  const configured = Number.parseInt(env.BUNCC_SLOTS ?? "", 10);
  const derived = process.platform === "win32" ? 1 : Math.max(1, Math.floor(cpus / MAX_LANE_JOBS));
  const lanes = Math.max(1, Math.min(16, Number.isFinite(configured) && configured > 0 ? configured : derived));
  const requested = Number.parseInt(env.CARGO_BUILD_JOBS ?? "", 10);
  const share = Math.max(1, Math.floor(cpus / lanes));
  const jobs = Math.max(1, Math.min(MAX_LANE_JOBS, requested > 0 ? requested : share));
  const root = env.BUNCC_LANE_ROOT || (process.platform === "linux" && laneRootExists(DEFAULT_LANE_ROOT) ? DEFAULT_LANE_ROOT : undefined);
  return { lanes, jobs, root };
}

/** CPU ticks used by `pid` and its live descendants plus reaped children (Linux /proc), or undefined elsewhere. */
export function treeCpuTicks(pid: number): number | undefined {
  if (process.platform !== "linux") return undefined;
  const children = new Map<number, number[]>();
  const ticks = new Map<number, number>();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const ppid = Number(fields[1]);
      // utime, stime, cutime, cstime are fields 14-17 (index 11-14 after the comm field).
      ticks.set(Number(entry), Number(fields[11]) + Number(fields[12]) + Number(fields[13]) + Number(fields[14]));
      children.set(ppid, [...(children.get(ppid) ?? []), Number(entry)]);
    } catch {}
  }
  let total = 0;
  const stack = [pid];
  while (stack.length) {
    const next = stack.pop()!;
    total += ticks.get(next) ?? 0;
    stack.push(...(children.get(next) ?? []));
  }
  return total;
}

/** True when `path` is a complete ar archive (every member fits inside the file). */
export function completeArchive(path: string): boolean {
  try {
    const size = statSync(path).size;
    const fd = openSync(path, "r");
    try {
      const magic = Buffer.alloc(8);
      readSync(fd, magic, 0, 8, 0);
      if (magic.toString("latin1") !== "!<arch>\n") return false;
      let offset = 8;
      const header = Buffer.alloc(60);
      while (offset < size) {
        if (readSync(fd, header, 0, 60, offset) !== 60) return false;
        const memberSize = Number.parseInt(header.toString("latin1", 48, 58).trim(), 10);
        if (!Number.isFinite(memberSize) || memberSize < 0) return false;
        offset += 60 + memberSize + (memberSize % 2);
        if (offset > size + 1) return false;
      }
      return true;
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

/**
 * A killed build can leave a truncated prebuilt download (rusty_v8's librusty_v8.a, with a .tmp beside it) that every
 * later build trusts. Under the lane lock nothing else writes this directory, so drop such artifacts and let the build
 * script fetch them again.
 */
export function repairTruncatedArtifacts(buildDir: string, log: (line: string) => void): void {
  if (!existsSync(buildDir)) return;
  const candidates: string[] = [];
  for (const profile of readdirSync(buildDir)) {
    for (const nested of ["", ...(existsSync(join(buildDir, profile)) ? safeList(join(buildDir, profile)) : [])]) {
      const obj = join(buildDir, profile, nested, "build", "gn_out", "obj");
      if (existsSync(obj)) candidates.push(obj);
    }
  }
  for (const obj of candidates) {
    const archive = join(obj, "librusty_v8.a");
    const partial = existsSync(join(obj, "librusty_v8.tmp"));
    if (!partial && (!existsSync(archive) || completeArchive(archive))) continue;
    for (const name of ["librusty_v8.a", "librusty_v8.tmp", "librusty_v8.sum"]) rmSync(join(obj, name), { force: true });
    log(`buncc: removed a truncated rusty_v8 download in ${obj}; the build fetches it again`);
  }
}

/** Minimum free space kept on the lane disk (BUNCC_LANE_MIN_FREE_GB, default 25). */
function reclaimLaneSpace(root: string, lane: string, log: (line: string) => void): void {
  const minimum = (Number(Bun.env.BUNCC_LANE_MIN_FREE_GB) > 0 ? Number(Bun.env.BUNCC_LANE_MIN_FREE_GB) : 25) * 2 ** 30;
  try {
    const fs = statfsSync(root);
    if (fs.bavail * fs.bsize >= minimum) return;
    // Only this lane is provably idle (we hold its lock): start it cold rather than fill the disk.
    rmSync(join(lane, "build"), { recursive: true, force: true });
    log(`buncc: lane disk below ${minimum / 2 ** 30} GiB free; cleared ${lane}/build`);
  } catch {}
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Run cargo in one of N lanes. Each lane has its own build and target directory on the fast disk
 * (BUNCC_LANE_ROOT/lane-N), at most four compiler jobs, and the shared sccache when it is enabled.
 * Waiting for a lane is not a failure (BUNCC_LANE_WAIT_MS, default 12 h). A running build is only killed when it makes
 * no progress: `options.timeoutMs` (default 30 min) is the window in which the cargo process tree must burn CPU.
 * BUNCC_CARGO_DEADLINE_MS adds an explicit hard deadline for callers that need one.
 */
export async function runCargo(args: string[], options: CargoOptions): Promise<RunResult> {
  const log = options.log ?? ((line: string) => process.stderr.write(line + "\n"));
  const baseEnv = options.env ?? Bun.env;
  const plan = planLanes(baseEnv);
  const stallMs = options.timeoutMs ?? DEFAULT_CARGO_STALL;
  const hardDeadline = Number(Bun.env.BUNCC_CARGO_DEADLINE_MS) > 0 ? Number(Bun.env.BUNCC_CARGO_DEADLINE_MS) : undefined;
  const laneWait = Number(Bun.env.BUNCC_LANE_WAIT_MS) > 0 ? Number(Bun.env.BUNCC_LANE_WAIT_MS) : 12 * 60 * 60_000;
  const { slot, release } = await acquireSlot(plan.lanes, laneWait, () =>
    log(`buncc: waiting for one of ${plan.lanes} cargo lane(s)...`),
  );
  try {
    const prepared = await prepareEnv(baseEnv, { driver: options.driver });
    for (const note of prepared.notes) log(`buncc: ${note}`);
    const env = prepared.env;
    env.BUNCC_SLOT = String(slot);
    env.CARGO_BUILD_JOBS = String(plan.jobs);
    // A build directory under the lane root (the host default for direct cargo) is not a caller's own choice.
    const inheritedBuildDir = env.CARGO_BUILD_BUILD_DIR && !(plan.root && env.CARGO_BUILD_BUILD_DIR.startsWith(plan.root));
    if (plan.root && !env.CARGO_TARGET_DIR && !inheritedBuildDir) {
      const lane = join(plan.root, `lane-${slot}`);
      mkdirSync(lane, { recursive: true });
      reclaimLaneSpace(plan.root, lane, log);
      env.CARGO_TARGET_DIR = lane;
      env.CARGO_BUILD_BUILD_DIR = join(lane, "build");
      // Full DWARF made the old shared build directory 250 GB; line tables keep backtraces and fit the fast disk.
      env.CARGO_PROFILE_DEV_DEBUG ??= "line-tables-only";
      env.CARGO_PROFILE_TEST_DEBUG ??= "line-tables-only";
    } else if (plan.lanes > 1 && !env.CARGO_TARGET_DIR) {
      env.CARGO_TARGET_DIR = join(options.root, "target", `slot-${slot}`);
    }
    const targetDir = resolve(options.root, env.CARGO_TARGET_DIR ?? "target");
    const buildDir = resolve(options.root, env.CARGO_BUILD_BUILD_DIR ?? env.CARGO_TARGET_DIR ?? "build/rust");
    log(`buncc: lane ${slot}/${plan.lanes}, ${plan.jobs} jobs, target ${targetDir}`);
    return await withLock(
      lockPathFor("cargo", targetDir),
      {
        deadlineMs: laneWait,
        staleMs: Number.POSITIVE_INFINITY,
        onWait: () => log(`buncc: waiting for the cargo lock on ${targetDir}...`),
      },
      () => {
        repairTruncatedArtifacts(buildDir, log);
        return run(["cargo", ...args], {
          cwd: options.cwd ?? options.root,
          env,
          timeoutMs: hardDeadline,
          stallMs,
          progress: treeCpuTicks,
          output: options.capture ? "capture" : "inherit",
        });
      },
    );
  } finally {
    release();
  }
}
