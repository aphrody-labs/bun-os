#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// build.ts: the workspace pipeline. One process builds, typechecks and caches every package and app.
//
//   bun scripts/m3/build.ts [build|typecheck|clean] [--only name,..] [--no-cache] [--no-apps] [--json]
//
// build      every package with a `build.config.ts` (see @aphrody/m3-config/bun-build): `Bun.build` in-process,
//            then native Bun checks and required declaration-output verification, packages of one dependency level in
//            parallel; then each app's `build` script.
// typecheck  `bun check -p tsconfig.json --noEmit` for every package and app that declares a `typecheck` script.
// clean      removes `dist/` of the packages and the cache.
//
// Cache: a package is rebuilt only when its files (not `dist`, `node_modules`, tests), the hashes of the
// workspace packages it depends on, `bun.lock`, the Bun version or this pipeline changed. The state lives
// in `node_modules/.cache/m3-build/state.json`. `--no-cache` rebuilds everything.
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { m3BunBuild, type M3PackageConfig } from "../../packages/m3-config/bun-build.ts";
import { REPO, levels, workspaceDeps, workspacePackages, type WorkspacePackage } from "./lib/workspace.ts";

export type Task = "build" | "typecheck";

export interface Outcome {
  name: string;
  task: Task;
  status: "built" | "cached" | "failed" | "skipped";
  ms: number;
  detail?: string;
}

const cacheFile = (root: string) => join(root, "node_modules/.cache/m3-build/state.json");
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".turbo",
  ".cache",
  "test",
  "tests",
  "__tests__",
  "docs",
]);
const SKIP_FILES = /\.(?:test|spec|stories)\.[jt]sx?$|\.tsbuildinfo$|\.md$/;

/** Files that feed a package build, relative to `dir`, sorted. */
export function sourceFiles(dir: string, task: Task = "build"): string[] {
  const out: string[] = [];
  const walk = (sub: string) => {
    for (const entry of readdirSync(join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) || (task === "typecheck" && ["test", "tests", "__tests__"].includes(entry.name)))
          walk(rel);
      } else if (entry.isFile() && !(task === "build" ? SKIP_FILES : /\.tsbuildinfo$|\.md$/).test(entry.name))
        out.push(rel);
    }
  };
  walk("");
  return out.toSorted();
}

/** Content hash of a package's build inputs. */
export function hashPackage(dir: string, task: Task = "build"): string {
  const hasher = new Bun.CryptoHasher("sha1");
  for (const file of sourceFiles(dir, task)) {
    hasher.update(file);
    hasher.update("\0");
    hasher.update(readFileSync(join(dir, file)));
    hasher.update("\0");
  }
  return hasher.digest("hex");
}

/** What every package hash is salted with: the toolchain and the pipeline itself. */
export function globalSalt(root: string = REPO): string {
  const hasher = new Bun.CryptoHasher("sha1");
  hasher.update(Bun.version);
  const lock = join(root, "bun.lock");
  hasher.update(existsSync(lock) ? readFileSync(lock) : "no lockfile");
  // The pipeline and the preset it runs: a change to either invalidates every package.
  for (const file of [
    import.meta.path,
    join(REPO, "scripts/m3/lib/workspace.ts"),
    join(REPO, "packages/m3-config/bun-build.ts"),
  ]) {
    hasher.update(readFileSync(file));
  }
  return hasher.digest("hex");
}

/** Own hash combined with the closure of its workspace dependencies: a dependency edit invalidates dependents. */
export function closureHashes(
  packages: readonly WorkspacePackage[],
  salt: string,
  task: Task = "build",
): Map<string, string> {
  const known = new Set(packages.map(p => p.name));
  const byName = new Map(packages.map(p => [p.name, p]));
  const own = new Map(packages.map(p => [p.name, hashPackage(p.dir, task)]));
  const memo = new Map<string, string>();
  const visit = (name: string, trail: ReadonlySet<string>): string => {
    const cached = memo.get(name);
    if (cached) return cached;
    const pkg = byName.get(name)!;
    const hasher = new Bun.CryptoHasher("sha1");
    hasher.update(salt);
    hasher.update(own.get(name)!);
    for (const dep of workspaceDeps(pkg, known)) {
      // Dependency cycles contribute their own hash only, so the walk terminates.
      hasher.update(trail.has(dep) ? own.get(dep)! : visit(dep, new Set([...trail, name])));
    }
    const digest = hasher.digest("hex");
    memo.set(name, digest);
    return digest;
  };
  for (const p of packages) visit(p.name, new Set());
  return memo;
}

type State = Record<string, string>;

function loadState(root: string): State {
  try {
    return JSON.parse(readFileSync(cacheFile(root), "utf8")) as State;
  } catch {
    return {};
  }
}

async function saveState(root: string, state: State): Promise<void> {
  await Bun.write(cacheFile(root), `${JSON.stringify(state, null, 1)}\n`);
}

async function run(cmd: string[], cwd: string): Promise<{ code: number; text: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", windowsHide: true, timeout: 1_800_000 });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, text: `${out}${err}`.trim() };
}

/** Runs async jobs with at most `limit` in flight. */
export async function pool<T, R>(items: readonly T[], limit: number, job: (item: T) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("pool limit must be a positive integer");
  const results: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        // Each worker waits for its own job before taking the next item to enforce the concurrency limit.
        // oxlint-disable-next-line no-await-in-loop
        results[i] = await job(items[i]!);
      }
    }),
  );
  return results;
}

async function loadConfig(pkg: WorkspacePackage): Promise<M3PackageConfig | undefined> {
  const file = join(pkg.dir, "build.config.ts");
  if (!existsSync(file)) return undefined;
  return ((await import(pathToFileURL(file).href)) as { default: M3PackageConfig }).default;
}

async function buildPackage(pkg: WorkspacePackage, config: M3PackageConfig): Promise<{ ok: boolean; detail: string }> {
  rmSync(join(pkg.dir, "dist"), { recursive: true, force: true });
  const started = performance.now();
  const js = await m3BunBuild({ ...config, cwd: pkg.dir });
  if (!js.success) return { ok: false, detail: js.logs.join("\n") };
  const jsMs = Math.round(performance.now() - started);
  let dtsMs = 0;
  const manifest = Bun.JSONC.parse(readFileSync(join(pkg.dir, "package.json"), "utf8")) as {
    types?: string;
    exports?: Record<string, string | { types?: string }>;
  };
  const declaredTypes = [
    manifest.types,
    ...Object.values(manifest.exports ?? {}).flatMap(value => (typeof value === "string" ? [] : [value.types])),
  ].filter((path): path is string => typeof path === "string");
  const typesUseShippedSources =
    declaredTypes.length > 0 &&
    declaredTypes.every(path => {
      const relativePath = path.replaceAll("\\", "/").replace(/^\.\//, "");
      return !relativePath.startsWith("dist/") && existsSync(join(pkg.dir, relativePath));
    });
  if (existsSync(join(pkg.dir, "tsconfig.build.json")) && !typesUseShippedSources) {
    const t = performance.now();
    const declarationConfig = Bun.JSONC.parse(readFileSync(join(pkg.dir, "tsconfig.build.json"), "utf8")) as {
      compilerOptions?: { rootDir?: string; outDir?: string };
    };
    const rootDir = declarationConfig.compilerOptions?.rootDir ?? "src";
    const outDir = declarationConfig.compilerOptions?.outDir ?? "dist";
    if (rootDir !== "src" || outDir !== "dist")
      return {
        ok: false,
        detail: "M3 declaration inputs and outputs must use the package-owned src/ and dist/ directories.",
      };
    const inputs = [...new Bun.Glob("src/**/*.{ts,tsx}").scanSync({ cwd: pkg.dir, onlyFiles: true })]
      .filter(path => !path.endsWith(".d.ts"))
      .toSorted();
    if (!inputs.length) return { ok: false, detail: "No declaration inputs found." };
    // Native declaration callbacks require explicit CLI inputs and options, not project-only mode.
    const dts = await run(
      [
        process.execPath,
        "check",
        "-p",
        "tsconfig.build.json",
        "--emitDeclarationOnly=true",
        "--declaration=true",
        "--noEmit=false",
        "--rootDir",
        rootDir,
        "--outDir",
        outDir,
        "--no-pretty",
        ...inputs,
      ],
      pkg.dir,
    );
    if (dts.code !== 0) return { ok: false, detail: dts.text };
    if (!new Bun.Glob("**/*.d.ts").scanSync({ cwd: join(pkg.dir, "dist"), onlyFiles: true }).next().value)
      return {
        ok: false,
        detail:
          "Native Bun checking passed but declaration output is missing; this package is not qualified for distribution.",
      };
    dtsMs = Math.round(performance.now() - t);
  }
  return {
    ok: true,
    detail: `js ${jsMs} ms${dtsMs ? `, d.ts ${dtsMs} ms` : ""}`,
  };
}

export interface PipelineOptions {
  task?: Task;
  only?: string[];
  cache?: boolean;
  apps?: boolean;
  root?: string;
}

/** Default scope: the `@aphrody/m3*` packages and the apps; foreign and host-bound workspace members only on request. */
const IN_SCOPE = (pkg: WorkspacePackage) => /^@[^/]+\/m3/.test(pkg.name) || pkg.rel.startsWith("apps/");

const isApp = (pkg: WorkspacePackage) => pkg.rel.startsWith("apps/");

const matches = (pkg: WorkspacePackage, only: string[] | undefined) =>
  !only
    ? IN_SCOPE(pkg)
    : only.some(o => o === pkg.name || o === pkg.rel || pkg.rel.endsWith(`/${o}`) || pkg.name.endsWith(`/${o}`));

/** Run the pipeline; resolves to one outcome per package or app. */
export async function pipeline(options: PipelineOptions = {}): Promise<Outcome[]> {
  const task = options.task ?? "build";
  const useCache = options.cache !== false;
  const root = options.root ?? REPO;
  const all = workspacePackages(root);
  const hashes = closureHashes(all, globalSalt(root), task);
  const state = useCache ? loadState(root) : {};
  const outcomes: Outcome[] = [];
  const limit = Math.max(2, Math.min(cpus().length, 8));

  const wanted = all.filter(p => matches(p, options.only) && (options.apps !== false || !isApp(p)));

  const process_ = async (pkg: WorkspacePackage): Promise<Outcome> => {
    const key = `${task}:${pkg.name}`;
    const hash = hashes.get(pkg.name)!;
    const started = performance.now();
    const done = (status: Outcome["status"], detail?: string): Outcome => ({
      name: pkg.name,
      task,
      status,
      ms: Math.round(performance.now() - started),
      ...(detail ? { detail } : {}),
    });

    if (task === "typecheck") {
      // Opt-in: a package takes part by declaring a `typecheck` script (the command itself is the pipeline's).
      if (!pkg.manifest.scripts?.typecheck) return done("skipped", "no typecheck script");
      if (!existsSync(join(pkg.dir, "tsconfig.json"))) return done("skipped", "no tsconfig.json");
      if (state[key] === hash) return done("cached");
      const res = await run([process.execPath, "check", "-p", "tsconfig.json", "--noEmit", "--no-pretty"], pkg.dir);
      if (res.code !== 0) return done("failed", res.text);
      state[key] = hash;
      return done("built");
    }

    if (isApp(pkg)) {
      if (!pkg.manifest.scripts?.build) return done("skipped", "no build script");
      if (state[key] === hash && existsSync(join(pkg.dir, "dist"))) return done("cached");
      const res = await run(["bun", "run", "build"], pkg.dir);
      if (res.code !== 0) return done("failed", res.text);
      state[key] = hash;
      return done("built", res.text.split("\n").pop());
    }

    const config = await loadConfig(pkg);
    if (!config) return done("skipped", "no build.config.ts");
    if (state[key] === hash && existsSync(join(pkg.dir, "dist"))) return done("cached");
    const res = await buildPackage(pkg, config);
    if (!res.ok) return done("failed", res.detail);
    state[key] = hash;
    return done("built", res.detail);
  };

  // Packages in dependency levels; apps last (they consume the packages from source, but a failed
  // package should stop the pipeline before the slower app builds).
  const wantedNames = new Set(wanted.map(p => p.name));
  const ordered = levels(all)
    .map(level => level.filter(p => wantedNames.has(p.name)))
    .filter(l => l.length > 0);
  const packageLevels = ordered.map(l => l.filter(p => !isApp(p))).filter(l => l.length > 0);
  const appLevel = ordered.flatMap(l => l.filter(isApp));
  for (const level of [...packageLevels, ...(appLevel.length > 0 ? [appLevel] : [])]) {
    // Dependency levels must finish before their consumers start.
    // oxlint-disable-next-line no-await-in-loop
    const results = await pool(level, limit, process_);
    outcomes.push(...results);
    if (results.some(r => r.status === "failed")) break;
  }
  if (useCache) await saveState(root, state);
  return outcomes;
}

export function clean(root: string = REPO): number {
  let removed = 0;
  for (const pkg of workspacePackages(root)) {
    const dist = join(pkg.dir, "dist");
    if (existsSync(dist) && statSync(dist).isDirectory()) {
      rmSync(dist, { recursive: true, force: true });
      removed++;
    }
  }
  rmSync(join(root, "node_modules/.cache/m3-build"), {
    recursive: true,
    force: true,
  });
  return removed;
}

function formatOutcomes(outcomes: Outcome[], totalMs: number): string {
  const rows = outcomes
    .filter(o => o.status !== "skipped")
    .map(
      o =>
        `${(o.task === "typecheck" && o.status === "built" ? "ok" : o.status).padEnd(6)} ${o.name.padEnd(30)} ${String(o.ms).padStart(5)} ms  ${o.status === "failed" ? "" : (o.detail ?? "")}`,
    );
  const count = (s: Outcome["status"]) => outcomes.filter(o => o.status === s).length;
  rows.push(
    `${outcomes[0]?.task ?? "build"}: ${count("built")} run, ${count("cached")} cached, ${count("failed")} failed, ${count("skipped")} skipped in ${totalMs} ms`,
  );
  return rows.join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const task = args.find(a => !a.startsWith("--")) ?? "build";
  const flag = (name: string) => args.includes(`--${name}`);
  const value = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args[i + 1];
  };
  if (task === "clean") {
    console.log(`clean: ${clean()} dist directories and the cache removed`);
    process.exit(0);
  }
  if (task !== "build" && task !== "typecheck") {
    console.error(`build.ts: unknown task "${task}" (build, typecheck, clean)`);
    process.exit(2);
  }
  const started = performance.now();
  const outcomes = await pipeline({
    task,
    only: value("only")?.split(","),
    cache: !flag("no-cache"),
    apps: !flag("no-apps"),
  });
  const totalMs = Math.round(performance.now() - started);
  if (flag("json")) console.log(JSON.stringify({ task, totalMs, outcomes }, null, 2));
  else console.log(formatOutcomes(outcomes, totalMs));
  for (const o of outcomes.filter(x => x.status === "failed")) console.error(`\n${o.name}: ${o.detail}`);
  process.exit(outcomes.some(o => o.status === "failed") ? 1 : 0);
}
