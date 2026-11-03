// SPDX-License-Identifier: Apache-2.0
// bunos windows: one view and one uninstall over everything Bun OS installed on Windows (docs/WINDOWS-ARCHITECTURE.md).
//
//   bunos windows status [--json] [--deep]       components (manifests), services, autostart, resident processes, orphans
//   bunos windows uninstall [<component>..|--all] [--yes]   plan (default) or run each component's own uninstall
//   bunos windows identity <file.exe>..           icon / VERSIONINFO / manifest present (exit 1 when icon or version lack)
//   bunos windows replace [<app> [on|off|status|record <key>=<value>]] [--force]   gated, reversible default switches
//
// Read-only except `uninstall --yes`, `replace on|off` and `replace record`. In-process (no checkout needed) except the
// component uninstallers and the shell switches, which live in the checkout or under %SystemRoot%\BunOS.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const env = process.env;
const systemRoot = env.SystemRoot ?? env.windir ?? "C:\\Windows";
export const bunosRoot = join(systemRoot, "BunOS");
const localAppData = env.LOCALAPPDATA ?? join(env.USERPROFILE ?? ".", "AppData", "Local");
const repo = (() => {
  const c = [env.BUNOS_REPO, resolve(import.meta.dir, "..", "..", "..")].find(
    p => p && existsSync(join(p, "infra", "fleet", "fleet.toml")),
  );
  return c ?? null;
})();

// ------------------------------------------------------------------------------------------------ manifest schema 2

/** One installed file. `sha256` is of the installed bytes (after signing). */
export interface ManifestFile {
  path: string;
  sha256?: string;
  size?: number;
  sourceSha256?: string;
  spdx?: string;
  signer?: string | null;
}

/** The single manifest shape every installer writes (factory/windows/manifest.schema.json). */
export interface Manifest {
  schema: 2;
  component: string;
  installedAt?: string;
  revision?: string;
  root?: string;
  files: ManifestFile[];
  services: string[];
  /** The command that removes this component (run elevated). */
  uninstall: string[];
}

/** How each component removes itself; `{repo}` and `{root}` are substituted. Reverse dependency order. */
const UNINSTALLERS: Record<string, string[]> = {
  "wsl-service": ["{root}\\wsl-service\\bunos-wsl-service.exe", "uninstall"],
  "bunos-shell": ["bun", "{repo}\\factory\\windows\\shell\\bunos-shell.ts", "uninstall"],
  "bun-dotnet-windows": ["bun", "{repo}\\packages\\bun-dotnet-windows\\install\\install.ts", "uninstall"],
  userland: ["pwsh", "-NoProfile", "-File", "{root}\\userland\\uninstall-system.ps1"],
  nt: ["pwsh", "-NoProfile", "-File", "{repo}\\factory\\windows\\nt\\setup-elevated.ps1", "-Uninstall"],
  wsl: ["pwsh", "-NoProfile", "-File", "{repo}\\factory\\wsl\\windows\\setup-elevated.ps1", "-Uninstall"],
};
const ORDER = ["wsl-service", "bunos-shell", "bun-dotnet-windows", "userland", "nt", "wsl"];

/** Normalises the four schema-1 shapes written on 2026-11-03 (shell/dotnet, nt/wsl, userland) and schema 2. */
export function normalize(raw: any, fallbackComponent: string): Manifest {
  const component = String(
    raw.component ?? (typeof raw.kind === "string" ? raw.kind.replace(/^bunos-windows-/, "").replace(/-install$/, "") : fallbackComponent),
  );
  const files: ManifestFile[] = (raw.files ?? [])
    .filter((f: any) => f && typeof f.path === "string" && (f.kind === undefined || f.kind === "file" || f.kind === "payload"))
    .map((f: any) => ({
      path: f.path,
      sha256: f.sha256,
      size: f.size ?? f.bytes,
      sourceSha256: f.sourceSha256 ?? (typeof f.source === "string" && /^[0-9a-f]{64}$/.test(f.source) ? f.source : undefined),
      spdx: f.spdx,
      signer: f.signer ?? f.thumbprint ?? null,
    }));
  const services: string[] = raw.services ?? (raw.service ? [raw.service] : []);
  const name = component === "shell" ? "bunos-shell" : component;
  return {
    schema: 2,
    component: name,
    installedAt: raw.installedAt ?? raw.installed,
    revision: raw.revision ?? raw.repoRev ?? raw.commit ?? raw.bundle?.revision ?? raw.manifestRevision,
    root: raw.root,
    files,
    services,
    uninstall: raw.uninstall ?? UNINSTALLERS[name] ?? [],
  };
}

/** Every manifest under %SystemRoot%\BunOS (manifests\*.json, the userland install record, the WSL service). */
export function manifests(root = bunosRoot): Manifest[] {
  const out: Manifest[] = [];
  const dir = join(root, "manifests");
  if (existsSync(dir))
    for (const n of readdirSync(dir).filter(n => n.endsWith(".json")).sort()) {
      try {
        out.push(normalize(JSON.parse(readFileSync(join(dir, n), "utf8")), n.replace(/\.json$/, "")));
      } catch {}
    }
  const record = join(root, "userland", "install-record.json");
  if (existsSync(record)) out.push(normalize(JSON.parse(readFileSync(record, "utf8")), "userland"));
  // bunos-wsl-service copies itself without a manifest file; its service registration is the record.
  const svc = join(root, "wsl-service", "bunos-wsl-service.exe");
  if (existsSync(svc) && !out.some(m => m.component === "wsl-service"))
    out.push({
      schema: 2,
      component: "wsl-service",
      root: dirname(svc),
      files: [{ path: svc, size: statSync(svc).size }],
      services: ["BunOSWsl"],
      uninstall: UNINSTALLERS["wsl-service"]!,
    });
  return out.sort((a, b) => ORDER.indexOf(a.component) - ORDER.indexOf(b.component));
}

// ------------------------------------------------------------------------------------------------ probes

function sh(argv: string[]): { code: number; out: string } {
  try {
    const r = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode ?? 1, out: r.stdout.toString() };
  } catch {
    return { code: 127, out: "" };
  }
}

/** `reg query` values of a key (value names and types are not localised). */
function regValues(key: string): Record<string, string> {
  const r = sh(["reg.exe", "query", key]);
  const out: Record<string, string> = {};
  for (const line of r.out.split(/\r?\n/)) {
    const m = /^\s{4}(.+?)\s{4}(REG_\w+)\s{4}(.*)$/.exec(line);
    if (m) out[m[1]!] = m[3]!;
  }
  return out;
}

const START = ["boot", "system", "auto", "demand", "disabled"];

function service(name: string) {
  const v = regValues(`HKLM\\SYSTEM\\CurrentControlSet\\Services\\${name}`);
  if (!Object.keys(v).length) return { name, installed: false };
  const start = START[Number.parseInt(v.Start ?? "", 16)] ?? v.Start;
  return { name, installed: true, start, image: v.ImagePath };
}

/** Our services: everything whose name starts with BunOS (services enumerated from the registry). */
function bunosServices(): string[] {
  const r = sh(["reg.exe", "query", "HKLM\\SYSTEM\\CurrentControlSet\\Services"]);
  return r.out
    .split(/\r?\n/)
    .map(l => l.trim().split("\\").pop() ?? "")
    .filter(n => /^BunOS/i.test(n));
}

/** Processes of the retired resident desktop stack, and the budgeted residents (docs/WINDOWS-ARCHITECTURE.md). */
export const RETIRED_RESIDENTS = [
  "glazewm.exe",
  "glazewm-watcher.exe",
  "tacky-borders.exe",
  "bunos-win11-wallpaper.exe",
  "bunos-win11-chrome.exe",
  "waku.exe",
  "zebar.exe",
  "Flow.Launcher.exe",
  "AltSnap.exe",
];
export const BUDGETED_RESIDENTS: Record<string, { privateMB: number; why: string }> = {
  "bunos-wsl-service.exe": { privateMB: 8, why: "BunOSWsl / BunOSWsl.<unit>, demand-started" },
  "bunos-winbridge.exe": { privateMB: 30, why: "BunOSWinBridge, demand-started" },
};

function processes(): { name: string; pid: number; memKB: number }[] {
  const r = sh(["tasklist.exe", "/fo", "csv", "/nh"]);
  return r.out
    .split(/\r?\n/)
    .map(l => l.match(/"([^"]*)"/g)?.map(s => s.slice(1, -1)) ?? [])
    .filter(c => c.length >= 5)
    .map(c => ({ name: c[0]!, pid: Number(c[1]), memKB: Number(c[4]!.replace(/[^\d]/g, "")) }));
}

function autostarts() {
  const out: { key: string; name: string; value: string }[] = [];
  for (const key of ["HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"])
    for (const [name, value] of Object.entries(regValues(key)))
      if (/bunos|bun-os|aphrody/i.test(`${name} ${value}`)) out.push({ key, name, value });
  return out;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Files under the tree that no manifest lists (the manifests themselves and per-component records excepted). */
function orphans(list: Manifest[], root = bunosRoot): string[] {
  const known = new Set(list.flatMap(m => m.files.map(f => f.path.toLowerCase())));
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 4 || !existsSync(d)) return;
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const s = statSync(p);
      if (s.isDirectory()) {
        if (!/^(manifests|licenses)$/i.test(n)) walk(p, depth + 1);
      } else if (!known.has(p.toLowerCase()) && !/install-record\.json$|manifest\.json$/i.test(n)) out.push(p);
    }
  };
  walk(root, 0);
  return out;
}

export function status(deep = false) {
  const list = manifests();
  const procs = processes();
  const components = list.map(m => ({
    component: m.component,
    revision: m.revision,
    installedAt: m.installedAt,
    files: m.files.length,
    missing: m.files.filter(f => !existsSync(f.path)).map(f => f.path),
    modified: deep
      ? m.files.filter(f => f.sha256 && existsSync(f.path) && sha256(f.path) !== f.sha256).map(f => f.path)
      : undefined,
    services: m.services.map(service),
    uninstall: m.uninstall.length > 0,
  }));
  return {
    root: bunosRoot,
    components,
    services: bunosServices().map(service),
    autostart: autostarts(),
    retiredRunning: procs.filter(p => RETIRED_RESIDENTS.some(n => n.toLowerCase() === p.name.toLowerCase())),
    residents: procs
      .filter(p => p.name.toLowerCase() in Object.fromEntries(Object.keys(BUDGETED_RESIDENTS).map(k => [k.toLowerCase(), 1])))
      .map(p => {
        const b = Object.entries(BUDGETED_RESIDENTS).find(([k]) => k.toLowerCase() === p.name.toLowerCase())![1];
        return { ...p, budgetMB: b.privateMB, why: b.why };
      }),
    orphans: orphans(list),
  };
}

// ------------------------------------------------------------------------------------------------ uninstall

export function uninstallPlan(names: string[]): string[][] {
  const list = manifests();
  const chosen = names.length ? list.filter(m => names.includes(m.component)) : list;
  return chosen.map(m =>
    m.uninstall.map(a => a.replaceAll("{root}", bunosRoot).replaceAll("{repo}", repo ?? "<checkout>")),
  );
}

// ------------------------------------------------------------------------------------------------ identity

/** Resource types present in a PE (RT_ICON 3, RT_GROUP_ICON 14, RT_VERSION 16, RT_MANIFEST 24). */
export function peResourceTypes(buf: Uint8Array): Set<number> | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 0x40 || dv.getUint16(0, true) !== 0x5a4d) return null;
  const nt = dv.getUint32(0x3c, true);
  if (dv.getUint32(nt, true) !== 0x4550) return null;
  const nsec = dv.getUint16(nt + 6, true);
  const optSize = dv.getUint16(nt + 20, true);
  const opt = nt + 24;
  const plus = dv.getUint16(opt, true) === 0x20b;
  const dd = opt + (plus ? 112 : 96) + 2 * 8; // data directory 2 = resources
  const rva = dv.getUint32(dd, true);
  const types = new Set<number>();
  if (!rva) return types;
  let off = -1;
  for (let i = 0; i < nsec; i++) {
    const s = opt + optSize + i * 40;
    const va = dv.getUint32(s + 12, true);
    const vs = Math.max(dv.getUint32(s + 8, true), dv.getUint32(s + 16, true));
    if (rva >= va && rva < va + vs) off = dv.getUint32(s + 20, true) + (rva - va);
  }
  if (off < 0) return types;
  const named = dv.getUint16(off + 12, true);
  const ids = dv.getUint16(off + 14, true);
  for (let i = 0; i < named + ids; i++) {
    const id = dv.getUint32(off + 16 + i * 8, true);
    if (!(id & 0x80000000)) types.add(id);
  }
  return types;
}

export function identity(file: string) {
  const t = peResourceTypes(new Uint8Array(readFileSync(file)));
  if (!t) return { file, pe: false, icon: false, version: false, manifest: false, ok: false };
  const r = { file, pe: true, icon: t.has(14) || t.has(3), version: t.has(16), manifest: t.has(24) };
  return { ...r, ok: r.icon && r.version };
}

// ------------------------------------------------------------------------------------------------ replace

interface Gate {
  crashFreeDays: number;
  maxStartupMs: number;
  idleCpuPct: number;
  privateMB: number;
}
interface AppEntry {
  title: string;
  switch: { kind: "shell-component"; component: string } | { kind: "none"; reason: string };
  gate?: Partial<Gate>;
  parity: string[];
}
interface Evidence {
  since?: string;
  lastCrash?: string;
  startupMs?: number;
  idleCpuPct?: number;
  privateMB?: number;
  parity?: Record<string, boolean>;
  switched?: boolean;
}

const gatesFile = join(localAppData, "bunos", "replace", "gates.json");

function replaceCatalog(): { defaultGate: Gate; apps: Record<string, AppEntry> } {
  const p = repo ? join(repo, "factory", "windows", "replace", "apps.json") : join(bunosRoot, "share", "replace-apps.json");
  return JSON.parse(readFileSync(p, "utf8"));
}
function loadEvidence(): Record<string, Evidence> {
  return existsSync(gatesFile) ? JSON.parse(readFileSync(gatesFile, "utf8")) : {};
}
function saveEvidence(e: Record<string, Evidence>) {
  mkdirSync(dirname(gatesFile), { recursive: true });
  writeFileSync(gatesFile, `${JSON.stringify(e, null, 2)}\n`);
}

/** Which gate conditions fail for an app (empty = the switch may be turned on). */
export function gateFailures(app: AppEntry, gate: Gate, ev: Evidence, now = Date.now()): string[] {
  const g = { ...gate, ...app.gate };
  const fail: string[] = [];
  if (app.switch.kind === "none") fail.push(`no switch: ${app.switch.reason}`);
  const from = Date.parse(ev.lastCrash ?? ev.since ?? "");
  const days = Number.isFinite(from) ? (now - from) / 86_400_000 : 0;
  if (days < g.crashFreeDays) fail.push(`crash-free ${days.toFixed(1)} of ${g.crashFreeDays} days`);
  if (ev.startupMs === undefined || ev.startupMs > g.maxStartupMs) fail.push(`startup ${ev.startupMs ?? "?"} ms > ${g.maxStartupMs} ms`);
  if (ev.idleCpuPct === undefined || ev.idleCpuPct > g.idleCpuPct) fail.push(`idle CPU ${ev.idleCpuPct ?? "?"} % > ${g.idleCpuPct} %`);
  if (ev.privateMB === undefined || ev.privateMB > g.privateMB) fail.push(`private ${ev.privateMB ?? "?"} MB > ${g.privateMB} MB`);
  const missing = app.parity.filter(p => !ev.parity?.[p]);
  if (missing.length) fail.push(`parity missing: ${missing.join("; ")}`);
  return fail;
}

function shellSwitch(component: string, on: boolean): number {
  const script = repo ? join(repo, "factory", "windows", "shell", "bunos-shell.ts") : join(bunosRoot, "share", "bunos-shell.ts");
  const r = Bun.spawnSync([process.execPath, script, on ? "enable" : "disable", component], { stdio: ["inherit", "inherit", "inherit"] });
  return r.exitCode ?? 1;
}

function replace(args: string[], force: boolean): number {
  const cat = replaceCatalog();
  const ev = loadEvidence();
  const [name, action = "status", ...rest] = args;
  if (!name) {
    for (const [id, app] of Object.entries(cat.apps)) {
      const fails = gateFailures(app, cat.defaultGate, ev[id] ?? {});
      console.log(`${id.padEnd(18)} ${ev[id]?.switched ? "on " : "off"}  ${fails.length ? `gate: ${fails.length} open` : "gate passed"}  ${app.title}`);
    }
    return 0;
  }
  const app = cat.apps[name];
  if (!app) {
    console.error(`bunos windows replace: unknown app '${name}' (${Object.keys(cat.apps).join(", ")})`);
    return 2;
  }
  const e = (ev[name] ??= {});
  switch (action) {
    case "status":
      console.log(JSON.stringify({ app: name, ...app, evidence: e, gate: gateFailures(app, cat.defaultGate, e) }, null, 2));
      return 0;
    case "record": {
      // record since=2026-11-03 | crash=now | startupMs=420 | idleCpuPct=0.1 | privateMB=35 | parity="Recycle Bin"
      for (const kv of rest) {
        const [k, ...v] = kv.split("=");
        const val = v.join("=");
        if (k === "crash") e.lastCrash = val === "now" || !val ? new Date().toISOString() : val;
        else if (k === "since") e.since = val || new Date().toISOString();
        else if (k === "parity") (e.parity ??= {})[val] = true;
        else if (k === "startupMs" || k === "idleCpuPct" || k === "privateMB") e[k] = Number(val);
        else {
          console.error(`unknown evidence ${k}`);
          return 2;
        }
      }
      e.since ??= new Date().toISOString();
      saveEvidence(ev);
      return 0;
    }
    case "on":
    case "off": {
      if (app.switch.kind === "none") {
        console.error(`${name}: ${app.switch.reason}`);
        return 3;
      }
      if (action === "on") {
        const fails = gateFailures(app, cat.defaultGate, e);
        if (fails.length && !force) {
          console.error(`${name}: gate not passed (use --force to override):\n  ${fails.join("\n  ")}`);
          return 3;
        }
      }
      const code = shellSwitch(app.switch.component, action === "on");
      if (code === 0) {
        e.switched = action === "on";
        saveEvidence(ev);
      }
      return code;
    }
    default:
      console.error("usage: bunos windows replace [<app> [status|on|off|record k=v..]] [--force]");
      return 2;
  }
}

// ------------------------------------------------------------------------------------------------ CLI

export async function main(argv: string[]): Promise<number> {
  const flag = (n: string) => {
    const i = argv.indexOf(n);
    if (i < 0) return false;
    argv.splice(i, 1);
    return true;
  };
  const json = flag("--json");
  const yes = flag("--yes");
  const all = flag("--all");
  const deep = flag("--deep");
  const force = flag("--force");
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined:
    case "status": {
      const s = status(deep);
      if (json) {
        console.log(JSON.stringify(s, null, 2));
        return 0;
      }
      for (const c of s.components)
        console.log(
          `${c.component.padEnd(20)} ${String(c.files).padStart(4)} files${c.missing.length ? `, ${c.missing.length} missing` : ""}${c.modified?.length ? `, ${c.modified.length} modified` : ""}  ${c.revision?.slice(0, 10) ?? ""}  ${c.uninstall ? "" : "NO UNINSTALL"}`,
        );
      for (const sv of s.services) console.log(`service ${sv.name}: ${sv.installed ? sv.start : "absent"}`);
      for (const a of s.autostart) console.log(`autostart ${a.name}: ${a.value}`);
      for (const p of s.retiredRunning) console.log(`RETIRED but running: ${p.name} (PID ${p.pid}, ${Math.round(p.memKB / 1024)} MB)`);
      for (const p of s.residents) console.log(`resident ${p.name} PID ${p.pid}: ${Math.round(p.memKB / 1024)} MB working set (budget ${p.budgetMB} MB private; ${p.why})`);
      if (s.orphans.length) console.log(`not in any manifest (${s.orphans.length}):\n  ${s.orphans.join("\n  ")}`);
      return s.retiredRunning.length ? 1 : 0;
    }
    case "uninstall": {
      if (!rest.length && !all) {
        console.error("bunos windows uninstall <component>.. | --all  (plan only; add --yes to run, elevated)");
        for (const m of manifests()) console.error(`  ${m.component}`);
        return 2;
      }
      const plan = uninstallPlan(rest);
      for (const step of plan) console.log(`${yes ? "run" : "would run"}: ${step.join(" ")}`);
      if (!yes) return 0;
      const sudo = join(systemRoot, "System32", "sudo.exe");
      for (const step of plan) {
        const argv0 = step[0] === "bun" ? process.execPath : step[0]!;
        const r = Bun.spawnSync([sudo, argv0, ...step.slice(1)], { stdio: ["inherit", "inherit", "inherit"] });
        if (r.exitCode !== 0) {
          console.error(`failed (${r.exitCode}): ${step.join(" ")}`);
          return r.exitCode ?? 1;
        }
      }
      return 0;
    }
    case "identity": {
      let bad = 0;
      for (const f of rest) {
        const r = identity(f);
        if (!r.ok) bad++;
        console.log(json ? JSON.stringify(r) : `${r.ok ? "ok  " : "FAIL"} ${f}  icon=${r.icon} version=${r.version} manifest=${r.manifest}`);
      }
      return bad ? 1 : 0;
    }
    case "replace":
      return replace(rest, force);
    default:
      console.error("usage: bunos windows status|uninstall|identity|replace (docs/WINDOWS-ARCHITECTURE.md)");
      return 2;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
