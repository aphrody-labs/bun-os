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
import { KIND_IDS, KINDS, type Kind, type SurfaceType } from "./src/inventory-kinds";
import { frontmatter, plain } from "./docs";

const root = resolve(import.meta.dir, "../..");

export interface Link {
  label: string;
  url: string;
}
export interface Surface {
  type: SurfaceType;
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
    .filter((e) => !e.name.startsWith("."))
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
const tomlDesc = (text: string) => {
  const line = text.split("\n").find((l) => l.startsWith("description"));
  const start = line?.indexOf('"') ?? -1;
  const end = line?.lastIndexOf('"') ?? -1;
  return line && end > start ? line.slice(start + 1, end).split(String.fromCharCode(92, 34)).join('"') : "";
};

const surface = (kind: Kind, id: string, type: SurfaceType, reason: string, extra: Partial<Surface> = {}): Surface => ({
  type,
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
    const related = config.related ?? (opens ? undefined : (family?.webosPackageId ?? (family && "creative")));
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
    if (!apps.some((entry) => entry.id === id))
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
      desc: app.d || (readme ? firstParagraph(readme) : "") || `Bun OS ${app.run} app at ${path}.`,
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
      desc: pkg?.description || (readme ? firstParagraph(readme) : "") || `Bun OS package at ${path}.`,
      path,
      version: pkg?.version,
      license: pkg?.license,
      run: bin.length ? "cli" : "library",
      tags: [bin.length ? "cli" : "library", ...(publishable ? ["npm"] : ["private"]), ...(child.dir && !pkg ? ["no-manifest"] : [])],
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

async function crateMembers(out: Detail[], wasmModules: Set<string>) {
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
    const wasm = (types.includes("cdylib") && wasmDeps) || wasmTarget || wasmDeps || /(^|[-_])wasm($|[-_])/.test(child.name);
    const readmeFile = typeof pk.readme === "string" ? `${path}/${pk.readme}` : undefined;
    const readme = readmeFile && has(readmeFile) ? await readText(readmeFile, MAX_DOC) : await readmeOf(path, child.files);
    const module = wasmModules.has(child.name) ? `/wasm/${child.name}.wasm` : undefined;
    out.push({
      kind: "crates",
      id: child.name,
      name,
      desc: pk.description || (readme ? firstParagraph(readme) : "") || `Bun OS crate at ${path}.`,
      path,
      version,
      license,
      run: wasm ? "wasm" : "library",
      tags: [wasm ? "wasm" : "native", ...(publish && text ? ["crates.io"] : ["unpublished"]), ...(text ? [] : ["no-manifest"])],
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
        ? surface("crates", child.name, "wasm", module ? "Ships as a WebAssembly module served by this deployment." : "WebAssembly-capable: its page shows build target, metadata and README; a module is served once the factory publishes one.", module ? { module } : {})
        : surface("crates", child.name, "api", "Native crate: metadata, README and versions through its page and /api/inventory/crates/<id> (RPC over HTTP JSON)."),
      hasDoc: Boolean(readme),
      meta: {
        crateName: name,
        publish: publish && Boolean(text),
        crateType: types,
        wasm,
        wasmModule: Boolean(module),
        edition: pick(pk.edition, "edition"),
        dependencies: Object.keys(manifest?.dependencies ?? {}).length,
        files: child.files.length,
      },
      ...(readme ? { readme } : {}),
      ...(!readme ? { files: child.files.slice(0, 200) } : {}),
    });
  }
}

// ---------------------------------------------------------------------------------------------------------
// docs

async function docMembers(out: Detail[]) {
  const pages: { id: string; path: string }[] = [];
  for (const file of tracked) {
    if (!/\.(md|mdx)$/i.test(file)) continue;
    if (file.startsWith("docs/")) pages.push({ id: file.slice(5).replace(/\.(mdx|md)$/i, ""), path: file });
    else if (!file.includes("/")) pages.push({ id: `root/${file.replace(/\.(mdx|md)$/i, "")}`, path: file });
  }
  for (const page of pages) {
    const raw = await readText(page.path, 400_000);
    if (raw === undefined) continue;
    const { meta, body } = frontmatter(raw);
    const text = plain(body).slice(0, MAX_DOC);
    const title = meta.title || /^#\s+(.+)$/m.exec(text)?.[1] || basename(page.id);
    out.push({
      kind: "docs",
      id: page.id,
      name: title.slice(0, 160),
      desc: meta.description || firstParagraph(text) || `Documentation page ${page.path}.`,
      path: page.path,
      run: "doc",
      tags: [page.id.includes("/") ? page.id.split("/")[0]! : "overview"],
      links: [sourceLink(page.path)],
      surface: surface("docs", page.id, "viewer", "Rendered Markdown in the Docs viewer and the Atlas."),
      readme: `# ${title}\n\n${text}`,
    } as unknown as Detail);
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
      surface: surface("ospackages", id, "info", "Package page: catalog, list and upstream search link."),
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
      if (name) add("cachyos", `${catalog.id}:${name}`, catalog.id, recipe, `CachyOS PKGBUILD recipe ${name} of ${catalog.repository}.`);
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
      surface: surface("engines", `console/${c.id}`, c.id === "nintendo-ds" ? "app" : "info", c.id === "nintendo-ds" ? "Runs in the desktop as the Nintendo DS app." : "Status page: core, route, required content and qualification state.", c.id === "nintendo-ds" ? { opens: "ds" } : {}),
      data: c,
    });
  for (const entry of children("packages/bun-engine/src"))
    out.push(await entryMember("engines", "core/", "packages/bun-engine/src", entry, ["core"]));
  for (const entry of children("packages/bun-engine/web-emulation"))
    out.push(await entryMember("engines", "web/", "packages/bun-engine/web-emulation", entry, ["web-emulation"]));
}

async function gameMembers(out: Detail[], games: { id: string; name: string; description: string; version?: string; license?: string }[]) {
  for (const game of games)
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
      surface: surface("games", game.id, "app", `Installs and runs in the desktop as package ${game.id}.`, { opens: game.id }),
    });
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
      surface: surface("sources", id, "info", "Source page: upstream repository, pinned revision, checkout policy and links."),
      meta: { url, revision: revisions.get(path) },
    });
  }
  const workspace = await readJson("infra/source-workspace.json");
  for (const c of workspace?.components ?? []) {
    if (out.some((m) => m.kind === "sources" && m.id === c.checkout)) continue;
    out.push({
      kind: "sources",
      id: c.checkout ?? c.id,
      name: c.id,
      desc: `${c.repository ?? c.id}: ${c.owner ?? c.integration ?? "source owner"}.`,
      path: c.checkout,
      run: "data",
      tags: [c.integration ?? "component"],
      links: c.repository ? [{ label: "Repository", url: `https://github.com/${c.repository}` }] : [],
      surface: surface("sources", c.checkout ?? c.id, "info", "Source page: owner, integration state and pinned revision."),
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
        ...byKind("docs", (m) => /android|aosp/i.test(m.id)),
      ],
    },
    {
      id: "material-3",
      title: "Material 3",
      desc: "The Material 3 design system: tokens, components, icons, themes, templates and documentation.",
      members: [
        ...byKind("packages", (m) => /(^|-)m3(-|$)|^libm3|material|eslint-plugin-m3|^themes$/.test(m.id)),
        ...byKind("apps", (m) => /m3/.test(m.id)),
        ...byKind("docs", (m) => /^material\/|m3|CRAFT-M3|THEMES|themes\//i.test(m.id)),
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
        ...byKind("docs", (m) => /^bun-engine\/|EMULATION/i.test(m.id)),
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

export interface BuildOptions {
  apps?: AppEntry[];
  /** WebOS registry packages with category games (build-time), as {id,name,description}. */
  games?: { id: string; name: string; description: string; version?: string; license?: string }[];
  /** Crates for which this deployment ships a WebAssembly module under /wasm/<crate>.wasm. */
  wasmModules?: Set<string>;
}

export async function buildInventory(options: BuildOptions = {}): Promise<Inventory> {
  const apps = options.apps ?? (await catalogMembers()).apps;
  const members: Detail[] = [];
  await appMembers(members, apps);
  await packageMembers(members);
  await crateMembers(members, options.wasmModules ?? new Set());
  await docMembers(members);
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
  const counts = Object.fromEntries(KIND_IDS.map((k) => [k, members.filter((m) => m.kind === k).length])) as Record<Kind, number>;
  const commit = Bun.env.WEBOS_COMMIT ?? git("rev-parse", "HEAD").trim();
  return { schemaVersion: 1, generated: new Date().toISOString(), commit, counts, total: members.length, members };
}

/** Lightweight member for list endpoints: no README, text or data. */
export const summary = ({ readme, text, files, members, data, lang, ...rest }: Detail): Member => ({
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

const builtinIds = async () => {
  const main = (await readText("apps/webos/src/main.ts", 5e6)) ?? "";
  return new Set([...main.matchAll(/^ {4}id: "([a-z0-9-]+)",$/gm)].map((m) => m[1]!));
};

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
    if (seen.has(key)) errors.push(`${key}: duplicate member`);
    seen.add(key);
    const s = m.surface;
    if (!s || !s.type || !s.page || !s.api || !s.reason) errors.push(`${key}: no WebOS surface (type, page, api, reason)`);
    else {
      if (s.page !== `/inventory/${key}` || s.api !== `/api/inventory/${key}`) errors.push(`${key}: surface routes do not match the member`);
      if (s.opens && !known.has(s.opens) && !(registry?.has(s.opens) ?? false) && !/^[a-z0-9-]+$/.test(s.opens))
        errors.push(`${key}: opens unknown app ${s.opens}`);
      if (s.opens && registry && !known.has(s.opens) && !registry.has(s.opens))
        flags.push(`${key}: opens ${s.opens}, which this deployment's registry does not contain (the page explains it)`);
    }
    if (!m.desc) errors.push(`${key}: empty description`);
    if (m.desc.startsWith("Directory ") || m.desc.startsWith("File ") || /^Bun OS (package|crate|\w+ app) at /.test(m.desc)) flags.push(`${key}: no description or README of its own`);
  }
  // Independent enumeration: the tracked children of each owner directory must all be members.
  for (const [kind, dir] of [["apps", "apps"], ["packages", "packages"], ["crates", "crates"]] as const)
    for (const child of children(dir))
      if (child.dir && !seen.has(`${kind}/${child.name}`)) errors.push(`${dir}/${child.name}: tracked member is missing from the inventory`);
  for (const child of children(""))
    if (child.name !== "node_modules" && !seen.has(`workspace/${child.name}`)) errors.push(`${child.name}: root entry is missing from the inventory`);
  for (const child of children("factory"))
    if (!seen.has(`factory/${child.name}`)) errors.push(`factory/${child.name}: missing from the inventory`);
  for (const kind of KIND_IDS)
    if (kind !== "games" && !inv.counts[kind]) errors.push(`${kind}: kind has no members`);
  if (dist) {
    for (const file of ["api/inventory.json", ...KIND_IDS.map((k) => `api/inventory/${k}.json`)])
      if (!(await Bun.file(join(dist, file)).exists())) errors.push(`${file}: not built`);
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
