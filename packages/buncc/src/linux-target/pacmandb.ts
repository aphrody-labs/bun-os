/**
 * Arch Linux repository database reader: parses `<repo>.db` (gzip tar of `<name>-<ver>/desc`),
 * resolves dependency closures with `provides` (so-names included) and yields download manifests.
 * Reference: pacman repo-add(8), libalpm db format (%FIELD% blocks).
 */
import { untar } from "./tar.ts";

export interface ArchPackage {
  repo: string;
  name: string;
  base: string;
  version: string;
  filename: string;
  sha256: string;
  csize: number;
  isize: number;
  arch: string;
  depends: string[];
  makedepends: string[];
  provides: string[];
}

/** `%FIELD%` blocks of a desc file to a map of line lists. */
export function parseDesc(text: string): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of text.split(/\r?\n/)) {
    const m = /^%([A-Z0-9]+)%$/.exec(line);
    if (m) {
      current = [];
      fields.set(m[1]!, current);
    } else if (line && current) current.push(line);
  }
  return fields;
}

export function packageFromDesc(repo: string, text: string): ArchPackage {
  const f = parseDesc(text);
  const one = (k: string) => f.get(k)?.[0] ?? "";
  return {
    repo,
    name: one("NAME"),
    base: one("BASE") || one("NAME"),
    version: one("VERSION"),
    filename: one("FILENAME"),
    sha256: one("SHA256SUM"),
    csize: Number(one("CSIZE")),
    isize: Number(one("ISIZE")),
    arch: one("ARCH"),
    depends: f.get("DEPENDS") ?? [],
    makedepends: f.get("MAKEDEPENDS") ?? [],
    provides: f.get("PROVIDES") ?? [],
  };
}

/** Parses a `.db` file (gzip-compressed tar). */
export function parseDb(repo: string, gz: Uint8Array): ArchPackage[] {
  const tar = Bun.gunzipSync(gz);
  const dec = new TextDecoder();
  return untar(tar)
    .filter(e => e.path.endsWith("/desc"))
    .map(e => packageFromDesc(repo, dec.decode(e.data)));
}

/** Dependency or provides key without version operator: `glib2>=2.80` -> `glib2`, `libfoo.so=1-64` -> `libfoo.so`. */
export const depKey = (dep: string): string => dep.replace(/\s*(>=|<=|=|<|>).*$/, "").replace(/:.*$/, "");

export class ArchIndex {
  readonly byName = new Map<string, ArchPackage>();
  readonly providers = new Map<string, ArchPackage[]>();
  constructor(packages: ArchPackage[]) {
    for (const p of packages) {
      if (!this.byName.has(p.name)) this.byName.set(p.name, p);
      for (const prov of [p.name, ...p.provides]) {
        const k = depKey(prov);
        const list = this.providers.get(k) ?? [];
        if (!list.includes(p)) list.push(p);
        this.providers.set(k, list);
      }
    }
  }
  /** Package satisfying a dependency string; an exact name wins, then an already-selected provider, then the first one. */
  resolve(dep: string, selected?: Set<string>): ArchPackage | undefined {
    const k = depKey(dep);
    const exact = this.byName.get(k);
    if (exact) return exact;
    const list = this.providers.get(k);
    if (!list?.length) return undefined;
    return list.find(p => selected?.has(p.name)) ?? list[0];
  }
}

export interface ClosureOptions {
  /** Include `makedepends` of the roots only (never of transitive packages). */
  rootMakedepends?: boolean;
  /** Package names (or provides keys) never pulled in. */
  exclude?: Iterable<string>;
}

export interface ArchClosure {
  packages: ArchPackage[];
  /** Dependencies no repository package satisfies. */
  unresolved: string[];
}

/** Breadth-first closure over `depends`; results are sorted by name so manifests are stable. */
export function archClosure(index: ArchIndex, roots: string[], options: ClosureOptions = {}): ArchClosure {
  const exclude = new Set(options.exclude ?? []);
  const selected = new Map<string, ArchPackage>();
  const unresolved = new Set<string>();
  const names = new Set<string>();
  const queue: Array<{ dep: string; root: boolean }> = roots.map(dep => ({ dep, root: true }));
  while (queue.length) {
    const { dep, root } = queue.shift()!;
    const key = depKey(dep);
    if (exclude.has(key)) continue;
    const pkg = index.resolve(dep, names);
    if (!pkg) {
      unresolved.add(key);
      continue;
    }
    if (exclude.has(pkg.name) || selected.has(pkg.name)) continue;
    selected.set(pkg.name, pkg);
    names.add(pkg.name);
    for (const d of pkg.depends) queue.push({ dep: d, root: false });
    if (root && options.rootMakedepends) for (const d of pkg.makedepends) queue.push({ dep: d, root: false });
  }
  return {
    packages: [...selected.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unresolved: [...unresolved].sort(),
  };
}

export const ARCH_MIRROR = "https://geo.mirror.pkgbuild.com";
export const packageUrl = (p: Pick<ArchPackage, "repo" | "filename" | "arch">, mirror = ARCH_MIRROR) =>
  `${mirror}/${p.repo}/os/${p.arch === "any" ? "x86_64" : p.arch}/${p.filename}`;
