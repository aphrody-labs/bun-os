// SPDX-License-Identifier: MIT
// The Bun OS scene server: Bun.serve on loopback, no bundler, no install step. It replaces upstream's Vite dev
// server, the Python SimpleHTTPRequestHandler of capture.py and the scratch-directory harness of kit_proof_harness.py.
//
//   kit mode    /                         index of the 22 kit blueprints
//               /kit/<record-id>/         one blueprint on Three.js WebGPURenderer (WebGL2 fallback), M3 chrome,
//                                         the viewer contract (window.__sceneReady, window.__viewer)
//               ?tier=T1|T2|T3 &params=<json> &capture=1 &backend=webgl2 &export=1 (GLTFExporter, no renderer)
//   dir mode    any built scene directory (index.html, dist/), served as is
//   study mode  the 37 upstream studies with an import map; anatomy meshes from a local copy or the hosted bucket
//
// Every mode also serves /three/ (the pinned Three.js package) and /__viz3d/ (the runtime: viewer, M3 sheet).
import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import type { CatalogRecord } from "./catalog.ts";
import { loadCatalog } from "./catalog.ts";
import { runtimeDir, skillRoot, studiesDir } from "./paths.ts";

/** The Three.js release Bun OS ships (root package.json catalog); kits and studies are served against it. */
export const THREE_VERSION = "0.186.1";

export type ServeMode = "kit" | "dir" | "study";

export interface ServeOptions {
  mode: ServeMode;
  /** dir mode: the directory to serve. */
  dir?: string;
  port?: number;
  hostname?: string;
}

export interface SceneServer {
  url: string;
  port: number;
  stop(): void;
}

const cacheRoot = () => resolve(Bun.env.VIZ3D_CACHE ?? join(homedir(), ".cache", "aphrody", "viz3d"));

/** The Three.js package directory: VIZ3D_THREE_DIR, the caller's project, this package, else a Bun-installed cache. */
export async function findThree(): Promise<string> {
  const ok = (dir: string) => existsSync(join(dir, "build/three.webgpu.js")) && existsSync(join(dir, "examples/jsm"));
  if (Bun.env.VIZ3D_THREE_DIR && ok(Bun.env.VIZ3D_THREE_DIR)) return resolve(Bun.env.VIZ3D_THREE_DIR);
  for (const from of [process.cwd(), import.meta.dir]) {
    try {
      const dir = resolve(Bun.resolveSync("three/package.json", from), "..");
      // Only a real install: without node_modules Bun auto-installs the latest release into its global cache.
      if (ok(dir) && dir.split(/[\\/]/).includes("node_modules")) return dir;
    } catch {
      // not resolvable from here
    }
  }
  const cache = join(cacheRoot(), `three-${THREE_VERSION}`);
  const dir = join(cache, "node_modules/three");
  if (!ok(dir)) {
    mkdirSync(cache, { recursive: true });
    await Bun.write(join(cache, "package.json"), JSON.stringify({ private: true, dependencies: { three: THREE_VERSION } }));
    const proc = Bun.spawnSync([process.execPath, "install", "--no-save"], { cwd: cache, stdout: "pipe", stderr: "pipe" });
    if (proc.exitCode !== 0 || !ok(dir)) throw new Error(`could not install three@${THREE_VERSION}: ${proc.stderr.toString().trim()}`);
  }
  return dir;
}

/** Import map of a kit page: one Three.js instance, the WebGPU build, which re-exports the core. */
export const KIT_IMPORT_MAP = {
  imports: {
    three: "/three/build/three.webgpu.js",
    "three/webgpu": "/three/build/three.webgpu.js",
    "three/tsl": "/three/build/three.tsl.js",
    "three/addons/": "/three/examples/jsm/",
  },
};

/** Import map of a study page: the studies are written against the WebGL renderer of the core build. */
export const STUDY_IMPORT_MAP = {
  imports: { three: "/three/build/three.module.js", "three/addons/": "/three/examples/jsm/" },
};

const attr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const html = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Asset {
  path: string;
  kind: string;
  factory?: string;
}

/** The asset one tier builds from and the path the harness loads it through (kit_proof_harness.tier_asset). */
export function tierAsset(record: CatalogRecord, tier: string): { asset: Asset; module: string } {
  const tiers = (record.tiers as Record<string, { asset?: Asset }> | undefined) ?? {};
  const asset = tiers[tier]?.asset ?? (record.asset as Asset);
  return { asset, module: `../${asset.path.split("templates/kits/")[1]}` };
}

/** The T2 build settings a proof runs with: the record's colour map, seed and AO numbers. */
export function surfaceSettings(record: CatalogRecord) {
  const tier = ((record.tiers as Record<string, Record<string, any>> | undefined) ?? {}).T2 ?? {};
  const ao = tier.ao ?? {};
  const seed = ((record.params as { name: string; default: unknown }[] | undefined) ?? []).find(p => p.name === "seed")?.default ?? 1;
  return {
    families: tier.families ?? {},
    seed,
    size: tier.texture_budget?.resolution ?? 1024,
    ao: { samples: ao.samples ?? 13, radius_m: ao.radius_m ?? 0.45, ground_dirt_m: ao.ground_dirt_m ?? 0.6 },
  };
}

export interface KitPageOptions {
  params?: Record<string, unknown> | null;
  tier?: string;
  capture?: boolean;
  exportGlb?: boolean;
  backend?: "auto" | "webgl2";
}

export function blueprint(id: string): CatalogRecord {
  const record = loadCatalog(undefined, "knowledge").records.find(r => r.id === id);
  if (!record || record.knowledge_kind !== "blueprint") throw new Error(`${id}: unknown blueprint record`);
  return record;
}

export function defaultParams(record: CatalogRecord): Record<string, unknown> {
  return Object.fromEntries(((record.params as { name: string; default: unknown }[]) ?? []).map(p => [p.name, p.default]));
}

/** The generated kit page: runtime/kit.html with the import map and the record's meta tags. */
export async function kitPage(record: CatalogRecord, options: KitPageOptions = {}): Promise<string> {
  const { tier = "T1", capture = false, exportGlb = false, backend = "auto" } = options;
  const params = options.params ?? defaultParams(record);
  const template = await Bun.file(join(runtimeDir(), "kit.html")).text();
  const { asset, module } = tierAsset(record, tier);
  const proof = (record.proof as { detail_socket?: string; max_close_m?: number } | undefined) ?? {};
  const meta: Record<string, string> = {
    blueprint: record.id,
    title: record.title.en,
    module,
    factory: asset.factory ?? "create",
    tier,
    params: JSON.stringify(params),
    footprint: JSON.stringify(record.footprint_m ?? null),
    backend,
  };
  // capture=1 stops the page advancing animate(dt) on the wall clock, so every named capture is reproducible.
  if (capture) meta.capture = "1";
  if (tier === "T2") meta.surface = JSON.stringify(surfaceSettings(record));
  if (proof.detail_socket) meta["detail-socket"] = proof.detail_socket;
  if (proof.max_close_m) meta["max-close-m"] = String(proof.max_close_m);
  const head = [
    `<script type="importmap">${JSON.stringify(KIT_IMPORT_MAP)}</script>`,
    ...Object.entries(meta).map(([name, content]) => `<meta name="${name}" content="${attr(content)}">`),
  ].join("\n    ");
  return template
    .replace("<!-- viz3d:inject -->", head)
    .replace("{{title}}", html(record.title.en))
    .replace("/__viz3d/kit-viewer.js", exportGlb ? "/kits/_harness/export-glb.js" : "/__viz3d/kit-viewer.js");
}

async function indexPage(): Promise<string> {
  const records = loadCatalog(undefined, "knowledge").records.filter(r => r.knowledge_kind === "blueprint");
  const items = records
    .map(r => `<li><a href="/kit/${r.id}/">${html(r.title.en)}</a> <a class="tier" href="/kit/${r.id}/?tier=T2">T2</a><p>${html(r.summary)}</p></li>`)
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>3Dviz Pro Max kits</title><link rel="stylesheet" href="/__viz3d/m3.css"><link rel="stylesheet" href="/__viz3d/kit.css"></head>
<body class="index"><main><h1>3Dviz Pro Max kits</h1><p>${records.length} blueprints on Three.js r${THREE_VERSION.split(".")[1]} WebGPU (WebGL2 fallback).</p><ul>${items}</ul></main></body></html>`;
}

/** A file under root, or null when the path escapes it or does not exist. Directories map to index.html. */
function inside(root: string, pathname: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const target = normalize(join(root, rel));
  const back = relative(root, target);
  if (back.startsWith("..") || back.split(sep).includes("..")) return null;
  if (!existsSync(target)) return null;
  if (statSync(target).isDirectory()) {
    const index = join(target, "index.html");
    return existsSync(index) ? index : null;
  }
  return target;
}

const NO_STORE = { "cache-control": "no-store" };

function fileResponse(path: string, extra: Record<string, string> = {}): Response {
  const type: Record<string, string> = extname(path) === ".glb" ? { "content-type": "model/gltf-binary" } : {};
  return new Response(Bun.file(path), { headers: { ...NO_STORE, ...type, ...extra } });
}

/** Insert the import map before the first module script of a study page (the studies have none of their own). */
export function withImportMap(page: string, map: object): string {
  if (page.includes('type="importmap"')) return page;
  const tag = `<script type="importmap">${JSON.stringify(map)}</script>`;
  return page.includes("</head>") ? page.replace("</head>", `${tag}</head>`) : `${tag}${page}`;
}

/** Anatomy meshes: a local copy (viz3d fetch-assets) when present, else the hosted bucket the manifest names. */
async function assetResponse(key: string, studies: string): Promise<Response> {
  const local = inside(join(cacheRoot(), "assets"), key);
  if (local) return fileResponse(local);
  const manifest = (await Bun.file(join(studies, "assets-manifest.json")).json()) as { base: string; files: { key: string }[] };
  if (!manifest.files.some(f => f.key === key)) return new Response("not found", { status: 404 });
  return Response.redirect(new URL(key, manifest.base).href, 302);
}

export async function serve(options: ServeOptions): Promise<SceneServer> {
  const three = await findThree();
  const runtime = runtimeDir();
  const kits = join(skillRoot(), "templates/kits");
  const studies = options.mode === "study" ? studiesDir() : null;
  if (options.mode === "study" && !studies) throw new Error("the studies ship with the @aphrody/viz3d workspace package, not the skill");
  const dir = options.mode === "dir" ? resolve(options.dir ?? ".") : null;
  if (dir && !existsSync(dir)) throw new Error(`no directory ${dir}`);
  const server = Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;
      // Browsers ask for an icon on their own; an empty answer keeps a clean scene's console clean.
      if (path === "/favicon.ico" && !(dir && inside(dir, path))) return new Response(null, { status: 204 });
      if (path.startsWith("/three/")) {
        const file = inside(three, path.slice("/three/".length));
        return file ? fileResponse(file) : new Response("not found", { status: 404 });
      }
      if (path.startsWith("/__viz3d/")) {
        const file = inside(runtime, path.slice("/__viz3d/".length));
        return file ? fileResponse(file) : new Response("not found", { status: 404 });
      }
      if (options.mode === "kit") {
        if (path === "/") return new Response(await indexPage(), { headers: { ...NO_STORE, "content-type": "text/html; charset=utf-8" } });
        if (path.startsWith("/kits/")) {
          const file = inside(kits, path.slice("/kits/".length));
          return file ? fileResponse(file) : new Response("not found", { status: 404 });
        }
        const match = /^\/kit\/([a-z0-9.-]+)\/?$/.exec(path);
        if (match) {
          try {
            const record = blueprint(match[1]!);
            const params = url.searchParams.get("params");
            const page = await kitPage(record, {
              params: params ? (JSON.parse(params) as Record<string, unknown>) : null,
              tier: url.searchParams.get("tier") ?? "T1",
              capture: url.searchParams.get("capture") === "1",
              exportGlb: url.searchParams.get("export") === "1",
              backend: url.searchParams.get("backend") === "webgl2" ? "webgl2" : "auto",
            });
            return new Response(page, { headers: { ...NO_STORE, "content-type": "text/html; charset=utf-8" } });
          } catch (error) {
            return new Response((error as Error).message, { status: 400 });
          }
        }
        return new Response("not found", { status: 404 });
      }
      if (studies) {
        if (path.startsWith("/assets/")) return assetResponse(decodeURIComponent(path.slice("/assets/".length)), studies);
        const file = inside(studies, path);
        if (!file) return new Response("not found", { status: 404 });
        if (file.endsWith(".html")) {
          const page = withImportMap(await Bun.file(file).text(), STUDY_IMPORT_MAP);
          return new Response(page, { headers: { ...NO_STORE, "content-type": "text/html; charset=utf-8" } });
        }
        return fileResponse(file);
      }
      const file = inside(dir!, path);
      return file ? fileResponse(file) : new Response("not found", { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/`, port: server.port!, stop: () => server.stop(true) };
}

/** URL of one kit page on a running kit server. */
export function kitUrl(base: string, id: string, query: Record<string, string | undefined> = {}): string {
  const url = new URL(`kit/${id}/`, base);
  for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, value);
  return url.href;
}
