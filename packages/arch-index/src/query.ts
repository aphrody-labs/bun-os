// SPDX-License-Identifier: MIT
// Read side of the index: search, info, dependency trees, provider resolution, outdated report, diffs.
import { isTestingRepo, type PackageRow, type Store, type DepKind } from "./store.ts";
import { parseSrcinfo } from "./srcinfo.ts";
import { parseDep, satisfies, vercmp, type DepSpec } from "./version.ts";

export type SearchBy =
  "name" | "provides" | "depends" | "makedepends" | "optdepends" | "desc" | "file" | "maintainer" | "group" | "base";

export interface SearchOptions {
  by?: SearchBy;
  /** "repo" = official only, "aur" = AUR only, default both. */
  source?: "repo" | "aur";
  testing?: boolean;
  limit?: number;
}

/** Shell glob to LIKE: * -> %, ? -> _, everything else literal. */
export function globToLike(pattern: string): string {
  return pattern
    .replace(/[\\%_]/g, c => `\\${c}`)
    .replaceAll("*", "%")
    .replaceAll("?", "_");
}

const PKG_SELECT = `SELECT p.id FROM packages p`;

export function search(store: Store, pattern: string, options: SearchOptions = {}): PackageRow[] {
  const by = options.by ?? "name";
  const limit = options.limit ?? 50;
  const hasGlob = /[*?]/.test(pattern);
  const like = hasGlob ? globToLike(pattern) : null;
  const args: (string | number)[] = [];
  const filters: string[] = [];
  if (options.source) {
    filters.push("p.source = ?");
    args.push(options.source);
  }
  if (!options.testing) filters.push("p.repo NOT LIKE '%-testing' AND p.repo NOT LIKE '%-staging'");
  let sql: string;
  const eq = (col: string) => (like ? `${col} LIKE ? ESCAPE '\\'` : `${col} = ? COLLATE NOCASE`);
  const val = like ?? pattern;
  const contains = `%${globToLike(pattern)}%`;
  switch (by) {
    case "name":
      sql = `${PKG_SELECT} WHERE ${like ? "p.name LIKE ? ESCAPE '\\'" : "(p.name = ? COLLATE NOCASE OR p.name LIKE ? ESCAPE '\\')"}`;
      args.unshift(...(like ? [like] : [pattern, contains]));
      break;
    case "base":
      sql = `${PKG_SELECT} WHERE ${eq("p.base")}`;
      args.unshift(val);
      break;
    case "desc":
      sql = `${PKG_SELECT} WHERE p.description LIKE ? ESCAPE '\\'`;
      args.unshift(like ?? contains);
      break;
    case "maintainer":
      sql = `${PKG_SELECT} WHERE ${eq("p.maintainer")}`;
      args.unshift(val);
      break;
    case "group":
      sql = `${PKG_SELECT} WHERE p.groups LIKE ? ESCAPE '\\'`;
      args.unshift(`%"${globToLike(pattern)}"%`);
      break;
    case "file":
      sql = `${PKG_SELECT} WHERE p.id IN (SELECT pkg_id FROM files WHERE ${like ? "path LIKE ? ESCAPE '\\'" : "path = ? OR path LIKE ? ESCAPE '\\'"})`;
      args.unshift(...(like ? [like] : [pattern, `%/${globToLike(pattern.replace(/^\/+/, ""))}`]));
      break;
    case "provides":
    case "depends":
    case "makedepends":
    case "optdepends": {
      const d = parseDep(pattern);
      sql = `${PKG_SELECT} WHERE p.id IN (SELECT pkg_id FROM deps WHERE kind = ? AND ${like ? "name LIKE ? ESCAPE '\\'" : "name = ?"})`;
      args.unshift(by, like ?? d.name);
      break;
    }
  }
  const where = filters.length ? ` AND ${filters.join(" AND ")}` : "";
  // Official packages first, then exact-name matches, then popularity for the AUR.
  const order = ` ORDER BY (p.source = 'repo') DESC, (p.name = ?) DESC, COALESCE(p.popularity, 0) DESC, p.name LIMIT ?`;
  const ids = store.db.query(sql + where + order).all(...args, pattern, limit) as { id: number }[];
  return ids.map(r => rowById(store, r.id)).filter((r): r is PackageRow => !!r);
}

export function rowById(store: Store, id: number): PackageRow | null {
  const r = store.db.query("SELECT name, repo FROM packages WHERE id = ?").get(id) as {
    name: string;
    repo: string;
  } | null;
  return r ? (store.getPackages(r.name).find(p => p.id === id) ?? null) : null;
}

export interface PackageInfo extends PackageRow {
  depends: DepSpec[];
  makedepends: DepSpec[];
  checkdepends: DepSpec[];
  optdepends: DepSpec[];
  provides: DepSpec[];
  conflicts: DepSpec[];
  replaces: DepSpec[];
  requiredBy: string[];
  files: string[];
  srcinfoVersions: string[];
}

export function info(
  store: Store,
  name: string,
  options: { source?: "repo" | "aur"; repo?: string; testing?: boolean } = {},
): PackageInfo | null {
  const row = store.getPackage(name, options);
  if (!row) return null;
  const deps = store.depsOf(row.id);
  const by = (k: DepKind): DepSpec[] =>
    deps
      .filter(d => d.kind === k)
      .map(d => ({ name: d.name, op: d.op as DepSpec["op"], version: d.ver, description: d.descr }));
  const requiredBy = (
    store.db
      .query(
        `SELECT DISTINCT p.name FROM deps d JOIN packages p ON p.id = d.pkg_id WHERE d.kind IN ('depends') AND d.name = ? AND p.repo NOT LIKE '%-testing' AND p.repo NOT LIKE '%-staging' ORDER BY p.name LIMIT 500`,
      )
      .all(name) as { name: string }[]
  ).map(r => r.name);
  return {
    ...row,
    depends: by("depends"),
    makedepends: by("makedepends"),
    checkdepends: by("checkdepends"),
    optdepends: by("optdepends"),
    provides: by("provides"),
    conflicts: by("conflicts"),
    replaces: by("replaces"),
    requiredBy,
    files: store.filesOf(row.id),
    srcinfoVersions: store.listSrcinfoVersions(row.source === "aur" ? "aur" : "arch", row.base).map(v => v.version),
  };
}

// ---- name resolution --------------------------------------------------------------------------------------------------

export type Resolution =
  | { kind: "package"; package: PackageRow }
  | { kind: "provided"; package: PackageRow; via: string }
  | { kind: "replaced"; package: PackageRow; replaces: string }
  | { kind: "group"; package: PackageRow; group: string; members: number }
  | { kind: "missing" };

/**
 * Resolve a name the way pacman would: exact package first, then a provider, then a package that replaces it.
 * Official repositories win over the AUR. `kind: "missing"` means the name is gone (fail fast in generators).
 */
export function resolveName(
  store: Store,
  spec: string | DepSpec,
  options: { aur?: boolean; testing?: boolean } = {},
): Resolution {
  const dep = typeof spec === "string" ? parseDep(spec) : spec;
  const allowed = (p: PackageRow) =>
    (options.testing || !isTestingRepo(p.repo)) && ((options.aur ?? true) ? true : p.source === "repo");
  const exact = store
    .getPackages(dep.name)
    .filter(allowed)
    .sort((a, b) => Number(b.source === "repo") - Number(a.source === "repo"));
  const hit = exact.find(p => satisfies(p.version, dep.op, dep.version));
  if (hit) return { kind: "package", package: hit };
  const providers = store.db
    .query(
      `SELECT p.id, d.ver AS pv FROM deps d JOIN packages p ON p.id = d.pkg_id WHERE d.kind = 'provides' AND d.name = ? ORDER BY (p.source = 'repo') DESC, p.name`,
    )
    .all(dep.name) as { id: number; pv: string }[];
  for (const pr of providers) {
    const row = rowById(store, pr.id);
    if (!row || !allowed(row)) continue;
    if (!dep.op || satisfies(pr.pv || row.version, dep.op, dep.version))
      return { kind: "provided", package: row, via: dep.name };
  }
  const replacers = store.db
    .query(
      `SELECT p.id FROM deps d JOIN packages p ON p.id = d.pkg_id WHERE d.kind = 'replaces' AND d.name = ? ORDER BY (p.source = 'repo') DESC, p.name`,
    )
    .all(dep.name) as { id: number }[];
  for (const r of replacers) {
    const row = rowById(store, r.id);
    if (row && allowed(row)) return { kind: "replaced", package: row, replaces: dep.name };
  }
  const members = store.db
    .query(
      `SELECT id FROM packages WHERE source = 'repo' AND groups LIKE ? AND repo NOT LIKE '%-testing' AND repo NOT LIKE '%-staging' ORDER BY name`,
    )
    .all(`%"${dep.name}"%`) as { id: number }[];
  if (members.length) {
    const row = rowById(store, members[0]!.id);
    if (row) return { kind: "group", package: row, group: dep.name, members: members.length };
  }
  return { kind: "missing" };
}

// ---- dependency tree --------------------------------------------------------------------------------------------------

export interface DepNode {
  name: string;
  /** The dependency as written ("glibc>=2.40"). */
  spec: string;
  resolved: string | null;
  version: string | null;
  repo: string | null;
  via?: string;
  /** Already expanded elsewhere in the tree (shared or cyclic). */
  seen?: boolean;
  missing?: boolean;
  children: DepNode[];
}

export function depTree(
  store: Store,
  name: string,
  options: { kinds?: DepKind[]; depth?: number; aur?: boolean; testing?: boolean } = {},
): DepNode {
  const kinds = options.kinds ?? ["depends"];
  const maxDepth = options.depth ?? 8;
  const seen = new Set<string>();
  const walk = (spec: string, depth: number): DepNode => {
    const res = resolveName(store, spec, options);
    if (res.kind === "missing")
      return {
        name: parseDep(spec).name,
        spec,
        resolved: null,
        version: null,
        repo: null,
        missing: true,
        children: [],
      };
    const p = res.package;
    const node: DepNode = {
      name: parseDep(spec).name,
      spec,
      resolved: p.name,
      version: p.version,
      repo: p.repo,
      children: [],
    };
    if (res.kind === "provided") node.via = `provides ${res.via}`;
    else if (res.kind === "replaced") node.via = `replaces ${res.replaces}`;
    else if (res.kind === "group") node.via = `group ${res.group} (${res.members} packages)`;
    const key = `${p.repo}/${p.name}`;
    if (seen.has(key)) {
      node.seen = true;
      return node;
    }
    seen.add(key);
    if (depth >= maxDepth) return node;
    for (const d of store.depsOf(p.id).filter(x => kinds.includes(x.kind))) {
      node.children.push(walk(`${d.name}${d.op}${d.ver}`, depth + 1));
    }
    return node;
  };
  return walk(name, 0);
}

export function renderTree(node: DepNode, prefix = "", last = true, root = true): string {
  const label = `${node.spec}${node.resolved && node.resolved !== node.name ? ` -> ${node.resolved}` : ""}${node.version ? ` ${node.version}` : ""}${node.repo ? ` [${node.repo}]` : ""}${node.via ? ` (${node.via})` : ""}${node.seen ? " (*)" : ""}${node.missing ? " (MISSING)" : ""}`;
  const lines = [root ? label : `${prefix}${last ? "└─ " : "├─ "}${label}`];
  const next = root ? "" : prefix + (last ? "   " : "│  ");
  node.children.forEach((c, i) => lines.push(renderTree(c, next, i === node.children.length - 1, false)));
  return lines.join("\n");
}

/** All distinct packages in the closure of a name (pacman -Si style resolution), cycle safe. */
export function closure(
  store: Store,
  names: string[],
  options: { kinds?: DepKind[]; aur?: boolean } = {},
): { packages: PackageRow[]; missing: string[] } {
  const kinds = options.kinds ?? ["depends"];
  const out = new Map<string, PackageRow>();
  const missing = new Set<string>();
  const queue = [...names];
  while (queue.length) {
    const spec = queue.shift()!;
    const res = resolveName(store, spec, options);
    if (res.kind === "missing") {
      missing.add(parseDep(spec).name);
      continue;
    }
    const p = res.package;
    const key = `${p.repo}/${p.name}`;
    if (out.has(key)) continue;
    out.set(key, p);
    for (const d of store.depsOf(p.id).filter(x => kinds.includes(x.kind))) queue.push(`${d.name}${d.op}${d.ver}`);
  }
  return { packages: [...out.values()], missing: [...missing] };
}

// ---- pins: outdated, missing, replaced -------------------------------------------------------------------------------

export interface Pin {
  name: string;
  /** Pinned version; omit for name-only lists (presence check). */
  version?: string;
  /** Where the pin comes from (file path) for the report. */
  origin?: string;
}

export type PinStatus =
  "group" | "current" | "outdated" | "newer" | "missing" | "replaced" | "provided" | "aur" | "flagged" | "orphaned";

export interface PinReport {
  pin: Pin;
  status: PinStatus;
  current?: string;
  repo?: string;
  note?: string;
}

/** Compare pins against the index: outdated, ahead, removed, replaced, provided by another package, AUR state. */
export function checkPins(store: Store, pins: Pin[], options: { aur?: boolean; testing?: boolean } = {}): PinReport[] {
  return pins.map(pin => {
    const res = resolveName(store, pin.name, { aur: options.aur ?? true, testing: options.testing });
    if (res.kind === "missing")
      return { pin, status: "missing" as const, note: "no package, provider or replacement in the index" };
    if (res.kind === "replaced")
      return {
        pin,
        status: "replaced" as const,
        current: res.package.name,
        repo: res.package.repo,
        note: `replaced by ${res.package.name}`,
      };
    if (res.kind === "group")
      return {
        pin,
        status: "group" as const,
        current: res.package.name,
        repo: res.package.repo,
        note: `package group with ${res.members} members`,
      };
    if (res.kind === "provided")
      return {
        pin,
        status: "provided" as const,
        current: res.package.name,
        repo: res.package.repo,
        note: `provided by ${res.package.name}`,
      };
    const p = res.package;
    if (p.source === "aur") {
      const status: PinStatus = p.outOfDate ? "flagged" : !p.maintainer ? "orphaned" : "aur";
      const cmp = pin.version ? vercmp(pin.version, p.version) : 0;
      return {
        pin,
        status: cmp < 0 ? "outdated" : status,
        current: p.version,
        repo: "aur",
        note: p.outOfDate
          ? `flagged out of date ${new Date(p.outOfDate * 1000).toISOString().slice(0, 10)}`
          : !p.maintainer
            ? "orphaned"
            : undefined,
      };
    }
    if (!pin.version) return { pin, status: "current" as const, current: p.version, repo: p.repo };
    const c = vercmp(pin.version, p.version);
    return {
      pin,
      status: c === 0 ? ("current" as const) : c < 0 ? ("outdated" as const) : ("newer" as const),
      current: p.version,
      repo: p.repo,
    };
  });
}

// ---- diff ------------------------------------------------------------------------------------------------------------

/** Line diff (LCS) in unified-ish form; small inputs only (.SRCINFO, PKGBUILD). */
export function lineDiff(a: string, b: string): string[] {
  const x = a.split("\n");
  const y = b.split("\n");
  const n = x.length;
  const m = y.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] = x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push(`-${x[i++]}`);
    else out.push(`+${y[j++]}`);
  }
  while (i < n) out.push(`-${x[i++]}`);
  while (j < m) out.push(`+${y[j++]}`);
  return out;
}

export interface SourceDiff {
  pkgbase: string;
  from: string;
  to: string;
  srcinfo: string[];
  pkgbuild: string[];
  sources: { added: string[]; removed: string[]; checksumChanged: string[] };
}

/** Diff two stored versions of a pkgbase (defaults to the two most recent fetched). */
export function diffSources(
  store: Store,
  source: "arch" | "aur",
  pkgbase: string,
  from?: string,
  to?: string,
): SourceDiff {
  const versions = store.listSrcinfoVersions(source, pkgbase);
  if (!from || !to) {
    if (versions.length < 2)
      throw new Error(
        `Only ${versions.length} stored version(s) of ${pkgbase}; sync sources again after the package updates.`,
      );
    from ??= versions[versions.length - 2]!.version;
    to ??= versions[versions.length - 1]!.version;
  }
  const a = store.getSrcinfoRow(source, pkgbase, from);
  const b = store.getSrcinfoRow(source, pkgbase, to);
  if (!a || !b) throw new Error(`Version ${!a ? from : to} of ${pkgbase} is not stored.`);
  const text = (sha: string | null) => (sha ? (store.getBlob(sha) ?? "") : "");
  const sa = text(a.srcinfo_sha256);
  const sb = text(b.srcinfo_sha256);
  const ea = parseSrcinfo(sa).sources;
  const eb = parseSrcinfo(sb).sources;
  const keyOf = (s: { source: string; arch: string }) => `${s.arch}|${s.source}`;
  const ma = new Map(ea.map(s => [keyOf(s), s]));
  const mb = new Map(eb.map(s => [keyOf(s), s]));
  return {
    pkgbase,
    from,
    to,
    srcinfo: lineDiff(sa, sb).filter(l => l.length > 1),
    pkgbuild: lineDiff(text(a.pkgbuild_sha256), text(b.pkgbuild_sha256)).filter(l => l.length > 1),
    sources: {
      added: [...mb.keys()].filter(k => !ma.has(k)),
      removed: [...ma.keys()].filter(k => !mb.has(k)),
      checksumChanged: [...mb.keys()].filter(
        k => ma.has(k) && JSON.stringify(ma.get(k)!.checksums) !== JSON.stringify(mb.get(k)!.checksums),
      ),
    },
  };
}
