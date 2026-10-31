#!/usr/bin/env bun
/**
 * Main gate: `bun check`, `bun lint`, `bun format --check` and `cargo check --workspace --locked`, run on the VPS.
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
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

export function gateSteps(): Step[] {
  const all: Step[] = [
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

async function runSteps(repo: string, changed: string[] | undefined, since: string | undefined, head: string) {
  const results: StepResult[] = [];
  await ensureInstall(repo);
  for (const step of gateSteps()) {
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
  const results = await runSteps(repo, changed, since, head);
  const green = results.every(result => result.ok);
  const entry = { at: new Date().toISOString(), sha: head, lastGreen: green ? head : since, green, results };
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(gateFile, JSON.stringify(entry, null, 2) + "\n");
  appendFileSync(join(stateDir, "gate.jsonl"), JSON.stringify(entry) + "\n");
  for (const result of results) await postStatus(head, result);
  const failed = results.filter(result => !result.ok);
  return green
    ? `gate: ${head.slice(0, 10)} green`
    : `gate: ${head.slice(0, 10)} red: ${failed
        .map(f => `${f.name} (${f.file ?? "?"}, ${f.culprit?.sha.slice(0, 10)} ${f.culprit?.author})`)
        .join("; ")}`;
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
  const stateDir = process.env.BUNOS_SYNC_STATE ?? join(homedir(), ".local", "state", "bunos-sync");
  const summary = await runGate(repo, stateDir);
  console.log(summary);
  process.exit(summary.includes(" red:") ? 1 : 0);
}
