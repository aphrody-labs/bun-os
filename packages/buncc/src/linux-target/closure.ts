/**
 * Desktop closure files (factory/linux-desktop/closure-*.json): pinned upstream sources with full SHAs,
 * their build graph and the Arch packages that make up the Linux sysroot. Pure logic, no I/O except `loadClosures`.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type BuildSystem = "meson" | "cmake";

export interface SourcePin {
  id: string;
  /** Git remote the pin was resolved from. */
  url: string;
  tag: string;
  /** Full 40-hex commit SHA of the tag (peeled). */
  sha: string;
  /** Commit date (ISO 8601). */
  date: string;
  build: BuildSystem;
  /** Source components that must be built and installed into the sysroot first. */
  needs: string[];
  /** Extra configure options (meson `-Dk=v`, cmake `-DK=V`) for a headless cross build. */
  options: string[];
  /** `dependency()` / `find_package()` names read from the pinned build files; informational oracle. */
  declared?: string[];
  /** Why this component cannot be cross-built without running target code, when that is so. */
  hostRun?: string[];
}

export interface SysrootPackage {
  name: string;
  version: string;
  repo: string;
  sha256: string;
  csize: number;
  isize: number;
}

export interface Closure {
  schemaVersion: 1;
  kind: "linux-desktop-closure";
  id: string;
  resolvedAt: string;
  release: Record<string, string>;
  sources: SourcePin[];
  /** Arch packages (name or provides key) the sysroot is the dependency closure of. */
  sysrootRoots: string[];
  sysrootExclude: string[];
  sysroot: { packages: SysrootPackage[]; unresolved: string[]; csize: number; isize: number };
  /** Other closures whose sources and sysroot this one builds on. */
  extends?: string[];
}

const SHA = /^[0-9a-f]{40}$/;

export function closureProblems(c: Closure): string[] {
  const p: string[] = [];
  const ids = new Set<string>();
  for (const s of c.sources) {
    if (ids.has(s.id)) p.push(`duplicate source ${s.id}`);
    ids.add(s.id);
    if (!SHA.test(s.sha)) p.push(`${s.id}: sha is not a full 40-hex commit`);
    if (!s.tag) p.push(`${s.id}: missing tag`);
    if (Number.isNaN(Date.parse(s.date))) p.push(`${s.id}: bad date ${s.date}`);
    if (s.build !== "meson" && s.build !== "cmake") p.push(`${s.id}: unknown build system ${s.build}`);
  }
  for (const s of c.sources)
    for (const n of s.needs) if (!ids.has(n) && !c.extends?.length) p.push(`${s.id}: needs unknown source ${n}`);
  const order = buildOrder(c.sources, c.sources.map(s => s.id));
  if (order.cycle.length) p.push(`dependency cycle: ${order.cycle.join(" -> ")}`);
  const names = new Set(c.sysroot.packages.map(x => x.name));
  if (names.size !== c.sysroot.packages.length) p.push("duplicate sysroot package");
  for (const x of c.sysroot.packages) if (!/^[0-9a-f]{64}$/.test(x.sha256)) p.push(`sysroot ${x.name}: bad sha256`);
  return p;
}

/**
 * Sources to build for `targets`, dependencies first (Kahn, ties broken by id so the order is deterministic).
 * `needs` that name no source of this list are treated as provided (by the sysroot or another closure).
 */
export function buildOrder(
  sources: Pick<SourcePin, "id" | "needs">[],
  targets: string[],
): { order: string[]; cycle: string[] } {
  const byId = new Map(sources.map(s => [s.id, s]));
  const want = new Set<string>();
  const visit = (id: string) => {
    if (want.has(id) || !byId.has(id)) return;
    want.add(id);
    for (const n of byId.get(id)!.needs) visit(n);
  };
  targets.forEach(visit);
  const indeg = new Map<string, number>();
  for (const id of want) indeg.set(id, byId.get(id)!.needs.filter(n => want.has(n)).length);
  const order: string[] = [];
  const ready = [...want].filter(id => indeg.get(id) === 0).sort();
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const other of [...want].sort())
      if (byId.get(other)!.needs.includes(id)) {
        const d = indeg.get(other)! - 1;
        indeg.set(other, d);
        if (d === 0) {
          ready.push(other);
          ready.sort();
        }
      }
  }
  const cycle = order.length === want.size ? [] : [...want].filter(id => !order.includes(id)).sort();
  return { order, cycle };
}

export function loadClosures(dir: string): Map<string, Closure> {
  const out = new Map<string, Closure>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter(f => /^closure-.*\.json$/.test(f)).sort()) {
    const c = JSON.parse(readFileSync(join(dir, f), "utf8")) as Closure;
    out.set(c.id, c);
  }
  return out;
}

export interface Resolved {
  closure: Closure;
  source: SourcePin;
  /** Everything to build, dependencies first, across extended closures. */
  order: Array<{ closure: string; source: SourcePin }>;
}

/** Finds `target` (a source id) in the closures and expands its build order across `extends`. */
export function resolveTarget(closures: Map<string, Closure>, target: string): Resolved | undefined {
  for (const closure of closures.values()) {
    const source = closure.sources.find(s => s.id === target);
    if (!source) continue;
    const all: Array<{ closure: string; source: SourcePin }> = [];
    const seen = new Set<string>();
    const gather = (c: Closure) => {
      if (seen.has(c.id)) return;
      seen.add(c.id);
      for (const e of c.extends ?? []) {
        const parent = closures.get(e);
        if (parent) gather(parent);
      }
      for (const s of c.sources) all.push({ closure: c.id, source: s });
    };
    gather(closure);
    const { order } = buildOrder(
      all.map(a => a.source),
      [target],
    );
    return {
      closure,
      source,
      order: order.map(id => all.find(a => a.source.id === id)!),
    };
  }
  return undefined;
}

/** Union of sysroot packages for a closure and everything it extends (name-deduplicated, sorted). */
export function sysrootPackages(closures: Map<string, Closure>, id: string): SysrootPackage[] {
  const seen = new Set<string>();
  const byName = new Map<string, SysrootPackage>();
  const walk = (c?: Closure) => {
    if (!c || seen.has(c.id)) return;
    seen.add(c.id);
    (c.extends ?? []).forEach(e => walk(closures.get(e)));
    for (const p of c.sysroot.packages) byName.set(p.name, p);
  };
  walk(closures.get(id));
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
