// SPDX-License-Identifier: Apache-2.0
// The status page (aphrody.com/status, nginx snippet aphrody-status.inc): status.json plus a self-contained
// index.html rendered from the automation state, regenerated every 5 minutes (bunos-auto-status.timer) and after
// each nightly run. It also carries the owner consent list: the only steps a human still has to do.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { home, loadState, readJson, recentEvents, run, statusRoot, syncStateDir, type Task } from "./lib.ts";

interface Consent {
  id: string;
  name: string;
  unlocks: string;
  how: string;
  granted: boolean;
}

/** Owner credential consents. Every flow that needs one checks it and proceeds by itself once it exists. */
export async function consents(): Promise<Consent[]> {
  const marker = (id: string) => existsSync(join(home, ".aphrody", "consents", id));
  const google = (await run(["gcloud", "auth", "print-access-token", "--quiet"], { timeoutMs: 30_000 })).code === 0;
  const az = (await run(["az", "account", "show", "--only-show-errors"], { timeoutMs: 30_000 })).code === 0;
  const play =
    marker("play") ||
    /Account \{name=[^,]+, type=com\.google\}/.test(
      (await run(["sudo", "-n", "waydroid", "shell", "--", "dumpsys", "account"], { timeoutMs: 30_000 })).out,
    );
  return [
    {
      id: "google",
      name: "Google consent (aphrody-bot impersonation, user OAuth for Drive)",
      unlocks: "Vertex Gemini briefs, qualify-gemini, Drive in COSMIC Files",
      how: "gcloud auth login + application-default login as the owner on the VPS",
      granted: google,
    },
    {
      id: "play",
      name: "Play Store sign-in in Android 17",
      unlocks: "Gemini APK and Play apps in the session (PRODUCT.md 10, 17)",
      how: "Sign in once in the Android 17 session; the health loop detects the com.google account",
      granted: play,
    },
    {
      id: "az",
      name: "az login (Azure / Partner Center)",
      unlocks: "Microsoft Store submission (buncc store), OneDrive (PRODUCT.md 19)",
      how: "az login --use-device-code on the VPS",
      granted: az,
    },
    {
      id: "windows-admin",
      name: "Admin-elevated Windows tasks on the workstation",
      unlocks: "machine-wide installs and services on the workstation",
      how: "Run the elevated task once; then touch ~/.aphrody/consents/windows-admin on the VPS",
      granted: marker("windows-admin"),
    },
    {
      id: "new-server",
      name: "Buy the new server",
      unlocks: "a second build host (more factory slots)",
      how: "Order it; then touch ~/.aphrody/consents/new-server on the VPS with its ssh alias inside",
      granted: marker("new-server"),
    },
  ];
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const dot = (ok: boolean | undefined) => `<span class="dot ${ok === undefined ? "na" : ok ? "ok" : "bad"}"></span>`;

export async function renderStatus() {
  const gate = readJson<{
    at?: string;
    sha?: string;
    green?: boolean;
    results?: { name: string; ok: boolean; skipped?: string; error?: string }[];
  }>(join(syncStateDir, "gate.json"), {});
  const sync = readJson<{ at?: string; outcome?: string; detail?: string }>(join(syncStateDir, "status.json"), {});
  const deliver = loadState<{
    lanes?: Record<string, { sha?: string; ok?: boolean; at?: string; detail?: string }>;
    nginxDrift?: string[];
  }>("deliver", {});
  const health = loadState<{ probes?: Record<string, { ok: boolean; detail: string; at: string }> }>("health", {});
  const guard = loadState<{ report?: string[]; at?: string }>("guard", {});
  const deps = loadState<Record<string, { at: string; ok: boolean }>>("deps", {});
  const forks = loadState<{ forks?: Record<string, { at: string; ok: boolean; detail: string }> }>("deps-forks", {});
  const coord = loadState<{
    lines?: Record<string, { status: string; dispatches: { at: string; mode: string; peer: string }[] }>;
    budget?: { tokens: number; invokes: number };
  }>("coordinator", {});
  const nightly = loadState<{
    at?: string;
    stamp?: string;
    green?: boolean;
    steps?: { name: string; ok: boolean; detail: string }[];
    shots?: string[];
  }>("nightly", {});
  const tasks = loadState<Task[]>("tasks", []).filter(t => t.state === "open" || t.state === "dispatched");
  const events = recentEvents(86_400_000).slice(-60).reverse();
  const consentList = await consents();
  const publicTasks = tasks.map(t => ({
    kind: t.kind,
    title: t.title,
    state: t.state,
    peer: t.peer,
    createdAt: t.createdAt,
  }));
  const status = {
    generatedAt: new Date().toISOString(),
    sync,
    gate,
    deliver,
    health,
    guard,
    deps,
    forks,
    coordinator: coord,
    nightly,
    tasks: publicTasks,
    consents: consentList,
  };
  mkdirSync(statusRoot, { recursive: true });
  await Bun.write(join(statusRoot, "status.json"), JSON.stringify(status, null, 2));

  const probes = Object.entries(health.probes ?? {});
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bun OS status</title><meta http-equiv="refresh" content="120">
<style>
:root{color-scheme:light dark;--bg:#fef7ff;--fg:#1d1b20;--card:#f3edf7;--muted:#49454f;--ok:#386a20;--bad:#ba1a1a;--na:#79747e}
@media (prefers-color-scheme:dark){:root{--bg:#141218;--fg:#e6e0e9;--card:#211f26;--muted:#cac4d0;--ok:#9ed582;--bad:#ffb4ab}}
body{margin:0;font:15px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--fg)}main{max-width:1100px;margin:auto;padding:24px}
h1{font-size:28px;margin:0 0 4px}h2{font-size:18px;margin:0 0 8px}.muted{color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-top:16px}
section{background:var(--card);border-radius:16px;padding:16px}table{width:100%;border-collapse:collapse;font-size:13px}
td{padding:3px 6px;vertical-align:top;border-top:1px solid color-mix(in srgb,var(--muted) 20%,transparent)}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}.ok{background:var(--ok)}.bad{background:var(--bad)}.na{background:var(--na)}
img{max-width:100%;border-radius:8px;margin-top:8px}code{font-size:12px}
</style></head><body><main>
<h1>Bun OS status</h1><div class="muted">Generated ${esc(status.generatedAt)} by the automation loops (docs/AUTOMATION.md). Refreshes every 5 minutes.</div>
<div class="grid">
<section><h2>${dot(gate.green)}Main gate</h2><div class="muted">${esc(gate.sha?.slice(0, 10))} at ${esc(gate.at)}</div><table>${(
    gate.results ?? []
  )
    .map(
      r =>
        `<tr><td>${dot(r.ok)}${esc(r.name)}</td><td>${esc(r.skipped ? `skipped: ${r.skipped}` : r.ok ? "ok" : r.error)}</td></tr>`,
    )
    .join("")}</table><div class="muted">sync: ${esc(sync.outcome)} ${esc(sync.detail)}</div></section>
<section><h2>Delivery</h2><table>${Object.entries(deliver.lanes ?? {})
    .map(
      ([k, v]) =>
        `<tr><td>${dot(v.ok)}${esc(k)}</td><td>${esc(v.sha?.slice(0, 10))}</td><td>${esc(v.detail)}</td></tr>`,
    )
    .join(
      "",
    )}</table>${deliver.nginxDrift?.length ? `<div class="muted">nginx drift (reported): ${deliver.nginxDrift.map(esc).join("<br>")}</div>` : ""}</section>
<section><h2>${dot(probes.every(([, p]) => p.ok))}Runtime health</h2><table>${probes
    .map(([k, v]) => `<tr><td>${dot(v.ok)}${esc(k)}</td><td>${esc(v.detail)}</td></tr>`)
    .join("")}</table></section>
<section><h2>Resources</h2><table>${(guard.report ?? []).map(r => `<tr><td>${esc(r)}</td></tr>`).join("")}</table><div class="muted">${esc(guard.at)}</div></section>
<section><h2>${dot(nightly.green)}Nightly qualification</h2><div class="muted">${esc(nightly.stamp)} ${esc(nightly.at)}</div><table>${(
    nightly.steps ?? []
  )
    .map(s => `<tr><td>${dot(s.ok)}${esc(s.name)}</td><td>${esc(s.detail)}</td></tr>`)
    .join(
      "",
    )}</table>${(nightly.shots ?? []).map(f => `<img loading="lazy" alt="${esc(f)}" src="/status/nightly/${esc(nightly.stamp)}/${esc(f)}">`).join("")}</section>
<section><h2>Dependencies</h2><table>${Object.entries(deps)
    .map(([k, v]) => `<tr><td>${dot(v.ok)}${esc(k)}</td><td>${esc(v.at)}</td></tr>`)
    .join("")}${Object.entries(forks.forks ?? {})
    .map(([k, v]) => `<tr><td>${dot(v.ok)}fork ${esc(k)}</td><td>${esc(v.detail)}</td></tr>`)
    .join("")}</table></section>
<section><h2>Agent loop</h2><div class="muted">today: ${esc(coord.budget?.tokens ?? 0)} Gemini tokens, ${esc(coord.budget?.invokes ?? 0)} peer runs</div><table>${Object.entries(
    coord.lines ?? {},
  )
    .filter(([, l]) => l.dispatches.length)
    .map(
      ([k, l]) =>
        `<tr><td>#${esc(k)}</td><td>${esc(l.status)}</td><td>${esc(l.dispatches.at(-1)?.mode)}:${esc(l.dispatches.at(-1)?.peer)}</td></tr>`,
    )
    .join("")}</table></section>
<section><h2>Open tasks (${tasks.length})</h2><table>${tasks
    .map(
      t =>
        `<tr><td>${esc(t.kind)}</td><td>${esc(t.title)}</td><td>${esc(t.state)}${t.peer ? ` (${esc(t.peer)})` : ""}</td></tr>`,
    )
    .join("")}</table></section>
<section><h2>Owner consents</h2><div class="muted">The only steps left to a human. Each flow continues by itself once its consent exists.</div><table>${consentList
    .map(
      c =>
        `<tr><td>${dot(c.granted)}${esc(c.name)}</td><td>${esc(c.granted ? "granted" : c.how)}</td><td class="muted">${esc(c.unlocks)}</td></tr>`,
    )
    .join("")}</table></section>
<section style="grid-column:1/-1"><h2>Last 24 hours</h2><table>${events
    .map(
      e =>
        `<tr><td><code>${esc(e.at.slice(5, 16).replace("T", " "))}</code></td><td>${esc(e.loop)}</td><td>${esc(e.kind)}</td><td>${esc(e.detail.slice(0, 220))}</td></tr>`,
    )
    .join("")}</table></section>
</div></main></body></html>`;
  await Bun.write(join(statusRoot, "index.html"), html);
  return status;
}
