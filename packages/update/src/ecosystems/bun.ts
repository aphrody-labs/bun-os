// SPDX-License-Identifier: Apache-2.0
/**
 * Bun / npm ecosystem module: one structured, documented, automated bump of the Bun runtime pin, the Tauri JS
 * packages, the root catalog and every first-party manifest. Doc: docs/operations/infra/update/BUN.md.
 *
 *   status    runtime installed vs pinned vs latest, direct dependencies behind latest, overrides, release-age
 *             excludes in force, npm advisories that are not held, holds
 *   plan      what `apply` would do, row by row (in-range, majors, held, age-gated)
 *   apply     runtime pin (tools), Tauri family (tauri sync), `bun update -r`, then the majors named by
 *             `--majors a,b` (a family member pulls its siblings), then a verify pass; writes a rollback snapshot
 *   verify    bun:check, monorepo:layout, workspace tests, typecheck of the packages whose resolved deps changed
 *   rollback  restore the manifests and bun.lock from the newest snapshot under target/update/bun/
 *
 * Reuses ../tools.ts (runtime pin), ../tauri/sync.ts (Tauri family), ../deps/inventory.ts (OSV, pool, bun.lock),
 * ../deps/sync.ts (version order) and the workspace manifest listing. Report-only unless `apply`.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Ctx } from "../context.ts";
import { cmpVersion } from "../deps/sync.ts";
import { osv, parseBunLock, pool, type Dep } from "../deps/inventory.ts";
import { plan as toolsPlan, runTools, type ToolRow } from "../tools.ts";
import { parseSemver, pickEligible, runTauriSync } from "../tauri/sync.ts";
import { runSources } from "../sources/drift.ts";
import { firstPartyManifests } from "../manifests.ts";

// ---------------------------------------------------------------- types

export const DEP_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"] as const;
export type DepSection = (typeof DEP_SECTIONS)[number];
export type Manifest = Record<string, any>;

/** One direct dependency: a catalog entry or a literal range in a manifest, deduplicated by name and spec. */
export type Direct = { name: string; spec: string; where: string[] };
export type SpecKind = "workspace" | "file" | "link" | "git" | "url" | "alias" | "catalog" | "tag" | "version";
export type BumpKind = "none" | "ahead" | "patch" | "minor" | "major" | "pre";

export type Row = Direct & {
  base?: string;
  latest?: string;
  deprecated?: string;
  kind: BumpKind;
  /** The latest release satisfies the declared range: `bun update -r` moves it, no spec edit. */
  inRange: boolean;
  owner?: "tauri" | "pins";
  hold?: Hold;
  /** Newest release old enough for `minimumReleaseAge`, when the latest is too recent to install. */
  eligible?: string;
  ageGated?: boolean;
};

/** A bump that policy refuses: stay at `maxMajor` (or at `maxVersion`) until the blocker moves. */
export type Hold = {
  name: string;
  maxMajor?: number;
  maxVersion?: string;
  reason: string;
  since?: string;
};
export type Holds = { schemaVersion: number; holds: Hold[] };
export type AdvisoryHold = { ecosystem: string; name: string; reason: string };

export type Latest = { version?: string; deprecated?: string };
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type ReleaseAge = { seconds: number; excludes: string[] };

export const HOLDS_FILE = "tools/config/deps/bun-holds.json";
export const ADVISORY_FILE = "tools/config/deps/advisory-holds.json";
export const SNAPSHOT_DIR = "target/update/bun";
/** Tools whose version lives in package.json / the Bun catalog and is pinned by `tools/config/update/pins.json`. */
export const RUNTIME_TOOLS = ["bun", "typescript", "oxlint", "oxfmt"];
/** Packages owned by `tauri sync` (its own gate, mirrors and release-age rules): never bumped here. */
export const TAURI_OWNED = /^@tauri-apps\//;
/** Packages whose version `tools/config/update/pins.json` rewrites everywhere (runtime and toolchain pins): moved by `tools --apply`. */
export const PIN_OWNED = new Set(["bun-types", "@types/bun", "typescript", "oxlint", "oxfmt"]);

// ---------------------------------------------------------------- specs

export function specKind(spec: string): SpecKind {
  if (spec.startsWith("workspace:")) return "workspace";
  if (spec.startsWith("catalog:")) return "catalog";
  if (spec.startsWith("file:")) return "file";
  if (spec.startsWith("link:")) return "link";
  if (spec.startsWith("npm:")) return "alias";
  if (/^(git|github|git\+\w+|gitlab|bitbucket):/.test(spec) || /^[\w.-]+\/[\w.-]+(#.*)?$/.test(spec)) return "git";
  if (/^https?:/.test(spec)) return "url";
  if (/^[\^~>=<v\d*xX\s|.-]/.test(spec) && /\d|[*xX]/.test(spec)) return "version";
  return "tag"; // latest, next, canary, ...
}

const numericOrZero = (s: string | undefined) => (s && /^\d+$/.test(s) ? s : "0");

/** Lowest bound of the highest alternative of a range (`^1.2.3`, `~1.2`, `>=1 <2 || ^3.1.0`); undefined when open. */
export function specBase(spec: string): string | undefined {
  const alt =
    spec
      .split("||")
      .map(a => a.trim())
      .findLast(Boolean) ?? "";
  const m = /(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(-[0-9A-Za-z.-]+)?/.exec(alt);
  if (!m) return undefined;
  return `${m[1]}.${numericOrZero(m[2])}.${numericOrZero(m[3])}${m[4] ?? ""}`;
}

/** Same range operator, new version: `^1.2.3` + `2.0.0` -> `^2.0.0`; exact stays exact; a union collapses to the new floor. */
export function rewriteSpec(spec: string, version: string): string {
  if (spec.includes("||") || /\s/.test(spec.trim())) return `^${version}`;
  const op = /^([\^~]|>=|>|<=|<|=)?\s*v?/.exec(spec)?.[1] ?? "";
  if (op === "<" || op === "<=") return `^${version}`;
  return `${op === "=" ? "" : op}${version}`;
}

export function bumpKind(base: string | undefined, latest: string | undefined): BumpKind {
  if (!base || !latest) return "none";
  const a = parseSemver(base);
  const b = parseSemver(latest);
  if (!a || !b) return "none";
  const order = cmpVersion(base, latest);
  if (order === 0) return "none";
  if (order > 0) return "ahead";
  if (a.major !== b.major) return "major";
  if (a.major === 0 && a.minor !== b.minor) return "major"; // 0.x minors are breaking by semver
  if (a.minor !== b.minor) return "minor";
  if (a.patch !== b.patch) return "patch";
  return "pre";
}

/** Bun.semver treats an unparsable range as matching everything; only real version ranges are evaluated. */
export function satisfies(version: string, spec: string): boolean {
  if (specKind(spec) !== "version") return false;
  try {
    return Bun.semver.satisfies(version, spec);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- manifests

/** Root `workspaces.catalog` plus every named catalog, flattened name -> spec (named ones keep the first spec seen). */
export function catalogEntries(root: Manifest): Record<string, string> {
  const out: Record<string, string> = {
    ...(root.workspaces?.catalog ?? root.catalog),
  };
  for (const named of Object.values<Record<string, string>>(root.workspaces?.catalogs ?? root.catalogs ?? {})) {
    for (const [n, s] of Object.entries(named)) out[n] ??= s;
  }
  return out;
}

/** name -> declared spec of one manifest with `catalog:` references resolved through the root catalog. */
export function resolvedDeps(manifest: Manifest, root: Manifest): Map<string, string> {
  const catalog = root.workspaces?.catalog ?? root.catalog ?? {};
  const catalogs: Record<string, Record<string, string>> = root.workspaces?.catalogs ?? root.catalogs ?? {};
  const out = new Map<string, string>();
  for (const section of DEP_SECTIONS) {
    for (const [name, spec] of Object.entries<string>(manifest[section] ?? {})) {
      if (spec === "catalog:" || spec === "catalog:default") out.set(name, catalog[name] ?? spec);
      else if (spec.startsWith("catalog:")) out.set(name, catalogs[spec.slice(8)]?.[name] ?? spec);
      else out.set(name, spec);
    }
  }
  return out;
}

/** Direct dependencies of the whole workspace: catalog entries first, then literal ranges of each manifest. */
export function collectDirect(root: Manifest, manifests: Record<string, Manifest>): Direct[] {
  const map = new Map<string, Direct>();
  const add = (name: string, spec: string, where: string) => {
    const k = `${name}\u0000${spec}`;
    const d = map.get(k) ?? { name, spec, where: [] };
    if (!d.where.includes(where)) d.where.push(where);
    map.set(k, d);
  };
  for (const [name, spec] of Object.entries(catalogEntries(root))) add(name, spec, "catalog");
  for (const [path, m] of Object.entries(manifests)) {
    for (const section of DEP_SECTIONS) {
      for (const [name, spec] of Object.entries<string>(m[section] ?? {})) {
        if (specKind(spec) === "catalog") continue; // already counted through the catalog entry
        add(name, spec, path);
      }
    }
  }
  return [...map.values()].toSorted((a, b) => a.name.localeCompare(b.name) || a.spec.localeCompare(b.spec));
}

/** Manifests whose resolved dependency specs differ between two states (catalog edits propagate to their users). */
export function touchedManifests(
  before: { root: Manifest; manifests: Record<string, Manifest> },
  after: { root: Manifest; manifests: Record<string, Manifest> },
): string[] {
  const out: string[] = [];
  for (const [path, m] of Object.entries(after.manifests)) {
    const a = resolvedDeps(m, after.root);
    const b = before.manifests[path] ? resolvedDeps(before.manifests[path]!, before.root) : new Map<string, string>();
    const changed = a.size !== b.size || [...a].some(([n, s]) => b.get(n) !== s);
    if (changed) out.push(path);
  }
  return out.toSorted();
}

// ---------------------------------------------------------------- config

export function parseReleaseAge(bunfigText: string): ReleaseAge {
  const t = Bun.TOML.parse(bunfigText) as {
    install?: {
      minimumReleaseAge?: number;
      minimumReleaseAgeExcludes?: string[];
    };
  };
  return {
    seconds: t.install?.minimumReleaseAge ?? 0,
    excludes: t.install?.minimumReleaseAgeExcludes ?? [],
  };
}

export function isExcluded(name: string, age: ReleaseAge): boolean {
  return age.excludes.includes(name);
}

export function parseHolds(text: string): Holds {
  const j = JSON.parse(text) as Partial<Holds>;
  return { schemaVersion: j.schemaVersion ?? 1, holds: j.holds ?? [] };
}

/** Hold that applies to this row: a release in a major above `maxMajor`, or above `maxVersion`, is refused. */
export function holdFor(holds: Hold[], name: string, latest: string | undefined): Hold | undefined {
  const major = latest ? parseSemver(latest)?.major : undefined;
  if (!latest || major === undefined) return undefined;
  return holds.find(
    h =>
      h.name === name &&
      ((h.maxMajor !== undefined && major > h.maxMajor) ||
        (h.maxVersion !== undefined && cmpVersion(latest, h.maxVersion) > 0)),
  );
}

export function advisoryHeld(holds: AdvisoryHold[], name: string): AdvisoryHold | undefined {
  return holds.find(h => h.ecosystem === "npm" && h.name === name);
}

/** Packages that must move together (peer or release-train coupling); a named member pulls its behind siblings. */
export const FAMILIES: RegExp[][] = [
  [/^react$/, /^react-dom$/, /^@types\/react$/, /^@types\/react-dom$/],
  [/^next$/, /^@next\//, /^eslint-config-next$/],
  [/^tailwindcss$/, /^@tailwindcss\//],
  [/^@lexical\//, /^lexical$/],
  [/^@tiptap\//],
  [/^@radix-ui\//, /^radix-ui$/],
  [/^three$/, /^@types\/three$/],
  [/^@better-auth\//, /^better-auth$/],
  [/^@sentry\//],
  [/^typescript$/, /^@typescript\/native-preview$/],
  [/^vitest$/, /^@vitest\//],
  [/^@colyseus\//],
  [/^@ai-sdk\//, /^ai$/],
  [/^graphql$/, /^graphql-scalars$/, /^graphql-yoga$/, /^@graphql-yoga\//, /^@envelop\//],
];

export function familyOf(name: string): RegExp[] | undefined {
  return FAMILIES.find(f => f.some(re => re.test(name)));
}

/** Names requested through `--majors`, plus the behind-by-major siblings of their family. */
export function expandMajors(requested: string[], rows: Row[]): string[] {
  const out = new Set(requested);
  for (const name of requested) {
    const fam = familyOf(name);
    if (!fam) continue;
    for (const r of rows) if (r.kind === "major" && !r.inRange && fam.some(re => re.test(r.name))) out.add(r.name);
  }
  return [...out].toSorted();
}

// ---------------------------------------------------------------- rows

export type RowInput = {
  directs: Direct[];
  latest: Map<string, Latest>;
  holds: Hold[];
  age?: ReleaseAge;
  /** version -> ISO time, only fetched for rows that are behind (see `eligibleVersion`). */
  times?: Map<string, Record<string, string>>;
  now?: number;
};

/**
 * Newest release inside the major of `latest` that is older than `minimumReleaseAge`. Prereleases are ignored
 * unless the latest itself is one (a canary can never be the answer for a stable latest).
 */
export function eligibleVersion(
  times: Record<string, string> | undefined,
  latest: string,
  age: ReleaseAge,
  name: string,
  now: number,
): { eligible?: string; ageGated: boolean } {
  if (!times || isExcluded(name, age) || age.seconds <= 0) return { eligible: latest, ageGated: false };
  const line = parseSemver(latest);
  if (!line) return { eligible: latest, ageGated: false };
  const candidates = line.pre.length
    ? times
    : Object.fromEntries(Object.entries(times).filter(([v]) => (parseSemver(v)?.pre.length ?? 1) === 0));
  const { eligible } = pickEligible(candidates, line.major, now, age.seconds);
  return { eligible: eligible ?? undefined, ageGated: eligible !== latest };
}

export function buildRows(input: RowInput): Row[] {
  const now = input.now ?? Date.now();
  const age = input.age ?? { seconds: 0, excludes: [] };
  const rows: Row[] = [];
  for (const d of input.directs) {
    if (specKind(d.spec) !== "version") continue;
    const info = input.latest.get(d.name) ?? {};
    const base = specBase(d.spec);
    const latest = info.version;
    const kind = bumpKind(base, latest);
    const row: Row = {
      ...d,
      base,
      latest,
      deprecated: info.deprecated,
      kind,
      inRange: !!latest && satisfies(latest, d.spec),
    };
    if (TAURI_OWNED.test(d.name)) row.owner = "tauri";
    else if (PIN_OWNED.has(d.name)) row.owner = "pins";
    row.hold = holdFor(input.holds, d.name, latest);
    if (latest && kind !== "none" && kind !== "ahead") {
      const e = eligibleVersion(input.times?.get(d.name), latest, age, d.name, now);
      row.eligible = e.eligible;
      row.ageGated = e.ageGated;
    }
    rows.push(row);
  }
  return rows;
}

/** Rows that still need a decision: behind latest, not owned by tauri sync or the pin manifest. */
export const behind = (rows: Row[]) => rows.filter(r => r.kind !== "none" && r.kind !== "ahead" && !r.owner);

/** Version `apply` would install: the release-age-eligible one, else the latest. */
export const targetOf = (r: Row): string | undefined => (r.ageGated ? r.eligible : r.latest);

export type Plan = {
  /** A newer release inside the declared range: `bun update -r` moves it. */
  inRange: Row[];
  /** Exact pin (or range) behind within the same major: `apply` rewrites the spec. */
  pinned: Row[];
  /** A new major (or a 0.x minor): needs `--majors` after reading the release notes. */
  majors: Row[];
  /** Refused by a hold in tools/config/deps/bun-holds.json. */
  held: Row[];
  /** Newer release exists but is younger than `minimumReleaseAge`: nothing installable yet. */
  waiting: Row[];
};

/** `waiting` rows are excluded from the other buckets because nothing newer can be installed today. */
export function planRows(rows: Row[]): Plan {
  const out: Plan = {
    inRange: [],
    pinned: [],
    majors: [],
    held: [],
    waiting: [],
  };
  for (const r of behind(rows)) {
    const t = targetOf(r);
    if (r.hold) out.held.push(r);
    else if (!t || cmpVersion(t, r.base ?? "0.0.0") <= 0) out.waiting.push(r);
    else if (satisfies(t, r.spec)) out.inRange.push(r);
    else if (r.kind === "major") out.majors.push(r);
    else out.pinned.push(r);
  }
  return out;
}

// ---------------------------------------------------------------- spec edits

export type Edit = { file: string; name: string; from: string; to: string };

/** Edits that move the named packages (majors or pinned): the catalog entry when the name is catalogued, else each literal range. */
export function specEdits(
  rows: Row[],
  names: string[],
  target: (r: Row) => string | undefined,
): { edits: Edit[]; errors: string[] } {
  const edits: Edit[] = [];
  const errors: string[] = [];
  for (const name of names) {
    const mine = rows.filter(r => r.name === name && !r.owner);
    if (!mine.length) {
      errors.push(`${name}: not a direct dependency`);
      continue;
    }
    for (const r of mine) {
      if (r.hold) {
        errors.push(`${name}: held (${r.hold.reason})`);
        continue;
      }
      const v = target(r);
      if (!v) {
        errors.push(`${name}: no release old enough for minimumReleaseAge`);
        continue;
      }
      if (cmpVersion(v, r.base ?? "0.0.0") <= 0) continue;
      const to = rewriteSpec(r.spec, v);
      for (const file of r.where)
        edits.push({
          file: file === "catalog" ? "package.json" : file,
          name,
          from: r.spec,
          to,
        });
    }
  }
  return { edits, errors };
}

const escapeForPattern = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replace `"name": "from"` by `"name": "to"` in JSON text, keeping the formatting; returns the new text and the count. */
export function applyEdit(text: string, name: string, from: string, to: string): { text: string; count: number } {
  const re = new RegExp(`("${escapeForPattern(name)}"\\s*:\\s*")${escapeForPattern(from)}(")`, "g");
  let count = 0;
  const out = text.replace(re, (_m, a: string, b: string) => {
    count++;
    return `${a}${to}${b}`;
  });
  return { text: out, count };
}

// ---------------------------------------------------------------- network (injectable)

const UA = {
  "user-agent": "aphrody-bun-update (contact@aphrody.com)",
  accept: "application/json",
};
const noSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** GET with exponential backoff on 429, 5xx and network errors; honours Retry-After. 404 is returned as is. */
export async function fetchWithBackoff(
  url: string,
  opts: {
    fetcher?: Fetcher;
    attempts?: number;
    baseMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<Response | undefined> {
  const f = opts.fetcher ?? ((u, i) => fetch(u, i));
  const sleep = opts.sleep ?? noSleep;
  const attempts = opts.attempts ?? 5;
  const base = opts.baseMs ?? 1000;
  let res: Response | undefined;
  for (let i = 0; i < attempts; i++) {
    // oxlint-disable-next-line no-await-in-loop -- relances séquentielles avec backoff : la tentative suivante dépend de la précédente
    res = await f(url, {
      headers: UA,
      signal: AbortSignal.timeout(30_000),
    }).catch(() => undefined);
    if (res && res.status !== 429 && res.status < 500) return res;
    if (i === attempts - 1) break;
    const retry = Number(res?.headers.get("retry-after"));
    // oxlint-disable-next-line no-await-in-loop -- attente de Retry-After entre deux relances séquentielles
    await sleep(Math.min(60_000, Number.isFinite(retry) && retry > 0 ? retry * 1000 : base * 2 ** i));
  }
  return res && res.ok ? res : undefined;
}

export const npmUrl = (name: string, suffix = "") => `https://registry.npmjs.org/${name.replace("/", "%2f")}${suffix}`;

export async function npmLatest(name: string, opts: Parameters<typeof fetchWithBackoff>[1] = {}): Promise<Latest> {
  const res = await fetchWithBackoff(npmUrl(name, "/latest"), opts);
  if (!res?.ok) return {};
  const d = (await res.json()) as { version?: string; deprecated?: string };
  return { version: d.version, deprecated: d.deprecated };
}

export async function npmTimes(
  name: string,
  opts: Parameters<typeof fetchWithBackoff>[1] = {},
): Promise<Record<string, string> | undefined> {
  const res = await fetchWithBackoff(npmUrl(name), opts);
  if (!res?.ok) return undefined;
  const t = {
    ...((await res.json()) as { time?: Record<string, string> }).time,
  };
  delete t.created;
  delete t.modified;
  return t;
}

// ---------------------------------------------------------------- repository state

export type Repo = { root: Manifest; manifests: Record<string, Manifest> };

export async function loadRepo(c: Ctx): Promise<Repo> {
  const root = JSON.parse(c.read("package.json")) as Manifest;
  const manifests: Record<string, Manifest> = {};
  for (const p of await firstPartyManifests(c.root))
    if (p !== "package.json") manifests[p] = JSON.parse(c.read(p)) as Manifest;
  return { root, manifests };
}

export function loadHolds(c: Ctx): Hold[] {
  return c.exists(HOLDS_FILE) ? parseHolds(c.read(HOLDS_FILE)).holds : [];
}

export function loadAdvisoryHolds(c: Ctx): AdvisoryHold[] {
  return c.jsonFile<{ holds?: AdvisoryHold[] }>(ADVISORY_FILE, {}).holds ?? [];
}

export function loadReleaseAge(c: Ctx): ReleaseAge {
  return c.exists("bunfig.toml") ? parseReleaseAge(c.read("bunfig.toml")) : { seconds: 0, excludes: [] };
}

export type Override = {
  name: string;
  spec: string;
  resolved: string[];
  latest?: string;
  local: boolean;
  missing?: boolean;
};

/** Root `overrides` (and `resolutions`), with what bun.lock resolves and whether a local tarball exists. */
export function describeOverrides(c: Ctx, root: Manifest, lock: Dep[], latest: Map<string, Latest>): Override[] {
  const o: Record<string, string> = { ...root.resolutions, ...root.overrides };
  return Object.entries(o).map(([name, spec]) => {
    const local = specKind(spec) === "file";
    return {
      name,
      spec,
      local,
      resolved: [...new Set(lock.filter(d => d.name === name).map(d => d.version))].toSorted(cmpVersion),
      latest: latest.get(name)?.version,
      missing: local ? !c.exists(spec.replace(/^file:/, "")) : undefined,
    };
  });
}

export type Advisory = {
  name: string;
  version: string;
  ids: string[];
  latest?: string;
  fixable: boolean;
};

/** OSV advisories on resolved npm packages that no hold in advisory-holds.json covers. */
export async function openAdvisories(
  lock: Dep[],
  holds: AdvisoryHold[],
  opts: {
    fetchLatest?: (n: string) => Promise<Latest>;
    query?: typeof osv;
  } = {},
): Promise<{ open: Advisory[]; held: Advisory[] }> {
  const hits = await (opts.query ?? osv)(lock);
  const fetchLatest = opts.fetchLatest ?? ((n: string) => npmLatest(n));
  const rows = [...hits.entries()].map(([k, ids]) => {
    const m = /^npm:(.+)@([^@]+)$/.exec(k)!;
    return { name: m[1]!, version: m[2]!, ids };
  });
  const names = [...new Set(rows.map(r => r.name))];
  const latest = new Map<string, Latest>();
  await pool(names, 6, async n => {
    latest.set(n, await fetchLatest(n));
  });
  const all: Advisory[] = rows.map(r => {
    const l = latest.get(r.name)?.version;
    return Object.assign(r, {
      latest: l,
      fixable: !!l && cmpVersion(r.version, l) < 0,
    });
  });
  return {
    open: all.filter(a => !advisoryHeld(holds, a.name)),
    held: all.filter(a => advisoryHeld(holds, a.name)),
  };
}

// ---------------------------------------------------------------- status

export type Status = {
  runtime: ToolRow[];
  rows: Row[];
  plan: Plan;
  overrides: Override[];
  releaseAge: ReleaseAge;
  holds: Hold[];
  advisories?: { open: Advisory[]; held: Advisory[] };
  manifests: number;
};

export async function collectStatus(c: Ctx, o: { offline?: boolean; advisories?: boolean } = {}): Promise<Status> {
  const repo = await loadRepo(c);
  const directs = collectDirect(repo.root, repo.manifests);
  const age = loadReleaseAge(c);
  const holds = loadHolds(c);
  const lock = c.exists("bun.lock") ? parseBunLock(c.read("bun.lock")) : [];
  const latest = new Map<string, Latest>();
  const times = new Map<string, Record<string, string>>();
  let runtime: ToolRow[] = [];
  if (!o.offline) {
    const names = [...new Set(directs.filter(d => specKind(d.spec) === "version").map(d => d.name))];
    await pool(names, 8, async n => {
      latest.set(n, await npmLatest(n));
    });
    for (const o2 of Object.keys({ ...repo.root.overrides })) if (!latest.has(o2)) latest.set(o2, await npmLatest(o2));
    const probe = buildRows({ directs, latest, holds, age });
    await pool(
      behind(probe).filter(r => !isExcluded(r.name, age)),
      6,
      async r => {
        const t = await npmTimes(r.name);
        if (t) times.set(r.name, t);
      },
    );
    runtime = (await toolsPlan(c)).filter(r => RUNTIME_TOOLS.includes(r.tool));
  }
  const rows = buildRows({ directs, latest, holds, age, times });
  const status: Status = {
    runtime,
    rows,
    plan: planRows(rows),
    releaseAge: age,
    holds,
    manifests: Object.keys(repo.manifests).length + 1,
    overrides: describeOverrides(c, repo.root, lock, latest),
  };
  if (!o.offline && o.advisories !== false) status.advisories = await openAdvisories(lock, loadAdvisoryHolds(c));
  return status;
}

const fmtRow = (r: Row) =>
  `${r.name} ${r.spec} -> ${r.latest}${r.kind === "major" ? " (major)" : ""}${r.eligible && r.ageGated ? ` [age gate: ${r.eligible} installable]` : ""}${r.deprecated ? " [deprecated]" : ""}  <- ${r.where.slice(0, 3).join(", ")}${r.where.length > 3 ? `, +${r.where.length - 3}` : ""}`;

export function renderStatus(s: Status): string[] {
  const out: string[] = [];
  for (const r of s.runtime) {
    const lag = r.latest && r.pinned && cmpVersion(r.pinned, r.latest) < 0;
    out.push(
      `runtime ${r.tool.padEnd(10)} pinned ${r.pinned ?? "?"}  installed ${r.installed ?? "-"}  latest ${r.latest ?? "?"}${lag ? "  <- behind" : ""}${r.installed && r.pinned && r.installed !== r.pinned ? "  <- installed differs from pin" : ""}`,
    );
  }
  out.push(`manifests ${s.manifests} first-party, ${s.rows.length} direct registry ranges`);
  out.push(
    `release-age ${s.releaseAge.seconds}s (${Math.round(s.releaseAge.seconds / 86400)} d), ${s.releaseAge.excludes.length} exclude(s): ${s.releaseAge.excludes.join(", ") || "none"}`,
  );
  for (const o of s.overrides)
    out.push(
      `override ${o.name} ${o.spec.length > 60 ? `${o.spec.slice(0, 57)}...` : o.spec}${o.local ? (o.missing ? "  <- tarball missing" : "  (local tarball)") : `  resolved ${o.resolved.join(", ") || "-"}  latest ${o.latest ?? "?"}`}`,
    );
  const b = behind(s.rows);
  const owned = s.rows.filter(r => r.owner && r.kind !== "none" && r.kind !== "ahead");
  out.push(
    `behind ${b.length} direct (in-range ${s.plan.inRange.length}, pinned ${s.plan.pinned.length}, majors ${s.plan.majors.length}, held ${s.plan.held.length}, waiting for release age ${s.plan.waiting.length})`,
  );
  for (const r of s.plan.inRange) out.push(`  in-range ${fmtRow(r)}`);
  for (const r of s.plan.pinned) out.push(`  pinned   ${fmtRow(r)}`);
  for (const r of s.plan.majors) out.push(`  major    ${fmtRow(r)}`);
  for (const r of s.plan.held) out.push(`  held     ${fmtRow(r)}  - ${r.hold!.reason}`);
  for (const r of s.plan.waiting) out.push(`  waiting  ${fmtRow(r)}`);
  for (const r of owned)
    out.push(
      `  ${r.owner}${" ".repeat(9 - r.owner!.length)}${fmtRow(r)}  (owned by ${r.owner === "tauri" ? "tauri sync" : "tools/config/update/pins.json, tools --apply"})`,
    );
  if (s.advisories) {
    out.push(
      `advisories ${s.advisories.open.length} open, ${s.advisories.held.length} held (tools/config/deps/advisory-holds.json)`,
    );
    for (const a of s.advisories.open)
      out.push(
        `  open ${a.name} ${a.version}: ${a.ids.slice(0, 3).join(", ")}${a.latest ? ` (latest ${a.latest}${a.fixable ? ", bump" : ", no newer release"})` : ""}`,
      );
  }
  return out;
}

// ---------------------------------------------------------------- snapshot / rollback

/** Files a bump may touch: every first-party manifest, the root manifest and bun.lock. */
export async function bumpFiles(c: Ctx): Promise<string[]> {
  return [...new Set(["package.json", "bun.lock", ...(await firstPartyManifests(c.root))])].toSorted();
}

export function snapshot(c: Ctx, files: string[], stamp = new Date().toISOString().replace(/[:.]/g, "-")): string {
  const dir = join(SNAPSHOT_DIR, stamp);
  for (const f of files) {
    if (!c.exists(f)) continue;
    const dst = join(c.root, dir, f);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(join(c.root, f), dst);
  }
  return dir;
}

export function latestSnapshot(c: Ctx): string | undefined {
  const base = join(c.root, SNAPSHOT_DIR);
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .toSorted()
    .at(-1);
  return d ? join(SNAPSHOT_DIR, d) : undefined;
}

export function restoreSnapshot(c: Ctx, dir: string): string[] {
  const restored: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(c.root, dir, rel), {
      withFileTypes: true,
    })) {
      const r = join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else {
        const dst = join(c.root, r);
        if (readFileSync(join(c.root, dir, r), "utf8") !== (existsSync(dst) ? readFileSync(dst, "utf8") : undefined)) {
          mkdirSync(dirname(dst), { recursive: true });
          copyFileSync(join(c.root, dir, r), dst);
          restored.push(r);
        }
      }
    }
  };
  walk("");
  return restored.toSorted();
}

// ---------------------------------------------------------------- verify

export type Step = { name: string; ok: boolean; detail?: string };

function sh(c: Ctx, cmd: string, args: string[]): { ok: boolean; tail: string } {
  const r = c.run(cmd, args);
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n");
  return { ok: r.status === 0, tail: text.slice(-12).join("\n") };
}

/** Manifests changed against `ref` (default HEAD) in their resolved dependency specs. */
export async function touchedSince(c: Ctx, ref = "HEAD"): Promise<string[]> {
  const now = await loadRepo(c);
  const show = (p: string): Manifest | undefined => {
    const r = c.run("git", ["show", `${ref}:${p}`]);
    return r.status === 0 ? (JSON.parse(r.stdout) as Manifest) : undefined;
  };
  const rootBefore = show("package.json") ?? now.root;
  const before: Repo = { root: rootBefore, manifests: {} };
  for (const p of Object.keys(now.manifests)) {
    const m = show(p);
    if (m) before.manifests[p] = m;
  }
  return touchedManifests(before, now);
}

export async function verify(c: Ctx, touched: string[], o: { skipTests?: boolean } = {}): Promise<Step[]> {
  const steps: Step[] = [];
  const run = (name: string, cmd: string, args: string[]) => {
    const r = sh(c, cmd, args);
    steps.push({ name, ok: r.ok, detail: r.ok ? undefined : r.tail });
    console.log(`verify ${r.ok ? "ok  " : "FAIL"} ${name}`);
    if (!r.ok)
      console.log(
        r.tail
          .split("\n")
          .map(l => `         ${l}`)
          .join("\n"),
      );
  };
  run("bun run bun:check", "bun", ["run", "bun:check"]);
  run("bun run monorepo:layout", "bun", ["run", "monorepo:layout"]);
  if (!o.skipTests) run("bun run test (workspace)", "bun", ["run", "test"]);
  const dirs = [...new Set([...touched.map(p => dirname(p)), "packages/infra/update"])]
    .filter(d => d !== ".")
    .toSorted();
  for (const d of dirs) {
    const m = JSON.parse(c.read(join(d, "package.json"))) as Manifest;
    if (!m.scripts?.typecheck) {
      console.log(`verify skip ${d} (no typecheck script)`);
      continue;
    }
    run(`typecheck ${d}`, "bun", ["run", "--cwd", d, "typecheck"]);
  }
  return steps;
}

// ---------------------------------------------------------------- apply

export type Args = {
  sub: string;
  root: string;
  json: boolean;
  offline: boolean;
  majors: string[];
  skipTests: boolean;
  noAdvisories: boolean;
};

export function parseArgs(argv: string[], cwd = process.cwd()): Args {
  const a: Args = {
    sub: "status",
    root: cwd,
    json: false,
    offline: false,
    majors: [],
    skipTests: false,
    noAdvisories: false,
  };
  let subSet = false;
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!;
    if (x === "--root") a.root = argv[++i] ?? "";
    else if (x === "--json") a.json = true;
    else if (x === "--offline") a.offline = true;
    else if (x === "--skip-tests") a.skipTests = true;
    else if (x === "--no-advisories") a.noAdvisories = true;
    else if (x === "--majors" || x.startsWith("--majors=")) {
      const v = x === "--majors" ? argv[++i] : x.slice(9);
      a.majors.push(
        ...(v ?? "")
          .split(",")
          .map(s => s.trim())
          .filter(Boolean),
      );
    } else if (!x.startsWith("-") && !subSet) {
      a.sub = x;
      subSet = true;
    } else if (x !== "--apply") throw new Error(`unknown argument ${x}`);
  }
  if (!a.root) throw new Error("--root requires a path");
  a.root = resolve(a.root);
  return a;
}

export function renderPlan(s: Status, majors: string[]): string[] {
  const out: string[] = [];
  const rt = s.runtime.find(r => r.tool === "bun");
  out.push(
    rt && rt.latest && rt.pinned && cmpVersion(rt.pinned, rt.latest) < 0
      ? `1 runtime   bun ${rt.pinned} -> ${rt.latest} (tools --apply, re-pins 12 targets)`
      : "1 runtime   bun pin is current",
  );
  out.push("2 tauri     `tauri-sync --apply` runs when its check reports drift (own gate and release age)");
  out.push(
    `3 in-range  \`bun update -r\`: ${s.plan.inRange.length} direct range(s) have a newer release inside their range`,
  );
  const want = expandMajors(majors, s.rows);
  out.push(
    `3b pinned   ${s.plan.pinned.length} exact pin(s) behind inside their major: apply rewrites the spec to the newest release old enough for minimumReleaseAge`,
  );
  out.push(
    `4 majors    ${s.plan.majors.length} candidate(s); requested ${want.length ? want.join(", ") : "none (pass --majors a,b after reading the release notes)"}`,
  );
  for (const r of s.plan.majors) out.push(`            ${want.includes(r.name) ? "*" : " "} ${fmtRow(r)}`);
  if (s.plan.held.length) out.push(`5 held      ${s.plan.held.map(r => `${r.name} (${r.hold!.reason})`).join("; ")}`);
  out.push(
    "6 verify    bun:check, monorepo:layout, workspace tests, typecheck of every package whose resolved deps changed",
  );
  out.push("7 fork      the runtime pin follows the oven-sh/bun releases (tools/config/update/pins.json)");
  return out;
}

async function applyBumps(c: Ctx, args: Args): Promise<number> {
  const files = await bumpFiles(c);
  const snap = snapshot(c, files);
  console.log(`snapshot ${snap} (restore with: yolo update bun rollback)`);
  const s = await collectStatus(c, { advisories: false });
  const rt = s.runtime.find(r => r.tool === "bun");
  if (rt?.latest && rt.pinned && cmpVersion(rt.pinned, rt.latest) < 0) await runTools(c, ["tools", "bun"]);
  const tauri = await runTauriSync(["--check", "--root", c.root]);
  if (tauri !== 0) {
    console.log("tauri  drift reported, applying through tauri sync");
    const code = await runTauriSync(["--apply", "--root", c.root]);
    if (code !== 0) {
      console.error("tauri sync failed; nothing else was changed after the snapshot step");
      return code;
    }
  }
  const upd = c.run("bun", ["update", "-r"], { inherit: true });
  if (upd.status !== 0) {
    console.error("bun update -r failed; restore with `yolo update bun rollback`");
    return 1;
  }
  {
    const s2 = await collectStatus(c, { advisories: false });
    // Floors follow the lock: pinned and in-range specs are raised to the installable release, majors only when named.
    const names = [
      ...new Set([...s2.plan.pinned, ...s2.plan.inRange].map(r => r.name).concat(expandMajors(args.majors, s2.rows))),
    ].toSorted();
    const { edits, errors } = specEdits(s2.rows, names, targetOf);
    for (const e of errors) console.error(`bump   skip ${e}`);
    for (const e of edits) {
      const r = applyEdit(c.read(e.file), e.name, e.from, e.to);
      if (r.count) {
        c.write(e.file, r.text);
        console.log(`bump   ${e.name} ${e.from} -> ${e.to} (${e.file})`);
      } else console.error(`bump   ${e.name}: "${e.from}" not found in ${e.file}`);
    }
    if (edits.length && c.run("bun", ["install"], { inherit: true }).status !== 0) {
      console.error("bun install failed after the spec edits; restore with `yolo update bun rollback`");
      return 1;
    }
  }
  const touched = await touchedSince(c);
  console.log(`touched ${touched.length} manifest(s) against HEAD`);
  const steps = await verify(c, touched, { skipTests: args.skipTests });
  return steps.every(x => x.ok) ? 0 : 1;
}

export async function runBun(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error((e as Error).message);
    console.error(
      "usage: bun <status|plan|apply|verify|rollback> [--majors a,b] [--offline] [--json] [--skip-tests] [--root <repo>]",
    );
    return 2;
  }
  const c = new Ctx(args.root, args.sub === "apply", args.json);
  switch (args.sub) {
    case "status": {
      const s = await collectStatus(c, {
        offline: args.offline,
        advisories: !args.noAdvisories,
      });
      console.log(args.json ? JSON.stringify(s, null, 2) : renderStatus(s).join("\n"));
      if (!args.offline && !args.json) await runSources(c, ["forks"]);
      return 0;
    }
    case "plan": {
      const s = await collectStatus(c, {
        offline: args.offline,
        advisories: false,
      });
      console.log(
        args.json
          ? JSON.stringify({ plan: s.plan, majors: expandMajors(args.majors, s.rows) }, null, 2)
          : renderPlan(s, args.majors).join("\n"),
      );
      return 0;
    }
    case "apply":
      return applyBumps(c, args);
    case "verify": {
      const steps = await verify(c, await touchedSince(c), {
        skipTests: args.skipTests,
      });
      return steps.every(x => x.ok) ? 0 : 1;
    }
    case "rollback": {
      const dir = latestSnapshot(c);
      if (!dir) {
        console.error("no snapshot under target/update/bun");
        return 1;
      }
      const files = restoreSnapshot(c, dir);
      console.log(
        `rollback ${dir}: ${files.length} file(s) restored${files.length ? `\n${files.map(f => `  ${f}`).join("\n")}\nrun bun install to realign node_modules` : ""}`,
      );
      return 0;
    }
    default:
      console.error(`unknown subcommand ${args.sub}`);
      return 2;
  }
}

if (import.meta.main) process.exit(await runBun(process.argv.slice(2)));
