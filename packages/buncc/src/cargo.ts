import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
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

export const DEFAULT_CARGO_DEADLINE = 30 * 60_000;

/**
 * Run cargo under a global build slot (BUNCC_SLOTS, default 1) and a lock on its target directory. The deadline covers
 * waiting for the lock and the build together. With more than one slot, slot N builds into target/slot-N so builds do not block.
 */
export async function runCargo(args: string[], options: CargoOptions): Promise<RunResult> {
  const log = options.log ?? ((line: string) => process.stderr.write(line + "\n"));
  // BUNCC_CARGO_DEADLINE_MS lifts the default for whole-workspace runs (clippy --all-targets on CI outlasts 30 minutes).
  const configured = Number(Bun.env.BUNCC_CARGO_DEADLINE_MS);
  const total = options.timeoutMs ?? (configured > 0 ? configured : DEFAULT_CARGO_DEADLINE);
  const started = Date.now();
  const slots = Math.max(
    1,
    Math.min(16, Number.parseInt(options.env?.BUNCC_SLOTS ?? Bun.env.BUNCC_SLOTS ?? "1", 10) || 1),
  );
  const { slot, release } = await acquireSlot(slots, total, () =>
    log(`buncc: waiting for one of ${slots} build slot(s)...`),
  );
  try {
    const prepared = await prepareEnv(options.env ?? Bun.env, { driver: options.driver });
    for (const note of prepared.notes) log(`buncc: ${note}`);
    const env = prepared.env;
    env.BUNCC_SLOT = String(slot);
    if (slots > 1 && !env.CARGO_TARGET_DIR) env.CARGO_TARGET_DIR = join(options.root, "target", `slot-${slot}`);
    const targetDir = resolve(options.root, env.CARGO_TARGET_DIR ?? "target");
    return await withLock(
      lockPathFor("cargo", targetDir),
      {
        deadlineMs: Math.max(1000, total - (Date.now() - started)),
        onWait: () => log(`buncc: waiting for the cargo lock on ${targetDir}...`),
      },
      () =>
        run(["cargo", ...args], {
          cwd: options.cwd ?? options.root,
          env,
          timeoutMs: Math.max(1000, total - (Date.now() - started)),
          output: options.capture ? "capture" : "inherit",
        }),
    );
  } finally {
    release();
  }
}
