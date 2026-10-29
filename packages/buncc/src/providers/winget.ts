/**
 * winget provider: drives the Windows Package Manager CLI. Replaces the fork's `systemDependencies` feature
 * (a `winget:<id>` entry in package.json resolved by reading winget's SQLite index in Bun's package manager):
 * buncc reads the same package.json block, asks winget for what is installed, installs what is missing or too old, and
 * records the result in `buncc.winget.lock.json`.
 * CLI reference: https://learn.microsoft.com/windows/package-manager/winget/
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../process.ts";
import { missing, probeVersion, which } from "./_shared.ts";
import { compareVersions, type Context, type Provider } from "./types.ts";

/** Documented winget exit codes (`winget error <code>`). */
export const EXIT = {
  ALREADY_INSTALLED: 0x8a150061,
  UPDATE_NOT_APPLICABLE: 0x8a15002b,
  NO_APPLICABLE_INSTALLER: 0x8a150010,
  PACKAGE_NOT_FOUND: 0x8a150014,
} as const;

/** winget exits with a signed 32-bit code on Windows; compare as unsigned. */
export function interpretExit(code: number): "installed" | "already-installed" | "reboot" | "not-found" | "failed" {
  const u = code >>> 0;
  if (code === 0) return "installed";
  if (u === EXIT.ALREADY_INSTALLED || u === EXIT.UPDATE_NOT_APPLICABLE) return "already-installed";
  if (u === EXIT.PACKAGE_NOT_FOUND) return "not-found";
  if (code === 3010 || code === 1641) return "reboot";
  return "failed";
}

export interface InstallOptions {
  id: string;
  version?: string;
  source?: string;
  scope?: "user" | "machine";
  architecture?: "x64" | "x86" | "arm64";
  /** Raw arguments for the installer itself (`--override`). */
  override?: string;
  location?: string;
}

/** Unattended install: exact id, silent, agreements accepted. */
export function installArgs(o: InstallOptions): string[] {
  const args = [
    "install",
    "--id",
    o.id,
    "--exact",
    "--source",
    o.source ?? "winget",
    "--silent",
    "--accept-package-agreements",
    "--accept-source-agreements",
    "--disable-interactivity",
  ];
  if (o.version) args.push("--version", o.version);
  if (o.scope) args.push("--scope", o.scope);
  if (o.architecture) args.push("--architecture", o.architecture);
  if (o.location) args.push("--location", o.location);
  if (o.override) args.push("--override", o.override);
  return args;
}

export function upgradeArgs(o: { id: string; version?: string }): string[] {
  const args = [
    "upgrade",
    "--id",
    o.id,
    "--exact",
    "--source",
    "winget",
    "--silent",
    "--accept-package-agreements",
    "--accept-source-agreements",
    "--disable-interactivity",
  ];
  if (o.version) args.push("--version", o.version);
  return args;
}

export function uninstallArgs(id: string): string[] {
  return ["uninstall", "--id", id, "--exact", "--silent", "--disable-interactivity"];
}

export function listArgs(id?: string): string[] {
  return ["list", ...(id ? ["--id", id, "--exact"] : []), "--accept-source-agreements", "--disable-interactivity"];
}

export function showArgs(id: string, versions = false): string[] {
  return [
    "show",
    "--id",
    id,
    "--exact",
    "--source",
    "winget",
    "--accept-source-agreements",
    ...(versions ? ["--versions"] : []),
  ];
}

export interface Row {
  [column: string]: string;
}

/**
 * Parse winget's fixed-width table (`Name  Id  Version  Available  Source`, any language) using the column start
 * offsets of the header line that precedes the `-----` rule.
 */
export function parseTable(text: string): Row[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const rule = lines.findIndex(l => /^-{5,}\s*$/.test(l));
  if (rule < 1) return [];
  const header = lines[rule - 1]!;
  const cols = [...header.matchAll(/\S+(?: \S+)*/g)].map(m => ({ name: m[0], start: m.index! }));
  const rows: Row[] = [];
  for (const line of lines.slice(rule + 1)) {
    if (!line.trim()) continue;
    const row: Row = {};
    cols.forEach((c, i) => {
      const end = i + 1 < cols.length ? cols[i + 1]!.start : undefined;
      row[c.name] = line.slice(c.start, end).trim();
    });
    rows.push(row);
  }
  return rows;
}

export interface Installed {
  id: string;
  version: string;
}

/** Id and Version columns whatever the display language calls them (Id/ID, Version). */
export function installedFromTable(text: string): Installed[] {
  return parseTable(text)
    .map(r => {
      const idKey = Object.keys(r).find(k => /^id$/i.test(k));
      const verKey = Object.keys(r).find(k => /^version$/i.test(k));
      return { id: idKey ? r[idKey]! : "", version: verKey ? r[verKey]!.replace(/^[<>~]\s*/, "") : "" };
    })
    .filter(r => r.id);
}

// ---------------------------------------------------------------------------------------------------------------
// package.json `systemDependencies`
// ---------------------------------------------------------------------------------------------------------------

export interface SystemDependency {
  source: string;
  id: string;
  range: string;
}

/** `{"winget:jqlang.jq": "*", "winget:Microsoft.PowerToys": "0.100.0"}`; other sources are ignored. */
export function readSystemDependencies(pkg: { systemDependencies?: Record<string, string> }): SystemDependency[] {
  const out: SystemDependency[] = [];
  for (const [key, range] of Object.entries(pkg.systemDependencies ?? {})) {
    const m = /^([a-z]+):(.+)$/.exec(key);
    if (m && m[1] === "winget") out.push({ source: "winget", id: m[2]!, range: range || "*" });
  }
  return out;
}

/** Compare components numerically, as winget does. Supports `*`, `1.2.x`, exact, `>= > <= <`, `^`, `~` and `||`. */
export function satisfies(version: string, range: string): boolean {
  return range.split("||").some(alt =>
    alt
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every(c => satisfiesOne(version, c)),
  );
}

function satisfiesOne(version: string, c: string): boolean {
  if (c === "*" || c === "x") return true;
  const m = /^(>=|<=|>|<|\^|~|=)?(.+)$/.exec(c)!;
  const op = m[1] ?? "";
  const target = m[2]!;
  if (/[xX*]/.test(target)) {
    const prefix = target.split(".").filter(p => !/^[xX*]$/.test(p));
    return version.split(".").slice(0, prefix.length).join(".") === prefix.join(".");
  }
  const cmp = compareVersions(version, target);
  switch (op) {
    case ">=":
      return cmp >= 0;
    case ">":
      return cmp > 0;
    case "<=":
      return cmp <= 0;
    case "<":
      return cmp < 0;
    case "^": {
      const major = target.split(".")[0];
      return cmp >= 0 && version.split(".")[0] === major;
    }
    case "~": {
      const parts = target.split(".");
      return cmp >= 0 && version.split(".").slice(0, 2).join(".") === parts.slice(0, 2).join(".");
    }
    default:
      return cmp === 0;
  }
}

export type PlanAction = {
  id: string;
  action: "skip" | "install" | "upgrade";
  version?: string;
  installed?: string;
  command?: string[];
};

/** What to run so every dependency is present and in range. Exact ranges pin `--version`. */
export function planDependencies(deps: SystemDependency[], installed: Installed[]): PlanAction[] {
  return deps.map(dep => {
    const have = installed.find(i => i.id.toLowerCase() === dep.id.toLowerCase());
    if (have && satisfies(have.version, dep.range))
      return { id: dep.id, action: "skip" as const, installed: have.version };
    const exact = /^=?\d[\w.+-]*$/.test(dep.range) ? dep.range.replace(/^=/, "") : undefined;
    return {
      id: dep.id,
      action: have ? ("upgrade" as const) : ("install" as const),
      version: exact,
      installed: have?.version,
      command: [
        "winget",
        ...(have ? upgradeArgs({ id: dep.id, version: exact }) : installArgs({ id: dep.id, version: exact })),
      ],
    };
  });
}

export const LOCK_FILE = "buncc.winget.lock.json";

export interface WingetLock {
  version: 1;
  packages: Record<string, { version: string; range: string; source: string }>;
}

export function buildLock(deps: SystemDependency[], installed: Installed[]): WingetLock {
  const packages: WingetLock["packages"] = {};
  for (const dep of deps) {
    const have = installed.find(i => i.id.toLowerCase() === dep.id.toLowerCase());
    if (have) packages[dep.id] = { version: have.version, range: dep.range, source: dep.source };
  }
  return {
    version: 1,
    packages: Object.fromEntries(Object.entries(packages).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
}

export function writeLock(root: string, lock: WingetLock): string {
  const file = join(root, LOCK_FILE);
  writeFileSync(file, JSON.stringify(lock, null, 2) + "\n");
  return file;
}

/** `--frozen` check: does the lock still cover every dependency within its range? Returns the problems found. */
export function verifyLock(deps: SystemDependency[], lock: WingetLock): string[] {
  const problems: string[] = [];
  for (const dep of deps) {
    const entry = lock.packages[dep.id];
    if (!entry) problems.push(`${dep.id} is not in ${LOCK_FILE}`);
    else if (!satisfies(entry.version, dep.range))
      problems.push(`${dep.id} ${entry.version} (locked) does not satisfy ${dep.range}`);
  }
  for (const id of Object.keys(lock.packages))
    if (!deps.some(d => d.id === id)) problems.push(`${id} is locked but no longer in systemDependencies`);
  return problems;
}

export async function listInstalled(ctx: Pick<Context, "env">): Promise<Installed[]> {
  const result = await run(["winget", ...listArgs()], { env: ctx.env, output: "capture", timeoutMs: 120_000 });
  return result.code === 0 || result.stdout ? installedFromTable(result.stdout) : [];
}

/** Install every missing dependency from `<root>/package.json`; writes the lock on success. Pass `dryRun` to only get the plan. */
export async function syncSystemDependencies(ctx: Context, options: { dryRun?: boolean } = {}) {
  const file = join(ctx.root, "package.json");
  const pkg = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as { systemDependencies?: Record<string, string> })
    : {};
  const deps = readSystemDependencies(pkg);
  if (ctx.platform !== "win32") return { plan: [], skipped: "winget packages are resolved on Windows only", deps };
  const plan = planDependencies(deps, await listInstalled(ctx));
  if (options.dryRun) return { plan, deps };
  const results: { id: string; outcome: ReturnType<typeof interpretExit> }[] = [];
  for (const step of plan) {
    if (step.action === "skip" || !step.command) continue;
    const r = await run(step.command, { env: ctx.env, output: "inherit" });
    results.push({ id: step.id, outcome: interpretExit(r.code) });
  }
  writeLock(ctx.root, buildLock(deps, await listInstalled(ctx)));
  return { plan, results, deps };
}

export const wingetProvider: Provider = {
  id: "winget",
  description: "Windows Package Manager (winget) and package.json systemDependencies",
  platforms: ["win32"],
  async detect(ctx) {
    const exe = which("winget", ctx);
    if (!exe) return missing("install App Installer from the Microsoft Store (https://aka.ms/getwinget)");
    return { found: true, path: exe, version: await probeVersion(exe, ["--version"], ctx) };
  },
  install: () => ({ commands: [], manual: "winget ships with App Installer: https://aka.ms/getwinget" }),
  env: async () => ({}),
};
