import { totalmem, freemem, availableParallelism } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { run } from "./process.ts";

export interface CrateNode {
  name: string;
  /** Directory of the manifest, relative to the workspace root with forward slashes. */
  dir: string;
  /** Workspace members this crate depends on at build time (normal and build dependencies). */
  deps: string[];
}

interface MetadataPackage {
  id: string;
  name: string;
  manifest_path: string;
  dependencies: { name: string; kind: string | null; path?: string }[];
}
interface Metadata {
  workspace_root: string;
  workspace_members: string[];
  packages: MetadataPackage[];
}

/** Workspace graph from `cargo metadata --no-deps`. Dev-dependencies are ignored so they cannot form cycles. */
export function graphFromMetadata(metadata: Metadata): CrateNode[] {
  const members = new Set(metadata.workspace_members);
  const packages = metadata.packages.filter(pkg => members.has(pkg.id));
  const names = new Set(packages.map(pkg => pkg.name));
  const root = resolve(metadata.workspace_root);
  return packages
    .map(pkg => ({
      name: pkg.name,
      dir: relative(root, dirname(resolve(pkg.manifest_path))).replaceAll("\\", "/"),
      deps: [
        ...new Set(
          pkg.dependencies
            .filter(dep => dep.kind !== "dev" && names.has(dep.name) && dep.name !== pkg.name)
            .map(dep => dep.name),
        ),
      ].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface Layers {
  /** Each layer only depends on earlier layers: its members can build together. */
  layers: string[][];
  /** Non-empty when the graph has a cycle among normal/build dependencies. */
  cycle: string[];
}

/** Kahn layering over the selected crates (dependencies outside the selection are treated as built). */
export function layerCrates(graph: CrateNode[], selection?: Iterable<string>): Layers {
  const selected = new Set(selection ?? graph.map(node => node.name));
  const nodes = graph.filter(node => selected.has(node.name));
  const remaining = new Map(nodes.map(node => [node.name, new Set(node.deps.filter(dep => selected.has(dep)))]));
  const layers: string[][] = [];
  while (remaining.size) {
    const ready = [...remaining]
      .filter(([, deps]) => deps.size === 0)
      .map(([name]) => name)
      .sort();
    if (!ready.length) return { layers, cycle: [...remaining.keys()].sort() };
    layers.push(ready);
    for (const name of ready) remaining.delete(name);
    for (const deps of remaining.values()) for (const name of ready) deps.delete(name);
  }
  return { layers, cycle: [] };
}

/** Crates reachable from `names` through reverse dependencies, plus `names` themselves. */
export function withDependents(graph: CrateNode[], names: Iterable<string>): Set<string> {
  const result = new Set(names);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph)
      if (!result.has(node.name) && node.deps.some(dep => result.has(dep))) {
        result.add(node.name);
        changed = true;
      }
  }
  return result;
}

/** Files that change the whole build when touched. */
const GLOBAL_FILES =
  /^(Cargo\.lock|Cargo\.toml|rust-toolchain(\.toml)?|\.cargo\/.*|clippy\.toml|rustfmt\.toml|deny\.toml|buncc\.toolchain\.json)$/;

export interface Affected {
  all: boolean;
  crates: string[];
  reason: string;
}

/** Map changed paths (from git diff, forward slashes) to the crates that must be rebuilt, dependents included. */
export function affectedCrates(graph: CrateNode[], changed: string[]): Affected {
  const files = changed.map(file => file.replaceAll("\\", "/")).filter(Boolean);
  if (!files.length) return { all: false, crates: [], reason: "no changed files" };
  const global = files.find(file => GLOBAL_FILES.test(file));
  if (global) return { all: true, crates: graph.map(node => node.name), reason: `${global} changed` };
  const direct = new Set<string>();
  const byLength = [...graph].sort((a, b) => b.dir.length - a.dir.length);
  for (const file of files) {
    const owner = byLength.find(node =>
      node.dir === "" ? false : file === node.dir || file.startsWith(`${node.dir}/`),
    );
    if (owner) direct.add(owner.name);
  }
  const crates = [...withDependents(graph, direct)].sort();
  return { all: false, crates, reason: `${direct.size} crate(s) changed, ${crates.length - direct.size} dependent(s)` };
}

/** Parallel job count bounded by cores and by free memory (rustc peaks near 2 GiB per job on this workspace). */
export function jobLimit(
  cores = availableParallelism(),
  freeBytes = freemem(),
  perJobBytes = 2 * 1024 ** 3,
  requested?: number,
): number {
  const byMemory = Math.max(1, Math.floor(freeBytes / perJobBytes));
  const limit = Math.max(1, Math.min(cores, byMemory));
  return requested ? Math.max(1, Math.min(requested, limit)) : limit;
}

export function systemBudget() {
  return { cores: availableParallelism(), totalBytes: totalmem(), freeBytes: freemem() };
}

export async function loadGraph(root: string, env = Bun.env): Promise<CrateNode[]> {
  const result = await run(["cargo", "metadata", "--no-deps", "--format-version", "1", "--locked"], {
    cwd: root,
    env,
    output: "capture",
    timeoutMs: 15 * 60_000,
  });
  if (result.code !== 0)
    throw new Error(`cargo metadata failed: ${result.stderr.trim().split("\n").slice(-3).join(" ")}`);
  return graphFromMetadata(JSON.parse(result.stdout) as Metadata);
}

export async function changedFiles(root: string, base: string): Promise<string[]> {
  const result = await run(["git", "diff", "--name-only", `${base}...HEAD`], {
    cwd: root,
    output: "capture",
    timeoutMs: 60_000,
  });
  const working = await run(["git", "diff", "--name-only", "HEAD"], {
    cwd: root,
    output: "capture",
    timeoutMs: 60_000,
  });
  if (result.code !== 0) throw new Error(`git diff ${base}...HEAD failed: ${result.stderr.trim()}`);
  return [
    ...new Set([...result.stdout.split("\n"), ...working.stdout.split("\n")].map(line => line.trim()).filter(Boolean)),
  ];
}

export interface ComponentEntry {
  id: string;
  kind: string;
  path: string;
  aot?: boolean;
  registration?: string[];
}

/** Components from factory/bunos/components.json, keyed by repository path. */
export async function loadComponents(root: string): Promise<Map<string, ComponentEntry>> {
  const file = Bun.file(resolve(root, "factory/bunos/components.json"));
  const out = new Map<string, ComponentEntry>();
  if (!(await file.exists())) return out;
  const data = (await file.json()) as { components?: ComponentEntry[]; modules?: ComponentEntry[] };
  for (const entry of [...(data.components ?? []), ...(data.modules ?? [])])
    if (entry.path) out.set(entry.path.replaceAll("\\", "/"), entry);
  return out;
}

/** Components that cannot run inside a `bun compile --aot` executable (aot:false) or need a preload/plugin hook that AOT ignores. */
export function aotBlockers(components: Map<string, ComponentEntry>): ComponentEntry[] {
  const hooks = new Set(["bunfig-preload", "bun-plugin"]);
  return [...components.values()].filter(
    entry => entry.aot === false || (entry.aot !== true && entry.registration?.some(mode => hooks.has(mode))),
  );
}
