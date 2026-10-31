/**
 * Google Fonts edge proxy for cdn.aphrody.com: the same paths as fonts.googleapis.com (`/css2`,
 * `/css`, `/icon`) and fonts.gstatic.com (`/s/...`), fetched once from Google through the Bun Google
 * edge proxy, stored on disk and served from there. CSS is requested with a modern browser
 * User-Agent (WOFF2 + unicode-range subsets) and its gstatic URLs are rewritten to this origin.
 * Only the allowed families are proxied (default: the Material 3 fonts and Material Symbols).
 * With `staticRoot`, the files of the asset CDN release trees (`/h/`, `/s/<scope>/`) are served
 * first, roots in order; paths none holds fall through to the proxy.
 */
import { stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { type EdgeRoute, createEdgeProxy } from "./edge-proxy.ts";

export const M3_FONT_FAMILIES = [
  "Google Sans Flex",
  "Google Sans Code",
  "Roboto Flex",
  "Roboto Mono",
  "Noto Sans JP",
  "M PLUS 1 Code",
  "Material Symbols Outlined",
  "Material Symbols Rounded",
  "Material Symbols Sharp",
];

const GOOGLEAPIS = "https://fonts.googleapis.com";
const GSTATIC = "https://fonts.gstatic.com";
/** Google tailors the CSS to the User-Agent; this one gets WOFF2 with unicode-range subsets. */
const MODERN_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export const gstaticId = (family: string) => family.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Family names of a css2 (`family=A:wght@400`, repeated) or css v1 (`family=A:400|B`) query. */
export function requestedFamilies(params: URLSearchParams): string[] {
  return params
    .getAll("family")
    .flatMap(v => v.split("|"))
    .map(v => v.split(":")[0]!.trim())
    .filter(Boolean);
}

export interface FontsProxyOptions {
  cacheDir: string;
  /** Public origin written into the CSS, e.g. `https://cdn.aphrody.com`. */
  origin: string;
  /** Allowed family names; `null` proxies every family. */
  families?: readonly string[] | null;
}

const CSS_PATHS = new Set(["/css", "/css2", "/icon"]);
const FONT_FILE = /^\/s\/([a-z0-9]+)\/v\d+\/[A-Za-z0-9_-]+\.(woff2|woff|ttf|otf)$/;
const ICON_FILE =
  /^\/s\/i\/(?:short-term\/release\/)?(materialsymbols(?:outlined|rounded|sharp)|materialicons[a-z]*)\/[a-z0-9_]+\/[a-z0-9]+\/[0-9]+px\.svg$/;

const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex").slice(0, 32);

export function fontsRoute(url: URL, opts: FontsProxyOptions): EdgeRoute | Response | null {
  const allowed =
    opts.families === null ? null : new Set((opts.families ?? M3_FONT_FAMILIES).map(f => f.toLowerCase()));
  const allowedIds = allowed && new Set([...allowed].map(gstaticId));
  const origin = opts.origin.replace(/\/$/, "");
  if (CSS_PATHS.has(url.pathname)) {
    const families = requestedFamilies(url.searchParams);
    if (!families.length) return new Response("Bad Request: missing family\n", { status: 400 });
    const denied = allowed && families.filter(f => !allowed.has(f.toLowerCase()));
    if (denied?.length) return new Response(`Forbidden: ${denied.join(", ")}\n`, { status: 403 });
    const search = url.searchParams.toString();
    return {
      upstream: new URL(`${GOOGLEAPIS}${url.pathname}?${search}`),
      cacheKey: `css${url.pathname}/${sha(search)}.css`,
      kind: "text",
      headers: { "user-agent": MODERN_UA, accept: "text/css,*/*;q=0.1" },
      transform: css => css.replaceAll(GSTATIC, origin),
    };
  }
  const font = FONT_FILE.exec(url.pathname);
  if (font) {
    if (allowedIds && !allowedIds.has(font[1]!)) return new Response("Forbidden\n", { status: 403 });
    return {
      upstream: new URL(`${GSTATIC}${url.pathname}`),
      cacheKey: url.pathname.slice(1),
      kind: "immutable",
    };
  }
  const icon = ICON_FILE.exec(url.pathname);
  if (icon) {
    if (allowedIds && !icon[1]!.startsWith("materialsymbols")) return new Response("Forbidden\n", { status: 403 });
    if (allowedIds && !allowedIds.has(icon[1]!)) return new Response("Forbidden\n", { status: 403 });
    return {
      upstream: new URL(`${GSTATIC}${url.pathname}`),
      cacheKey: url.pathname.slice(1),
      kind: "text",
    };
  }
  return null;
}

export function createFontsProxy(opts: FontsProxyOptions) {
  return createEdgeProxy({
    cacheDir: opts.cacheDir,
    route: url => fontsRoute(url, opts),
    headers: {
      "access-control-allow-origin": "*",
      "timing-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
      "x-content-type-options": "nosniff",
    },
  });
}

const STATIC_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};
const STATIC_PATH = /^\/[hs]\/[A-Za-z0-9._@/-]+$/;

/**
 * A file of the `scripts/tools/infra/cdn.ts` release tree under `root`: `/h/<sha16>.<ext>`
 * (immutable), `/s/manifest.json`, `/s/<scope>/<path>`. `null` when the tree does not hold it.
 */
export async function staticFile(root: string, pathname: string): Promise<Response | null> {
  if (!STATIC_PATH.test(pathname) || pathname.split("/").some(p => p === "." || p === "..")) return null;
  const path = join(root, pathname);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return null;
  const cache = pathname.startsWith("/h/")
    ? "public, max-age=31536000, immutable"
    : pathname === "/s/manifest.json"
      ? "public, max-age=60, must-revalidate"
      : "public, max-age=3600, stale-while-revalidate=86400";
  const file = Bun.file(path);
  return new Response(file, {
    headers: {
      "content-type": STATIC_TYPES[extname(path).toLowerCase()] ?? file.type,
      "cache-control": cache,
      "access-control-allow-origin": "*",
      "timing-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

/**
 * The first of `roots` holding `pathname`: the catalog release (`scripts/tools/infra/cdn.ts`) and the
 * releases published from other repositories (Material Symbols: `asset-catalog.json` `releases`).
 */
export async function staticFromRoots(roots: readonly string[], pathname: string): Promise<Response | null> {
  const found = await Promise.all(roots.map(root => staticFile(root, pathname)));
  return found.find(response => response !== null) ?? null;
}

export function serveFontsProxy(
  opts: FontsProxyOptions & {
    port?: number;
    hostname?: string;
    staticRoot?: string | readonly string[];
  },
) {
  const handle = createFontsProxy(opts);
  const roots = [opts.staticRoot ?? []].flat().filter(Boolean);
  return Bun.serve({
    hostname: opts.hostname ?? "127.0.0.1",
    port: opts.port ?? 8796,
    routes: { "/health": Response.json({ ok: true, service: "aphrody-fonts-proxy" }) },
    fetch: async req => {
      if (roots.length && (req.method === "GET" || req.method === "HEAD")) {
        const file = await staticFromRoots(roots, new URL(req.url).pathname);
        if (file) return file;
      }
      return handle(req);
    },
  });
}
