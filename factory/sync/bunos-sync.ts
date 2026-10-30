#!/usr/bin/env bun
/**
 * Bun OS VPS auto-sync: keeps one checkout converged with origin/main without ever forcing or rewriting history.
 *
 *   bun factory/sync/bunos-sync.ts            one pass (what the systemd timer runs)
 *   bun factory/sync/bunos-sync.ts --loop     repeat every BUNOS_SYNC_INTERVAL seconds (tmux fallback, default 600)
 *   bun factory/sync/bunos-sync.ts --dry-run  print the decision, change nothing
 *
 * One pass:
 *   1. fetch origin/main (https, credentials from `gh auth git-credential`; no token is ever stored or printed here).
 *   2. Behind only: fast-forward (`git merge --ff-only`). Submodule pointers are NOT updated (the build does that).
 *   3. Ahead only (local commits on main): `git push origin HEAD:main` (normal push).
 *   4. Diverged or dirty tree: do nothing, write the reason to the status file and exit 2.
 * The result of each pass is written to $BUNOS_SYNC_STATUS (default ~/.local/state/bunos-sync/status.json).
 *
 * Environment: BUNOS_REPO (default ~/src/bun-os), BUNOS_SYNC_INTERVAL, BUNOS_SYNC_STATUS, BUNOS_SYNC_PUSH=0 to disable pushing.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const home = homedir();
const repo = process.env.BUNOS_REPO ?? join(home, "src", "bun-os");
const statusFile = process.env.BUNOS_SYNC_STATUS ?? join(home, ".local", "state", "bunos-sync", "status.json");
const interval = Number(process.env.BUNOS_SYNC_INTERVAL ?? 600);
const push = process.env.BUNOS_SYNC_PUSH !== "0";
const dryRun = process.argv.includes("--dry-run");
const loop = process.argv.includes("--loop");

type Outcome = "current" | "fast-forwarded" | "pushed" | "diverged" | "dirty" | "wrong-branch" | "error";

async function git(...args: string[]): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(["git", "-C", repo, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: (out + err).trim() };
}

function record(outcome: Outcome, detail: string, extra: Record<string, unknown> = {}) {
  const status = { at: new Date().toISOString(), repo, outcome, detail, ...extra };
  mkdirSync(dirname(statusFile), { recursive: true });
  writeFileSync(statusFile, JSON.stringify(status, null, 2) + "\n");
  console.log(`[bunos-sync] ${status.at} ${outcome}: ${detail}`);
  return outcome;
}

async function pass(): Promise<Outcome> {
  const branch = await git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch.code !== 0) return record("error", `not a git checkout: ${branch.out}`);
  if (branch.out !== "main") return record("wrong-branch", `checked out ${branch.out}, expected main; nothing changed`);

  const fetch = await git("fetch", "--no-recurse-submodules", "origin", "main");
  if (fetch.code !== 0) return record("error", `fetch failed: ${fetch.out.split("\n").at(-1)}`);

  const [local, remote, base] = await Promise.all([
    git("rev-parse", "HEAD"),
    git("rev-parse", "origin/main"),
    git("merge-base", "HEAD", "origin/main"),
  ]);
  const sha = { local: local.out, remote: remote.out };
  if (local.out === remote.out) return record("current", `at ${remote.out.slice(0, 10)}`, sha);

  // Submodule pointer changes are ignored for the dirty check: the factory moves them during builds.
  const dirty = await git("status", "--porcelain", "--ignore-submodules=all", "--untracked-files=no");
  if (base.out === local.out) {
    if (dirty.out) return record("dirty", "tracked files modified; fast-forward skipped", sha);
    if (dryRun) return record("fast-forwarded", `dry-run: would fast-forward to ${remote.out.slice(0, 10)}`, sha);
    const ff = await git("merge", "--ff-only", "origin/main");
    return ff.code === 0
      ? record("fast-forwarded", `${local.out.slice(0, 10)}..${remote.out.slice(0, 10)}`, sha)
      : record("error", `ff-only merge failed: ${ff.out.split("\n").at(-1)}`, sha);
  }
  if (base.out === remote.out) {
    if (!push) return record("current", "local commits ahead; BUNOS_SYNC_PUSH=0", sha);
    if (dryRun) return record("pushed", "dry-run: would push HEAD:main", sha);
    const pushed = await git("push", "origin", "HEAD:main");
    return pushed.code === 0
      ? record("pushed", `${remote.out.slice(0, 10)}..${local.out.slice(0, 10)}`, sha)
      : record("error", `push rejected: ${pushed.out.split("\n").at(-1)}`, sha);
  }
  return record("diverged", "local main and origin/main both have commits; needs a manual merge (never forced)", sha);
}

async function main() {
  if (!loop) {
    const outcome = await pass();
    process.exit(
      outcome === "diverged" || outcome === "dirty" || outcome === "wrong-branch" ? 2 : outcome === "error" ? 1 : 0,
    );
  }
  for (;;) {
    await pass();
    await Bun.sleep(interval * 1000);
  }
}
await main();
