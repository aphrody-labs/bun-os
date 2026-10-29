#!/usr/bin/env bun
/**
 * Resynchronise apps/spacedrive and docs/spacedrive/upstream from a checkout of
 * aphrody-labs/spacedrive (a fork that tracks spacedriveapp/spacedrive).
 *
 *   git clone --depth 1 https://github.com/aphrody-labs/spacedrive.git /tmp/sd
 *   bun scripts/spacedrive/sync.ts /tmp/sd [--check|--patch-only]
 *
 * The upstream tree is copied unchanged (layout, headers, LICENSE, NOTICE). The only edits are in
 * member Cargo.toml files: `workspace = true` entries whose upstream version is not the version the
 * Bun OS root workspace pins are expanded to the upstream requirement, and package-field
 * inheritance (edition, license, repository, rust-version) is made explicit because the root
 * [workspace.package] belongs to Bun OS. See docs/spacedrive/PROVENANCE.md.
 */
import {cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";

const args = process.argv.slice(2);
const src = resolve(args.find(a => !a.startsWith("--")) ?? "");
const check = args.includes("--check");
const root = resolve(import.meta.dir, "../..");
const dest = join(root, "apps/spacedrive");
const docsDest = join(root, "docs/spacedrive/upstream");
if (!existsSync(join(src, "Cargo.toml"))) throw new Error(`not a Spacedrive checkout: ${src}`);

const SKIP = new Set([".git", "node_modules", "target", "dist", ".turbo"]);
const ROOT_ONLY = new Set(["Cargo.toml", "Cargo.lock", "package.json", "bun.lockb", "bun.lock", "docs"]);
const UPSTREAM_STASH = ".upstream";

function copyTree(from: string, to: string, top = false) {
  mkdirSync(to, {recursive: true});
  for (const e of readdirSync(from, {withFileTypes: true})) {
    if (SKIP.has(e.name) || (top && ROOT_ONLY.has(e.name))) continue;
    const a = join(from, e.name), b = join(to, e.name);
    if (e.isDirectory()) copyTree(a, b);
    else cpSync(a, b);
  }
}

/** `[workspace.dependencies]` of a Cargo.toml as name -> raw spec. */
function wsDeps(path: string): Map<string, string> {
  const t = readFileSync(path, "utf8");
  const i = t.indexOf("[workspace.dependencies]");
  const rest = t.slice(i + 24);
  const end = rest.search(/\n\[/);
  const body = end < 0 ? rest : rest.slice(0, end);
  const out = new Map<string, string>();
  let buf = "", key = "";
  for (const line of body.split("\n")) {
    const m = !buf && line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
    if (m) { key = m[1]; buf = m[2]; } else if (buf) buf += "\n" + line;
    else continue;
    const stripped = buf.replace(/#.*$/gm, "").trim();
    const open = (stripped.match(/[{[]/g) ?? []).length, close = (stripped.match(/[}\]]/g) ?? []).length;
    if (open === close) { out.set(key, stripped); buf = ""; }
  }
  return out;
}

const upDeps = wsDeps(join(src, "Cargo.toml"));
const osDeps = wsDeps(join(root, "Cargo.toml"));
// Names the root already pins keep the root's spec only if it is textually the upstream one;
// everything else is expanded in the members so upstream crates build exactly as upstream intends.
const norm = (s: string) => s.replace(/\s+/g, " ");
const expand = new Set([...upDeps.keys()].filter(k => osDeps.has(k) && norm(osDeps.get(k)!) !== norm(upDeps.get(k)!)));

function innerFields(spec: string): string {
  const s = spec.trim();
  if (s.startsWith("{")) return s.slice(1, -1).trim();
  return `version = ${s}`;
}
function mergeFields(a: string, b: string): string {
  // a: upstream workspace fields, b: member's extra fields (features/optional/default-features...)
  const parse = (x: string) => {
    const m = new Map<string, string>();
    let depth = 0, cur = "";
    const parts: string[] = [];
    for (const ch of x) {
      if (ch === "[" || ch === "{") depth++;
      if (ch === "]" || ch === "}") depth--;
      if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    for (const p of parts) { const i = p.indexOf("="); if (i > 0) m.set(p.slice(0, i).trim(), p.slice(i + 1).trim()); }
    return m;
  };
  const A = parse(a), B = parse(b);
  for (const [k, v] of B) {
    if (k === "features" && A.has("features")) {
      const f = (s: string) => s.replace(/^\[|\]$/g, "").split(",").map(x => x.trim()).filter(Boolean);
      A.set(k, `[${[...new Set([...f(A.get(k)!), ...f(v)])].join(", ")}]`);
    } else A.set(k, v);
  }
  return [...A].map(([k, v]) => `${k} = ${v}`).join(", ");
}

const PKG = {
  edition: '"2021"',
  license: '"Apache-2.0"',
  repository: '"https://github.com/spacedriveapp/spacedrive"',
  "rust-version": '"1.95"',
};

function patchCargo(path: string) {
  let t = readFileSync(path, "utf8");
  const before = t;
  for (const [k, v] of Object.entries(PKG)) t = t.replace(new RegExp(`^(${k})\s*\.workspace\s*=\s*true`, "gm"), `$1 = ${v}`);
  t = t.replace(/^([A-Za-z0-9_-]+)\s*\.workspace\s*=\s*true\s*$/gm, (m, name) =>
    expand.has(name) ? `${name} = { ${innerFields(upDeps.get(name)!)} }` : m);
  t = t.replace(/^([A-Za-z0-9_-]+)(\s*)=\s*\{\s*workspace\s*=\s*true\s*(?:,\s*([^}]*))?\}/gm, (m, name, sp, extra) =>
    expand.has(name) ? `${name}${sp}= { ${mergeFields(innerFields(upDeps.get(name)!), (extra ?? "").trim())} }` : m);
  if (t !== before) writeFileSync(path, t);
}

function walk(dir: string, f: (p: string) => void) {
  for (const e of readdirSync(dir, {withFileTypes: true})) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, f); else f(p);
  }
}

if (check) { console.log(JSON.stringify({expand: [...expand], missing: [...upDeps.keys()].filter(k => !osDeps.has(k))}, null, 2)); process.exit(0); }

if (!args.includes("--patch-only")) {
  rmSync(dest, {recursive: true, force: true});
  copyTree(src, dest, true);
  mkdirSync(join(dest, UPSTREAM_STASH), {recursive: true});
  for (const f of ["Cargo.toml", "Cargo.lock", "package.json", "bun.lockb"]) if (existsSync(join(src, f))) cpSync(join(src, f), join(dest, UPSTREAM_STASH, f + ".orig"));
  rmSync(docsDest, {recursive: true, force: true});
  mkdirSync(docsDest, {recursive: true});
  copyTree(join(src, "docs"), docsDest);
  for (const f of ["LICENSE", "NOTICE"]) cpSync(join(src, f), join(root, "docs/spacedrive", f));
}
const catalog: Record<string, string> = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).catalog ?? {};
/** Dependencies the root Bun catalog pins are switched to `catalog:` so one version is installed. */
function patchPackage(path: string) {
  const j = JSON.parse(readFileSync(path, "utf8"));
  let changed = false;
  for (const sect of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const [name, range] of Object.entries<string>(j[sect] ?? {})) {
      if (name in catalog && !String(range).startsWith("workspace:")) { j[sect][name] = "catalog:"; changed = true; }
    }
  }
  if (changed) writeFileSync(path, `${JSON.stringify(j, null, "\t")}\n`);
}
walk(dest, p => {
  if (p.endsWith("Cargo.toml")) patchCargo(p);
  else if (p.endsWith("package.json") && !p.includes(UPSTREAM_STASH) && !p.includes("/mobile/")) patchPackage(p);
});
console.log(`synced ${src} -> apps/spacedrive (${[...expand].length} workspace deps expanded)`);
