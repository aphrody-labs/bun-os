/** Recipe model of `buncc desktop`: load factory/desktop/recipes.json, resolve upstream tags, order the dependency graph. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../process.ts";

export interface Pin {
  tag: string;
  sha: string;
}
export interface Recipe {
  id: string;
  group: string;
  build: "meson" | "cmake";
  repo?: string;
  /** Repository-relative directory of a local source (samples). */
  local?: string;
  track?: { pattern: string; lts?: string };
  pin?: Pin;
  lts?: Pin;
  deps: string[];
  options: string[];
  wraps?: string;
  needsTools?: string[];
  status?: "plan-only";
  note?: string;
}
export interface ToolRecipe {
  source: "pypi" | "git" | "zip";
  name?: string;
  version?: string;
  repo?: string;
  tag?: string;
  sha?: string;
  build?: string;
  url?: string;
  sha256?: string;
  why?: string;
}
export interface Target {
  kind: "msvc" | "llvm-mingw";
  arch?: "x64" | "arm64";
  triple?: string;
  cross: boolean;
  needs?: string;
}
export interface RecipeFile {
  schemaVersion: 1;
  kind: string;
  verified: string;
  targets: Record<string, Target>;
  tools: Record<string, ToolRecipe>;
  packages: Recipe[];
  groups: Record<string, string[]>;
}

export function recipesPath(root: string): string {
  return join(root, "factory", "desktop", "recipes.json");
}
export function loadRecipes(root: string): RecipeFile {
  return JSON.parse(readFileSync(recipesPath(root), "utf8")) as RecipeFile;
}

/** Newest tag of `lines` ("<sha>\trefs/tags/<name>") that matches the pattern; the pattern's numeric groups order the tags. */
export function newestTag(lines: string[], pattern: string): Pin | undefined {
  const re = new RegExp(pattern);
  const found: { tag: string; sha: string; key: number[] }[] = [];
  for (const line of lines) {
    const [sha, ref] = line.split(/\s+/);
    if (!sha || !ref?.startsWith("refs/tags/") || ref.endsWith("^{}")) continue;
    const tag = ref.slice("refs/tags/".length);
    const m = re.exec(tag);
    if (m) found.push({ tag, sha, key: m.slice(1).map(n => Number.parseInt(n, 10) || 0) });
  }
  found.sort((a, b) => {
    for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) {
      const d = (a.key[i] ?? 0) - (b.key[i] ?? 0);
      if (d) return d;
    }
    return 0;
  });
  const last = found.at(-1);
  return last && { tag: last.tag, sha: last.sha };
}

/** `git ls-remote --tags --refs` (annotated tags peeled by the server are not requested, so the sha is the tag object for annotated tags). */
export async function remoteTags(repo: string): Promise<string[]> {
  const result = await run(["git", "ls-remote", "--tags", repo], { output: "capture", timeoutMs: 120_000 });
  if (result.code !== 0) throw new Error(`git ls-remote ${repo}: ${result.stderr.trim()}`);
  // Prefer the peeled commit (refs/tags/x^{}) over the tag object when both exist.
  const peeled = new Map<string, string>();
  const lines: string[] = [];
  for (const raw of result.stdout.split(/\r?\n/)) {
    const [sha, ref] = raw.split(/\s+/);
    if (!sha || !ref) continue;
    if (ref.endsWith("^{}")) peeled.set(ref.slice(0, -3), sha);
    else lines.push(`${sha}\t${ref}`);
  }
  return lines.map(l => {
    const [sha, ref] = l.split("\t");
    return `${peeled.get(ref!) ?? sha}\t${ref}`;
  });
}

export interface Resolution {
  id: string;
  current?: Pin;
  latest?: Pin;
  lts?: Pin;
  changed: boolean;
}

/** Resolve the newest stable tag of every package (network). `write` stores the result in recipes.json. */
export async function resolveAll(root: string, only: string[] | undefined, write: boolean): Promise<Resolution[]> {
  const file = loadRecipes(root);
  const out: Resolution[] = [];
  const todo = file.packages.filter(p => p.repo && p.track && (!only || only.includes(p.id)));
  const results = await Promise.all(
    todo.map(async pkg => {
      try {
        const lines = await remoteTags(pkg.repo!);
        return { pkg, latest: newestTag(lines, pkg.track!.pattern), lts: pkg.track!.lts ? newestTag(lines, pkg.track!.lts) : undefined };
      } catch (error) {
        console.error(`plan: ${pkg.id}: ${(error as Error).message}`);
        return { pkg, latest: undefined, lts: undefined };
      }
    }),
  );
  for (const { pkg, latest, lts } of results) {
    const changed = !!latest && (pkg.pin?.tag !== latest.tag || pkg.pin?.sha !== latest.sha);
    out.push({ id: pkg.id, current: pkg.pin, latest, lts, changed });
    if (write && latest) pkg.pin = latest;
    if (write && lts) pkg.lts = lts;
  }
  if (write) writeFileSync(recipesPath(root), JSON.stringify(file, null, 2) + "\n");
  return out;
}

/** Expand ids and group names into a dependency-ordered list (dependencies first, stable by declaration order). */
export function order(file: RecipeFile, wanted: string[]): Recipe[] {
  const byId = new Map(file.packages.map(p => [p.id, p]));
  const seen = new Set<string>();
  const done: Recipe[] = [];
  const visit = (name: string, trail: string[]) => {
    const members = file.groups[name];
    if (members && !byId.has(name)) {
      for (const m of members) visit(m, [...trail, name]);
      return;
    }
    const pkg = byId.get(name);
    if (!pkg) throw new Error(`unknown package or group: ${name}`);
    if (trail.includes(name)) throw new Error(`dependency cycle: ${[...trail, name].join(" -> ")}`);
    if (seen.has(name)) return;
    seen.add(name);
    for (const dep of pkg.deps) visit(dep, [...trail, name]);
    done.push(pkg);
  };
  for (const w of wanted) visit(w, []);
  return done;
}

/** Levels of packages that can build in parallel (every dependency in an earlier level). */
export function levels(list: Recipe[]): Recipe[][] {
  const level = new Map<string, number>();
  const ids = new Set(list.map(p => p.id));
  for (const p of list) {
    const l = Math.max(-1, ...p.deps.filter(d => ids.has(d)).map(d => level.get(d) ?? -1)) + 1;
    level.set(p.id, l);
  }
  const out: Recipe[][] = [];
  for (const p of list) (out[level.get(p.id)!] ??= []).push(p);
  return out;
}

export function exists(path: string): boolean {
  return existsSync(path);
}
