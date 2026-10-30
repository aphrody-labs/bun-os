#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Aphrody download server: a read-only Bun.serve app behind nginx (infra/config/host/nginx/aphrody/
 * downloads.aphrody.com.conf). It serves one published release tree and never mutates anything.
 *
 *   <root>/latest.json        manifest: artifacts with name, version, platform, url, sha256, size
 *   <root>/SHA256SUMS         `<sha256>  <file>` for every artifact of the release
 *   <root>/install.sh|.ps1    one-line installers
 *   <root>/files/<file>       artifacts, each next to its `<file>.sha256`
 *   /releases/<id>/...        immutable routes from sibling releases/<id>, same public resources
 *
 * `<root>` is the `current` symlink that scripts/release/publish-downloads.ts flips atomically.
 * Environment: DOWNLOADS_ROOT (default APHRODY_HOME/downloads/current), DOWNLOADS_PORT or PORT (8797),
 * DOWNLOADS_HOST (127.0.0.1).
 *
 * Site hosts (SITE_HOSTS, default aphrody.com and www.aphrody.com) are served first from the static tree
 * SITE_ROOT (default <root>/../site/current): the Bun fork site published by the former Bun fork
 * packages/web/site/publish.ts. Paths missing from it fall back to the download routes above.
 * Deployed alone as /home/ubuntu/apps/downloads/app/server.ts: no relative imports.
 */
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import type { PublicIndexSearch, PublicIndexSdkOptions } from "./public-index.ts";

/** Resolve a deployment without assuming a VPS layout or a fixed ingress port. */
export function serverOptions(env: Record<string, string | undefined> = process.env) {
  const value = env.DOWNLOADS_PORT?.trim() || env.PORT?.trim() || "8797";
  if (!/^\d{1,5}$/.test(value) || Number(value) > 65535)
    throw new Error("DOWNLOADS_PORT/PORT must be an integer from 0 to 65535");
  return {
    root: resolve(
      env.DOWNLOADS_ROOT?.trim() ||
        join(env.APHRODY_HOME?.trim() || join(homedir(), ".aphrody"), "downloads", "current"),
    ),
    port: Number(value),
    hostname: env.DOWNLOADS_HOST?.trim() || env.HOST?.trim() || "127.0.0.1",
  };
}

export interface Artifact {
  name: string;
  version: string;
  platform: string;
  target?: string;
  kind?: string;
  url: string;
  sha256: string;
  size: number;
  file?: string;
  provides?: string[];
}

export interface Manifest {
  schemaVersion: number;
  generatedAt: string;
  release: { id: string; commit?: string };
  baseUrl: string;
  artifacts: Artifact[];
  notes?: string[];
}

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const TEXT_TYPES: Record<string, string> = {
  ".sh": "text/x-shellscript; charset=utf-8",
  ".ps1": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".sha256": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

// The Aphrody pet, idle track of crates/ui/identity (atlas row 0, six timed cells), drawn by CSS
// at half scale from /pet.webp so the page carries no script for it.
const PET: { cell: [number, number]; atlas: [number, number]; idle: number[] } = {
  cell: [192, 208],
  atlas: [1536, 2288],
  idle: [280, 110, 110, 140, 140, 320],
};
const petKeyframes = (): string => {
  const total = PET.idle.reduce((a, b) => a + b, 0);
  let at = 0;
  return PET.idle
    .map((ms, i) => {
      const pct = ((at / total) * 100).toFixed(2);
      at += ms;
      return `${pct}%{background-position:-${(i * PET.cell[0]) / 2}px 0}`;
    })
    .join("");
};

const cmd = (label: string, text: string) =>
  `<button class="cmd" data-copy="${text}" aria-label="Copy ${label} command"><span>${label}</span><code>${text}</code></button>`;

export function renderIndex(manifest: Manifest | null): string {
  const base = escapeHtml(manifest?.baseUrl ?? "https://downloads.aphrody.com");
  const desktop = (manifest?.artifacts ?? []).find(a => a.kind === "desktop" || /desktop|studio/i.test(a.name));
  const button = desktop
    ? `<a class="btn" href="${escapeHtml(desktop.url)}">Download Aphrody</a>`
    : `<span class="btn off" aria-disabled="true">Download Aphrody</span>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aphrody</title>
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<style>
/* M3 tonal-spot roles from the Aphrody pet seed #8c6c88 (m3/packages/identity PET_COLORS). */
:root{--md-sys-color-background:#fff7fa;--md-sys-color-on-background:#201a1e;--md-sys-color-primary:#7e4d7c;--md-sys-color-on-primary:#fff;--md-sys-color-surface-container:#f7ebf1;--md-sys-color-on-surface-variant:#4e444b;--md-sys-color-outline-variant:#d1c3cc}
@media (prefers-color-scheme:dark){:root{--md-sys-color-background:#171216;--md-sys-color-on-background:#ebdfe6;--md-sys-color-primary:#efb4e9;--md-sys-color-on-primary:#4b1f4b;--md-sys-color-surface-container:#241e22;--md-sys-color-on-surface-variant:#d1c3cc;--md-sys-color-outline-variant:#4e444b}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--md-sys-color-background);color:var(--md-sys-color-on-background);font:16px/1.5 Roboto,system-ui,sans-serif}
main{width:min(100% - 2rem,26rem);display:grid;gap:1rem;justify-items:center;padding:2rem 0}
.pet{width:96px;height:104px;background:url(/pet.webp) 0 0/768px 1144px no-repeat;animation:idle 1.1s step-end infinite}
@keyframes idle{${petKeyframes()}}
@media (prefers-reduced-motion:reduce){.pet{animation:none}}
h1{font:400 2.25rem/2.75rem Roboto,system-ui,sans-serif;margin:0;letter-spacing:0}
.btn{position:relative;display:inline-flex;align-items:center;height:40px;padding:0 24px;border-radius:20px;background:var(--md-sys-color-primary);color:var(--md-sys-color-on-primary);text-decoration:none;font:500 .875rem/1.25rem Roboto,system-ui,sans-serif;letter-spacing:.1px;overflow:hidden}
.btn::after{content:"";position:absolute;inset:0;background:currentColor;opacity:0;transition:opacity .15s}
.btn:hover::after{opacity:.08}.btn:focus-visible::after,.btn:active::after{opacity:.12}
.btn.off{opacity:.38;pointer-events:none}
.cmd{display:grid;gap:.25rem;width:100%;min-height:48px;box-sizing:border-box;text-align:left;padding:.75rem 1rem;border:1px solid var(--md-sys-color-outline-variant);border-radius:12px;background:var(--md-sys-color-surface-container);color:inherit;cursor:pointer;font:inherit;transition:background .15s}
.cmd:hover{background:color-mix(in srgb,var(--md-sys-color-on-background) 8%,var(--md-sys-color-surface-container))}
:is(.btn,.cmd):focus-visible{outline:3px solid var(--md-sys-color-primary);outline-offset:2px}
.cmd span{font-size:.75rem;letter-spacing:.5px;color:var(--md-sys-color-on-surface-variant)}
.cmd code{font:13px/1.4 ui-monospace,monospace;word-break:break-all}
.cmd.ok span::after{content:" \u00B7 copied";color:var(--md-sys-color-primary)}
</style></head><body><main>
<div class="pet" role="img" aria-label="Aphrody"></div>
<h1>Aphrody</h1>
${button}
${cmd("Linux / macOS", `curl -fsSL ${base}/install.sh | sh`)}
${cmd("Windows", `irm ${base}/install.ps1 | iex`)}
<script>for(const b of document.querySelectorAll(".cmd"))b.onclick=()=>{navigator.clipboard.writeText(b.dataset.copy).then(()=>{b.classList.add("ok");setTimeout(()=>b.classList.remove("ok"),1500)})}</script>
</main></body></html>
`;
}

const PUBLIC_ASSETS = new Set([
  "latest.json",
  "manifest.json",
  "SHA256SUMS",
  "install.sh",
  "install.ps1",
  "install-full.sh",
  "install-full.ps1",
  "pet.webp",
  "icon.svg",
]);

function resolveContainedFile(root: string, directory: string, name: string): string | null {
  if (!name || /[\\/\0\r\n]/.test(name) || name.startsWith(".")) return null;
  // Release trees must never expose credentials, databases or model stores.
  const protectedName =
    /(?:\.(?:pem|key|sqlite3?|db|gguf|safetensors|onnx|ckpt)(?:-wal|-shm)?$|^id_(?:rsa|dsa|ecdsa|ed25519)|^credentials(?:\.json)?$|^cookies?\.(?:json|txt|sqlite)$)/i;
  if (protectedName.test(name)) return null;
  try {
    const realRoot = realpathSync(root);
    const realBase = realpathSync(join(root, directory));
    if (realBase !== realRoot && !realBase.startsWith(realRoot + sep)) return null;
    const real = realpathSync(join(realBase, name));
    return real.startsWith(realBase + sep) &&
      !protectedName.test(basename(real)) &&
      !basename(real).startsWith(".") &&
      statSync(real).isFile()
      ? real
      : null;
  } catch {
    return null;
  }
}

export function resolveFile(root: string, name: string): string | null {
  return resolveContainedFile(root, "files", name);
}

function resolveRelease(root: string, id: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) return null;
  try {
    const parent = realpathSync(dirname(root));
    const releases = realpathSync(join(dirname(root), "releases"));
    if (releases !== join(parent, "releases")) return null;
    const release = realpathSync(join(releases, id));
    return release === join(releases, id) && statSync(release).isDirectory() ? release : null;
  } catch {
    return null;
  }
}

function parseRange(header: string | null, size: number): [number, number] | "invalid" | null {
  if (header === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";
  const [, startText, endText] = match;
  if (startText === "" && endText === "") return "invalid";
  let start: number;
  let end: number;
  if (startText === "") {
    const suffix = Number(endText);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText === "" ? size - 1 : Math.min(Number(endText), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return [start, end];
}

function withHeaders(init: Record<string, string>): Headers {
  return new Headers({ ...SECURITY_HEADERS, ...init });
}

async function readManifest(root: string): Promise<Manifest | null> {
  try {
    const path = resolveContainedFile(root, "", "latest.json");
    return path ? ((await Bun.file(path).json()) as Manifest) : null;
  } catch {
    return null;
  }
}

export interface SiteOptions {
  root: string;
  hosts: Set<string>;
  /** Explicit, separately published canonical app-ui artifact. No native RPC is exposed. */
  appUiRoot?: string;
}
const APP_UI_ARTICLE_IDS = [
  "runtime-architecture",
  "bun-native-framework",
  "material-3-design-tokens",
  "tauri-desktop-bridge",
  "llms-txt-standard",
];

const invalidAppUiDeclaration = () =>
  new Error(
    "Invalid app-ui deployment declaration: expected schemaVersion=1 and root=current inside the declared app-ui directory",
  );

/** Optional explicit opt-in declaration beside the downloads tree; no auth or proxy settings. */
function declaredAppUiRoot(downloadsRoot: string): string | undefined {
  const base = dirname(resolve(downloadsRoot));
  const directory = join(base, "app-ui");
  const declaration = join(directory, "deployment.json");
  try {
    lstatSync(declaration);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const realBase = realpathSync(base);
    const realDirectory = realpathSync(directory);
    const realDeclaration = realpathSync(declaration);
    if (
      !realDirectory.startsWith(realBase + sep) ||
      dirname(realDeclaration) !== realDirectory ||
      !statSync(realDeclaration).isFile() ||
      statSync(realDeclaration).size > 4096
    )
      throw invalidAppUiDeclaration();
    const value: unknown = JSON.parse(readFileSync(realDeclaration, "utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidAppUiDeclaration();
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || record.schemaVersion !== 1 || record.root !== "current")
      throw invalidAppUiDeclaration();
    const root = realpathSync(join(realDirectory, "current"));
    if (!root.startsWith(realDirectory + sep) || !statSync(root).isDirectory()) throw invalidAppUiDeclaration();
    return root;
  } catch {
    throw invalidAppUiDeclaration();
  }
}

export function siteOptions(downloadsRoot: string, env: Record<string, string | undefined> = process.env): SiteOptions {
  const appUiRoot = env.APP_UI_ROOT?.trim() ? resolve(env.APP_UI_ROOT.trim()) : declaredAppUiRoot(downloadsRoot);
  if (
    appUiRoot &&
    [
      "index.html",
      "public-home.html",
      "public-docs.json",
      "app.js",
      "app.css",
      ...APP_UI_ARTICLE_IDS.map(id => `public-docs/${id}.html`),
    ].some(name => !resolveSiteFile(appUiRoot, "/" + name))
  ) {
    throw new Error("APP_UI_ROOT must contain a complete canonical app-ui build including public-home.html");
  }
  if (appUiRoot) artifactAssetsBase(appUiRoot);
  return {
    appUiRoot,
    root: resolve(env.SITE_ROOT?.trim() || join(dirname(resolve(downloadsRoot)), "site", "current")),
    hosts: new Set(
      (env.SITE_HOSTS ?? "aphrody.com,www.aphrody.com")
        .split(",")
        .map(h => h.trim().toLowerCase())
        .filter(Boolean),
    ),
  };
}

const SITE_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".sh": "text/plain; charset=utf-8",
  ".ps1": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
};

/** The site loads its M3 tokens, fonts and Material Symbols from cdn.aphrody.com. */
const SITE_CSP =
  "default-src 'self'; img-src 'self' data: https:; media-src 'self' https:; style-src 'self' 'unsafe-inline' https://cdn.aphrody.com; font-src 'self' https://cdn.aphrody.com https://assets.aphrody.app; script-src 'self'; connect-src 'self' https://api.github.com https://assets.aphrody.app; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const PUBLIC_ASSETS_ORIGIN = "https://assets.aphrody.app";
function artifactAssetsBase(root: string): string | undefined {
  const file = resolveSiteFile(root, "/public-assets.json");
  if (!file) return undefined;
  const value = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  if (value.schemaVersion !== 1 || value.baseUrl !== PUBLIC_ASSETS_ORIGIN || Object.keys(value).length !== 2)
    throw new Error("Unqualified app-ui public asset origin");
  return PUBLIC_ASSETS_ORIGIN;
}

/** `/docs/x` -> `<site>/docs/x`, `<site>/docs/x/index.html` or `<site>/docs/x.html`, contained in the site. */
export function resolveSiteFile(siteRoot: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (/[\\\0\r\n]/.test(decoded)) return null;
  const parts = decoded.split("/").filter(Boolean);
  if (parts.some(p => p === ".." || p.startsWith("."))) return null;
  let realRoot: string;
  try {
    realRoot = realpathSync(siteRoot);
  } catch {
    return null;
  }
  const base = join(realRoot, ...parts);
  const candidates = parts.length ? [base, join(base, "index.html"), `${base}.html`] : [join(realRoot, "index.html")];
  for (const candidate of candidates) {
    try {
      const real = realpathSync(candidate);
      if (real.startsWith(realRoot + sep) && statSync(real).isFile()) return real;
    } catch {}
  }
  return null;
}

/** Add public document summaries without modifying the mirrored source tree. */
export async function documentSeo(html: string, pathname: string): Promise<string> {
  if (!pathname.startsWith("/docs/")) return html;
  let descriptionPresent = false;
  const paragraphs: string[] = [];
  let paragraph = -1;
  const collected = new HTMLRewriter()
    .on('head meta[name="description"]', {
      element(element) {
        descriptionPresent ||= Boolean(element.getAttribute("content")?.trim());
      },
    })
    .on("article p", {
      element() {
        paragraph = paragraphs.push("") - 1;
      },
      text(chunk) {
        if (paragraph >= 0) paragraphs[paragraph] += chunk.text;
      },
    })
    .transform(new Response(html));
  await collected.text();
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    hellip: "…",
  };
  const summary = paragraphs
    .map(text =>
      text
        .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (original, entity: string) => {
          if (!entity.startsWith("#")) return entities[entity] ?? original;
          const point =
            entity[1]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
          return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
            ? String.fromCodePoint(point)
            : original;
        })
        .replace(/\s+/g, " ")
        .trim(),
    )
    .find(Boolean);
  const description = summary && (summary.length > 160 ? `${summary.slice(0, 157).replace(/\s+\S*$/, "")}…` : summary);
  // Preserve each source title while giving independently addressable docs a
  // route context (cookies, contributing and plugin docs have duplicate titles).
  const context = pathname
    .slice(6)
    .split("/")
    .map(part => part.replaceAll("-", " "))
    .join(" / ");
  const contextualTitle = html.replace(
    /<title>([\s\S]*?)<\/title>/i,
    (_match, title: string) => `<title>${title} · ${escapeHtml(context)}</title>`,
  );
  if (descriptionPresent || !description) return contextualTitle;
  return new HTMLRewriter()
    .on('head meta[name="description"]', {
      element(element) {
        element.remove();
      },
    })
    .on("head", {
      element(element) {
        element.append(`<meta name="description" content="${escapeHtml(description)}">`, {
          html: true,
        });
      },
    })
    .transform(new Response(contextualTitle))
    .text();
}

async function siteResponse(request: Request, file: string, status = 200): Promise<Response> {
  const ext = extname(file);
  const type =
    SITE_TYPES[ext] ?? (basename(file) === "install" ? "text/plain; charset=utf-8" : "application/octet-stream");
  const cache = /^(\.(html|md|txt|json|xml|sh|ps1))?$/.test(ext)
    ? "public, max-age=300"
    : ext === ".css" || ext === ".js"
      ? "public, max-age=3600"
      : "public, max-age=86400";
  const headers = withHeaders({
    "referrer-policy": "strict-origin-when-cross-origin",
    "content-security-policy": SITE_CSP,
    "content-type": type,
    "cache-control": cache,
    vary: "accept-encoding",
  });
  if (ext !== ".html") headers.set("access-control-allow-origin", "*");
  let body: Blob = Bun.file(file);
  if (ext === ".html" && new URL(request.url).pathname.startsWith("/docs/") && status === 200) {
    const html = await documentSeo(await body.text(), new URL(request.url).pathname);
    return new Response(request.method === "HEAD" ? null : html, {
      status,
      headers,
    });
  }
  if (/\bgzip\b/.test(request.headers.get("accept-encoding") ?? "") && existsSync(`${file}.gz`)) {
    body = Bun.file(`${file}.gz`);
    headers.set("content-encoding", "gzip");
  }
  return new Response(request.method === "HEAD" ? null : body, {
    status,
    headers,
  });
}

/** Serve only explicit app-ui pages/assets; native RPC is deliberately unavailable. */
// Explicit router.tsx surfaces; parameterized native resource IDs are not public fallbacks.
export const APP_UI_ROUTES = new Set([
  "/os",
  "/studio",
  "/templates",
  "/material-3",
  "/showcase",
  "/docs",
  "/chat",
  "/codex",
  "/explorer",
  "/models",
  "/creator",
  "/admin",
  "/favorites",
  "/recents",
  "/file-kinds",
  "/redundancy",
  "/redundancy/at-risk",
  "/redundancy/compare",
  "/sources",
  "/sources/adapters",
  "/search",
  "/jobs",
  "/tasks",
  "/settings",
  "/settings/appearance",
  ...[
    "overview",
    "theme",
    "components",
    "primitives",
    "forms",
    "explorer",
    "motion",
    "icons",
    "ai",
    "reader",
    "design",
    "next",
    "system",
    "brands",
    "adaptive",
  ].flatMap(page => [`/material-3/${page}`, `/showcase/${page}`]),
]);
/** Metadata for explicit public preview routes; native capabilities remain installation-dependent. */
export function publicRouteSeo(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  const context = path
    .slice(1)
    .split("/")
    .map(part =>
      part
        .split("-")
        .map(word => word[0]?.toUpperCase() + word.slice(1))
        .join(" "),
    )
    .join(" — ");
  const title =
    path === "/" || path === "/index.html"
      ? "Aphrody — Search, workspace and native OS"
      : path === "/os"
        ? "Aphrody OS — Browser workspace"
        : `${context} — Aphrody`;
  const description =
    path === "/os"
      ? "Explore the shared Aphrody OS browser workspace. Native capabilities require the installed application."
      : path.startsWith("/material-3") || path.startsWith("/showcase")
        ? `Explore ${context} in Aphrody's Material 3 component and design catalogue.`
        : path === "/templates"
          ? "Browse Aphrody project templates and their source descriptions."
          : path === "/docs"
            ? "Read Aphrody runtime, native SDK and desktop documentation."
            : `Explore ${context} in the Aphrody browser preview. Connected native tools require the installed application.`;
  return {
    title,
    description,
    canonical: `https://aphrody.com${path === "/index.html" ? "/" : path}`,
  };
}
async function appUiResponse(request: Request, root: string): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const home = pathname === "/" || pathname === "/index.html";
  const seo = publicRouteSeo(pathname);
  const shell = APP_UI_ROUTES.has(pathname.replace(/\/+$/, ""));
  const asset = pathname.startsWith("/_app-ui/");
  if (!home && !shell && !asset) return null;
  const file = resolveSiteFile(
    root,
    home ? "/public-home.html" : shell ? "/index.html" : pathname.slice("/_app-ui".length),
  );
  const headers = withHeaders({
    "content-security-policy": `default-src 'self'; img-src 'self' data: ${PUBLIC_ASSETS_ORIGIN}; style-src 'self' 'unsafe-inline'; font-src 'self' ${PUBLIC_ASSETS_ORIGIN}; script-src 'self'; connect-src 'self' ${PUBLIC_ASSETS_ORIGIN}; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
    "content-type": file ? (SITE_TYPES[extname(file)] ?? "application/octet-stream") : "text/plain; charset=utf-8",
    "cache-control": home || shell ? "public, max-age=60" : "public, max-age=3600",
    "referrer-policy": "strict-origin-when-cross-origin",
  });
  if (!file)
    return new Response("App UI artifact unavailable", {
      status: 404,
      headers,
    });
  if (home || shell) {
    const html = await new HTMLRewriter()
      .on("title", {
        element(element) {
          if (!home) element.remove();
        },
      })
      .on('meta[name="description"], link[rel="canonical"]', {
        element(element) {
          if (!home) element.remove();
        },
      })
      .on("base", {
        element(element) {
          element.setAttribute("href", "/_app-ui/");
        },
      })
      .on("head", {
        element(element) {
          element.append('<meta name="aphrody-rpc" content="unavailable">', {
            html: true,
          });
          const assetsBase = artifactAssetsBase(root);
          if (assetsBase)
            element.append(`<meta name="aphrody-assets-base" content="${assetsBase}">`, {
              html: true,
            });
          if (!home)
            element.append(
              `<title>${seo.title}</title><meta name="description" content="${seo.description.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"><link rel="canonical" href="${seo.canonical}">`,
              { html: true },
            );
        },
      })
      .transform(new Response(Bun.file(file)))
      .text();
    return new Response(request.method === "HEAD" ? null : html, { headers });
  }
  return new Response(request.method === "HEAD" ? null : Bun.file(file), {
    headers,
  });
}

/** Explicit source-owned catalogue and five product articles; never a catch-all SPA route. */
async function appUiDocsResponse(request: Request, root: string): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const id = pathname.startsWith("/docs/") ? pathname.slice("/docs/".length) : "";
  const api = pathname === "/api/docs";
  if (!api && !APP_UI_ARTICLE_IDS.includes(id)) return null;
  const file = resolveSiteFile(root, api ? "/public-docs.json" : `/public-docs/${id}.html`);
  if (!file) return null;
  const response = await siteResponse(request, file);
  if (api || request.method === "HEAD") return response;
  const html = await new HTMLRewriter()
    .on("base", {
      element(element) {
        element.setAttribute("href", "/_app-ui/");
      },
    })
    .transform(response)
    .text();
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", SITE_CSP.replace("base-uri 'none'", "base-uri 'self'"));
  return new Response(html, { headers });
}

type PublicSearch = (
  request: {
    query: string;
    vertical: "web";
    safe: "active";
    hl: string;
    start: number;
    num: number;
  },
  signal?: AbortSignal,
) => Promise<unknown>;

let publicSearchOwner: Promise<PublicSearch> | undefined;
async function defaultPublicSearch(): Promise<PublicSearch> {
  publicSearchOwner ??= (async () => {
    // Standalone deployments install the SDK or configure its canonical source module explicitly.
    const sdk = await import(process.env.GOOGLE_SEARCH_SDK_MODULE || "@aphrody/bun-google/search");
    return sdk.createGooglePublicSearch({
      executable: process.env.GOOGLE_SEARCH_OWNER || "aphrody",
    }) as PublicSearch;
  })().catch((error: unknown) => {
    publicSearchOwner = undefined;
    throw error;
  });
  return publicSearchOwner;
}

export async function publicSearchResponse(
  request: Request,
  search?: PublicSearch,
  indexSearch?: PublicIndexSearch,
  env: Record<string, string | undefined> = process.env,
): Promise<Response> {
  const headers = { ...SECURITY_HEADERS, "cache-control": "no-store" };
  if (request.method !== "GET")
    return Response.json({ error: "method not allowed" }, { status: 405, headers: { ...headers, allow: "GET" } });
  const params = new URL(request.url).searchParams;
  const allowed = new Set(["query", "vertical", "hl", "safe", "start", "num"]);
  const query = params.get("query")?.trim() ?? "";
  const hl = params.get("hl") ?? "en";
  const start = params.get("start") ?? "0";
  const num = params.get("num") ?? "10";
  if (
    [...params.keys()].some(key => !allowed.has(key) || params.getAll(key).length !== 1) ||
    !query ||
    new TextEncoder().encode(query).byteLength > 4096 ||
    Array.from(query).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    (params.get("vertical") ?? "web") !== "web" ||
    (params.get("safe") ?? "active") !== "active" ||
    !/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(hl) ||
    !/^\d{1,4}$/.test(start) ||
    Number(start) > 1000 ||
    !/^\d{1,2}$/.test(num) ||
    Number(num) < 1 ||
    Number(num) > 20
  )
    return Response.json({ error: "invalid public search request" }, { status: 400, headers });
  try {
    const backend = env.PUBLIC_SEARCH_BACKEND?.trim() || "google";
    if (backend === "public-index") {
      const collection = env.PUBLIC_INDEX_DEFAULT_COLLECTION?.trim();
      if (!collection || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(collection))
        throw new Error("Public search collection is not configured");
      const url = new URL("/api/index/search", request.url);
      url.search = new URLSearchParams({
        query,
        collection,
        num,
        start,
      }).toString();
      const conditional = request.headers.get("if-none-match");
      return publicIndexResponse(
        new Request(url, {
          signal: request.signal,
          headers: conditional ? { "if-none-match": conditional } : {},
        }),
        indexSearch,
      );
    }
    if (backend !== "google") throw new Error("Unsupported public search backend");
    const owner = search ?? (await defaultPublicSearch());
    const result = await owner(
      {
        query,
        vertical: "web",
        safe: "active",
        hl,
        start: Number(start),
        num: Number(num),
      },
      request.signal,
    );
    return Response.json(result, { headers });
  } catch {
    return Response.json({ error: "Search is unavailable. Please try again." }, { status: 503, headers });
  }
}

let publicIndexOwner: { key: string; search: Promise<PublicIndexSearch> } | undefined;

/** Import only an explicitly configured public SDK. Type-only imports keep this server standalone. */
export async function configuredPublicIndexSearch(
  env: Record<string, string | undefined> = process.env,
): Promise<PublicIndexSearch> {
  const module = env.PUBLIC_INDEX_SDK_MODULE?.trim();
  const root = env.PUBLIC_INDEX_ROOT?.trim();
  const encoded = env.PUBLIC_INDEX_COLLECTIONS;
  if (
    !module ||
    module.length > 4096 ||
    !root ||
    !isAbsolute(root) ||
    root.includes("\0") ||
    !encoded ||
    encoded.length > 16384
  )
    throw new Error("Public index is not configured");
  const collections = JSON.parse(encoded) as PublicIndexSdkOptions["collections"];
  if (!collections || typeof collections !== "object" || Array.isArray(collections))
    throw new Error("Invalid public index configuration");
  const entries = Object.entries(collections);
  if (
    !entries.length ||
    entries.length > 8 ||
    entries.some(
      ([name, policy]) =>
        !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name) ||
        !policy ||
        typeof policy !== "object" ||
        policy.pointer !== `${name}.pointer.json` ||
        !Array.isArray(policy.hosts) ||
        !policy.hosts.length ||
        policy.hosts.length > 32 ||
        policy.hosts.some(host => typeof host !== "string" || !/^[a-z0-9.-]+$/.test(host)) ||
        typeof policy.policySha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(policy.policySha256) ||
        typeof policy.owner !== "string" ||
        !policy.owner.trim() ||
        policy.owner.length > 128,
    )
  )
    throw new Error("Invalid public index configuration");
  const key = JSON.stringify([module, root, collections]);
  if (!publicIndexOwner || publicIndexOwner.key !== key) {
    const search = (async () => {
      const sdk = await import(module);
      if (typeof sdk.createPublicIndexSearch !== "function") throw new Error("Public index SDK unavailable");
      const owner: unknown = sdk.createPublicIndexSearch({
        root,
        collections,
      } satisfies PublicIndexSdkOptions);
      if (typeof owner !== "function") throw new Error("Public index SDK unavailable");
      return owner as PublicIndexSearch;
    })();
    publicIndexOwner = { key, search };
    search.catch(() => {
      if (publicIndexOwner?.key === key) publicIndexOwner = undefined;
    });
  }
  return publicIndexOwner.search;
}

/** Public projection only; the SDK owns bounded cache, hashes, collection isolation and FTS. */
export async function publicIndexResponse(request: Request, search?: PublicIndexSearch): Promise<Response> {
  const headers = { ...SECURITY_HEADERS, "cache-control": "no-store" };
  if (request.method !== "GET")
    return Response.json(
      { error: "method not allowed" },
      {
        status: 405,
        headers: { ...headers, allow: "GET" },
      },
    );
  const params = new URL(request.url).searchParams;
  const rawQuery = params.get("query") ?? "";
  const query = rawQuery.trim();
  const collection = params.get("collection") ?? "";
  const num = params.get("num") ?? "10";
  const start = params.get("start") ?? "0";
  const allowed = new Set(["query", "collection", "num", "start"]);
  if (
    [...params.keys()].some(key => !allowed.has(key) || params.getAll(key).length !== 1) ||
    !query ||
    new TextEncoder().encode(rawQuery).byteLength > 4096 ||
    Array.from(rawQuery).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(collection) ||
    !/^\d{1,2}$/.test(num) ||
    Number(num) < 1 ||
    Number(num) > 20 ||
    !/^\d{1,4}$/.test(start) ||
    Number(start) > 1000
  )
    return Response.json({ error: "invalid public index request" }, { status: 400, headers });
  try {
    request.signal.throwIfAborted();
    const owner = search ?? (await configuredPublicIndexSearch());
    request.signal.throwIfAborted();
    const result = await owner({ query, collection, num: Number(num), start: Number(start) }, request.signal);
    request.signal.throwIfAborted();
    const body = result?.body;
    if (
      !body ||
      body.query !== query ||
      body.collection !== collection ||
      body.source !== "public-crawl-cache" ||
      typeof body.generatedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(body.generatedAt) ||
      !Number.isFinite(Date.parse(body.generatedAt)) ||
      !Array.isArray(body.organic) ||
      body.organic.length > Number(num) ||
      !/^(?:W\/)?"[A-Za-z0-9._:-]{1,128}"$/.test(result.etag) ||
      !["hit", "miss"].includes(result.cache)
    )
      throw new Error("Invalid public index response");
    const organic = body.organic.map(hit => {
      if (
        !hit ||
        typeof hit.title !== "string" ||
        hit.title.length > 2048 ||
        typeof hit.snippet !== "string" ||
        hit.snippet.length > 4096 ||
        typeof hit.url !== "string" ||
        hit.url.length > 8192
      )
        throw new Error("Invalid public index response");
      const url = new URL(hit.url);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
        throw new Error("Invalid public index response");
      return { title: hit.title, url: hit.url, snippet: hit.snippet };
    });
    const successHeaders = {
      ...SECURITY_HEADERS,
      "cache-control": "public, max-age=0, must-revalidate",
      etag: result.etag,
      "x-public-index-cache": result.cache,
    };
    const conditional = request.headers
      .get("if-none-match")
      ?.split(",")
      .map(value => value.trim().replace(/^W\//, ""));
    if (conditional?.some(value => value === "*" || value === result.etag.replace(/^W\//, "")))
      return new Response(null, { status: 304, headers: successHeaders });
    return Response.json(
      {
        query,
        organic,
        source: body.source,
        collection,
        generatedAt: body.generatedAt,
      },
      { headers: successHeaders },
    );
  } catch {
    return Response.json({ error: "Public index is unavailable. Please try again." }, { status: 503, headers });
  }
}

export function createHandler(
  rootInput: string,
  site?: SiteOptions,
  search?: PublicSearch,
  indexSearch?: PublicIndexSearch,
): (request: Request) => Promise<Response> {
  const downloads = downloadsHandler(resolve(rootInput));
  if (!site) return downloads;
  return async request => {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === "/api/index/search" && site.hosts.has(url.hostname.toLowerCase()))
      return publicIndexResponse(request, indexSearch);
    if (pathname === "/api/search" && site.hosts.has(url.hostname.toLowerCase()))
      return publicSearchResponse(request, search, indexSearch);
    if (
      !site.hosts.has(url.hostname.toLowerCase()) ||
      pathname === "/health" ||
      pathname === "/healthz" ||
      (request.method !== "GET" && request.method !== "HEAD")
    )
      return downloads(request);
    if (site.appUiRoot && (pathname === "/" || pathname === "/index.html" || pathname.startsWith("/_app-ui/"))) {
      const appUi = await appUiResponse(request, site.appUiRoot);
      if (appUi) return appUi;
    }
    const file = resolveSiteFile(site.root, pathname.replace(/(.)\/+$/, "$1"));
    if (file) return siteResponse(request, file);
    if (site.appUiRoot) {
      const docs = await appUiDocsResponse(request, site.appUiRoot);
      if (docs) return docs;
      const appUi = await appUiResponse(request, site.appUiRoot);
      if (appUi) return appUi;
    }
    const response = await downloads(request);
    if (response.status === 404) {
      const notFound = resolveSiteFile(site.root, "/404.html");
      if (notFound) return siteResponse(request, notFound, 404);
    }
    return response;
  };
}

function downloadsHandler(root: string): (request: Request) => Promise<Response> {
  return async request => {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", {
        status: 405,
        headers: withHeaders({ allow: "GET, HEAD" }),
      });
    }
    const head = request.method === "HEAD";
    const path = url.pathname;

    if (path === "/health" || path === "/healthz") {
      const manifest = await readManifest(root);
      const body = JSON.stringify({
        ok: manifest !== null,
        release: manifest?.release.id ?? null,
        artifacts: manifest?.artifacts.length ?? 0,
      });
      return new Response(head ? null : body, {
        status: manifest ? 200 : 503,
        headers: withHeaders({
          "content-type": "application/json",
          "cache-control": "no-store",
        }),
      });
    }

    if (path === "/" || path === "/index.html") {
      const html = renderIndex(await readManifest(root));
      return new Response(head ? null : html, {
        headers: withHeaders({
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=60",
        }),
      });
    }

    let releaseRoot = root;
    let resourcePath = path;
    const immutable = path.startsWith("/releases/");
    if (immutable) {
      const match = /^\/releases\/([^/]+)(\/.*)$/.exec(path);
      let id: string;
      try {
        id = match ? decodeURIComponent(match[1]!) : "";
      } catch {
        return new Response("bad request", {
          status: 400,
          headers: withHeaders({}),
        });
      }
      const pinnedRoot = resolveRelease(root, id);
      if (!match || pinnedRoot === null)
        return new Response("not found", {
          status: 404,
          headers: withHeaders({}),
        });
      releaseRoot = pinnedRoot;
      resourcePath = match[2]!;
    }

    if (PUBLIC_ASSETS.has(resourcePath.slice(1))) {
      const real = resolveContainedFile(releaseRoot, "", resourcePath.slice(1));
      if (real === null)
        return new Response("not found", {
          status: 404,
          headers: withHeaders({}),
        });
      const file = Bun.file(real);
      const ext = resourcePath.slice(resourcePath.lastIndexOf("."));
      return new Response(head ? null : file, {
        headers: withHeaders({
          "content-type": TEXT_TYPES[ext] ?? "text/plain; charset=utf-8",
          "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=60",
          "access-control-allow-origin": "*",
        }),
      });
    }

    if (resourcePath.startsWith("/files/")) {
      let name: string;
      try {
        name = decodeURIComponent(resourcePath.slice("/files/".length));
      } catch {
        return new Response("bad request", {
          status: 400,
          headers: withHeaders({}),
        });
      }
      const real = resolveFile(releaseRoot, name);
      if (real === null)
        return new Response("not found", {
          status: 404,
          headers: withHeaders({}),
        });
      const file = Bun.file(real);
      const size = file.size;
      const type = TEXT_TYPES[name.slice(name.lastIndexOf("."))] ?? "application/octet-stream";
      const headers = withHeaders({
        "content-type": type,
        "accept-ranges": "bytes",
        "cache-control": "public, max-age=31536000, immutable",
        "content-disposition": `attachment; filename="${basename(real).replace(/"/g, "")}"`,
      });
      const range = parseRange(request.headers.get("range"), size);
      if (range === "invalid") {
        headers.set("content-range", `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }
      if (range === null) {
        headers.set("content-length", String(size));
        return new Response(head ? null : file, { headers });
      }
      const [start, end] = range;
      headers.set("content-range", `bytes ${start}-${end}/${size}`);
      headers.set("content-length", String(end - start + 1));
      return new Response(head ? null : file.slice(start, end + 1), {
        status: 206,
        headers,
      });
    }

    return new Response("not found", { status: 404, headers: withHeaders({}) });
  };
}

export function startPublicServer(env: Record<string, string | undefined> = process.env) {
  const { root, port, hostname } = serverOptions(env);
  const handler = createHandler(root, siteOptions(root, env));
  return Bun.serve({ port, hostname, idleTimeout: 120, fetch: handler });
}

if (import.meta.main) {
  const server = startPublicServer();
  console.log(`Aphrody public listening on http://${server.hostname}:${server.port}`);
}
