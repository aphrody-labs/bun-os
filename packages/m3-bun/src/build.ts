// SPDX-License-Identifier: Apache-2.0
// `m3-bun build`: the production build of an M3 app. It is `buildM3` of `@aphrody/m3` (one `Bun.build`) with the
// one m3-bun plugin, then a layout a file server and every deploy target can use as is:
//   dist/index.html            the entry, hoisted to the root with its asset references rewritten
//   dist/chunk-<hash>.{js,css} content-hashed assets (immutable caching)
//   dist/m3-bun.manifest.json  files, sizes, gzip and zstd sizes, SHA-256 and a build id derived from them
import { buildM3, type BuildM3Options } from "@aphrody/m3";
import { heapStats, memoryUsage } from "bun:jsc";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { loadApp, type M3App } from "./config.ts";
import { graphPath, recordBuild, type GraphRecord } from "./graph.ts";
import { m3Bun } from "./plugin.ts";
import { sha256 } from "./util.ts";

export type MinifyLevel = "none" | "basic" | "full";

/** `Bun.build` minify options of a level: `basic` is whitespace and syntax, `full` adds identifiers. */
export function minifyOptions(level: MinifyLevel): NonNullable<BuildM3Options["minify"]> {
  if (level === "none") return false;
  return { whitespace: true, syntax: true, identifiers: level === "full" };
}

export interface BuildFile {
  /** Path relative to the build directory, `/`-separated. */
  path: string;
  bytes: number;
  gzipBytes: number;
  /** `Bun.zstdCompressSync` size at the default level: what a `zstd` content encoding costs. */
  zstdBytes: number;
  sha256: string;
}

export interface BuildManifest {
  schema: "m3-bun.manifest/1";
  name: string;
  version: string;
  bun: string;
  minify: MinifyLevel;
  /** Hash of the file hashes: the identity of this build, reproducible for the same inputs. */
  buildId: string;
  entry: "index.html";
  files: BuildFile[];
}

/** Memory of the building process when the build finished (`bun:jsc`), in bytes. */
export interface BuildMemory {
  /** JavaScriptCore heap after the last collection, plus extra memory. */
  heapSize: number;
  heapCapacity: number;
  objectCount: number;
  /** Resident set size, now and at its peak. */
  rss: number;
  peakRss: number;
}

export interface BuildReport {
  app: M3App;
  outdir: string;
  manifest: BuildManifest;
  totalBytes: number;
  totalGzipBytes: number;
  totalZstdBytes: number;
  ms: number;
  memory: BuildMemory;
  /** Problems that did not stop the build, such as a Bun outside the app's `engines.bun` range. */
  warnings: string[];
  /** The graph registry record of this build, when the build was recorded. */
  graph?: GraphRecord;
}

/**
 * Move the HTML entry that `Bun.build` placed at `<depth dirs>/index.html` to the build root and strip the
 * `../` the entry used to reach its siblings. `depth` is the number of directories the entry sat in. Only `src`
 * and `href` attributes are rewritten (`HTMLRewriter`), never text, comments or script bodies.
 */
export function hoistHtml(html: string, depth: number): string {
  if (depth === 0) return html;
  const rewriter = new HTMLRewriter().on("[src], [href]", {
    element(element) {
      for (const name of ["src", "href"]) {
        const value = element.getAttribute(name);
        const ups = value ? /^(?:\.\.\/)+/.exec(value)?.[0] : undefined;
        if (!value || !ups) continue;
        const remaining = ups.length / 3 - depth;
        element.setAttribute(name, `${remaining > 0 ? "../".repeat(remaining) : "./"}${value.slice(ups.length)}`);
      }
    },
  });
  return rewriter.transform(html);
}

/** `Bun.version` against the `engines.bun` range of the app's `package.json` (`Bun.semver`): a message when outside. */
export function checkEngine(appDir: string, version: string = Bun.version): string | undefined {
  const file = join(appDir, "package.json");
  if (!existsSync(file)) return undefined;
  const range = (JSON.parse(readFileSync(file, "utf8")) as { engines?: { bun?: string } }).engines?.bun;
  if (!range || Bun.semver.satisfies(version, range)) return undefined;
  return `Bun ${version} does not satisfy engines.bun "${range}" of ${file}`;
}

function buildMemory(): BuildMemory {
  const heap = heapStats();
  const usage = memoryUsage();
  return {
    heapSize: heap.heapSize,
    heapCapacity: heap.heapCapacity,
    objectCount: heap.objectCount,
    rss: usage.current,
    peakRss: usage.peak,
  };
}

/** Every file of a build directory with sizes and hashes; `manifestName` itself is not listed. */
export async function listBuild(outdir: string, manifestName = "m3-bun.manifest.json"): Promise<BuildFile[]> {
  const files: BuildFile[] = [];
  const paths = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: outdir, onlyFiles: true, dot: true }));
  for (const path of paths.map(p => p.replaceAll("\\", "/")).toSorted()) {
    if (path === manifestName || path.endsWith(".map")) continue;
    // oxlint-disable-next-line no-await-in-loop -- Hash and compress one asset at a time so memory is bounded by the largest asset.
    const bytes = new Uint8Array(await Bun.file(join(outdir, path)).arrayBuffer());
    files.push({
      path,
      bytes: bytes.length,
      gzipBytes: Bun.gzipSync(bytes).length,
      zstdBytes: Bun.zstdCompressSync(bytes).length,
      sha256: sha256(bytes),
    });
  }
  return files;
}

export interface BuildAppOptions {
  /** App directory (default: the working directory). */
  dir?: string;
  /** `m3.config.ts` path, relative to `dir`. */
  configFile?: string;
  minify?: MinifyLevel;
  /** Development build: no `NODE_ENV=production`, linked sourcemaps. */
  dev?: boolean;
  /** Override the output directory. */
  outdir?: string;
  /** A pre-loaded app, for callers that already read the config. */
  app?: M3App;
  /** Record the build in a graph registry (SQLite) (default: `bun.graph` of the config): `true` for the app default, or a path. */
  graph?: boolean | string;
}

/** Build the UI of an M3 app into its output directory. */
export async function buildApp(options: BuildAppOptions = {}): Promise<BuildReport> {
  const started = performance.now();
  const app = options.app ?? (await loadApp(resolve(options.dir ?? process.cwd()), options.configFile));
  const outdir = resolve(options.outdir ?? app.outdir);
  const minify = options.minify ?? app.minify;
  const { m3 } = app;
  const graph = options.graph ?? app.bun.graph ?? false;
  const engine = checkEngine(app.dir);

  const built = await buildM3({
    entry: m3.entry,
    outdir,
    production: options.dev !== true,
    splitting: app.bun.splitting ?? true,
    minify: minifyOptions(minify),
    ...(m3.define ? { define: m3.define } : {}),
    ...(m3.drop ? { drop: m3.drop } : {}),
    ...(m3.optimizeImports ? { optimizeImports: m3.optimizeImports } : {}),
    plugin: false,
    plugins: [
      m3Bun({
        ...(m3.theme ? { theme: m3.theme } : {}),
        ...(m3.root ? { root: m3.root } : {}),
        configDir: m3.dir,
      }),
    ],
    cwd: m3.dir,
    metafile: graph !== false,
  });

  await hoistEntry(outdir, m3.dir, m3.entry);

  const files = await listBuild(outdir);
  const manifest: BuildManifest = {
    schema: "m3-bun.manifest/1",
    name: app.name,
    version: app.version,
    bun: Bun.version,
    minify,
    buildId: sha256(files.map(f => `${f.path}:${f.sha256}`).join("\n")).slice(0, 16),
    entry: "index.html",
    files,
  };
  await Bun.write(join(outdir, "m3-bun.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const report: BuildReport = {
    app,
    outdir,
    manifest,
    totalBytes: files.reduce((n, f) => n + f.bytes, 0),
    totalGzipBytes: files.reduce((n, f) => n + f.gzipBytes, 0),
    totalZstdBytes: files.reduce((n, f) => n + f.zstdBytes, 0),
    ms: Math.round(performance.now() - started),
    memory: buildMemory(),
    warnings: engine ? [engine] : [],
  };
  if (graph === false) return report;
  if (!built.metafile) throw new Error("m3-bun build: Bun.build returned no metafile to record");
  report.graph = await recordBuild(report, built.metafile, graph === true ? graphPath(app) : resolve(m3.dir, graph));
  return report;
}

/** `Bun.build` keeps the HTML entry at its source-relative path (`src/index.html`): make it `index.html`. */
async function hoistEntry(outdir: string, appDir: string, entry: string): Promise<void> {
  const rel = relative(appDir, entry).replaceAll("\\", "/");
  const built = join(outdir, rel);
  if (!existsSync(built)) throw new Error(`m3-bun: the build produced no ${rel} in ${outdir}`);
  const depth = dirname(rel) === "." ? 0 : dirname(rel).split("/").length;
  const html = hoistHtml(readFileSync(built, "utf8"), depth);
  await Bun.write(join(outdir, "index.html"), html);
  if (basename(built) !== "index.html" || depth > 0) {
    await rm(built, { force: true });
    // Drop the now empty source-relative directories.
    for (let dir = dirname(built); dir !== outdir && dir.startsWith(outdir); dir = dirname(dir)) {
      // oxlint-disable-next-line no-await-in-loop -- Inspect the next parent only after removing its empty child.
      if ((await readdir(dir)).length > 0) break;
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** The manifest of an existing build directory. */
export function readManifest(outdir: string): BuildManifest | undefined {
  const file = join(outdir, "m3-bun.manifest.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as BuildManifest) : undefined;
}
