#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Codex Luna sub-agent dispatcher (`aphrody codex agent ...`).
// Runs `codex exec` workers (model gpt-6-luna, reasoning medium) in the single Bun OS checkout as Claude-style sub-agents:
// roles with their own prompts, serialized per file set, bounded concurrency, token budget, per-task timeout, logs under
// <coord>/codex-agent, results returned as short reports to the sender's a2a inbox. The dispatcher (not the sandboxed worker)
// commits and pushes the files a committing role changed, as aphrody-dev, to main (fetch first, never forced).
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ROLES, role as getRole } from "./roles.ts";

const HOME = homedir();
const REPO = resolve(process.env.BUNOS_REPO ?? join(import.meta.dir, "..", ".."));
const COORD = process.env.APHRODY_COORD_DIR ?? join(HOME, "apps/aphrody/shared/coord");
const DIR = process.env.APHRODY_CODEX_AGENT_DIR ?? join(COORD, "codex-agent");
const CODEX = process.env.CODEX_BIN ?? join(HOME, ".codex/packages/standalone/current/bin/codex");
const APHRODY = process.env.APHRODY_BIN ?? join(HOME, ".local/bin/aphrody");
const IDENTITY = "codex-luna";
const GATE = join(HOME, ".local/state/bunos-sync/gate.json");

type Config = {
  model: string;
  reasoning: string;
  maxConcurrent: number;
  timeoutSec: number;
  dailyTokenCap: number;
  totalTokenCap: number;
  autoloops: boolean;
  gateSteps: string;
};
const defaults: Config = {
  model: "gpt-6-luna",
  reasoning: "medium",
  maxConcurrent: 3,
  timeoutSec: 1200,
  dailyTokenCap: 30_000_000,
  totalTokenCap: 600_000_000,
  autoloops: true,
  gateSteps: "stale-overwrite,shell-syntax",
};
function config(): Config {
  let file: Partial<Config> = {};
  try {
    file = JSON.parse(readFileSync(join(DIR, "config.json"), "utf8"));
  } catch {}
  const env = process.env;
  const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);
  return {
    ...defaults,
    ...file,
    ...(num(env.CODEX_AGENT_MAX) !== undefined && { maxConcurrent: num(env.CODEX_AGENT_MAX)! }),
    ...(num(env.CODEX_AGENT_TIMEOUT) !== undefined && { timeoutSec: num(env.CODEX_AGENT_TIMEOUT)! }),
    ...(num(env.CODEX_AGENT_DAILY_TOKENS) !== undefined && { dailyTokenCap: num(env.CODEX_AGENT_DAILY_TOKENS)! }),
  };
}

type Task = {
  id: string;
  role: string;
  prompt: string;
  files: string[];
  from: string;
  createdAt: string;
  timeoutSec?: number;
  envelope?: string;
};
type Result = {
  id: string;
  role: string;
  status: "done" | "failed" | "timeout" | "capped";
  tokens: number;
  commit?: string;
  left?: string[];
  report: string;
  startedAt: string;
  endedAt: string;
};

const sub = (n: string) => join(DIR, n);
for (const d of ["queue", "running", "done", "logs", "results"]) mkdirSync(sub(d), { recursive: true });
const now = () => new Date().toISOString();
const log = (m: string) => console.log(`${now()} ${m}`);

function sh(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO,
    encoding: "utf8",
    env: { ...process.env, ...opts.env },
    maxBuffer: 64 << 20,
  });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
const git = (...a: string[]) => sh("git", a);
const GIT_ID = {
  GIT_AUTHOR_NAME: "aphrody-dev",
  GIT_AUTHOR_EMAIL: "contact@aphrody.com",
  GIT_COMMITTER_NAME: "aphrody-dev",
  GIT_COMMITTER_EMAIL: "contact@aphrody.com",
};

// ---- budget (tokens: ChatGPT-login Codex has no per-call price) ----
function ledger(): { ts: string; tokens: number; id: string }[] {
  try {
    return readFileSync(sub("ledger.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map(l => JSON.parse(l));
  } catch {
    return [];
  }
}
function spend() {
  const l = ledger();
  const today = new Date().toISOString().slice(0, 10);
  return {
    day: l.filter(e => e.ts.startsWith(today)).reduce((a, e) => a + e.tokens, 0),
    total: l.reduce((a, e) => a + e.tokens, 0),
  };
}
function capped(c: Config) {
  const s = spend();
  return s.day >= c.dailyTokenCap || s.total >= c.totalTokenCap;
}

// ---- file set locks: committing tasks with overlapping file sets are serialized; one without files is exclusive ----
const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
const overlap = (a: string[], b: string[]) =>
  a.some(x =>
    b.some(y => norm(x) === norm(y) || norm(x).startsWith(norm(y) + "/") || norm(y).startsWith(norm(x) + "/")),
  );
const writes = (t: Task) => getRole(t.role).commit;
function conflicts(t: Task, running: Task[]) {
  if (!writes(t)) return false;
  return running.some(r => writes(r) && (t.files.length === 0 || r.files.length === 0 || overlap(t.files, r.files)));
}

// ---- enqueue ----
const newId = () =>
  `${new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14)}-${Math.random().toString(36).slice(2, 7)}`;
export function enqueue(t: Partial<Task> & { prompt: string }): Task {
  const task: Task = {
    id: t.id ?? newId(),
    role: t.role ?? "fixer",
    prompt: t.prompt,
    files: (t.files ?? []).map(norm),
    from: t.from ?? "cli",
    createdAt: now(),
    timeoutSec: t.timeoutSec,
    envelope: t.envelope,
  };
  getRole(task.role);
  writeFileSync(sub(`queue/${task.id}.json`), JSON.stringify(task, null, 2));
  return task;
}

// ---- worker ----
function dirtyMap(): Map<string, string> {
  const m = new Map<string, string>();
  const st = git("status", "--porcelain=v1", "-z", "--untracked-files=all").out;
  for (const e of st.split("\0")) {
    if (e.length < 4) continue;
    const p = e.slice(3);
    m.set(p, existsSync(join(REPO, p)) ? sh("git", ["hash-object", "--", p]).out.trim() : "deleted");
  }
  return m;
}

function runCodex(
  task: Task,
  c: Config,
  logFile: string,
  resultFile: string,
): Promise<{ code: number | null; timedOut: boolean; tokens: number }> {
  const r = getRole(task.role);
  const args = [
    "exec",
    "-m",
    c.model,
    "-c",
    `model_reasoning_effort="${c.reasoning}"`,
    "-s",
    r.sandbox,
    "-C",
    REPO,
    "--json",
    "--ephemeral",
    "-o",
    resultFile,
    "-",
  ];
  const prompt = `${r.prompt}\n\nTask (from ${task.from}, id ${task.id})${task.files.length ? `\nFile set: ${task.files.join(", ")}` : ""}\n${task.prompt}\n`;
  return new Promise(res => {
    const p = spawn(CODEX, args, {
      cwd: REPO,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CODEX_HOME: process.env.CODEX_HOME ?? join(HOME, ".codex") },
    });
    let tokens = 0;
    let buf = "";
    p.stdout.on("data", (d: Buffer) => {
      appendFileSync(logFile, d);
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          const ev = JSON.parse(line);
          if (ev.type === "turn.completed" && ev.usage)
            tokens += (ev.usage.input_tokens ?? 0) + (ev.usage.output_tokens ?? 0);
        } catch {}
      }
    });
    p.stderr.on("data", (d: Buffer) => appendFileSync(logFile, d));
    p.stdin.end(prompt);
    let timedOut = false;
    const timer = setTimeout(
      () => {
        timedOut = true;
        try {
          process.kill(-p.pid!, "SIGTERM");
        } catch {}
        setTimeout(() => {
          try {
            process.kill(-p.pid!, "SIGKILL");
          } catch {}
        }, 10_000);
      },
      (task.timeoutSec ?? c.timeoutSec) * 1000,
    );
    p.on("close", code => {
      clearTimeout(timer);
      res({ code, timedOut, tokens });
    });
    p.on("error", () => {
      clearTimeout(timer);
      res({ code: 127, timedOut: false, tokens });
    });
  });
}

function commitAndPush(task: Task, before: Map<string, string>, report: string): { commit?: string; left: string[] } {
  const after = dirtyMap();
  const changed: string[] = [];
  const left: string[] = [];
  for (const [p, h] of after) {
    if (before.has(p) && before.get(p) === h) continue; // not touched by this worker
    if (before.has(p)) {
      left.push(`${p} (dirty before the task)`);
      continue;
    }
    if (task.files.length && !overlap([p], task.files)) {
      left.push(`${p} (outside the file set)`);
      continue;
    }
    changed.push(p);
  }
  if (!changed.length) return { left };
  const first = (report.split("\n").find(l => l.trim()) ?? task.prompt).replace(/^[#*\s-]+/, "");
  const msg = `${first.length > 72 ? first.slice(0, 72) : first}\n\nCodex Luna ${task.role} task ${task.id} (from ${task.from}).`;
  sh("git", ["add", "--", ...changed], { env: GIT_ID });
  const cm = sh("git", ["commit", "-q", "-m", msg, "--", ...changed], { env: GIT_ID });
  if (cm.code !== 0) return { left: [...left, `commit failed: ${cm.out.slice(0, 200)}`] };
  let pushed = false;
  for (let i = 0; i < 3 && !pushed; i++) {
    const pull = sh("git", ["pull", "--rebase", "--autostash", "-q"], { env: GIT_ID });
    if (pull.code !== 0) {
      sh("git", ["rebase", "--abort"]);
      left.push(`pull --rebase failed: ${pull.out.slice(0, 160)}`);
      break;
    }
    // The pre-push hook runs the whole-tree gate; failures other agents left behind must not block a worker's own change,
    // so the steps are restricted to the ones that judge the pushed diff (override with BUNOS_GATE_STEPS or config gateSteps).
    pushed =
      sh("git", ["push", "-q", "origin", "HEAD:main"], {
        env: { BUNOS_GATE_STEPS: process.env.BUNOS_GATE_STEPS ?? config().gateSteps },
      }).code === 0;
  }
  if (!pushed) left.push("committed locally but not pushed (the bunos-sync timer or the next push carries it)");
  return { commit: git("rev-parse", "--short=10", "HEAD").out.trim(), left };
}

function reportTo(task: Task, res: Result) {
  const lines = [
    `[codex-luna ${task.role}] ${task.id} ${res.status}${res.commit ? ` commit ${res.commit}` : ""} (${res.tokens} tokens)`,
  ];
  if (res.left?.length) lines.push(`left uncommitted: ${res.left.slice(0, 5).join("; ")}`);
  lines.push(res.report.length > 1200 ? res.report.slice(0, 1200) + " ..." : res.report);
  if (task.from && task.from !== "cli" && !task.from.startsWith("auto:")) {
    sh(APHRODY, ["a2a", "send", "--target", task.from, lines.join("\n")], {
      env: { APHRODY_A2A_PEER_ID: `${IDENTITY}-${task.role}` },
    });
  }
}

export async function execute(task: Task, c = config()): Promise<Result> {
  const startedAt = now();
  const logFile = sub(`logs/${task.id}.jsonl`);
  const resultFile = sub(`results/${task.id}.md`);
  const finish = (r: Omit<Result, "id" | "role" | "startedAt" | "endedAt">): Result => {
    const out: Result = { id: task.id, role: task.role, startedAt, endedAt: now(), ...r };
    writeFileSync(sub(`done/${task.id}.json`), JSON.stringify(out, null, 2));
    appendFileSync(
      sub("ledger.jsonl"),
      JSON.stringify({
        ts: now(),
        id: task.id,
        role: task.role,
        tokens: r.tokens,
        status: r.status,
        commit: r.commit,
      }) + "\n",
    );
    reportTo(task, out);
    return out;
  };
  if (capped(c))
    return finish({ status: "capped", tokens: 0, report: "token budget reached (daily or total cap); task not run" });
  const before = writes(task) ? dirtyMap() : new Map<string, string>();
  const run = await runCodex(task, c, logFile, resultFile);
  let report = existsSync(resultFile) ? readFileSync(resultFile, "utf8").trim() : "";
  if (!report) report = run.timedOut ? "timed out" : `no final message (exit ${run.code}); see ${logFile}`;
  const status = run.timedOut ? "timeout" : run.code === 0 ? "done" : "failed";
  let commit: string | undefined;
  let left: string[] | undefined;
  if (writes(task) && status !== "failed") ({ commit, left } = commitAndPush(task, before, report));
  return finish({ status, tokens: run.tokens, commit, left, report });
}

// ---- daemon ----
const listQueue = (): Task[] =>
  readdirSync(sub("queue"))
    .filter(f => f.endsWith(".json"))
    .sort()
    .map(f => JSON.parse(readFileSync(sub(`queue/${f}`), "utf8")));
function seenSet(): Set<string> {
  try {
    return new Set(readFileSync(sub("seen.txt"), "utf8").split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}
const identities = () => [IDENTITY, ...Object.keys(ROLES).map(r => `${IDENTITY}-${r}`)];
function pollInbox() {
  const seen = seenSet();
  for (const name of identities()) {
    const r = sh(APHRODY, ["a2a", "inbox", "--id", name, "--limit", "20"], { env: { APHRODY_A2A_PEER_ID: name } });
    let msgs: any[] = [];
    try {
      msgs = JSON.parse(r.out.slice(r.out.indexOf("[")));
    } catch {
      continue;
    }
    for (const m of msgs) {
      if (!m.id || seen.has(m.id) || m.kind !== "ask" || String(m.from).startsWith(IDENTITY)) continue;
      seen.add(m.id);
      appendFileSync(sub("seen.txt"), m.id + "\n");
      const body = String(m.body);
      const roleName =
        name === IDENTITY ? (/^\s*role:\s*(\S+)/im.exec(body)?.[1] ?? "fixer") : name.slice(IDENTITY.length + 1);
      if (!ROLES[roleName]) continue;
      const files = [...body.matchAll(/^\s*files:\s*(.+)$/gim)].flatMap(x => x[1].split(/[,\s]+/).filter(Boolean));
      const prompt = body.replace(/^\s*(role|files):.*$/gim, "").trim();
      const t = enqueue({ role: roleName, prompt, files, from: m.from, envelope: m.id });
      log(`queued ${t.id} role=${t.role} from=${t.from}`);
    }
  }
}
function autoloops() {
  // Gate failure triage: one read-only triage task per failing gate commit.
  try {
    const g = JSON.parse(readFileSync(GATE, "utf8"));
    const failed = g.ok === false || g.status === "failure" || g.state === "failure" || g.result === "fail";
    const key = String(g.commit ?? g.sha ?? g.head ?? "");
    if (failed && key && !seenSet().has(`gate:${key}`)) {
      appendFileSync(sub("seen.txt"), `gate:${key}\n`);
      log(
        `queued gate triage ${enqueue({ role: "triage", from: "auto:gate", prompt: `The VPS gate failed. Gate state is in ${GATE} (commit ${key}). Triage it.` }).id}`,
      );
    }
  } catch {}
}

async function daemon() {
  const running = new Map<string, Task>();
  let lastInbox = 0,
    lastReg = 0,
    lastAuto = 0;
  log(
    `codex-agent daemon: repo=${REPO} dir=${DIR} model=${config().model}/${config().reasoning} max=${config().maxConcurrent}`,
  );
  for (const f of readdirSync(sub("running"))) renameSync(sub(`running/${f}`), sub(`queue/${f}`)); // crash recovery
  for (;;) {
    const c = config();
    const t = Date.now();
    if (t - lastReg > 120_000) {
      lastReg = t;
      for (const n of identities()) sh(APHRODY, ["a2a", "register"], { env: { APHRODY_A2A_PEER_ID: n } });
    }
    if (t - lastInbox > 15_000) {
      lastInbox = t;
      try {
        pollInbox();
      } catch (e) {
        log(`inbox: ${e}`);
      }
    }
    if (c.autoloops && t - lastAuto > 300_000) {
      lastAuto = t;
      autoloops();
    }
    for (const task of listQueue()) {
      if (running.size >= c.maxConcurrent) break;
      if (running.has(task.id) || conflicts(task, [...running.values()])) continue;
      renameSync(sub(`queue/${task.id}.json`), sub(`running/${task.id}.json`));
      running.set(task.id, task);
      log(`start ${task.id} role=${task.role} files=${task.files.join(",") || "-"}`);
      execute(task, c)
        .then(r => log(`end ${task.id} ${r.status} tokens=${r.tokens}${r.commit ? ` commit=${r.commit}` : ""}`))
        .catch(e => log(`error ${task.id}: ${e}`))
        .finally(() => {
          running.delete(task.id);
          rmSync(sub(`running/${task.id}.json`), { force: true });
        });
    }
    await Bun.sleep(3000);
  }
}

// ---- CLI ----
function productLine(spec: string): string {
  const lines = readFileSync(join(REPO, "docs/PRODUCT.md"), "utf8").split("\n");
  if (/^\d+$/.test(spec)) return lines[Number(spec) - 1] ?? "";
  return lines.find(l => l.toLowerCase().includes(spec.toLowerCase())) ?? "";
}
function parse(argv: string[]) {
  const o: { role?: string; files: string[]; from?: string; product?: string; timeout?: number; rest: string[] } = {
    files: [],
    rest: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--role" || a === "-r") o.role = argv[++i];
    else if (a === "--files" || a === "-f") o.files.push(...argv[++i].split(","));
    else if (a === "--from") o.from = argv[++i];
    else if (a === "--product-line") o.product = argv[++i];
    else if (a === "--timeout") o.timeout = Number(argv[++i]);
    else o.rest.push(a);
  }
  return o;
}
function buildPrompt(o: ReturnType<typeof parse>) {
  const parts = [o.rest.join(" ").trim()];
  if (o.product) parts.push(`docs/PRODUCT.md line (${o.product}): ${productLine(o.product)}`);
  return parts.filter(Boolean).join("\n");
}
function status() {
  const c = config();
  const s = spend();
  const done = readdirSync(sub("done"))
    .sort()
    .slice(-5)
    .map(f => JSON.parse(readFileSync(sub(`done/${f}`), "utf8")));
  console.log(
    JSON.stringify(
      {
        daemon: sh("systemctl", ["is-active", "aphrody-codex-agent.service"]).out.trim(),
        appServer: sh("systemctl", ["is-active", "aphrody-codex-app-server.service"]).out.trim(),
        model: `${c.model}/${c.reasoning}`,
        maxConcurrent: c.maxConcurrent,
        timeoutSec: c.timeoutSec,
        tokens: { day: s.day, dailyCap: c.dailyTokenCap, total: s.total, totalCap: c.totalTokenCap },
        queued: listQueue().map(t => `${t.id}:${t.role}`),
        running: readdirSync(sub("running")).map(f => f.replace(".json", "")),
        recent: done.map(d => ({ id: d.id, role: d.role, status: d.status, commit: d.commit, tokens: d.tokens })),
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  const [cmd = "status", ...rest] = process.argv.slice(2);
  const o = parse(rest);
  const usage =
    "usage: agent run|queue [--role R] [--files a,b] [--from peer] [--product-line N|text] [--timeout s] <prompt...>";
  switch (cmd) {
    case "daemon":
      await daemon();
      break;
    case "status":
      status();
      break;
    case "roles":
      for (const r of Object.values(ROLES))
        console.log(
          `${r.name.padEnd(12)} ${r.sandbox.padEnd(16)} ${r.commit ? "commits" : "no-commit"}  ${r.description}`,
        );
      break;
    case "queue": {
      const prompt = buildPrompt(o);
      if (!prompt) {
        console.error(usage);
        process.exit(2);
      }
      console.log(enqueue({ role: o.role, prompt, files: o.files, from: o.from, timeoutSec: o.timeout }).id);
      break;
    }
    case "run": {
      const prompt = buildPrompt(o);
      if (!prompt) {
        console.error(usage);
        process.exit(2);
      }
      const t = enqueue({ role: o.role, prompt, files: o.files, from: o.from, timeoutSec: o.timeout });
      if (sh("systemctl", ["is-active", "aphrody-codex-agent.service"]).out.trim() === "active") {
        log(`queued ${t.id}; waiting for the daemon`);
        while (!existsSync(sub(`done/${t.id}.json`))) await Bun.sleep(2000);
        const r = JSON.parse(readFileSync(sub(`done/${t.id}.json`), "utf8"));
        console.log(`${r.status} ${r.commit ?? ""} tokens=${r.tokens}\n${r.report}`);
      } else {
        rmSync(sub(`queue/${t.id}.json`), { force: true });
        const r = await execute(t);
        console.log(`${r.status} ${r.commit ?? ""} tokens=${r.tokens}\n${r.report}`);
      }
      break;
    }
    case "lint-sweep":
      console.log(
        enqueue({
          role: "fixer",
          from: "auto:lint",
          files: o.files,
          prompt:
            "Run `bun lint` on the files changed in the last 10 commits (git diff --name-only HEAD~10), fix warnings in them only, and report.",
        }).id,
      );
      break;
    case "doc-sync":
      console.log(
        enqueue({
          role: "doc-writer",
          from: "auto:docs",
          prompt:
            o.rest.join(" ") ||
            "Sync docs/PRODUCT.md and docs/A2A-AGENTS.md with the repository state; fix stale statements only.",
          files: o.files.length ? o.files : ["docs/PRODUCT.md", "docs/A2A-AGENTS.md"],
        }).id,
      );
      break;
    case "gate-triage":
      console.log(enqueue({ role: "triage", from: "auto:gate", prompt: `Triage the VPS gate state in ${GATE}.` }).id);
      break;
    default:
      console.error("agent run|queue|status|roles|daemon|lint-sweep|doc-sync|gate-triage");
      process.exit(2);
  }
}
