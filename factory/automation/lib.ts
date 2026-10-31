// SPDX-License-Identifier: Apache-2.0
// Shared helpers of the Bun OS automation loops (docs/AUTOMATION.md): process runner, state files, the event log,
// a2a messages and the queue of agent tasks, and the shared-checkout lock that bunos-sync also takes.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const home = homedir();
export const repo = resolve(process.env.BUNOS_REPO ?? resolve(import.meta.dir, "../.."));
export const stateDir = process.env.BUNOS_AUTO_STATE ?? join(home, ".local", "state", "bunos-auto");
export const syncStateDir = process.env.BUNOS_SYNC_STATE ?? join(home, ".local", "state", "bunos-sync");
export const statusRoot = process.env.BUNOS_STATUS_ROOT ?? join(home, "apps", "bunos-status");
export const githubRepo = process.env.BUNOS_GATE_REPO ?? "aphrody-labs/bun-os";
mkdirSync(stateDir, { recursive: true });

export interface Run {
  code: number;
  out: string;
}

/** Run a command, capture stdout+stderr, never throw. */
export async function run(
  argv: string[],
  options: { cwd?: string; timeoutMs?: number; env?: Record<string, string | undefined>; input?: string } = {},
): Promise<Run> {
  try {
    const proc = Bun.spawn(argv, {
      cwd: options.cwd ?? repo,
      stdout: "pipe",
      stderr: "pipe",
      stdin: options.input === undefined ? "ignore" : new Blob([options.input]),
      timeout: options.timeoutMs ?? 600_000,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", ...options.env },
    });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, out: `${out}${err ? `\n${err}` : ""}`.trim() };
  } catch (error) {
    return { code: 127, out: String(error) };
  }
}

export const sudo = (argv: string[], timeoutMs = 120_000) => run(["sudo", "-n", ...argv], { timeoutMs });
export const git = (...args: string[]) => run(["git", "-C", repo, ...args], { timeoutMs: 300_000 });

export function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + "\n");
  // rename is atomic on the same filesystem: readers never see a half-written file.
  renameSync(`${path}.tmp`, path);
}

export const statePath = (name: string) => join(stateDir, `${name}.json`);
export const loadState = <T>(name: string, fallback: T) => readJson<T>(statePath(name), fallback);
export const saveState = (name: string, value: unknown) => writeJson(statePath(name), value);

/** One line per event in events.jsonl; the status page and the daily digest read it. */
export function event(loop: string, kind: string, detail: string, extra: Record<string, unknown> = {}) {
  const entry = { at: new Date().toISOString(), loop, kind, detail: detail.slice(0, 2000), ...extra };
  appendFileSync(join(stateDir, "events.jsonl"), JSON.stringify(entry) + "\n");
  console.log(`[${loop}] ${kind}: ${detail.slice(0, 400)}`);
  return entry;
}

export function recentEvents(sinceMs: number) {
  const file = join(stateDir, "events.jsonl");
  if (!existsSync(file)) return [];
  const since = Date.now() - sinceMs;
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .slice(-20_000)
    .map(line => {
      try {
        return JSON.parse(line) as { at: string; loop: string; kind: string; detail: string; [key: string]: unknown };
      } catch {
        return undefined;
      }
    })
    .filter(e => e && Date.parse(e.at) >= since) as { at: string; loop: string; kind: string; detail: string }[];
}

/** a2a message through the hub (docs/A2A-AGENTS.md); the client reads the token file itself. Retries the hub. */
export async function a2a(target: string, text: string) {
  if (!Bun.which("aphrody")) return false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const sent = await run(
      ["aphrody", "a2a", "send", "--source", "automation", "--target", target, text.slice(0, 3500)],
      {
        timeoutMs: 60_000,
        env: { APHRODY_A2A_PEER_ID: "automation" },
      },
    );
    if (sent.code === 0) return true;
    await Bun.sleep(2000 * (attempt + 1));
  }
  event("a2a", "send-failed", `to ${target}: ${text.slice(0, 200)}`);
  return false;
}

export interface Task {
  key: string;
  kind: "autofix" | "escalation" | "deps" | "consent";
  title: string;
  detail: string;
  owner?: string;
  createdAt: string;
  state: "open" | "dispatched" | "done" | "failed";
  attempts: number;
  dispatchedAt?: string;
  peer?: string;
  result?: string;
}

/**
 * File a task for an agent: it goes to the owner (or help-wanted) over a2a at once, and into the coordinator queue,
 * where the auto-fix dispatcher hands it to a Codex/Claude peer when nobody fixed it. Deduplicated by key.
 */
export async function fileTask(task: Omit<Task, "createdAt" | "state" | "attempts">) {
  const queue = loadState<Task[]>("tasks", []);
  const existing = queue.find(t => t.key === task.key && (t.state === "open" || t.state === "dispatched"));
  if (existing) return existing;
  const entry: Task = { ...task, createdAt: new Date().toISOString(), state: "open", attempts: 0 };
  queue.push(entry);
  saveState("tasks", queue.slice(-500));
  event("tasks", "filed", `${task.kind} ${task.key}: ${task.title}`);
  await a2a(task.owner ?? "help-wanted", `[automation task ${task.kind}] ${task.title}\n${task.detail}`);
  return entry;
}

/** Close the open tasks whose key starts with the prefix (the condition that opened them is gone). */
export function closeTasks(prefix: string, result: string) {
  const queue = loadState<Task[]>("tasks", []);
  let changed = false;
  for (const t of queue)
    if (t.key.startsWith(prefix) && (t.state === "open" || t.state === "dispatched")) {
      t.state = "done";
      t.result = result;
      changed = true;
    }
  if (changed) saveState("tasks", queue);
}

/**
 * The shared checkout's lock, the same file and format bunos-sync takes (.git/bunos-sync.lock), so a deploy or a
 * lock refresh never runs while the sync moves HEAD. Waits up to `waitMs`.
 */
export async function withCheckoutLock<T>(fn: () => Promise<T>, waitMs = 45 * 60_000): Promise<T | undefined> {
  const lock = join(repo, ".git", "bunos-sync.lock");
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: Date.now(), owner: "bunos-auto" }), {
        flag: "wx",
      });
      break;
    } catch {
      const holder = readJson<{ pid?: number }>(lock, {});
      if (holder.pid && !alive(holder.pid)) {
        rmSync(lock, { force: true });
        continue;
      }
      if (Date.now() > deadline) return undefined;
      await Bun.sleep(15_000);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

export function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** GitHub commit status (context bunos-auto/<name>). */
export async function commitStatus(sha: string, name: string, ok: boolean | "pending", description: string) {
  if (!Bun.which("gh")) return;
  await run(
    [
      "gh",
      "api",
      "--method",
      "POST",
      `repos/${githubRepo}/statuses/${sha}`,
      "-f",
      `state=${ok === "pending" ? "pending" : ok ? "success" : "failure"}`,
      "-f",
      `context=bunos-auto/${name}`,
      "-f",
      `description=${description.slice(0, 139)}`,
      "-f",
      "target_url=https://aphrody.com/status",
    ],
    { timeoutMs: 60_000 },
  );
}

/** HTTP probe: status code (0 when unreachable). */
export async function httpStatus(url: string, timeoutMs = 10_000) {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    await res.arrayBuffer().catch(() => undefined);
    return res.status;
  } catch {
    return 0;
  }
}

export async function tcpOpen(host: string, port: number, timeoutMs = 5000) {
  try {
    const socket = await Promise.race([
      Bun.connect({ hostname: host, port, socket: { data() {}, open() {} } }),
      Bun.sleep(timeoutMs).then(() => undefined),
    ]);
    if (!socket) return false;
    socket.end();
    return true;
  } catch {
    return false;
  }
}

/** Format a Markdown document with the repository formatter settings (the gate's `bun format --check`). */
export async function formatMarkdown(text: string) {
  const dir = join(stateDir, "fmt");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "doc.md");
  writeFileSync(file, text);
  const r = await run(
    [process.execPath, "fmt", "--no-script", "--write", "--config", join(repo, "bun-format.json"), "doc.md"],
    {
      cwd: dir,
      timeoutMs: 60_000,
    },
  );
  return r.code === 0 ? readFileSync(file, "utf8") : text;
}

/** Units this automation may restart. Shenron (dragonballfr.com) and its build runner are a separate project: never. */
export const NEVER_TOUCH = /shenron|dbfr|rg-website|rosegriffon/i;
