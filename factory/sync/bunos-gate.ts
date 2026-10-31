#!/usr/bin/env bun
/**
 * Main gate, run on the VPS: stale-overwrite detection (a change that writes back a replaced version of a file),
 * `sh -n` of the unified image scripts and `bun factory/images/build.ts plan bunos-unified` (when factory/images
 * changed), `bun check`, `bun lint`, `bun format --check` and `cargo check --workspace --locked` (when Rust changed).
 * A red gate is also posted to the a2a `help-wanted` channel.
 *
 *   bun factory/sync/bunos-gate.ts                 gate the checkout's HEAD (also run by bunos-sync after a pull)
 *   bun factory/sync/bunos-gate.ts --pre-push      the pre-push hook: same steps on the working tree being pushed
 *
 * After a pull the result goes to <state>/gate.json, one line per run to gate.jsonl, and a GitHub commit status per
 * step (context `vps-gate/<step>`) when `gh` is authenticated. A failing step names the first error, the file it
 * points at, and the first commit since the last green gate that touched that file, with its author.
 *
 * The pre-push hook only runs heavy steps on the build host (APHRODY_BUILD_HOST=vps or a host named vps*); elsewhere
 * it reports that the VPS gate will judge the push. `cargo check` runs only when the pushed range touches Rust.
 * Environment: BUNOS_GATE_STEPS (comma list to restrict), BUNOS_GATE_REPO for the GitHub status (default
 * aphrody-labs/bun-os).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";

interface Step {
  name: string;
  argv: string[];
  /** Only when the change set touches these paths (undefined: always). */
  when?: RegExp;
  timeoutMs: number;
}

export interface StepResult {
  name: string;
  ok: boolean;
  skipped?: string;
  seconds: number;
  error?: string;
  file?: string;
  culprit?: { sha: string; author: string; subject: string };
}

const RUST = /(^|\/)(Cargo\.(toml|lock)|rust-toolchain\.toml|\.cargo\/config\.toml)$|\.rs$/;

const IMAGE = /^factory\/images\//;
const SELF = "factory/sync/bunos-gate.ts";

export function gateSteps(range: { since?: string; head: string } = { head: "HEAD" }): Step[] {
  const all: Step[] = [
    // A commit that puts back an older version of a file someone changed since (stale copy, checkpoint, bad merge).
    ...(range.since
      ? [{ name: "stale-overwrite", argv: ["bun", SELF, "--stale", range.since, range.head], timeoutMs: 300_000 }]
      : []),
    { name: "shell-syntax", argv: ["bun", SELF, "--shell-syntax"], when: IMAGE, timeoutMs: 300_000 },
    {
      name: "image-plan",
      argv: ["bun", "factory/images/build.ts", "plan", "bunos-unified"],
      when: IMAGE,
      timeoutMs: 600_000,
    },
    { name: "check", argv: ["bun", "run", "check"], timeoutMs: 900_000 },
    { name: "lint", argv: ["bun", "run", "lint"], timeoutMs: 900_000 },
    { name: "format", argv: ["bun", "run", "format:check"], timeoutMs: 900_000 },
    {
      name: "cargo-check",
      argv: ["bun", "scripts/cargo.ts", "exec", "--", "check", "--workspace", "--locked"],
      when: RUST,
      timeoutMs: 4 * 60 * 60_000,
    },
  ];
  const only = process.env.BUNOS_GATE_STEPS?.split(",").filter(Boolean);
  return only ? all.filter(step => only.includes(step.name)) : all;
}

async function capture(argv: string[], cwd: string, timeoutMs = 600_000) {
  const proc = Bun.spawn(argv, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    timeout: timeoutMs,
    env: { ...process.env, APHRODY_BUILD_HOST: process.env.APHRODY_BUILD_HOST ?? "vps", FORCE_COLOR: "0", NO_COLOR: "1" },
    windowsHide: true,
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, text: `${out}\n${err}`.trim() };
}

const git = async (repo: string, ...args: string[]) => (await capture(["git", "-C", repo, ...args], repo)).text;

/** First error line and the repository file it names. */
export function firstError(text: string): { error?: string; file?: string } {
  const lines = text.split(/\r?\n/);
  const errorLine =
    lines.find(line => /\berror\b|✗|FAIL|not a tracked|cannot|failed/i.test(line) && !/^\s*warning/i.test(line)) ??
    lines.at(-1);
  const pathPattern = /((?:[\w@.\-]+\/)+[\w@.\-]+\.(?:ts|tsx|mts|js|mjs|json|jsonc|rs|toml|md|css))/;
  const start = errorLine ? lines.indexOf(errorLine) : 0;
  let file: string | undefined;
  for (const line of lines.slice(Math.max(0, start), start + 12)) {
    const match = line.replace(/^\s*-->\s*/, "").match(pathPattern);
    if (match) {
      file = match[1]!.replace(/^\.\//, "");
      break;
    }
  }
  return { error: errorLine?.trim().slice(0, 300), file };
}

/** The commit after `since` that last touched `file`, else the oldest commit in the range. */
export async function culprit(repo: string, since: string | undefined, head: string, file?: string) {
  const range = since && since !== head ? `${since}..${head}` : `${head}~1..${head}`;
  const format = "--format=%H%x09%an <%ae>%x09%s";
  let line = file ? (await git(repo, "log", "-1", format, range, "--", file)).split("\n")[0] : "";
  if (!line) line = (await git(repo, "log", "--reverse", format, range)).split("\n")[0] ?? "";
  const [sha = head, author = "", subject = ""] = line.split("\t");
  return { sha, author, subject };
}

async function runSteps(
  repo: string,
  changed: string[] | undefined,
  since: string | undefined,
  head: string,
  select: (name: string) => boolean = () => true,
) {
  const results: StepResult[] = [];
  await ensureInstall(repo);
  for (const step of gateSteps({ since, head }).filter(step => select(step.name))) {
    if (step.when && changed && !changed.some(path => step.when!.test(path))) {
      results.push({ name: step.name, ok: true, skipped: "no matching change", seconds: 0 });
      continue;
    }
    const started = Date.now();
    const run = await capture(step.argv, repo, step.timeoutMs);
    const seconds = Math.round((Date.now() - started) / 1000);
    if (run.code === 0) {
      results.push({ name: step.name, ok: true, seconds });
      continue;
    }
    const { error, file } = firstError(run.text);
    results.push({ name: step.name, ok: false, seconds, error, file, culprit: await culprit(repo, since, head, file) });
  }
  return results;
}

/** node_modules must match bun.lock before the Bun steps; the material-web archive comes from the canonical setup plan. */
async function ensureInstall(repo: string) {
  const archive = join(repo, "build/packages/material-web.tgz");
  if (!existsSync(archive)) {
    const { materialWebPreparationPlan } = await import(join(repo, "scripts/setup-submodules.ts"));
    for (const command of materialWebPreparationPlan(repo, process.execPath).commands as { cwd: string; argv: string[] }[]) {
      mkdirSync(join(repo, "build/packages"), { recursive: true });
      await capture(command.argv, command.cwd);
    }
  }
  await capture(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], repo, 900_000);
}

async function postStatus(head: string, result: StepResult) {
  if (!Bun.which("gh")) return;
  const repoName = process.env.BUNOS_GATE_REPO ?? "aphrody-labs/bun-os";
  const description = result.ok
    ? result.skipped
      ? `skipped: ${result.skipped}`
      : `passed in ${result.seconds}s`
    : `${result.file ?? ""} ${result.culprit ? `(${result.culprit.sha.slice(0, 10)} ${result.culprit.author})` : ""} ${result.error ?? ""}`;
  await capture(
    [
      "gh",
      "api",
      "--method",
      "POST",
      `repos/${repoName}/statuses/${head}`,
      "-f",
      `state=${result.ok ? "success" : "failure"}`,
      "-f",
      `context=vps-gate/${result.name}`,
      "-f",
      `description=${description.trim().slice(0, 139)}`,
    ],
    process.cwd(),
    60_000,
  );
}

/** Gate the checkout's HEAD once; called by bunos-sync while it holds the checkout. */
/** Steps that take minutes run outside the sync pass (see runCargoGate), so the checkout keeps syncing. */
export const SLOW_STEPS = new Set(["cargo-check"]);

/** Gate the checkout's HEAD once; called by bunos-sync while it holds the checkout (fast steps only). */
export async function runGate(repo: string, stateDir: string): Promise<string> {
  const head = (await git(repo, "rev-parse", "HEAD")).trim();
  const gateFile = join(stateDir, "gate.json");
  const previous = (() => {
    try {
      return JSON.parse(readFileSync(gateFile, "utf8")) as { sha?: string; lastGreen?: string };
    } catch {
      return {};
    }
  })();
  if (previous.sha === head) return `gate: ${head.slice(0, 10)} already gated`;
  const since = previous.lastGreen;
  const changed = since
    ? (await git(repo, "diff", "--name-only", since, head)).split("\n").filter(Boolean)
    : undefined;
  const results = await runSteps(repo, changed, since, head, name => !SLOW_STEPS.has(name));
  const green = results.every(result => result.ok);
  const entry = { at: new Date().toISOString(), sha: head, lastGreen: green ? head : since, green, results };
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(gateFile, JSON.stringify(entry, null, 2) + "\n");
  appendFileSync(join(stateDir, "gate.jsonl"), JSON.stringify(entry) + "\n");
  for (const result of results) await postStatus(head, result);
  if (!green) await notifyA2a(head, results);
  const failed = results.filter(result => !result.ok);
  return green
    ? `gate: ${head.slice(0, 10)} green`
    : `gate: ${head.slice(0, 10)} red: ${failed
        .map(f => `${f.name} (${f.file ?? "?"}, ${f.culprit?.sha.slice(0, 10)} ${f.culprit?.author})`)
        .join("; ")}`;
}

/** Red gates are posted to the a2a `help-wanted` channel so the owning agent sees them (docs/A2A-AGENTS.md). */
async function notifyA2a(head: string, results: StepResult[]) {
  if (!Bun.which("aphrody") || !process.env.APHRODY_A2A_HUB_URL) return;
  const lines = results
    .filter(result => !result.ok)
    .map(f => `${f.name}: ${f.file ?? ""} ${f.error ?? ""} (commit ${f.culprit?.sha.slice(0, 10)} "${f.culprit?.subject}")`);
  await capture(
    ["aphrody", "a2a", "send", "--source", "vps-gate", "--target", "help-wanted", `main ${head.slice(0, 10)} is red: ${lines.join(" | ")}`.slice(0, 3500)],
    process.cwd(),
    60_000,
  );
}

/**
 * Paths whose new content in base..head equals an older version of that path that was since replaced on base:
 * a stale copy written back over newer work (an old checkpoint, a copied tree, a bad merge resolution).
 */
export async function staleOverwrites(repo: string, base: string, head: string): Promise<string[]> {
  const found: string[] = [];
  const changed = (await git(repo, "diff", "--name-only", "--diff-filter=M", base, head)).split("\n").filter(Boolean);
  for (const path of changed.slice(0, 2000)) {
    const blob = (await git(repo, "rev-parse", "--verify", "--quiet", `${head}:${path}`)).trim();
    if (!blob) continue;
    // Each change on base replaced a version (`<commit>^:<path>`); writing one of those back is a stale overwrite.
    // Merges are judged below by what they dropped, so a fix after a bad merge is not reported as a revert.
    const history = (await git(repo, "log", "--no-merges", "-n", "25", "--format=%H", base, "--", path))
      .split("\n")
      .filter(Boolean);
    for (const commit of history) {
      const older = (await git(repo, "rev-parse", "--verify", "--quiet", `${commit}^:${path}`)).trim();
      if (older && older === blob) {
        found.push(`${path} reverts to its version before ${commit.slice(0, 10)}`);
        break;
      }
    }
  }
  // A merge whose result is exactly one side for a path both sides changed dropped the other side's work.
  const merges = (await git(repo, "rev-list", "--merges", `${base}..${head}`)).split("\n").filter(Boolean);
  for (const merge of merges) {
    const [first, second] = (await git(repo, "rev-parse", `${merge}^1`, `${merge}^2`)).split("\n").map(s => s.trim());
    if (!first || !second) continue;
    const mergeBase = (await git(repo, "merge-base", first, second)).trim();
    const side = async (tip: string) =>
      new Set((await git(repo, "diff", "--name-only", mergeBase, tip)).split("\n").filter(Boolean));
    const [ours, theirs] = [await side(first), await side(second)];
    for (const path of ours) {
      if (!theirs.has(path)) continue;
      const blob = async (rev: string) => (await git(repo, "rev-parse", "--verify", "--quiet", `${rev}:${path}`)).trim();
      const [result, a, b] = [await blob(merge), await blob(first), await blob(second)];
      if (a !== b && (result === a || result === b))
        found.push(`${path}: merge ${merge.slice(0, 10)} kept one side and dropped the other side's changes`);
    }
  }
  return found;
}

/** `sh -n` (or `bash -n`) of every shell script of the unified image. */
function shellSyntax(repo: string): string[] {
  const root = join(repo, "factory/images/bunos-unified");
  const failures: string[] = [];
  const walk = (dir: string) => {
    for (const name of existsSync(dir) ? readdirSync(dir) : []) {
      const path = join(dir, name);
      const info = statSync(path, { throwIfNoEntry: false });
      if (!info) continue;
      if (info.isDirectory()) walk(path);
      else if (info.isFile() && info.size < 2_000_000) {
        const rel = path.slice(repo.length + 1).replaceAll("\\", "/");
        const head = readFileSync(path, "utf8").slice(0, 120).split("\n")[0] ?? "";
        const shell = /^#!.*\bbash\b/.test(head) ? "bash" : /^#!.*\b(sh|dash)\b/.test(head) || rel.endsWith(".sh") ? "sh" : "";
        if (!shell) continue;
        const result = Bun.spawnSync([shell, "-n", path], { stdout: "pipe", stderr: "pipe" });
        if (result.exitCode !== 0) failures.push(`${rel}: ${result.stderr.toString().trim().split("\n")[0]}`);
      }
    }
  };
  walk(root);
  return failures;
}

/**
 * The slow steps for the checkout's HEAD, run detached from the sync pass (systemd-run --user, unit bunos-gate-cargo).
 * The result is posted only when HEAD did not move meanwhile; a moved HEAD is gated again by the next run.
 */
export async function runCargoGate(repo: string, stateDir: string): Promise<string> {
  const head = (await git(repo, "rev-parse", "HEAD")).trim();
  const file = join(stateDir, "gate-cargo.json");
  const previous = (() => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as { sha?: string; lastGreen?: string };
    } catch {
      return {};
    }
  })();
  if (previous.sha === head) return `cargo gate: ${head.slice(0, 10)} already gated`;
  const since = previous.lastGreen;
  const changed = since ? (await git(repo, "diff", "--name-only", since, head)).split("\n").filter(Boolean) : undefined;
  const results = await runSteps(repo, changed, since, head, name => SLOW_STEPS.has(name));
  const after = (await git(repo, "rev-parse", "HEAD")).trim();
  if (after !== head) return `cargo gate: HEAD moved from ${head.slice(0, 10)} to ${after.slice(0, 10)}; result dropped`;
  const green = results.every(result => result.ok);
  const entry = { at: new Date().toISOString(), sha: head, lastGreen: green ? head : since, green, results };
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(file, JSON.stringify(entry, null, 2) + "\n");
  appendFileSync(join(stateDir, "gate.jsonl"), JSON.stringify(entry) + "\n");
  for (const result of results) await postStatus(head, result);
  if (!green) await notifyA2a(head, results);
  return `cargo gate: ${head.slice(0, 10)} ${green ? "green" : "red"}`;
}

/** Start the detached slow gate unless one is already running. */
export function startCargoGate(repo: string): string {
  if (process.platform !== "linux" || !Bun.which("systemd-run")) return "cargo gate: no systemd-run";
  const active = Bun.spawnSync(["systemctl", "--user", "is-active", "bunos-gate-cargo.service"], { stdout: "pipe" });
  if (active.stdout.toString().trim() === "active") return "cargo gate: already running";
  Bun.spawnSync(["systemctl", "--user", "reset-failed", "bunos-gate-cargo.service"], { stdout: "ignore", stderr: "ignore" });
  const started = Bun.spawnSync(
    [
      "systemd-run", "--user", "--unit", "bunos-gate-cargo", "--collect", "--no-block",
      "--property=Nice=15", "--property=IOSchedulingClass=idle",
      `--setenv=PATH=${process.env.PATH ?? ""}`, "--setenv=APHRODY_BUILD_HOST=vps",
      `--working-directory=${repo}`, process.execPath, join(repo, SELF), "--cargo",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  return started.exitCode === 0 ? "cargo gate: started" : `cargo gate: start failed: ${started.stderr.toString().trim()}`;
}

function buildHost(): boolean {
  return process.env.APHRODY_BUILD_HOST === "vps" || hostname().toLowerCase().startsWith("vps");
}

/** pre-push hook: stdin carries `<local ref> <local sha> <remote ref> <remote sha>` lines. */
async function prePush(repo: string): Promise<number> {
  if (!buildHost()) {
    console.error("[gate] not the build host: the VPS gate (vps-gate/* commit statuses) judges this push.");
    return 0;
  }
  const lines = (await Bun.stdin.text()).split("\n").filter(Boolean);
  const changed = new Set<string>();
  for (const line of lines) {
    const [, localSha, , remoteSha] = line.split(" ");
    if (!localSha || /^0+$/.test(localSha)) continue;
    const base = remoteSha && !/^0+$/.test(remoteSha) ? remoteSha : "origin/main";
    for (const path of (await git(repo, "diff", "--name-only", base, localSha)).split("\n")) if (path) changed.add(path);
  }
  const head = (await git(repo, "rev-parse", "HEAD")).trim();
  const results = await runSteps(repo, [...changed], "origin/main", head);
  for (const result of results)
    console.error(
      `[gate] ${result.ok ? "ok  " : "FAIL"} ${result.name}${result.skipped ? ` (skipped: ${result.skipped})` : ""}${
        result.ok ? "" : `: ${result.error}${result.file ? ` [${result.file}]` : ""}`
      }`,
    );
  return results.every(result => result.ok) ? 0 : 1;
}

if (import.meta.main) {
  const repo = resolve(process.env.BUNOS_REPO ?? process.cwd());
  if (process.argv.includes("--pre-push")) process.exit(await prePush(repo));
  if (process.argv.includes("--cargo")) {
    const stateDir = process.env.BUNOS_SYNC_STATE ?? join(homedir(), ".local", "state", "bunos-sync");
    const summary = await runCargoGate(repo, stateDir);
    console.log(summary);
    process.exit(summary.endsWith(" red") ? 1 : 0);
  }
  const staleIndex = process.argv.indexOf("--stale");
  if (staleIndex >= 0) {
    const found = await staleOverwrites(repo, process.argv[staleIndex + 1]!, process.argv[staleIndex + 2] ?? "HEAD");
    for (const line of found) console.error(`error: stale overwrite: ${line}`);
    process.exit(found.length ? 1 : 0);
  }
  if (process.argv.includes("--shell-syntax")) {
    const failures = shellSyntax(repo);
    for (const line of failures) console.error(`error: shell syntax: ${line}`);
    process.exit(failures.length ? 1 : 0);
  }
  const stateDir = process.env.BUNOS_SYNC_STATE ?? join(homedir(), ".local", "state", "bunos-sync");
  const summary = await runGate(repo, stateDir);
  console.log(summary);
  process.exit(summary.includes(" red:") ? 1 : 0);
}
