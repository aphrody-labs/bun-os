// SPDX-License-Identifier: Apache-2.0
// Host config: systemd units, nginx sites, the cross-host inventory and the toolchain
// manifest live under `infra/config/host` (the single home for aphrody and nie). Units keep only their own
// directives; shared sandbox/identity blocks are drop-ins listed in
// `catalog.json` and composed back into one flat unit at install/package time.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { accountProblems, loadTunnel, tunnelProblems } from "./wireguard.ts";
export * from "./layout.ts";

export interface HostUnit {
  service: string;
  unit: string;
  path: string;
  dropIns: string[];
  ownerRepo: string;
  targetHost: string;
  site?: string;
  pairs?: string;
  status?: string;
}
/** A Unix account declared for hosts: root-owned authorized keys, sudoers drop-in, sshd drop-ins, no extra group. */
export interface HostAccount {
  user: string;
  hosts: string[];
  groups: string[];
  authorizedKeys: string;
  sudoers: string;
  sshdDropIns: { file: string; install: string; hosts: string[] }[];
  allowedFrom: string[];
  postgresAccess?: "sudo-only";
  /** Findings the plan repeats to the owner (declared choices that weaken a guarantee); they never block the declaration. */
  findings?: string[];
}
export interface HostCatalog {
  schemaVersion: number;
  units: HostUnit[];
  nginx: {
    file: string;
    site: string;
    service?: string;
    ownerRepo: string;
    targetHost: string;
  }[];
  dropIns: { dir: string; files: string[] };
  unitDropIns: { unit: string; path: string; hosts: string[] }[];
  nginxSnippets: { dir: string; files: string[] };
  /** Cross-host inventory records (targets, dated observations) and the per-user toolchain manifest. */
  inventory?: { dir: string; files: string[]; toolchain: string };
  /** Private WireGuard tunnel declaration (`wireguard.ts`) and the accounts that use it. */
  wireguard?: { declaration: string };
  accounts?: HostAccount[];
}

/** The source checkout that holds this module, when it carries the host catalog (null in a compiled binary). */
export function sourceCheckout(from = import.meta.dir): string | null {
  for (let dir = from, up = dirname(dir); dir !== up; dir = up, up = dirname(dir))
    if (existsSync(join(dir, "infra", "config", "host", "catalog.json"))) return dir;
  return null;
}

/** `$YOLO_ROOT`, else the source checkout running this code, else `$HOME/src/aphrody` (`%USERPROFILE%\src\aphrody`). */
export function yoloRoot(
  env: Record<string, string | undefined> = process.env,
  checkout: string | null = sourceCheckout(),
): string {
  return (
    env.BUN_OS_ROOT ||
    env.APHRODY_WORKSPACE_ROOT ||
    checkout ||
    env.YOLO_ROOT ||
    join(env.HOME || env.USERPROFILE || homedir(), "src", "aphrody")
  );
}
export const hostRoot = (env?: Record<string, string | undefined>) => join(yoloRoot(env), "infra", "config", "host");

/** Keep repository paths distinct from the migrated tools/config directory. */
export function hostRepositoryRoot(root = hostRoot()): string {
  const parent = resolve(root, "..", "..");
  if (basename(parent) === "infra") return dirname(parent);
  // A legacy repository named tools still owns its own Git directory or worktree file.
  if (basename(parent) !== "tools" || existsSync(join(parent, ".git"))) return parent;
  return dirname(parent);
}

export function loadCatalog(root = hostRoot()): HostCatalog {
  return JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));
}

/** Flat unit text: the unit file plus its drop-in directives inserted at the head of `[Service]`. */
export function composeUnit(name: string, root = hostRoot()): string {
  const entry = loadCatalog(root).units.find(u => u.unit === name || u.service === name);
  if (!entry) throw new Error(`unknown unit: ${name}`);
  const text = readFileSync(join(root, entry.path), "utf8");
  if (!entry.dropIns.length) return text;
  const body = entry.dropIns.flatMap(d =>
    readFileSync(join(root, "systemd/shared", `${d}.conf`), "utf8")
      .split("\n")
      .filter(l => l.trim() && !l.startsWith("#") && l.trim() !== "[Service]"),
  );
  const at = text.indexOf("[Service]\n");
  if (at < 0) throw new Error(`${entry.unit}: no [Service] section`);
  const cut = at + "[Service]\n".length;
  return `${text.slice(0, cut)}${body.join("\n")}\n${text.slice(cut)}`;
}

/** Inline `include snippets/NAME.inc;` so a concatenated site bundle stays self-contained. */
export function composeNginx(text: string, root = hostRoot()): string {
  return text.replace(/^([ \t]*)include snippets\/([\w.-]+);[ \t]*$/gm, (_m, indent, file) =>
    readFileSync(join(root, "nginx/snippets", file), "utf8")
      .split("\n")
      .filter(l => l.trim() && !l.startsWith("#"))
      .map(l => `${indent}${l}`)
      .join("\n"),
  );
}

/** Consistency problems between catalog and tree (empty means consistent). */
export function checkCatalog(root = hostRoot()): string[] {
  const c = loadCatalog(root);
  const problems: string[] = [];
  const listed = new Set<string>();
  for (const u of c.units) {
    listed.add(u.path);
    if (!existsSync(join(root, u.path))) problems.push(`missing unit file: ${u.path}`);
    for (const d of u.dropIns)
      if (!existsSync(join(root, "systemd/shared", `${d}.conf`))) problems.push(`${u.unit}: unknown drop-in ${d}`);
    if (basename(u.path) !== u.unit) problems.push(`${u.unit}: path/unit mismatch`);
  }
  for (const n of c.nginx) {
    listed.add(n.file);
    if (!existsSync(join(root, n.file))) problems.push(`missing nginx file: ${n.file}`);
  }
  if (c.inventory) {
    for (const f of c.inventory.files)
      if (!existsSync(join(root, c.inventory.dir, f))) problems.push(`missing inventory file: ${c.inventory.dir}/${f}`);
    if (!existsSync(join(root, c.inventory.toolchain)))
      problems.push(`missing toolchain manifest: ${c.inventory.toolchain}`);
    if (existsSync(join(root, c.inventory.dir)))
      for (const f of readdirSync(join(root, c.inventory.dir)))
        if (!c.inventory.files.includes(f)) problems.push(`unlisted inventory file: ${f}`);
  }
  for (const dir of ["aphrody"])
    for (const f of readdirSync(join(root, "systemd", dir)))
      if (f.endsWith(".service") || f.endsWith(".timer"))
        if (!listed.has(`systemd/${dir}/${f}`)) problems.push(`unlisted unit: systemd/${dir}/${f}`);
  if (c.wireguard) problems.push(...tunnelProblems(root, c.wireguard.declaration));
  if (c.accounts)
    problems.push(
      ...accountProblems(root, c.accounts, c.wireguard ? loadTunnel(root, c.wireguard.declaration) : undefined),
    );
  for (const f of readdirSync(join(root, "systemd/shared")))
    if (f.endsWith(".conf") && !c.dropIns.files.includes(f)) problems.push(`unlisted drop-in: ${f}`);
  return problems;
}
