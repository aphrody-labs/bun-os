#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// The Bun OS inventory: every member of the repository (apps, packages, crates, docs, factory, engines,
// games, tools, infra, releases, sources, root entries, collections) with the WebOS surface that serves it.
//
//   bun apps/webos/inventory.ts            print counts per kind and run the coverage gate
//   bun apps/webos/inventory.ts --check    same, exit 1 on any member without a surface
//   bun apps/webos/inventory.ts --dist     also verify dist/ serves every member (after build.ts)
//   bun apps/webos/inventory.ts --json     print the index JSON
//
// build.ts calls writeInventory(); the Worker serves /api/inventory[/<kind>[/<id>]] and the Atlas window
// (src/apps/atlas.ts) renders it. A member that cannot run in a browser still gets a page (info, status,
// download, API): there is no member without a surface, and checkInventory() fails the build if one appears.
import { mkdir } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { allAppCapabilities } from "@aphrody/bun-workspace/capabilities";
import { APPS, ROUTES, type MemberKind } from "./src/config";
import { BACKINGS, KIND_IDS, KINDS, type Backing, type Kind, type SurfaceType } from "./src/inventory-kinds";
import { FILE_DESCRIPTIONS, MEMBER_DESCRIPTIONS } from "./descriptions";

const root = resolve(import.meta.dir, "../..");

export interface Link {
  label: string;
  url: string;
}
export interface Surface {
  type: SurfaceType;
  /** What stands behind the page: a desktop app, a WebAssembly module, an API, a download or tracked repository content. */
  backing: Backing;
  /** Deep link in the desktop. */
  page: string;
  /** JSON of this member. */
  api: string;
  /** Desktop app or package that runs it directly. */
  opens?: string;
  /** WebAssembly module of the member, when this deployment ships one. */
  module?: string;
  /** One sentence: how this member is reachable here. */
  reason: string;
}
export interface Member {
  kind: Kind;
  id: string;
  name: string;
  desc: string;
  path?: string;
  version?: string;
  license?: string;
  run?: MemberKind | "wasm" | "data" | "doc";
  tags: string[];
  links: Link[];
  surface: Surface;
  hasDoc?: boolean;
  meta?: Record<string, unknown>;
}
export interface Detail extends Member {
  readme?: string;
  text?: string;
  lang?: string;
  files?: string[];
  members?: string[];
  data?: unknown;
}
export interface Inventory {
  schemaVersion: 1;
  generated: string;
  commit: string;
  counts: Record<Kind, number>;
  total: number;
  members: Detail[];
}

// ---------------------------------------------------------------------------------------------------------
// Repository listing

const git = (...args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
};
const listing = git("ls-files", "-s")
  .split("\n")
  .filter(Boolean)
  .map((line) => ({ mode: line.slice(0, 6), path: line.slice(line.indexOf("\t") + 1) }));
const tracked = listing.map((l) => l.path);
/** Submodule mount points are tracked as one gitlink entry but are directories. */
const gitlinks = new Set(listing.filter((l) => l.mode === "160000").map((l) => l.path));

/** Direct children of a tracked directory: name, whether it is a directory, and every tracked file below. */
/**
 * WebOS serves real apps, not documentation, templates, showcases or examples: those entries are not members.
 * Applies to every directory listing, so the generator and the coverage gate agree.
 */
export const EXCLUDED = /^(docs|examples?)$|(^|[-_])(examples?|showcases?|templates?)($|[-_])/;
function children(dir: string) {
  const prefix = dir ? `${dir}/` : "";
  const out = new Map<string, { name: string; dir: boolean; files: string[] }>();
  for (const file of tracked) {
    if (!file.startsWith(prefix)) continue;
    const rest = file.slice(prefix.length);
    const slash = rest.indexOf("/");
    const name = slash < 0 ? rest : rest.slice(0, slash);
    const entry = out.get(name) ?? { name, dir: slash >= 0, files: [] };
    if (slash >= 0 || gitlinks.has(file)) entry.dir = true;
    entry.files.push(file);
    out.set(name, entry);
  }
  return [...out.values()]
    .filter((e) => !e.name.startsWith(".") && !EXCLUDED.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}
const has = (path: string) => tracked.includes(path);
const MAX_TEXT = 64 * 1024;
const MAX_DOC = 160 * 1024;
const TEXT_EXT = new Set([".md", ".mdx", ".json", ".toml", ".ts", ".tsx", ".js", ".mjs", ".sh", ".ps1", ".yaml", ".yml", ".rs", ".txt", ".conf", ".css", ".html", ".py", ".just", ".lock", ".cfg"]);

async function readText(path: string, limit = MAX_TEXT): Promise<string | undefined> {
  const file = Bun.file(join(root, path));
  if (!(await file.exists())) return undefined;
  try {
    const text = await file.text();
    return text.length > limit ? `${text.slice(0, limit)}\n\n[truncated]` : text;
  } catch {
    return undefined;
  }
}
const readJson = async <T = any>(path: string): Promise<T | undefined> => {
  try {
    return (await Bun.file(join(root, path)).json()) as T;
  } catch {
    return undefined;
  }
};

/** First prose paragraph of a Markdown document. */
function firstParagraph(markdown: string, length = 240): string {
  const lines: string[] = [];
  let fence = false;
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```")) fence = !fence;
    if (fence || line.startsWith("```")) continue;
    if (!line) {
      if (lines.length) break;
      continue;
    }
    if (/^(#|>|\||!\[|\[!\[|<|---|===|[-*]\s|\d+\.\s|import |export )/.test(line)) {
      if (lines.length) break;
      continue;
    }
    lines.push(line);
  }
  const flat = lines.join(" ").replace(/`|\*\*|__/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}
/** First comment line of a script, after a shebang. */
function commentLine(text: string): string {
  for (const raw of text.split("\n").slice(0, 12)) {
    const m = /^\s*(?:\/\/\/?|#(?!!)|\/\*\*?|--)\s*(?:SPDX[^\n]*|\S.*)$/.exec(raw);
    if (!m) continue;
    const body = raw.replace(/^\s*(?:\/\/\/?|#|\/\*\*?|--)\s*/, "").replace(/\s*\*\/\s*$/, "").trim();
    if (body && !/^SPDX|^!|^Copyright/i.test(body)) return body.slice(0, 240);
  }
  return "";
}
/** Leading comment block of a source file: `//!`, `//`, `#` or a block comment, without license and tooling lines. */
function headerText(text: string, length = 240): string {
  const out: string[] = [];
  let block = false;
  for (const raw of text.split("\n").slice(0, 40)) {
    const line = raw.trim();
    if (!line) {
      if (out.length) break;
      continue;
    }
    let body: string | undefined;
    if (block) {
      body = line.replace(/^\*+\s?/, "");
      if (line.includes("*/")) block = false;
      body = body.replace(/\*\/.*$/, "");
    } else if (line.startsWith("/*")) {
      block = !line.includes("*/");
      body = line.replace(/^\/\*+!?\s*/, "").replace(/\*\/.*$/, "");
    } else if (/^(\/\/[/!]?|#(?![!\[]))/.test(line)) body = line.replace(/^(\/\/[/!]?|#)\s?/, "");
    else if (out.length || /^(#!|"use |import |export |use |mod |pub |const |let |\{)/.test(line)) break;
    else continue;
    body = body.trim();
    if (!body || /^(SPDX|Copyright|eslint|@ts-|prettier|biome|-\*-|vim:)/i.test(body)) continue;
    out.push(body);
    if (out.join(" ").length >= length) break;
  }
  const flat = out.join(" ").replace(/`|\*\*/g, "").replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}
/** Description from the entry files of a directory (lib.rs, main.rs, index.ts, mod.ts, ...) or its first source file. */
async function sourceDescription(dir: string, files: string[]): Promise<string> {
  const rank = (f: string) => {
    const rel = f.slice(dir.length + 1);
    const i = ["src/lib.rs", "src/main.rs", "src/index.ts", "src/mod.ts", "src/main.ts", "index.ts", "mod.ts", "main.ts", "index.js", "build.ts", "index.mjs", "src/index.tsx", "lib.rs", "main.rs", "src/lib.ts"].indexOf(rel);
    return i < 0 ? 100 + rel.split("/").length : i;
  };
  const candidates = files
    .filter((f) => /\.(rs|ts|tsx|js|mjs|py|sh|ps1|just)$/.test(f) && !/\.(test|spec|d)\.ts$|node_modules|\/tests?\//.test(f))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .slice(0, 6);
  for (const file of candidates) {
    const text = await readText(file, 6000);
    const header = text ? headerText(text) : "";
    if (header.length >= 12) return header;
  }
  return "";
}
const tomlDesc = (text: string) => {
  const line = text.split("\n").find((l) => l.startsWith("description"));
  const start = line?.indexOf('"') ?? -1;
  const end = line?.lastIndexOf('"') ?? -1;
  return line && end > start ? line.slice(start + 1, end).split(String.fromCharCode(92, 34)).join('"') : "";
};

const BACKING_OF: Record<SurfaceType, Backing> = {
  app: "desktop-app",
  wasm: "wasm-module",
  api: "api",
  download: "download",
  viewer: "repository",
};

const surface = (kind: Kind, id: string, type: SurfaceType, reason: string, extra: Partial<Surface> = {}): Surface => ({
  type,
  backing: BACKING_OF[type],
  page: `/inventory/${kind}/${id}`,
  api: `/api/inventory/${kind}/${id}`,
  reason,
  ...extra,
});
const sourceLink = (path: string): Link => ({
  label: "Source",
  url: `${ROUTES.source}/${path.split("/").map(encodeURIComponent).join("/")}`,
});

// ---------------------------------------------------------------------------------------------------------
// apps, packages, crates (the catalog build.ts has always served, now complete: no member without a manifest is skipped)

export interface AppEntry {
  id: string;
  d: string;
  k?: string;
  run: MemberKind;
  opens?: string;
  related?: string;
  artifact?: string;
  readme?: boolean;
}
export interface CatalogEntry {
  id: string;
  d: string;
  k?: string;
}

const capabilities = allAppCapabilities();
const familyOf = (id: string) => {
  const base = id.replace(/(-web-app|-web|-cli|-server|_native)$/, "");
  return capabilities.find((capability) => capability.libraryId === base);
};

/** The apps, packages and crates the shell's catalog.json and member windows use (moved from build.ts). */
export async function catalogMembers() {
  const readmes = new Map<string, string>();
  const scanned: CatalogEntry[] = [];
  for (const child of children("apps")) {
    if (!child.dir) continue;
    const p = `apps/${child.name}`;
    const pkg = await readJson(`${p}/package.json`);
    let d = pkg?.description ?? "";
    const cargo = await readText(`${p}/Cargo.toml`);
    if (!d && cargo) d = tomlDesc(cargo);
    const kind = has(`${p}/index.html`) || has(`${p}/Trunk.toml`) ? "web" : pkg ? "js" : cargo ? "native" : "source";
    if (has(`${p}/README.md`)) readmes.set(p, join(root, p, "README.md"));
    scanned.push({ id: child.name, d, k: kind });
  }
  const apps: AppEntry[] = scanned.map((entry) => {
    const config = APPS.members[entry.id] ?? {};
    const family = familyOf(entry.id);
    const run: MemberKind =
      config.kind ??
      (entry.id.endsWith("-cli")
        ? "cli"
        : entry.id.endsWith("-server")
          ? "server"
          : entry.id.endsWith("-web") && family?.webosPackageId
            ? "web"
            : "native");
    const opens = config.opens ?? (run === "web" ? family?.webosPackageId : undefined);
    const related = config.related ?? (opens ? undefined : (family?.webosPackageId ?? (family && "apps")));
    return {
      ...entry,
      d: config.desc ?? (entry.d || family?.description || ""),
      run,
      ...(opens ? { opens } : {}),
      ...(related ? { related } : {}),
      ...(config.artifact ? { artifact: config.artifact } : {}),
      ...(readmes.has(`apps/${entry.id}`) ? { readme: true } : {}),
    };
  });
  for (const id of Object.keys(APPS.members))
    if (!apps.some((entry) => entry.id === id) && !EXCLUDED.test(id))
      throw new Error(`apps.json declares ${id}, which is not a tracked apps/ member`);
  const packages: CatalogEntry[] = [];
  for (const child of children("packages")) {
    const pkg = await readJson(`packages/${child.name}/package.json`);
    if (pkg) packages.push({ id: child.name, d: pkg.description ?? "" });
  }
  const crates: CatalogEntry[] = [];
  for (const child of children("crates")) {
    const cargo = await readText(`crates/${child.name}/Cargo.toml`);
    if (cargo) crates.push({ id: child.name, d: tomlDesc(cargo) });
  }
  return { apps, packages, crates, readmes };
}

const readmeOf = async (dir: string, files: string[]): Promise<string | undefined> => {
  const name = files.find((f) => /^readme(\.md|\.mdx|\.markdown|\.txt)?$/i.test(f.slice(dir.length + 1)));
  return name ? readText(name, MAX_DOC) : undefined;
};

const NATIVE_RUN = new Set<MemberKind>(["native", "cli", "server", "android"]);

async function appMembers(out: Detail[], apps: AppEntry[]) {
  for (const app of apps) {
    const path = `apps/${app.id}`;
    const child = children("apps").find((c) => c.name === app.id)!;
    const readme = await readmeOf(path, child.files);
    const pkg = await readJson(`${path}/package.json`);
    const opens = app.opens;
    const type: SurfaceType = opens ? "app" : NATIVE_RUN.has(app.run) ? "download" : "viewer";
    const reason = opens
      ? `Runs in the desktop as ${opens}.`
      : NATIVE_RUN.has(app.run)
        ? `A ${app.run} member: its page lists published builds from the downloads service, its in-browser counterpart${app.related ? ` (${app.related})` : ""}, README and source.`
        : "A library or example: its page renders README and source.";
    out.push({
      kind: "apps",
      id: app.id,
      name: app.id,
      desc: app.d || (readme ? firstParagraph(readme) : "") || (await sourceDescription(path, child.files)) || `Bun OS ${app.run} app at ${path}.`,
      path,
      version: pkg?.version,
      license: pkg?.license,
      run: app.run,
      tags: [app.run, ...(app.related ? [`related:${app.related}`] : [])],
      links: [sourceLink(path), ...(app.artifact || NATIVE_RUN.has(app.run) ? [{ label: "Downloads", url: "/api/downloads" }] : [])],
      surface: surface("apps", app.id, type, reason, opens ? { opens } : {}),
      hasDoc: Boolean(readme),
      meta: { related: app.related, artifact: app.artifact, files: child.files.length },
      ...(readme ? { readme } : {}),
    });
  }
}

async function packageMembers(out: Detail[]) {
  for (const child of children("packages")) {
    const path = `packages/${child.name}`;
    const pkg = await readJson(`${path}/package.json`);
    const readme = await readmeOf(path, child.files);
    const name: string = pkg?.name ?? child.name;
    const publishable = pkg && pkg.private !== true && typeof pkg.name === "string";
    const bin = pkg?.bin ? Object.keys(typeof pkg.bin === "string" ? { [name]: 1 } : pkg.bin) : [];
    out.push({
      kind: "packages",
      id: child.name,
      name,
      desc: pkg?.description || (readme ? firstParagraph(readme) : "") || (await sourceDescription(path, child.files)) || `Bun OS package at ${path}.`,
      path,
      version: pkg?.version,
      license: pkg?.license,
      run: bin.length ? "cli" : "library",
      tags: [bin.length ? "cli" : "library", ...(publishable ? ["npm"] : ["unpublished"]), ...(child.dir && !pkg ? ["no-manifest"] : [])],
      links: [
        sourceLink(path),
        ...(publishable ? [{ label: "npm", url: `https://www.npmjs.com/package/${name}` }] : []),
      ],
      surface: surface("packages", child.name, "viewer", "README, manifest, versions and links rendered in its page."),
      hasDoc: Boolean(readme),
      meta: { npm: publishable ? name : undefined, bin, files: child.files.length, dependencies: Object.keys(pkg?.dependencies ?? {}).length },
      ...(readme ? { readme } : {}),
      ...(!readme ? { files: child.files.slice(0, 200) } : {}),
    });
  }
}

async function crateMembers(out: Detail[], wasmModules: Map<string, string>) {
  const rootCargo = Bun.TOML.parse((await readText("Cargo.toml", 1e6)) ?? "") as any;
  const inherited = rootCargo?.workspace?.package ?? {};
  for (const child of children("crates")) {
    const path = `crates/${child.name}`;
    const text = await readText(`${path}/Cargo.toml`, 1e6);
    let manifest: any;
    try {
      manifest = text ? Bun.TOML.parse(text) : undefined;
    } catch {
      manifest = undefined;
    }
    const pk = manifest?.package ?? {};
    const pick = (v: unknown, key: string) =>
      v && typeof v === "object" && (v as any).workspace ? inherited[key] : v;
    const name: string = pk.name ?? child.name;
    const version = pick(pk.version, "version") as string | undefined;
    const license = (pick(pk.license, "license") as string | undefined) ?? pk["license-file"];
    const publish = pk.publish !== false && !(Array.isArray(pk.publish) && pk.publish.length === 0);
    const deps = { ...manifest?.dependencies, ...manifest?.["build-dependencies"] };
    const types: string[] = manifest?.lib?.["crate-type"] ?? [];
    const wasmDeps = ["wasm-bindgen", "js-sys", "web-sys", "wasm-bindgen-futures", "gloo", "trunk"].some((d) => d in deps);
    const wasmTarget = Object.keys(manifest?.target ?? {}).some((t) => t.includes("wasm32"));
    const capable = wasmTarget || wasmDeps || /(^|[-_])wasm($|[-_])/.test(child.name);
    /** A wasm-bindgen cdylib: the factory builds it into a WebAssembly module (build-wasm.ts). */
    const wasm = types.includes("cdylib") && "wasm-bindgen" in deps;
    const readmeFile = typeof pk.readme === "string" ? `${path}/${pk.readme}` : undefined;
    const readme = readmeFile && has(readmeFile) ? await readText(readmeFile, MAX_DOC) : await readmeOf(path, child.files);
    const module = wasmModules.get(child.name);
    out.push({
      kind: "crates",
      id: child.name,
      name,
      desc: pk.description || (readme ? firstParagraph(readme) : "") || (await sourceDescription(path, child.files)) || `Bun OS crate at ${path}.`,
      path,
      version,
      license,
      run: wasm ? "wasm" : "library",
      tags: [wasm ? "wasm" : capable ? "wasm-capable" : "native", ...(publish && text ? ["crates.io"] : ["unpublished"]), ...(text ? [] : ["no-manifest"])],
      links: [
        sourceLink(path),
        ...(publish && text
          ? [
              { label: "crates.io", url: `https://crates.io/crates/${encodeURIComponent(name)}` },
              { label: "docs.rs", url: `https://docs.rs/${encodeURIComponent(name)}` },
            ]
          : []),
      ],
      surface: wasm
        ? surface("crates", child.name, module ? "wasm" : "api", module ? "Built into a WebAssembly module by the VPS factory and served by this deployment." : "A wasm-bindgen crate: the factory builds it into a module (build-wasm.ts); until that build succeeds it is reachable through the API.", module ? { module } : {})
        : surface("crates", child.name, "api", `${capable ? "A library that compiles for WebAssembly but exports no module of its own; reachable through the API." : "Native crate reachable through the API"}: metadata, dependencies, README and versions on its page, /api/inventory/crates/<id> and the /api/rpc methods.`),
      hasDoc: Boolean(readme),
      meta: {
        crateName: name,
        publish: publish && Boolean(text),
        crateType: types,
        wasm,
        wasmCapable: capable,
        wasmModule: Boolean(module),
        edition: pick(pk.edition, "edition"),
        dependencies: Object.keys(manifest?.dependencies ?? {}).length,
        files: child.files.length,
      },
      data: {
        dependencies: Object.fromEntries(Object.entries(manifest?.dependencies ?? {}).map(([k, v]) => [k, typeof v === "string" ? v : ((v as any)?.version ?? ((v as any)?.path ? "path" : (v as any)?.workspace ? "workspace" : "git"))])),
        features: Object.keys(manifest?.features ?? {}),
        bins: (manifest?.bin ?? []).map((b: any) => b.name),
        libCrateTypes: types,
      },
      ...(readme ? { readme } : {}),
      ...(!readme ? { files: child.files.slice(0, 200) } : {}),
    });
  }
}

// ---------------------------------------------------------------------------------------------------------
// generic directory members (factory, tools, infra, workspace root)

async function entryMember(kind: Kind, idPrefix: string, dir: string, entry: ReturnType<typeof children>[number], extraTags: string[] = []): Promise<Detail> {
  const path = dir ? `${dir}/${entry.name}` : entry.name;
  const id = `${idPrefix}${entry.name}`;
  const ext = extname(entry.name).toLowerCase();
  let desc = "";
  let readme: string | undefined;
  let text: string | undefined;
  let lang: string | undefined;
  let version: string | undefined;
  let license: string | undefined;
  let files: string[] | undefined;
  if (entry.dir) {
    readme = await readmeOf(path, entry.files);
    const pkg = await readJson(`${path}/package.json`);
    desc = pkg?.description || (readme ? firstParagraph(readme) : "");
    version = pkg?.version;
    license = pkg?.license;
    if (!desc) desc = await sourceDescription(path, entry.files);
    if (!readme) files = entry.files.slice(0, 400);
  } else if (TEXT_EXT.has(ext) || /^(justfile|Dockerfile|LICENSE|NOTICE)/i.test(entry.name)) {
    text = await readText(path);
    lang = ext.slice(1) || "text";
    if (text !== undefined) {
      if (ext === ".md" || ext === ".mdx") {
        readme = text;
        text = undefined;
        desc = firstParagraph(readme);
      } else if (ext === ".json") {
        try {
          const j = JSON.parse(text.replace(/\n\n\[truncated\]$/, ""));
          desc = (typeof j.description === "string" && j.description) || (typeof j.$comment === "string" && j.$comment.slice(0, 240)) || (typeof j.kind === "string" ? `${j.kind}${j.schemaVersion ? ` (schema ${j.schemaVersion})` : ""}` : "");
        } catch {
          // Truncated large catalog: described by its name below.
        }
      } else desc = commentLine(text);
    }
  }
  const isDownload = kind === "releases";
  return {
    kind,
    id,
    name: entry.name,
    desc: desc || `${entry.dir ? "Directory" : "File"} ${path}${entry.dir ? ` (${entry.files.length} files)` : ""}.`,
    path,
    version,
    license,
    run: "data",
    tags: [entry.dir ? "directory" : "file", ...extraTags],
    links: [sourceLink(path)],
    surface: surface(kind, id, isDownload ? "download" : "viewer", entry.dir ? "Directory page: README, file listing and source link." : "File page: rendered content, source link and raw JSON through the API."),
    hasDoc: Boolean(readme),
    meta: { files: entry.files.length, bytes: undefined },
    ...(readme ? { readme } : {}),
    ...(text !== undefined ? { text, lang } : {}),
    ...(files ? { files } : {}),
  };
}

async function directoryKind(out: Detail[], kind: Kind, specs: { dir: string; prefix?: string; tags?: string[] }[]) {
  for (const spec of specs)
    for (const entry of children(spec.dir)) {
      if (kind === "workspace" && !spec.dir && entry.name === "node_modules") continue;
      out.push(await entryMember(kind, spec.prefix ?? "", spec.dir, entry, spec.tags));
    }
}

// ---------------------------------------------------------------------------------------------------------
// factory compositions, OS package catalogs, engines, games, sources, releases, collections

async function compositionMembers(out: Detail[]) {
  const distribution = await readJson("distribution.json");
  for (const [id, profile] of Object.entries<any>(distribution?.profiles ?? {}))
    out.push({
      kind: "factory",
      id: `composition/${id}`,
      name: `Composition ${id}`,
      desc: profile.description ?? `Bun OS distribution profile ${id}.`,
      path: "distribution.json",
      run: "data",
      tags: ["composition"],
      links: [sourceLink("distribution.json")],
      surface: surface("factory", `composition/${id}`, "viewer", "Distribution profile page with its declared components."),
      meta: {},
      data: profile,
    });
  const images = await readJson("factory/images/manifest.json");
  for (const [id, image] of Object.entries<any>(images?.images ?? {}))
    out.push({
      kind: "factory",
      id: `image/${id}`,
      name: `Image ${id}`,
      desc: (typeof image === "object" && (image.description ?? image.purpose)) || `Bun OS image ${id} of factory/images/manifest.json.`,
      path: "factory/images/manifest.json",
      run: "data",
      tags: ["image"],
      links: [sourceLink("factory/images/manifest.json")],
      surface: surface("factory", `image/${id}`, "viewer", "Image page: manifest entry, build recipe and downloads."),
      meta: {},
      data: image,
    });
}

async function osPackageMembers(out: Detail[]) {
  const seen = new Set<string>();
  const add = (catalog: string, name: string, list: string, data: unknown, desc: string) => {
    const id = `${catalog}/${name}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      kind: "ospackages",
      id,
      name,
      desc,
      path: `factory/arch/${catalog}`,
      run: "data",
      tags: [catalog, list],
      links: [
        { label: "Arch package search", url: `https://archlinux.org/packages/?q=${encodeURIComponent(name)}` },
        sourceLink(`factory/arch/${catalog}`),
      ],
      surface: surface("ospackages", id, "viewer", "Package page: catalog, list and upstream search link."),
      data,
    });
  };
  const omarchy = await readJson("factory/arch/omarchy/packages.json");
  for (const list of omarchy?.lists ?? [])
    for (const pkg of list.packages ?? []) add("omarchy", String(pkg), list.id, { list: list.id, source: list.source }, `Pacman package of the Omarchy list ${list.id}.`);
  const chimera = await readJson("factory/arch/chimeraos/catalog.json");
  for (const key of ["packages", "buildPackages", "installerPackages", "installerBuildPackages", "bootstrapPackages"])
    for (const pkg of chimera?.[key] ?? []) add("chimeraos", String(pkg), key, { list: key }, `Pacman package of the ChimeraOS ${key} list.`);
  for (const pkg of [...(chimera?.aurPackages ?? []), ...(chimera?.localPackages ?? [])])
    add("chimeraos", String(pkg.name), pkg.repository ? "aur" : "local", pkg, `ChimeraOS ${pkg.repository ? "AUR" : "local"} package${pkg.version ? ` ${pkg.version}` : ""}.`);
  const cachy = await readJson("factory/arch/cachyos/catalog.json");
  for (const catalog of cachy?.catalogs ?? [])
    for (const recipe of catalog.recipes ?? []) {
      const name = String(recipe.recipe ?? "").replace(/\/PKGBUILD$/, "");
      if (name) add("cachyos", `${catalog.id}/${name}`, catalog.id, recipe, `CachyOS PKGBUILD recipe ${name} of ${catalog.repository}.`);
    }
}

async function engineMembers(out: Detail[]) {
  const consoles = await readJson("scripts/emulation/consoles.json");
  for (const c of consoles?.consoles ?? [])
    out.push({
      kind: "engines",
      id: `console/${c.id}`,
      name: c.name,
      desc: `${c.name} via ${c.core} (route ${c.route}, needs ${c.needs}).`,
      path: "scripts/emulation/consoles.json",
      run: "data",
      tags: ["console", c.route],
      links: [sourceLink("scripts/emulation/consoles.json")],
      surface: surface("engines", `console/${c.id}`, c.id === "nintendo-ds" ? "app" : "viewer", c.id === "nintendo-ds" ? "Runs in the desktop as the Nintendo DS app." : "Status page: core, route, required content and qualification state.", c.id === "nintendo-ds" ? { opens: "ds" } : {}),
      data: c,
    });
  for (const entry of children("packages/bun-engine/src"))
    out.push(await entryMember("engines", "core/", "packages/bun-engine/src", entry, ["core"]));
  for (const entry of children("packages/bun-engine/web-emulation"))
    out.push(await entryMember("engines", "web/", "packages/bun-engine/web-emulation", entry, ["web-emulation"]));
}

/** The game library and the emulators that always ship in the shell, plus every game package of the registry. */
async function gameMembers(out: Detail[], games: { id: string; name: string; description: string; version?: string; license?: string }[]) {
  const fixed: typeof games = [
    { id: "play", name: "Play", description: APPS.workspace.find((w) => w.id === "play")?.desc ?? "Bun Engine game library and the qualified emulators." },
    { id: "ds", name: "Nintendo DS", description: "The qualified Dust Nintendo DS emulator of Bun Engine, with open-source test content." },
  ];
  for (const game of [...fixed, ...games.filter((g) => !fixed.some((f) => f.id === g.id))])
    out.push({
      kind: "games",
      id: game.id,
      name: game.name,
      desc: game.description,
      version: game.version,
      license: game.license,
      run: "web",
      tags: ["game", "installable"],
      links: [],
      surface: surface("games", game.id, game.id === "ds" || game.id === "play" ? "app" : "app", `Installs and runs in the desktop as package ${game.id}.`, { opens: game.id }),
    });
  // Game owners of the repository: launcher and status pages that list the members behind each game. Game files are never hosted;
  // private owners (DBXV2, iecode-docs) list their owners only, their content is stripped by privatize().
  const owners = (test: (m: Detail) => boolean) => out.filter((m) => m.kind !== "games" && m.kind !== "collections" && test(m)).map((m) => `${m.kind}/${m.id}`);
  const owned: { id: string; name: string; desc: string; tags: string[]; test: (m: Detail) => boolean }[] = [
    {
      id: "ievr",
      name: "Inazuma Eleven: Victory Road (IEVR)",
      desc: "IEVR tooling: the IECODE web, .NET and C++ owners, the ieverse and inagle libraries and the aphrody-nie engine crates. The game is read from your own install; no game files are hosted.",
      tags: ["launcher", "level5"],
      test: (m) => /^(iecode-(web|dotnet|cpp|homebrew|scripts)|ieverse|inagle|aphrody-nie-)/.test(m.id) && m.kind !== "ospackages",
    },
    {
      id: "dbxv2",
      name: "Dragon Ball Xenoverse 2 (DBXV2)",
      desc: "DBXV2 tooling: the unified streamed asset layer and the reverse engineering crates shared with IEVR. Private owner material: only the owners are listed, no game content or corpus is published.",
      tags: ["launcher", "private"],
      test: (m) => m.kind === "crates" && (m.id === "re" || m.id === "aphrody-re" || /^re($|-)/.test(m.id)),
    },
    {
      id: "ctr",
      name: "Nintendo 3DS (ctr)",
      desc: "The aphrody-ctr 3DS emulator crates and their desktop host.",
      tags: ["emulator"],
      test: (m) => m.kind === "crates" && m.id.startsWith("aphrody-ctr"),
    },
    {
      id: "steam",
      name: "Steam and game streaming",
      desc: "Steam client integration and game streaming owners: bun-steam, bun-gamestream and the emulator host.",
      tags: ["launcher", "steam"],
      test: (m) => m.kind === "packages" && /^(bun-steam|bun-gamestream|bun-emu-host)$/.test(m.id),
    },
    {
      id: "nie-play",
      name: "NIE play",
      desc: "The aphrody-nie game and play crates: the Inazuma Eleven engine runtime and match simulation.",
      tags: ["engine"],
      test: (m) => m.kind === "crates" && /^aphrody-nie-(game|play|runtime)/.test(m.id),
    },
  ];
  for (const o of owned) {
    const members = owners(o.test);
    out.push({
      kind: "games",
      id: o.id,
      name: o.name,
      desc: o.desc,
      run: "data",
      tags: ["game", ...o.tags],
      links: [],
      surface: surface("games", o.id, "viewer", o.tags.includes("private") ? "Private-aware info page: owners and status only, no game content." : "Launcher page: owners, status and how to run it from your own install."),
      members,
      meta: { owners: members.length },
    });
  }
}

/** Private owner material (DBXV2, iecode-docs) is listed for completeness but its content never leaves the repository. */
const PRIVATE = /dbxv2|^packages\/iecode-docs(\/|$)/i;
function privatize(m: Detail) {
  if (!PRIVATE.test(`${m.path ?? ""} ${m.id}`) || m.kind === "games" || m.kind === "collections") return;
  m.desc = MEMBER_DESCRIPTIONS[`${m.kind}/${m.id}`] ?? `Private owner material (${m.kind}): listed for completeness, content is not published.`;
  delete m.readme;
  delete m.text;
  delete m.files;
  delete m.data;
  m.hasDoc = false;
  m.links = [];
  m.meta = {};
  m.tags = [...new Set([...m.tags, "private"])];
  m.surface = surface(m.kind, m.id, "viewer", "Private owner material: the member is listed, its content is not published.");
}

async function sourceMembers(out: Detail[]) {
  const text = (await readText(".gitmodules", 2e6)) ?? "";
  const locks = await readJson("sources.lock.json");
  const revisions = new Map<string, string>(
    (locks?.repositories ?? []).map((r: any) => [r.mount, r.revision] as [string, string]),
  );
  for (const block of text.split(/\n(?=\[submodule )/)) {
    const path = /path\s*=\s*(.+)/.exec(block)?.[1]?.trim();
    const url = /url\s*=\s*(.+)/.exec(block)?.[1]?.trim();
    if (!path || !url) continue;
    const id = path;
    const repo = url.replace(/\.git$/, "");
    out.push({
      kind: "sources",
      id,
      name: basename(path),
      desc: `Pinned upstream source ${repo.replace(/^https:\/\/github.com\//, "")} mounted at ${path}.`,
      path,
      run: "data",
      tags: ["submodule", ...(/update\s*=\s*none/.test(block) ? ["on-demand"] : [])],
      links: [{ label: "Repository", url: repo }, sourceLink(path)],
      surface: surface("sources", id, "viewer", "Source page: upstream repository, pinned revision, checkout policy and links."),
      meta: { url, revision: revisions.get(path) },
    });
  }
  const workspace = await readJson("infra/source-workspace.json");
  for (const c of workspace?.components ?? []) {
    const checkout = c.checkout && c.checkout !== "." ? c.checkout : undefined;
    const sid = checkout ?? `component/${c.id}`;
    if (out.some((m) => m.kind === "sources" && m.id === sid)) continue;
    out.push({
      kind: "sources",
      id: sid,
      name: c.id,
      desc: `${c.repository ?? c.id}: ${c.owner ?? c.integration ?? "source owner"}.`,
      path: checkout,
      run: "data",
      tags: [c.integration ?? "component"],
      links: c.repository ? [{ label: "Repository", url: `https://github.com/${c.repository}` }] : [],
      surface: surface("sources", sid, "viewer", "Source page: owner, integration state and pinned revision."),
      meta: { revision: c.integratedRevision },
      data: c,
    });
  }
}

async function releaseMembers(out: Detail[]) {
  out.push({
    kind: "releases",
    id: "downloads",
    name: "Downloads catalogue",
    desc: "Live release catalogue of the downloads service: every published native build with size and SHA-256.",
    run: "data",
    tags: ["live"],
    links: [{ label: "Catalogue (JSON)", url: "/api/downloads" }],
    surface: surface("releases", "downloads", "download", "The page lists the live /api/downloads catalogue."),
  });
  for (const entry of children("infra/releases"))
    out.push(await entryMember("releases", "manifest/", "infra/releases", entry, ["manifest"]));
}

function collectionMembers(out: Detail[]) {
  const byKind = (kind: Kind, test: (m: Detail) => boolean) =>
    out.filter((m) => m.kind === kind && test(m)).map((m) => `${m.kind}/${m.id}`);
  const androidOwners = ["apps/bun-android", "apps/java-ffi", "crates/android-native", "packages/bun-android", "packages/android-pipeline", "packages/android-web"];
  const groups: { id: string; title: string; desc: string; members: string[] }[] = [
    {
      id: "android",
      title: "Android",
      desc: "Android owners: apps/bun-android, apps/java-ffi, crates/android-native, packages/bun-android, packages/android-pipeline and packages/android-web, with AOSP and Waydroid.",
      members: [
        ...out.filter((m) => m.path && androidOwners.includes(m.path)).map((m) => `${m.kind}/${m.id}`),
        ...byKind("packages", (m) => /waydroid|android/.test(m.id)),
        ...byKind("factory", (m) => /aosp|google/.test(m.id)),
      ],
    },
    {
      id: "material-3",
      title: "Material 3",
      desc: "The Material 3 design system: tokens, components, icons, themes, templates and documentation.",
      members: [
        ...byKind("packages", (m) => /(^|-)m3(-|$)|^libm3|material|eslint-plugin-m3|^themes$/.test(m.id)),
        ...byKind("apps", (m) => /m3/.test(m.id)),
        ...byKind("workspace", (m) => m.id === "design-system"),
      ],
    },
    {
      id: "engines",
      title: "Engines and emulators",
      desc: "Bun Engine cores, consoles, emulator hosts, game streaming and loaders.",
      members: [
        ...byKind("engines", () => true),
        ...byKind("games", () => true),
        ...byKind("packages", (m) => /^bun-(engine|emu-host|gamestream|loaders|steam)$/.test(m.id)),
      ],
    },
    {
      id: "compositions",
      title: "Compositions: Server, COSMIC Desktop, Gaming",
      desc: "The separate distribution compositions and the images and catalogs they are assembled from.",
      members: [...byKind("factory", (m) => /^(composition|image)\//.test(m.id) || /gaming|omarchy|hyprland|alpine|ubuntu|disk|desktop|distro/.test(m.id))],
    },
    {
      id: "craft",
      title: "Craft apps",
      desc: "The Craft creative suite: every craft app, library, CLI and web build.",
      members: [...byKind("apps", (m) => /craft/.test(m.id)), ...byKind("packages", (m) => /craft/.test(m.id)), ...byKind("crates", (m) => /craft/.test(m.id))],
    },
  ];
  for (const g of groups)
    out.push({
      kind: "collections",
      id: g.id,
      name: g.title,
      desc: g.desc,
      run: "data",
      tags: ["collection"],
      links: [],
      surface: surface("collections", g.id, "viewer", "Collection page listing every member with its surface."),
      members: [...new Set(g.members)],
      meta: { members: new Set(g.members).size },
    });
}

// ---------------------------------------------------------------------------------------------------------
// assembly

/** Generated fallback text that says nothing about the member. */
const isPlaceholder = (desc: string) =>
  !desc ||
  /^(Directory|File) \S+( \(\d+ files\))?\.$/.test(desc) ||
  /^Bun OS (package|crate|\w+ app) at /.test(desc);

/** descriptions.ts entry, a well-known file name, or the top-level keys of a JSON file. */
function curatedDescription(m: Detail): string {
  const own = MEMBER_DESCRIPTIONS[`${m.kind}/${m.id}`] ?? FILE_DESCRIPTIONS[basename(m.path ?? m.id)];
  if (own) return own;
  if (m.text && m.path?.endsWith(".json")) {
    const keys = [...m.text.matchAll(/^ {2}"([^"]+)":/gm)].map((k) => k[1]!).slice(0, 8);
    if (keys.length) return `JSON file ${m.path} with the sections ${keys.join(", ")}.`;
  }
  return "";
}

export interface VersionInfo {
  /** Newest first, at most 30. */
  versions: string[];
  latest?: string;
  total: number;
  published: boolean;
  checked: string;
}
const DAY = 86_400_000;

/** crates.io sparse index path of a crate name. */
export function sparsePath(name: string): string {
  const n = name.toLowerCase();
  if (n.length <= 2) return `${n.length}/${n}`;
  if (n.length === 3) return `3/${n[0]}/${n}`;
  return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n}`;
}

async function lookup(url: string, headers: Record<string, string>): Promise<Response | undefined> {
  try {
    return await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  } catch {
    return undefined;
  }
}

/**
 * Version history of every crates.io crate (sparse index) and npm package of the inventory, cached in a file outside the
 * repository (default build/webos-versions.json, refreshed after a day). Offline-safe: a failed lookup keeps the cached
 * entry, and without any entry the member simply has no history.
 */
export async function attachVersions(members: Detail[], cachePath = Bun.env.WEBOS_VERSIONS_CACHE ?? join(root, "build/webos-versions.json")) {
  const cache: Record<string, VersionInfo> = (await Bun.file(cachePath).json().catch(() => ({}))) as Record<string, VersionInfo>;
  const jobs: { key: string; member: Detail; fetchInfo: () => Promise<VersionInfo | undefined> }[] = [];
  for (const m of members) {
    if (m.kind === "crates" && m.tags.includes("crates.io")) {
      const name = String(m.meta?.crateName ?? m.name);
      jobs.push({
        key: `crate:${name}`,
        member: m,
        fetchInfo: async () => {
          const res = await lookup(`https://index.crates.io/${sparsePath(name)}`, { "user-agent": "aphrody-webos-inventory (contact@aphrody.com)" });
          if (!res) return undefined;
          if (res.status === 404) return { versions: [], total: 0, published: false, checked: new Date().toISOString() };
          if (!res.ok) return undefined;
          const all = (await res.text())
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as { vers: string; yanked?: boolean })
            .filter((v) => !v.yanked)
            .map((v) => v.vers)
            .reverse();
          return { versions: all.slice(0, 30), latest: all[0], total: all.length, published: all.length > 0, checked: new Date().toISOString() };
        },
      });
    } else if (m.kind === "packages" && typeof m.meta?.npm === "string") {
      const name = m.meta.npm;
      jobs.push({
        key: `npm:${name}`,
        member: m,
        fetchInfo: async () => {
          const res = await lookup(`https://registry.npmjs.org/${name.replace("/", "%2f")}`, { accept: "application/vnd.npm.install-v1+json" });
          if (!res) return undefined;
          if (res.status === 404) return { versions: [], total: 0, published: false, checked: new Date().toISOString() };
          if (!res.ok) return undefined;
          const doc = (await res.json()) as { versions?: Record<string, unknown>; "dist-tags"?: { latest?: string } };
          const all = Object.keys(doc.versions ?? {}).reverse();
          return { versions: all.slice(0, 30), latest: doc["dist-tags"]?.latest ?? all[0], total: all.length, published: all.length > 0, checked: new Date().toISOString() };
        },
      });
    }
  }
  let next = 0;
  let fetched = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      const hit = cache[job.key];
      if (!hit || Date.now() - Date.parse(hit.checked) > DAY) {
        const fresh = await job.fetchInfo().catch(() => undefined);
        if (fresh) {
          cache[job.key] = fresh;
          fetched++;
        }
      }
      const info = cache[job.key];
      if (info) job.member.meta = { ...job.member.meta, history: info };
    }
  };
  await Promise.all(Array.from({ length: 12 }, worker));
  await mkdir(dirname(cachePath), { recursive: true });
  await Bun.write(cachePath, JSON.stringify(cache));
  return { jobs: jobs.length, fetched, cached: jobs.filter((j) => cache[j.key]).length };
}

export interface BuildOptions {
  /** Fetch crates.io and npm version history (cached); build.ts turns it on, the offline gate leaves it off. */
  versions?: boolean;
  apps?: AppEntry[];
  /** WebOS registry packages with category games (build-time), as {id,name,description}. */
  games?: { id: string; name: string; description: string; version?: string; license?: string }[];
  /** Crates for which this deployment ships a WebAssembly module under /wasm/<crate>.wasm. */
  wasmModules?: Map<string, string>;
}

export async function buildInventory(options: BuildOptions = {}): Promise<Inventory> {
  const apps = options.apps ?? (await catalogMembers()).apps;
  const members: Detail[] = [];
  await appMembers(members, apps);
  await packageMembers(members);
  await crateMembers(members, options.wasmModules ?? new Map());
  await directoryKind(members, "factory", [{ dir: "factory", tags: ["factory"] }]);
  await compositionMembers(members);
  await osPackageMembers(members);
  await engineMembers(members);
  await gameMembers(members, options.games ?? []);
  await directoryKind(members, "tools", [
    { dir: "scripts", prefix: "scripts/" },
    { dir: "tools/aphrody", prefix: "tools/" },
    { dir: "bin", prefix: "bin/" },
    { dir: "install", prefix: "install/" },
  ]);
  await directoryKind(members, "infra", [
    { dir: "infra", prefix: "" },
    { dir: "infra/config", prefix: "config/" },
    { dir: "infra/config/host", prefix: "host/" },
  ]);
  await releaseMembers(members);
  await sourceMembers(members);
  await directoryKind(members, "workspace", [{ dir: "" }]);
  collectionMembers(members);
  if (options.versions) console.log("versions:", JSON.stringify(await attachVersions(members)));
  members.forEach(privatize);
  for (const m of members) if (isPlaceholder(m.desc)) m.desc = curatedDescription(m) || m.desc;
  const counts = Object.fromEntries(KIND_IDS.map((k) => [k, members.filter((m) => m.kind === k).length])) as Record<Kind, number>;
  const commit = Bun.env.WEBOS_COMMIT ?? git("rev-parse", "HEAD").trim();
  return { schemaVersion: 1, generated: new Date().toISOString(), commit, counts, total: members.length, members };
}

/** Lightweight member for list endpoints: no README, text or data. */
export const summary = ({ readme: _readme, text: _text, files: _files, members: _members, data: _data, lang: _lang, ...rest }: Detail): Member => ({
  ...rest,
  ...(members ? { meta: { ...rest.meta, members: members.length } } : {}),
});

/** dist/api/inventory.json (index), dist/api/inventory/<kind>.json (lists) and one JSON file per member. */
export async function writeInventory(dist: string, inv: Inventory) {
  const write = async (path: string, value: unknown) => {
    await mkdir(dirname(join(dist, path)), { recursive: true });
    await Bun.write(join(dist, path), JSON.stringify(value));
  };
  const light = inv.members.map(summary);
  await write("api/inventory.json", { schemaVersion: 1, generated: inv.generated, commit: inv.commit, counts: inv.counts, total: inv.total, kinds: KINDS, members: light });
  for (const kind of KIND_IDS)
    await write(`api/inventory/${kind}.json`, { kind, ...KINDS[kind], count: inv.counts[kind], members: light.filter((m) => m.kind === kind) });
  await Promise.all(inv.members.map((m) => write(`api/inventory/${m.kind}/${m.id}.json`, m)));
}

// ---------------------------------------------------------------------------------------------------------
// coverage gate

const BUILTIN_BACKINGS = new Set(["wasm", "app-ui", "api", "browser"]);
const builtinSource = async () => (await readText("apps/webos/src/main.ts", 5e6)) ?? "";
const builtinIds = async () => {
  const main = await builtinSource();
  return new Set([...main.matchAll(/^ {4}id: "([a-z0-9-]+)",$/gm)].map((m) => m[1]!));
};

/** Every desktop app declares a real backing; the stub vocabulary cannot come back. */
const STUB_WORDS = /coming soon|placeholder|mock|stub|fake|not implemented|lorem|\bdemo\b/i;
export async function checkBuiltins(): Promise<string[]> {
  const errors: string[] = [];
  const main = await builtinSource();
  const blocks = main.split(/^  \{\r?$/m).slice(1);
  for (const block of blocks) {
    const id = /^    id: "([a-z0-9-]+)",/.exec(block)?.[1];
    if (!id) continue;
    const backing = /^    backing: "([a-z-]+)",/m.exec(block)?.[1];
    if (!backing || !BUILTIN_BACKINGS.has(backing)) errors.push(`desktop app ${id}: no real backing (wasm, app-ui, api or browser)`);
    const desc = /^    desc: "([^"]*)",/m.exec(block)?.[1] ?? "";
    if (STUB_WORDS.test(desc)) errors.push(`desktop app ${id}: stub wording in its description`);
  }
  return errors;
}

/** Characters the release activator and URLs cannot carry in a member id (backslash, colon, NUL, ?, #, %). */
const UNSAFE = new RegExp("[" + String.fromCharCode(92, 92) + ":" + String.fromCharCode(0) + "?#%]");

/** Every member needs a surface; every kind a label; every source directory must be enumerated. */
export async function checkInventory(inv: Inventory, dist?: string): Promise<{ errors: string[]; flags: string[] }> {
  const errors: string[] = [];
  const flags: string[] = [];
  const seen = new Set<string>();
  const known = await builtinIds();
  for (const w of APPS.workspace) known.add(w.id);
  let registry: Set<string> | undefined;
  if (dist) {
    const file = Bun.file(join(dist, "registry.json"));
    if (await file.exists())
      registry = new Set(((await file.json()) as { packages: { id: string }[] }).packages.map((p) => p.id));
  }
  for (const m of inv.members) {
    const key = `${m.kind}/${m.id}`;
    if (!(m.kind in KINDS)) errors.push(`${key}: unknown kind`);
    if (!m.id) errors.push(`${key}: empty id`);
    // The id is a URL path and a file name of the release: the activator rejects backslash, colon, NUL and dot segments.
    if (m.id.split("/").some((part) => !part || part === "." || part === ".." || UNSAFE.test(part)))
      errors.push(`${key}: id is not a safe path`);
    if (seen.has(key)) errors.push(`${key}: duplicate member`);
    seen.add(key);
    const s = m.surface;
    if (!s || !s.type || !s.page || !s.api || !s.reason || !s.backing) errors.push(`${key}: no WebOS surface (type, page, api, reason, backing)`);
    else {
      if (!BACKINGS.includes(s.backing)) errors.push(`${key}: unknown backing ${s.backing}`);
      if (s.backing === "desktop-app" && !s.opens) errors.push(`${key}: desktop-app backing without an app to open`);
      if (s.backing === "wasm-module" && dist && !s.module) errors.push(`${key}: wasm-module backing without a built module`);
      if (s.page !== `/inventory/${key}` || s.api !== `/api/inventory/${key}`) errors.push(`${key}: surface routes do not match the member`);
      if (s.opens && !known.has(s.opens) && !(registry?.has(s.opens) ?? false) && !/^[a-z0-9-]+$/.test(s.opens))
        errors.push(`${key}: opens unknown app ${s.opens}`);
      if (s.opens && registry && !known.has(s.opens) && !registry.has(s.opens))
        flags.push(`${key}: opens ${s.opens}, which this deployment's registry does not contain (the page explains it)`);
    }
    if (!m.desc) errors.push(`${key}: empty description`);
    if (isPlaceholder(m.desc)) errors.push(`${key}: no description (add a manifest description, a README, a header comment or an entry in descriptions.ts)`);
  }
  // Independent enumeration: the tracked children of each owner directory must all be members.
  for (const [kind, dir] of [["apps", "apps"], ["packages", "packages"], ["crates", "crates"]] as const)
    for (const child of children(dir))
      if (child.dir && !seen.has(`${kind}/${child.name}`)) errors.push(`${dir}/${child.name}: tracked member is missing from the inventory`);
  for (const child of children(""))
    if (child.name !== "node_modules" && !seen.has(`workspace/${child.name}`)) errors.push(`${child.name}: root entry is missing from the inventory`);
  for (const child of children("factory"))
    if (!seen.has(`factory/${child.name}`)) errors.push(`factory/${child.name}: missing from the inventory`);
  errors.push(...(await checkBuiltins()));
  for (const kind of KIND_IDS)
    if (!inv.counts[kind]) errors.push(`${kind}: kind has no members`);
  if (dist) {
    for (const file of ["api/inventory.json", ...KIND_IDS.map((k) => `api/inventory/${k}.json`)])
      if (!(await Bun.file(join(dist, file)).exists())) errors.push(`${file}: not built`);
    for (const m of inv.members)
      if (m.surface.module && !(await Bun.file(join(dist, m.surface.module)).exists()))
        errors.push(`${m.kind}/${m.id}: declared module ${m.surface.module} is not in the release`);
    const missing: string[] = [];
    for (const m of inv.members) if (!(await Bun.file(join(dist, `api/inventory/${m.kind}/${m.id}.json`)).exists())) missing.push(`${m.kind}/${m.id}`);
    if (missing.length) errors.push(`${missing.length} members have no built API file, first ${missing.slice(0, 5).join(", ")}`);
  }
  return { errors, flags };
}

export function printCounts(inv: Inventory) {
  for (const kind of KIND_IDS) console.log(`${kind.padEnd(12)} ${inv.counts[kind]}`);
  console.log(`${"total".padEnd(12)} ${inv.total}`);
}

if (import.meta.main) {
  const args = new Set(Bun.argv.slice(2));
  let games: BuildOptions["games"];
  const dist = join(import.meta.dir, "dist");
  if (args.has("--dist")) {
    const reg = await Bun.file(join(dist, "registry.json")).json().catch(() => undefined);
    games = reg?.packages?.filter((p: any) => p.category === "games");
  }
  const inv = await buildInventory({ games });
  if (args.has("--json")) console.log(JSON.stringify({ counts: inv.counts, total: inv.total }, null, 2));
  else printCounts(inv);
  const { errors, flags } = await checkInventory(inv, args.has("--dist") ? dist : undefined);
  if (flags.length) console.warn(`flags: ${flags.length} (first: ${flags.slice(0, 8).join(" | ")})`);
  if (errors.length) {
    console.error(`inventory gate FAILED (${errors.length}):\n${errors.slice(0, 40).join("\n")}`);
    process.exit(1);
  }
  console.log("inventory gate ok: every member has a WebOS surface");
}
