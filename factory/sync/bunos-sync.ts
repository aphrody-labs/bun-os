#!/usr/bin/env bun
/**
 * Bun OS auto-sync: keeps a checkout converged with origin/main, never forcing or rewriting published history and never
 * discarding work. The same script runs on the VPS (systemd user timer) and on the workstation (Scheduled Task).
 *
 *   bun factory/sync/bunos-sync.ts                      one pass (what the timer runs)
 *   bun factory/sync/bunos-sync.ts --loop               repeat every BUNOS_SYNC_INTERVAL seconds (default 600)
 *   bun factory/sync/bunos-sync.ts --dry-run            print the decision, change nothing
 *   bun factory/sync/bunos-sync.ts --repo <dir> --host <name> [--stamp <YYYYMMDDTHHMMSSZ>] [--heal-now]
 *
 * One pass:
 *   1. Repair: a stale `.git/index.lock` (old, and no live git process in this checkout) is removed.
 *   2. fetch origin/main (credentials come from the git credential helper; nothing is stored or printed here).
 *   3. Clean and behind: fast-forward. Clean and ahead: normal `git push origin HEAD:main`.
 *   4. Dirty, diverged, on another branch or detached: self-heal. Everything (tracked changes, staged changes, untracked
 *      files, divergent local commits through the snapshot's parents) is committed to `refs/wip/<host>/<stamp>`, the
 *      ref is verified, untracked paths that origin/main now tracks are moved aside, and the checkout is reset to
 *      origin/main on branch main. Untracked files are never deleted. The ref is logged to the status file and
 *      appended to wip.jsonl in the state directory.
 *   5. Lock writer (BUNOS_SYNC_LOCK_WRITER=1, the VPS only): when manifests changed and Cargo.lock no longer matches,
 *      `cargo metadata` updates it and the VPS commits and pushes the lock. This is the only lock writer.
 *   6. Gate (BUNOS_SYNC_GATE=1, the VPS only): factory/sync/bunos-gate.ts runs the main gate on the new HEAD.
 *
 * Environment: BUNOS_REPO, BUNOS_SYNC_HOST, BUNOS_SYNC_INTERVAL, BUNOS_SYNC_STATE (state directory),
 * BUNOS_SYNC_PUSH=0 (no push), BUNOS_SYNC_HEAL=0 (report instead of healing), BUNOS_SYNC_DIRTY_GRACE (seconds a dirty
 * tree that blocks nothing may stay dirty, default 1800), BUNOS_SYNC_LOCK_WRITER=1, BUNOS_SYNC_GATE=1.
 */
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const argv = process.argv.slice(2);
const option = (name: string) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const home = homedir();
const repo = resolve(option("--repo") ?? process.env.BUNOS_REPO ?? join(home, "src", "bun-os"));
const host = (option("--host") ?? process.env.BUNOS_SYNC_HOST ?? hostname().split(".")[0] ?? "host")
  .toLowerCase()
  .replace(/[^a-z0-9-]/g, "-");
const stateDir = process.env.BUNOS_SYNC_STATE ?? join(home, ".local", "state", "bunos-sync");
const statusFile = process.env.BUNOS_SYNC_STATUS ?? join(stateDir, "status.json");
const stateFile = join(stateDir, "state.json");
const wipLog = join(stateDir, "wip.jsonl");
const interval = Number(process.env.BUNOS_SYNC_INTERVAL ?? 600);
const push = process.env.BUNOS_SYNC_PUSH !== "0";
const heal = process.env.BUNOS_SYNC_HEAL !== "0";
const dirtyGraceMs = Number(process.env.BUNOS_SYNC_DIRTY_GRACE ?? 1800) * 1000;
const lockWriter = process.env.BUNOS_SYNC_LOCK_WRITER === "1";
const gateEnabled = process.env.BUNOS_SYNC_GATE === "1";
const dryRun = argv.includes("--dry-run");
const loop = argv.includes("--loop");
const healNow = argv.includes("--heal-now");
const fixedStamp = option("--stamp");
const IDENTITY = { name: "aphrody-dev", email: "contact@aphrody.com" };
/** Untracked files above this size stay on disk but are not copied into the snapshot (listed in its message). */
const SNAPSHOT_FILE_LIMIT = 64 * 1024 * 1024;
const MANIFESTS = ["Cargo.lock", ":(glob)**/Cargo.toml", ".cargo/config.toml", "rust-toolchain.toml"];

export type Outcome = "current" | "fast-forwarded" | "pushed" | "healed" | "diverged" | "dirty" | "busy" | "error";

interface Result {
  code: number;
  out: string;
  err: string;
}

async function git(args: string[], options: { env?: Record<string, string>; stdin?: Uint8Array; timeoutMs?: number } = {}) {
  const proc = Bun.spawn(["git", "-C", repo, "-c", "core.quotePath=false", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: options.stdin ?? "ignore",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...options.env },
    timeout: options.timeoutMs ?? 600_000,
    windowsHide: true,
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: out.trimEnd(), err: err.trim() } satisfies Result;
}

async function gitOk(args: string[], options?: Parameters<typeof git>[1]): Promise<string> {
  const result = await git(args, options);
  if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${(result.err || result.out).split("\n").at(-1)}`);
  return result.out;
}

const lastLine = (result: Result) => (result.err || result.out).split("\n").at(-1) ?? "";

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function saveState(patch: Record<string, unknown>) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ ...readJson(stateFile, {}), ...patch }, null, 2) + "\n");
}

function record(outcome: Outcome, detail: string, extra: Record<string, unknown> = {}): Outcome {
  const status = { at: new Date().toISOString(), repo, host, outcome, detail, ...extra };
  mkdirSync(dirname(statusFile), { recursive: true });
  writeFileSync(statusFile, JSON.stringify(status, null, 2) + "\n");
  console.log(`[bunos-sync] ${status.at} ${outcome}: ${detail}`);
  return outcome;
}

function stampNow(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

/** Pids of live git processes working in this checkout (Linux /proc; elsewhere none can be proven). */
function liveGitProcesses(): number[] {
  if (process.platform !== "linux") return [];
  const found: number[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    try {
      const cmd = readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0");
      if (!basename(cmd[0] ?? "").startsWith("git")) continue;
      const cwd = readlinkSync(`/proc/${entry}/cwd`);
      if (cwd === repo || cwd.startsWith(repo + "/") || cmd.some(arg => arg === repo)) found.push(Number(entry));
    } catch {}
  }
  return found;
}

/** Remove `.git/index.lock` once it is old and no git process in this checkout can hold it. */
function repairIndexLock(gitDir: string): string | undefined {
  const lock = join(gitDir, "index.lock");
  if (!existsSync(lock)) return undefined;
  const age = Date.now() - statSync(lock).mtimeMs;
  const minimum = process.platform === "linux" ? 10 * 60_000 : 30 * 60_000;
  if (age < minimum) return "busy";
  const holders = liveGitProcesses();
  if (holders.length) return `held by git pid ${holders.join(",")}`;
  if (!dryRun) rmSync(lock, { force: true });
  console.log(`[bunos-sync] removed stale ${lock} (${Math.round(age / 60_000)} min old, no live git process)`);
  return "removed";
}

/** One pass at a time per checkout. */
function acquirePassLock(gitDir: string): (() => void) | undefined {
  const lock = join(gitDir, "bunos-sync.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { flag: "wx" });
      return () => rmSync(lock, { force: true });
    } catch {
      const holder = readJson<{ pid?: number; startedAt?: number }>(lock, {});
      let alive = false;
      if (holder.pid) {
        try {
          process.kill(holder.pid, 0);
          alive = true;
        } catch (error) {
          alive = (error as NodeJS.ErrnoException).code === "EPERM";
        }
      }
      if (alive && Date.now() - (holder.startedAt ?? 0) < 6 * 60 * 60_000) return undefined;
      rmSync(lock, { force: true });
    }
  }
  return undefined;
}

interface Snapshot {
  ref: string;
  commit: string;
  tracked: number;
  untracked: number;
  skipped: string[];
  displaced: string[];
}

/** Commit the whole working state (index, tracked changes, untracked files) to refs/wip/<host>/<stamp>. */
async function snapshot(gitDir: string, reason: string, parents: string[], tracked: string[]): Promise<Snapshot> {
  const stamp = fixedStamp ?? stampNow();
  const ref = `refs/wip/${host}/${stamp}`;
  if ((await git(["rev-parse", "--verify", "--quiet", ref])).code === 0) throw new Error(`${ref} already exists`);
  const index = join(gitDir, "bunos-wip.index");
  rmSync(index, { force: true });
  // Start from the real index: staged work is kept and stat data avoids rehashing the whole tree.
  if (existsSync(join(gitDir, "index"))) copyFileSync(join(gitDir, "index"), index);
  const env = { GIT_INDEX_FILE: index };
  try {
    if (!existsSync(index)) await gitOk(["read-tree", "HEAD"], { env });
    await gitOk(["add", "-u"], { env, timeoutMs: 1_800_000 });
    const listed = (await gitOk(["ls-files", "-z", "-o", "--exclude-standard"], { timeoutMs: 1_800_000 }))
      .split("\0")
      .filter(Boolean);
    const skipped: string[] = [];
    const include: string[] = [];
    for (const path of listed) {
      try {
        const info = statSync(join(repo, path));
        if (info.isFile() && info.size > SNAPSHOT_FILE_LIMIT) skipped.push(path);
        else include.push(path);
      } catch {
        include.push(path);
      }
    }
    if (include.length)
      await gitOk(
        ["-c", "advice.addEmbeddedRepo=false", "add", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"],
        { env, stdin: new TextEncoder().encode(include.join("\0") + "\0"), timeoutMs: 1_800_000 },
      );
    const tree = await gitOk(["write-tree"], { env });
    const message = [
      `wip: ${host} snapshot ${stamp}`,
      "",
      `Saved by factory/sync/bunos-sync.ts before resetting ${repo} to origin/main.`,
      `Reason: ${reason}`,
      `Parents: ${parents.join(" ")}`,
      `Tracked changes: ${tracked.length}; untracked paths: ${include.length}`,
      ...(skipped.length ? ["Left on disk, not copied (over 64 MiB):", ...skipped.map(path => `  ${path}`)] : []),
      "",
      "Recover: git switch -c <name> " + ref + "   (or cherry-pick / checkout <ref> -- <path>)",
    ].join("\n");
    const commit = await gitOk(["commit-tree", tree, ...parents.flatMap(parent => ["-p", parent]), "-F", "-"], {
      stdin: new TextEncoder().encode(message + "\n"),
      env: {
        GIT_AUTHOR_NAME: IDENTITY.name,
        GIT_AUTHOR_EMAIL: IDENTITY.email,
        GIT_COMMITTER_NAME: IDENTITY.name,
        GIT_COMMITTER_EMAIL: IDENTITY.email,
      },
    });
    await gitOk(["update-ref", "-m", "bunos-sync snapshot", ref, commit, ""]);
    if ((await gitOk(["rev-parse", "--verify", ref])) !== commit) throw new Error(`${ref} did not record ${commit}`);
    return { ref, commit, tracked: tracked.length, untracked: include.length, skipped, displaced: [] };
  } finally {
    rmSync(index, { force: true });
  }
}

/** Move untracked paths that the target commit tracks out of the way, so the reset cannot overwrite them. */
async function displaceCollisions(target: string, stamp: string): Promise<string[]> {
  const entries = (await gitOk(["ls-files", "-z", "-o", "--exclude-standard", "--directory", "--no-empty-directory"]))
    .split("\0")
    .filter(Boolean)
    .map(path => path.replace(/\/$/, ""));
  const moved: string[] = [];
  for (let start = 0; start < entries.length; start += 200) {
    const chunk = entries.slice(start, start + 200);
    const tracked = new Set(
      (await gitOk(["ls-tree", "-z", "--name-only", target, "--", ...chunk])).split("\0").filter(Boolean),
    );
    for (const path of chunk) {
      if (!tracked.has(path)) continue;
      const destination = join(stateDir, "displaced", host, stamp, path);
      mkdirSync(dirname(destination), { recursive: true });
      try {
        renameSync(join(repo, path), destination);
        moved.push(path);
      } catch (error) {
        console.log(`[bunos-sync] could not move ${path} aside: ${(error as Error).message}`);
      }
    }
  }
  return moved;
}

async function newestChange(paths: string[]): Promise<number> {
  let newest = 0;
  for (const path of paths) {
    try {
      newest = Math.max(newest, statSync(join(repo, path)).mtimeMs);
    } catch {
      newest = Date.now();
    }
  }
  return newest;
}

async function pushMain(): Promise<Result> {
  return git(["push", "origin", "HEAD:main"], { timeoutMs: 300_000 });
}

/** The single Cargo.lock writer: keep the lock in step with the manifests on main. */
async function syncCargoLock(head: string): Promise<string> {
  const state = readJson<{ lockVerified?: string }>(stateFile, {});
  if (state.lockVerified === head) return "lock: verified";
  if (state.lockVerified) {
    const range = await git(["diff", "--name-only", state.lockVerified, head, "--", ...MANIFESTS]);
    if (range.code === 0 && !range.out) {
      saveState({ lockVerified: head });
      return "lock: no manifest change";
    }
  }
  const cargo = (args: string[]) =>
    Bun.spawn(["cargo", "metadata", "--format-version", "1", ...args], {
      cwd: repo,
      stdout: "ignore",
      stderr: "pipe",
      timeout: 1_800_000,
      env: { ...process.env, CARGO_TERM_COLOR: "never" },
      windowsHide: true,
    });
  const locked = cargo(["--locked"]);
  const lockedErr = await new Response(locked.stderr).text();
  if ((await locked.exited) === 0) {
    saveState({ lockVerified: head });
    return "lock: matches manifests";
  }
  if (!/cannot update the lock file/.test(lockedErr))
    return `lock: cargo metadata failed: ${lockedErr.trim().split("\n").at(-1)}`;
  if (dryRun) return "lock: dry-run: would update Cargo.lock";
  const update = cargo([]);
  const updateErr = await new Response(update.stderr).text();
  if ((await update.exited) !== 0) return `lock: update failed: ${updateErr.trim().split("\n").at(-1)}`;
  const changed = (await gitOk(["diff", "--name-only", "--ignore-submodules=all"])).split("\n").filter(Boolean);
  if (changed.join() !== "Cargo.lock") return `lock: refusing to commit unexpected changes: ${changed.join(", ")}`;
  await gitOk(["add", "Cargo.lock"]);
  await gitOk(["commit", "-m", "lock: sync Cargo.lock with the manifests (VPS lock writer)"], {
    env: {
      GIT_AUTHOR_NAME: IDENTITY.name,
      GIT_AUTHOR_EMAIL: IDENTITY.email,
      GIT_COMMITTER_NAME: IDENTITY.name,
      GIT_COMMITTER_EMAIL: IDENTITY.email,
    },
  });
  const pushed = await pushMain();
  if (pushed.code !== 0) {
    // The lock commit is derived data: drop it and regenerate on the next pass instead of diverging.
    await git(["fetch", "--no-recurse-submodules", "origin", "main"]);
    await git(["reset", "--hard", "origin/main"]);
    return `lock: push rejected (${lastLine(pushed)}); regenerated next pass`;
  }
  const committed = await gitOk(["rev-parse", "HEAD"]);
  saveState({ lockVerified: committed });
  return `lock: committed and pushed ${committed.slice(0, 10)}`;
}

async function pass(): Promise<Outcome> {
  const gitDirResult = await git(["rev-parse", "--absolute-git-dir"]);
  if (gitDirResult.code !== 0) return record("error", `not a git checkout: ${lastLine(gitDirResult)}`);
  const gitDir = gitDirResult.out;
  const release = acquirePassLock(gitDir);
  if (!release) return record("busy", "another sync or gate pass holds the checkout");
  try {
    const repaired = repairIndexLock(gitDir);
    if (repaired === "busy" || repaired?.startsWith("held")) return record("busy", `index.lock ${repaired}`);

    const fetch = await git(["fetch", "--no-recurse-submodules", "origin", "main"], { timeoutMs: 300_000 });
    if (fetch.code !== 0) return record("error", `fetch failed: ${lastLine(fetch)}`);

    const branch = (await git(["symbolic-ref", "--quiet", "--short", "HEAD"])).out || "(detached)";
    const local = await gitOk(["rev-parse", "HEAD"]);
    const remote = await gitOk(["rev-parse", "origin/main"]);
    const localMain = (await git(["rev-parse", "--verify", "--quiet", "refs/heads/main"])).out;
    const base = (await git(["merge-base", "HEAD", "origin/main"])).out;
    const sha = { branch, local, remote };
    // Submodule pointers move during builds; they never count as dirt.
    const tracked = (await gitOk(["diff", "--name-only", "HEAD", "--ignore-submodules=all"], { timeoutMs: 1_800_000 }))
      .split("\n")
      .filter(Boolean);
    const staged = (await gitOk(["diff", "--cached", "--name-only", "--ignore-submodules=all"])).split("\n").filter(Boolean);
    const dirty = [...new Set([...tracked, ...staged])];
    const behind = base === local && local !== remote;
    const ahead = base === remote && local !== remote;
    const diverged = base !== local && base !== remote;
    const offMain = branch !== "main";

    let healReason = "";
    if (offMain) healReason = `checkout is on ${branch}, not main`;
    else if (diverged) healReason = "local main and origin/main both have commits";
    else if (dirty.length && (behind || healNow)) healReason = `${dirty.length} uncommitted tracked change(s) block the fast-forward`;
    else if (dirty.length && Date.now() - (await newestChange(dirty)) > dirtyGraceMs)
      healReason = `${dirty.length} uncommitted tracked change(s) older than ${dirtyGraceMs / 60_000} min`;

    let healed: Snapshot | undefined;
    if (healReason) {
      if (!heal) return record(diverged ? "diverged" : "dirty", `${healReason}; BUNOS_SYNC_HEAL=0`, sha);
      if (dryRun) return record("healed", `dry-run: would snapshot (${healReason}) and reset to origin/main`, sha);
      // Divergent local main commits stay reachable through the snapshot's parents.
      const target = ahead && !offMain ? local : remote;
      const parents = [local];
      if (localMain && localMain !== local) {
        const merged = await git(["merge-base", "--is-ancestor", localMain, target]);
        if (merged.code !== 0) parents.push(localMain);
      }
      healed = await snapshot(gitDir, healReason, parents, dirty);
      const stamp = healed.ref.split("/").at(-1)!;
      healed.displaced = await displaceCollisions(target, stamp);
      const reset = await git(["checkout", "-f", "-B", "main", target], { timeoutMs: 1_800_000 });
      if (reset.code !== 0) return record("error", `snapshot ${healed.ref} saved; reset failed: ${lastLine(reset)}`, sha);
      const entry = { at: new Date().toISOString(), repo, host, reason: healReason, ...healed, ...sha, resetTo: target };
      mkdirSync(stateDir, { recursive: true });
      appendFileSync(wipLog, JSON.stringify(entry) + "\n");
      console.log(`[bunos-sync] saved work in ${healed.ref} (${healed.commit.slice(0, 10)}); recover with: git -C ${repo} switch -c <name> ${healed.ref}`);
    }

    const head = await gitOk(["rev-parse", "HEAD"]);
    let outcome: Outcome;
    let detail: string;
    if (head === remote) {
      outcome = healed ? "healed" : "current";
      detail = healed ? `work saved in ${healed.ref}; reset to ${remote.slice(0, 10)}` : `at ${remote.slice(0, 10)}`;
    } else if (!healed && behind && !dirty.length) {
      if (dryRun) return record("fast-forwarded", `dry-run: would fast-forward to ${remote.slice(0, 10)}`, sha);
      const ff = await git(["merge", "--ff-only", "origin/main"], { timeoutMs: 1_800_000 });
      if (ff.code !== 0) return record("error", `ff-only merge failed: ${lastLine(ff)}`, sha);
      outcome = "fast-forwarded";
      detail = `${local.slice(0, 10)}..${remote.slice(0, 10)}`;
    } else if (ahead || (healed && head !== remote)) {
      if (!push) return record("current", "local commits ahead; BUNOS_SYNC_PUSH=0", sha);
      if (dryRun) return record("pushed", "dry-run: would push HEAD:main", sha);
      const pushed = await pushMain();
      if (pushed.code !== 0) return record("error", `push rejected: ${lastLine(pushed)} (next pass heals)`, sha);
      outcome = "pushed";
      detail = `${remote.slice(0, 10)}..${head.slice(0, 10)}`;
    } else {
      // Dirty inside the grace period while nothing needs pulling: leave the tree to its owner for now.
      return record("dirty", `${dirty.length} uncommitted tracked change(s), younger than the grace period`, sha);
    }

    const extra: Record<string, unknown> = { ...sha, ...(healed ? { wip: healed } : {}) };
    if (lockWriter) extra.lock = await syncCargoLock(await gitOk(["rev-parse", "HEAD"]));
    if (gateEnabled && !dryRun) {
      const { runGate } = await import("./bunos-gate.ts");
      extra.gate = await runGate(repo, stateDir);
    }
    return record(outcome, detail, extra);
  } catch (error) {
    return record("error", (error as Error).message);
  } finally {
    release();
  }
}

async function main() {
  if (!loop) {
    const outcome = await pass();
    process.exit(outcome === "diverged" || outcome === "dirty" ? 2 : outcome === "error" ? 1 : 0);
  }
  for (;;) {
    await pass();
    await Bun.sleep(interval * 1000);
  }
}
if (import.meta.main) await main();
