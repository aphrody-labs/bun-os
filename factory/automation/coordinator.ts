// SPDX-License-Identifier: Apache-2.0
// Loop 4, autonomous agent loop (bunos-auto-coordinator.service, persistent): reads docs/PRODUCT.md on origin/main,
// picks the next unfinished line (critical path first), and dispatches it: first to the owning topic over a2a, then,
// when a line makes no progress, to a Codex or Claude peer through `aphrody a2a invoke`. Open automation tasks
// (red gates, failed lanes, escalations) are dispatched before product lines. Progress is read back from PRODUCT.md
// itself (a changed state or evidence cell); stalled lines are re-queued. The dispatch table at the end of
// PRODUCT.md is kept current. Briefs are written by Vertex Gemini (aphrody-bot, through aphrody-chat-gateway) under
// a daily token cap; peer invocations have their own daily cap.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { commitOnMain } from "./deps.ts";
import { a2a, event, formatMarkdown, git, home, loadState, run, saveState, stateDir, type Task } from "./lib.ts";

const TICK_MS = Number(process.env.BUNOS_AUTO_TICK_SECONDS ?? 600) * 1000;
const DAILY_TOKENS = Number(process.env.BUNOS_AUTO_DAILY_TOKENS ?? 300_000);
const DAILY_INVOKES = Number(process.env.BUNOS_AUTO_DAILY_INVOKES ?? 4);
const MAX_IN_FLIGHT = Number(process.env.BUNOS_AUTO_MAX_IN_FLIGHT ?? 3);
const STALL_MS = Number(process.env.BUNOS_AUTO_STALL_HOURS ?? 12) * 3_600_000;
const GATEWAY = process.env.BUNOS_AUTO_GEMINI_URL ?? "http://127.0.0.1:8794/v1/chat/completions";
const MODEL = process.env.BUNOS_AUTO_GEMINI_MODEL ?? "google/gemini-2.5-flash";
const PEERS = (process.env.BUNOS_AUTO_PEERS ?? "codex,claude").split(",");
const invokeCwd = join(home, "apps", "aphrody", "shared", "agent-workspaces", "aphrody");
const CRITICAL_PATH = [3, 2, 9, 10, 14, 15, 17, 25, 12, 23];

export interface Line {
  num: number;
  section: string;
  component: string;
  owner: string;
  state: string;
  evidence: string;
  next: string;
}

/** The checklist rows of PRODUCT.md (`| # | Component | Owner | State | Evidence | Next step |`). */
export function parseProduct(markdown: string): Line[] {
  const lines: Line[] = [];
  let section = "";
  for (const raw of markdown.split("\n")) {
    if (raw.startsWith("## ")) section = raw.slice(3).trim();
    if (raw.startsWith("### ")) section = raw.slice(4).trim();
    if (section.startsWith("Automation dispatch") || section.startsWith("Cut")) continue;
    const cells = raw.split("|").map(cell => cell.trim());
    if (cells.length < 8 || !/^\d+$/.test(cells[1]!)) continue;
    lines.push({
      num: Number(cells[1]),
      section,
      component: cells[2]!,
      owner: cells[3]!,
      state: cells[4]!,
      evidence: cells[5]!,
      next: cells[6]!,
    });
  }
  return lines;
}

const isDone = (state: string) => /^done/i.test(state) && !/building|missing|blocked/i.test(state);

/** The a2a topic (docs/A2A-AGENTS.md) that owns a checklist section. */
function topic(line: Line) {
  const s = line.section.toLowerCase();
  if (s.includes("android")) return "android";
  if (s.includes("webos")) return "sessions";
  if (s.includes("browser")) return "sessions";
  if (s.includes("google")) return "google";
  if (s.includes("base")) return "rust-base";
  if (s.includes("store")) return /game|emulat/i.test(line.component) ? "emulators" : "store";
  if (s.includes("delivery")) return line.num === 27 ? "blockers" : "product";
  if (/cosmic fork|rio|spacedrive/i.test(line.component)) return "native-apps";
  return "unified-image";
}

interface Dispatch {
  at: string;
  mode: "a2a" | "invoke";
  peer: string;
  unit?: string;
  result?: string;
}
interface LineState {
  fingerprint: string;
  dispatches: Dispatch[];
  status: "queued" | "dispatched" | "progress" | "done" | "stalled";
  lastProgress?: string;
}
interface CoordinatorState {
  lines: Record<string, LineState>;
  budget: { day: string; tokens: number; invokes: number };
  lastTableCommit?: string;
  lastTable?: string;
}

function budget(state: CoordinatorState) {
  const day = new Date().toISOString().slice(0, 10);
  if (state.budget?.day !== day) state.budget = { day, tokens: 0, invokes: 0 };
  return state.budget;
}

/** A short, concrete brief from Gemini (Vertex, aphrody-bot); a template when the daily token cap is reached. */
async function brief(state: CoordinatorState, subject: string, context: string) {
  const b = budget(state);
  const template = `${subject}\n${context}\nWork on the VPS checkout ~/src/bun-os (AGENTS.md rules: main only, normal push, commit as aphrody-dev <contact@aphrody.com>). Update your docs/PRODUCT.md line with evidence when done.`;
  if (b.tokens >= DAILY_TOKENS) return template;
  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        messages: [
          {
            role: "system",
            content:
              "You write task briefs for autonomous coding agents working on the Bun OS repository (aphrody-labs/bun-os, VPS checkout ~/src/bun-os). Output at most 12 lines: goal, the concrete next action, how to verify, and the rule to commit straight to main as aphrody-dev <contact@aphrody.com> with a normal push and update the docs/PRODUCT.md line with evidence. No preamble.",
          },
          { role: "user", content: `${subject}\n${context}` },
        ],
      }),
    });
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { total_tokens?: number };
    };
    b.tokens += body.usage?.total_tokens ?? 1500;
    const text = body.choices?.[0]?.message?.content?.trim();
    return text ? `${text}\n(${subject})` : template;
  } catch {
    return template;
  }
}

/** A Codex/Claude peer run in its own transient unit (output under the state directory). */
async function invoke(state: CoordinatorState, id: string, prompt: string): Promise<Dispatch | undefined> {
  const b = budget(state);
  if (b.invokes >= DAILY_INVOKES || !existsSync(invokeCwd)) return undefined;
  const peer = PEERS[b.invokes % PEERS.length]!;
  const unit = `bunos-auto-invoke-${id.replace(/[^a-z0-9-]/gi, "-")}-${Date.now().toString(36)}`;
  const logDir = join(stateDir, "invocations");
  mkdirSync(logDir, { recursive: true });
  const started = await run([
    "systemd-run",
    "--user",
    "--collect",
    `--unit=${unit}`,
    "-p",
    `WorkingDirectory=${invokeCwd}`,
    "-p",
    "RuntimeMaxSec=7200",
    "-p",
    "CPUWeight=20",
    "-p",
    `StandardOutput=append:${join(logDir, `${unit}.log`)}`,
    "-p",
    `StandardError=append:${join(logDir, `${unit}.log`)}`,
    "--setenv=APHRODY_A2A_PEER_ID=automation",
    "aphrody",
    "a2a",
    "invoke",
    "--peer",
    peer,
    prompt.slice(0, 6000),
  ]);
  if (started.code !== 0) {
    event("coordinator", "invoke-failed", `${peer} for ${id}: ${started.out.slice(0, 200)}`);
    return undefined;
  }
  b.invokes++;
  return { at: new Date().toISOString(), mode: "invoke", peer, unit };
}

/** Finished invocations: exit status from the transient unit (gone once collected: then the log decides). */
async function settle(dispatch: Dispatch) {
  if (dispatch.mode !== "invoke" || !dispatch.unit || dispatch.result) return;
  const active = (await run(["systemctl", "--user", "is-active", dispatch.unit])).out.trim();
  if (active === "active" || active === "activating") return;
  const log = Bun.file(join(stateDir, "invocations", `${dispatch.unit}.log`));
  const text = (await log.exists()) ? await log.text() : "";
  dispatch.result = /error|failed|×/i.test(text.split("\n").slice(-5).join(" ")) ? "failed" : "finished";
}

async function dispatchTasks(state: CoordinatorState) {
  const queue = loadState<Task[]>("tasks", []);
  let inFlight = queue.filter(t => t.state === "dispatched").length;
  for (const task of queue) {
    if (task.state === "dispatched" && task.dispatchedAt && Date.now() - Date.parse(task.dispatchedAt) > STALL_MS) {
      task.state = "open"; // re-queue a task nobody closed
      event("coordinator", "requeued", `task ${task.key} after ${task.attempts} attempt(s)`);
    }
    if (task.state !== "open" || inFlight >= MAX_IN_FLIGHT) continue;
    // Give the owner an hour from the first a2a notice before a peer is spent on it.
    if (Date.now() - Date.parse(task.createdAt) < 3_600_000 && task.attempts === 0) continue;
    const prompt = await brief(state, `Automation task (${task.kind}): ${task.title}`, task.detail);
    const d = await invoke(state, `task-${task.key}`, prompt);
    if (!d) continue;
    task.state = "dispatched";
    task.attempts++;
    task.dispatchedAt = d.at;
    task.peer = d.peer;
    inFlight++;
    event("coordinator", "dispatched-task", `${task.key} -> ${d.peer} (${d.unit})`);
  }
  saveState("tasks", queue);
}

export async function tick() {
  const state = loadState<CoordinatorState>("coordinator", { lines: {}, budget: { day: "", tokens: 0, invokes: 0 } });
  budget(state);
  await git("fetch", "-q", "origin", "main");
  const markdown = (await git("show", "refs/remotes/origin/main:docs/PRODUCT.md")).out;
  const lines = parseProduct(markdown);
  const byNum = new Map(lines.map(line => [line.num, line]));

  for (const line of lines) {
    const key = String(line.num);
    const fingerprint = `${line.state}|${line.evidence}|${line.next}`;
    const ls = (state.lines[key] ??= { fingerprint, dispatches: [], status: "queued" });
    for (const d of ls.dispatches) await settle(d);
    if (isDone(line.state)) {
      if (ls.status !== "done") event("coordinator", "line-done", `#${line.num} ${line.component.slice(0, 60)}`);
      ls.status = "done";
    } else if (ls.fingerprint !== fingerprint) {
      ls.status = "progress";
      ls.lastProgress = new Date().toISOString();
      event("coordinator", "line-progress", `#${line.num}: ${line.state}`);
    }
    ls.fingerprint = fingerprint;
  }

  await dispatchTasks(state);

  const blocked = (line: Line) => {
    const on = line.state.match(/blocked on (\d+)/i);
    return on ? !isDone(byNum.get(Number(on[1]))?.state ?? "") : false;
  };
  const rank = (line: Line) => {
    const i = CRITICAL_PATH.indexOf(line.num);
    return i >= 0 ? i : 100 + line.num;
  };
  const open = lines.filter(line => !isDone(line.state) && !blocked(line)).sort((a, b) => rank(a) - rank(b));
  const inFlight = () =>
    Object.values(state.lines).filter(
      ls => ls.status === "dispatched" && Date.now() - Date.parse(ls.dispatches.at(-1)?.at ?? "0") < STALL_MS,
    ).length;

  for (const line of open) {
    if (inFlight() >= MAX_IN_FLIGHT) break;
    const ls = state.lines[String(line.num)]!;
    const last = ls.dispatches.at(-1);
    const lastActivity = Math.max(Date.parse(last?.at ?? "0"), Date.parse(ls.lastProgress ?? "0"));
    if (last && Date.now() - lastActivity < STALL_MS) continue;
    if (last) {
      ls.status = "stalled";
      event("coordinator", "requeued", `#${line.num} no progress in ${STALL_MS / 3_600_000} h`);
    }
    const subject = `docs/PRODUCT.md line ${line.num} (${line.section}): ${line.component}`;
    const context = `Owner: ${line.owner}. State: ${line.state}. Evidence: ${line.evidence}. Next step: ${line.next}.`;
    const text = await brief(state, subject, context);
    // First dispatch goes to the owning topic; a line that stalled after an a2a dispatch goes to a peer.
    const a2aCount = ls.dispatches.filter(d => d.mode === "a2a").length;
    let dispatch: Dispatch | undefined;
    if (a2aCount === 0) {
      const target = topic(line);
      if (await a2a(target, `[coordinator] ${text}`))
        dispatch = { at: new Date().toISOString(), mode: "a2a", peer: target };
    } else dispatch = await invoke(state, `line-${line.num}`, text);
    if (!dispatch) continue;
    ls.dispatches.push(dispatch);
    ls.status = "dispatched";
    event("coordinator", "dispatched-line", `#${line.num} -> ${dispatch.mode}:${dispatch.peer}`);
  }

  await writeTable(state, lines, markdown);
  saveState("coordinator", state);
  return state;
}

/** Keep the "Automation dispatch" section of PRODUCT.md current (at most one commit an hour). */
async function writeTable(state: CoordinatorState, lines: Line[], markdown: string) {
  const rows = lines
    .filter(line => state.lines[String(line.num)]?.dispatches.length)
    .map(line => {
      const ls = state.lines[String(line.num)]!;
      const last = ls.dispatches.at(-1)!;
      return `| ${line.num} | ${ls.status} | ${last.mode}:${last.peer} | ${last.at.slice(0, 16).replace("T", " ")} | ${ls.dispatches.length} |`;
    });
  const table = [
    "## Automation dispatch",
    "",
    "Written by the coordinator (`bunos-auto-coordinator.service`, docs/AUTOMATION.md); do not edit by hand.",
    "",
    "| #   | Status | Dispatched to | At (UTC) | Dispatches |",
    "| --- | ------ | ------------- | -------- | ---------- |",
    ...rows,
    "",
  ].join("\n");
  if (!rows.length || table === state.lastTable) return;
  if (state.lastTableCommit && Date.now() - Date.parse(state.lastTableCommit) < 3_600_000) return;
  const start = markdown.indexOf("## Automation dispatch");
  const body = start >= 0 ? markdown.slice(0, start).trimEnd() : markdown.trimEnd();
  const commit = await commitOnMain("product: coordinator dispatch table", [
    { path: "docs/PRODUCT.md", content: await formatMarkdown(`${body}\n\n${table}`) },
  ]);
  if (commit) {
    state.lastTable = table;
    state.lastTableCommit = new Date().toISOString();
  }
}

export async function coordinator(once: boolean) {
  for (;;) {
    await tick().catch(error => event("coordinator", "error", String(error).slice(0, 400)));
    if (once) return;
    await Bun.sleep(TICK_MS);
  }
}
