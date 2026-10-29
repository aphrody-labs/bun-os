/**
 * Workspace integration graph of the Bun OS monorepo, shared by check-components.ts:
 *   - which Cargo packages and npm packages are workspace members (or covered by an explicit, reasoned exclusion),
 *   - the dependency edges between components (Cargo path/workspace deps, npm workspace deps, manifest `dependsOn`
 *     / `consumedBy` / `edges.consumers`, wiring-file path references for submodules).
 * No build and no network: it reads tracked files only, so it also runs on a checkout without submodules.
 */
import { posix } from "node:path";

export type Excluded = Record<string, string>;
export interface Integration {
  cargo: { excluded: Excluded };
  npm: { excluded: Excluded };
  /** Path prefixes whose submodules/crates are connected through the factory rather than a build file. */
  notes?: string;
}

const sh = async (root: string, ...args: string[]) => {
  const proc = Bun.spawn(args, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [out] = await Promise.all([proc.stdout.text(), proc.exited]);
  return out.replace(/\r/g, "").split("\n").filter(Boolean);
};

const coveredBy = (map: Excluded, dir: string) => Object.keys(map).find(p => dir === p || dir.startsWith(p + "/"));
const underAny = (dir: string, roots: Iterable<string>) => {
  for (const r of roots) if (dir === r || dir.startsWith(r + "/")) return r;
  return undefined;
};

/** Expand `a/*`-style workspace globs against a directory set. */
const matchGlob = (glob: string, dirs: Iterable<string>) => {
  if (!/[*?]/.test(glob)) return [...dirs].filter(d => d === glob);
  const re = new RegExp("^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*") + "$");
  return [...dirs].filter(d => re.test(d));
};

export interface Graph {
  cargoMembers: Set<string>; // explicit members + implicit path-dependency members
  cargoOrphans: string[]; // package dirs neither member nor covered
  cargoExcluded: Map<string, string>; // package dir -> reason (from the map)
  cargoStaleExcludes: string[];
  rootExcludeMissingReason: string[];
  npmMembers: Set<string>;
  npmOrphans: string[];
  npmExcluded: Map<string, string>;
  npmStaleExcludes: string[];
  edges: Map<string, Set<string>>; // module id -> module ids it depends on (derived + manifest)
  derivedEdgeCount: number;
  manifestEdgeCount: number;
  unresolved: string[]; // manifest edge ids that do not resolve
  isolated: string[]; // module ids with neither inbound nor outbound edge
  nodes: number;
}

export async function buildGraph(root: string, manifest: any, integration: Integration): Promise<Graph> {
  const files = await sh(root, "git", "ls-files");
  const gitlinks = new Set((await sh(root, "git", "ls-files", "-s")).filter(l => l.startsWith("160000")).map(l => l.split("\t")[1]));
  const fileSet = new Set(files);
  const readJson = async (f: string) => Bun.file(`${root}/${f}`).json().catch(() => undefined);
  const readToml = async (f: string) => {
    try {
      return Bun.TOML.parse(await Bun.file(`${root}/${f}`).text()) as any;
    } catch {
      return undefined;
    }
  };

  // ---- Cargo -------------------------------------------------------------------------------------------------
  const rootToml = (await readToml("Cargo.toml"))!;
  const ws = rootToml.workspace ?? {};
  const cargoFiles = files.filter(f => f.endsWith("/Cargo.toml") || f === "Cargo.toml");
  const pkgs = new Map<string, any>(); // dir -> parsed toml (packages only)
  const wsRoots = new Set<string>(); // nested workspace roots (own [workspace]), excluding the repo root
  for (const f of cargoFiles) {
    if (f.startsWith("vendor/cargo/")) continue; // vendored crates.io sources (cargo vendor), not components
    const t = await readToml(f);
    if (!t) continue;
    const dir = posix.dirname(f) === "." ? "." : posix.dirname(f);
    if (t.package) pkgs.set(dir, t);
    if (t.workspace && dir !== ".") wsRoots.add(dir);
  }
  const memberSet = new Set<string>();
  for (const m of ws.members ?? []) for (const d of matchGlob(m.replace(/\/$/, ""), pkgs.keys())) memberSet.add(d);
  // Submodule members cannot be read without a checkout: keep the declared path as a member.
  for (const m of ws.members ?? []) if (!/[*?]/.test(m) && gitlinks.has(m)) memberSet.add(m);
  const rootExcludes: string[] = ws.exclude ?? [];

  const depTables = (t: any) => {
    const out: Record<string, any>[] = [];
    for (const k of ["dependencies", "dev-dependencies", "build-dependencies"]) if (t[k]) out.push(t[k]);
    for (const target of Object.values<any>(t.target ?? {}))
      for (const k of ["dependencies", "dev-dependencies", "build-dependencies"]) if (target[k]) out.push(target[k]);
    return out;
  };
  const wsDeps: Record<string, any> = ws.dependencies ?? {};
  const pathDepsOf = (dir: string, t: any) => {
    const targets = new Set<string>();
    for (const table of depTables(t))
      for (const [key, spec] of Object.entries<any>(table)) {
        if (!spec || typeof spec !== "object") continue;
        let p: string | undefined = spec.path;
        let base = dir;
        if (spec.workspace) {
          const w = wsDeps[key];
          p = w && typeof w === "object" ? w.path : undefined;
          base = ".";
        }
        if (p) targets.add(posix.normalize(posix.join(base, p)));
      }
    return targets;
  };
  // Implicit membership: a path dependency of a member inside the workspace root is a member (unless excluded).
  const queue = [...memberSet];
  while (queue.length) {
    const dir = queue.pop()!;
    const t = pkgs.get(dir);
    if (!t) continue;
    for (const target of pathDepsOf(dir, t)) {
      if (pkgs.has(target) && !memberSet.has(target) && !underAny(target, rootExcludes)) {
        memberSet.add(target);
        queue.push(target);
      }
    }
  }
  memberSet.add(".");
  const cargoExcl = integration.cargo.excluded;
  const cargoOrphans: string[] = [];
  const cargoExcluded = new Map<string, string>();
  for (const dir of pkgs.keys()) {
    if (memberSet.has(dir)) continue;
    const key = coveredBy(cargoExcl, dir);
    if (key) cargoExcluded.set(dir, cargoExcl[key]);
    else cargoOrphans.push(dir);
  }
  const cargoStaleExcludes = Object.keys(cargoExcl).filter(
    p => !files.some(f => f.startsWith(p + "/")) && !gitlinks.has(p) && !underAny(p, gitlinks),
  );
  const rootExcludeMissingReason = rootExcludes.filter(p => !coveredBy(cargoExcl, p));

  // ---- npm ---------------------------------------------------------------------------------------------------
  const rootPkg = (await readJson("package.json")) ?? {};
  const pkgFiles = files.filter(f => (f.endsWith("/package.json") || f === "package.json") && !f.includes("node_modules/"));
  const npmPkgs = new Map<string, any>();
  for (const f of pkgFiles) {
    const j = await readJson(f);
    if (j) npmPkgs.set(posix.dirname(f), j);
  }
  const wsGlobs: string[] = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : (rootPkg.workspaces?.packages ?? []);
  const npmMembers = new Set<string>();
  for (const g of wsGlobs) {
    if (g.startsWith("!")) continue;
    for (const d of matchGlob(g.replace(/\/$/, ""), [...npmPkgs.keys(), ...gitlinks])) npmMembers.add(d);
  }
  const npmExcl = integration.npm.excluded;
  const npmOrphans: string[] = [];
  const npmExcluded = new Map<string, string>();
  for (const [dir, j] of npmPkgs) {
    if (dir === "." || npmMembers.has(dir)) continue;
    if (!j.name) continue; // anonymous manifests (scripts, fixtures) are not packages
    const key = coveredBy(npmExcl, dir);
    if (key) npmExcluded.set(dir, npmExcl[key]);
    else npmOrphans.push(dir);
  }
  const npmStaleExcludes = Object.keys(npmExcl).filter(
    p => !files.some(f => f.startsWith(p + "/")) && !gitlinks.has(p) && !underAny(p, gitlinks),
  );

  // ---- graph -------------------------------------------------------------------------------------------------
  const modules: any[] = manifest.modules ?? [];
  const byId = new Map<string, any>(modules.map(m => [m.id, m]));
  const compIds = new Set<string>((manifest.components ?? []).map((c: any) => c.id));
  const nodeModules = modules.filter(m => m.kind !== "crate-dependency");
  const pathToId = new Map<string, string>();
  for (const m of nodeModules) if (m.path) pathToId.set(m.path, m.id);
  const owner = (dir: string) => {
    let d = dir;
    while (d && d !== "." && d !== "/") {
      const id = pathToId.get(d);
      if (id) return id;
      d = posix.dirname(d);
    }
    return undefined;
  };
  const edges = new Map<string, Set<string>>();
  let derived = 0;
  const add = (from?: string, to?: string) => {
    if (!from || !to || from === to) return false;
    if (!edges.has(from)) edges.set(from, new Set());
    if (edges.get(from)!.has(to)) return false;
    edges.get(from)!.add(to);
    return true;
  };
  for (const [dir, t] of pkgs) {
    const from = owner(dir);
    for (const target of pathDepsOf(dir, t)) if (add(from, owner(target))) derived++;
  }
  // The root [workspace.dependencies] path entries and [patch.*] paths connect the workspace root to components.
  const rootEdgeTargets = new Set<string>();
  for (const spec of Object.values<any>(wsDeps)) if (spec?.path) rootEdgeTargets.add(posix.normalize(spec.path));
  for (const patch of Object.values<any>(rootToml.patch ?? {}))
    for (const spec of Object.values<any>(patch)) if (spec?.path) rootEdgeTargets.add(posix.normalize(spec.path));
  for (const target of rootEdgeTargets) if (add("root:cargo", owner(target))) derived++;
  // npm: dependency names / workspace: / file: / link: specs.
  const nameToDir = new Map<string, string>();
  for (const [dir, j] of npmPkgs) if (j.name && (npmMembers.has(dir) || dir === ".")) nameToDir.set(j.name, dir);
  for (const [dir, j] of npmPkgs) {
    const from = owner(dir);
    for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])
      for (const [dep, spec] of Object.entries<string>(j[k] ?? {})) {
        let target = nameToDir.get(dep);
        const m = /^(?:file|link|portal):(.*)$/.exec(spec);
        if (m) target = posix.normalize(posix.join(dir, m[1]));
        if (target && add(from, owner(target))) derived++;
      }
  }
  for (const [dir] of npmPkgs) if (dir !== "." && npmMembers.has(dir)) if (add("root:npm", owner(dir))) derived++;
  // Membership in the root Cargo workspace is itself the link of a crate to the rest of the graph.
  for (const dir of memberSet) if (dir !== "." && add("root:cargo", owner(dir))) derived++;
  // Wiring-file references: a component path mentioned by a build/CI/factory file other than the manifest itself.
  const wiring = files.filter(
    f =>
      !f.startsWith("vendor/cargo/") &&
      !f.startsWith("docs/generated/") &&
      f !== "factory/bunos/components.json" &&
      f !== ".gitmodules" &&
      f !== "Cargo.lock" &&
      f !== "bun.lock" &&
      !f.includes("/LICENSE") &&
      (/(^|\/)(Cargo\.toml|package\.json|tsconfig[^/]*\.json|justfile|turbo\.json|pnpm-workspace\.yaml)$/.test(f) ||
        /^(factory|\.github|scripts)\//.test(f)) &&
      /\.(toml|json|ya?ml|ts|mjs|js|sh|ps1|just|PKGBUILD)$|PKGBUILD$|justfile$/.test(f),
  );
  const subPaths = nodeModules.filter(m => m.kind === "submodule").map(m => m.path as string);
  if (subPaths.length) {
    for (const f of wiring) {
      let text: string;
      try {
        text = await Bun.file(`${root}/${f}`).text();
      } catch {
        continue;
      }
      if (text.length > 2_000_000) continue;
      const from = owner(posix.dirname(f)) ?? `file:${f}`;
      for (const p of subPaths) {
        if (owner(posix.dirname(f)) === pathToId.get(p)) continue;
        if (text.includes(p) && add(from, pathToId.get(p))) derived++;
      }
    }
  }

  // Manifest-declared edges.
  let declared = 0;
  const unresolved: string[] = [];
  const resolve = (ref: string) =>
    byId.has(ref) || compIds.has(ref) || (ref.startsWith("file:") && fileSet.has(ref.slice(5))) ? ref : undefined;
  for (const m of modules) {
    const lists: [string, string[]][] = [
      ["dependsOn", m.dependsOn ?? []],
      ["consumedBy", m.consumedBy ?? []],
      ["edges.consumers", m.edges?.consumers ?? []],
    ];
    for (const [field, refs] of lists) {
      for (const ref of refs) {
        const target = resolve(ref) ?? resolve(`submodule:${ref}`) ?? resolve(`npm:${ref}`) ?? resolve(`crate:${ref}`);
        if (!target) {
          if (field !== "edges.consumers") unresolved.push(`${m.id}.${field}: ${ref}`);
          continue;
        }
        if (field === "dependsOn" ? add(m.id, target) : add(target, m.id)) declared++;
      }
    }
  }
  const inbound = new Set<string>();
  for (const tos of edges.values()) for (const to of tos) inbound.add(to);
  const isolated = nodeModules.map(m => m.id as string).filter(id => !inbound.has(id) && !(edges.get(id)?.size ?? 0));
  return {
    cargoMembers: memberSet,
    cargoOrphans: cargoOrphans.sort(),
    cargoExcluded,
    cargoStaleExcludes,
    rootExcludeMissingReason,
    npmMembers,
    npmOrphans: npmOrphans.sort(),
    npmExcluded,
    npmStaleExcludes,
    edges,
    derivedEdgeCount: derived,
    manifestEdgeCount: declared,
    unresolved,
    isolated: isolated.sort(),
    nodes: nodeModules.length,
  };
}
