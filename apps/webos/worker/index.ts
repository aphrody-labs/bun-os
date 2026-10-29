// SPDX-License-Identifier: Apache-2.0
// aphrody.com edge: static Bun OS shell + /api/health + /api/browse (script-free reader proxy for the Bun Browser).
import { workspaceResponse } from "./workspace";
import { gameContentResponse } from "./game-content";
import { playResponse } from "./play";
import { downloadsResponse } from "./downloads";
import { APP_SERVER_PATHS, appServerResponse } from "./app-server";
import { ROUTES } from "../src/config";
import { ORIGIN, pathMeta } from "../paths";
import vmLock from "../vm.lock.json";

interface R2ObjectBodyLike {
  body: ReadableStream;
  size: number;
  httpEtag: string;
  range?: { offset: number; length: number };
}
interface Env {
  SOURCE_COMMIT?: string;
  BROWSE_FETCH?: (url: string, init: RequestInit) => Promise<Response>;
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** The former aphrody-app Worker, kept as the private backend of the merged API routes (service binding). */
  LEGACY: { fetch(request: Request): Promise<Response> };
  /** R2 bucket aphrody-assets; large VM images live under webos/vm/. */
  VM: {
    get(
      key: string,
      options?: { range?: { offset: number; length?: number } },
    ): Promise<R2ObjectBodyLike | null>;
    head(key: string): Promise<{ size: number; httpEtag: string } | null>;
  };
}

const ISO_KEY = `webos/vm/${vmLock.alpine.iso.name}`;

/** Serve the Alpine ISO from R2 with Range support (v86 reads it in chunks). */
async function iso(request: Request, env: Env): Promise<Response> {
  const head = await env.VM.head(ISO_KEY);
  if (!head) return new Response("Disk image not published.", { status: 404 });
  const headers = new Headers({
    "accept-ranges": "bytes",
    "content-type": "application/octet-stream",
    "cache-control": "no-store",
    etag: head.httpEtag,
    "cross-origin-resource-policy": "same-origin",
  });
  const m = /^bytes=([0-9]*)-([0-9]*)$/.exec(
    request.headers.get("range") ?? "",
  );
  if (request.method === "HEAD") {
    headers.set("content-length", String(head.size));
    return new Response(null, { headers });
  }
  if (!m) {
    const full = await env.VM.get(ISO_KEY);
    headers.set("content-length", String(head.size));
    return new Response(full?.body ?? null, { headers });
  }
  let start =
    m[1] === "" ? Math.max(0, head.size - Number(m[2])) : Number(m[1]);
  const end =
    m[1] === "" || m[2] === ""
      ? head.size - 1
      : Math.min(Number(m[2]), head.size - 1);
  if (start > end || start >= head.size)
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${head.size}` },
    });
  start = Math.max(0, start);
  const part = await env.VM.get(ISO_KEY, {
    range: { offset: start, length: end - start + 1 },
  });
  headers.set("content-range", `bytes ${start}-${end}/${head.size}`);
  headers.set("content-length", String(end - start + 1));
  return new Response(part?.body ?? null, { status: 206, headers });
}

const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

// Installed app packages are hash-verified and same-origin; their pages carry an inline module script.
const APP_CSP = PAGE_CSP.replace(
  "script-src 'self'",
  "script-src 'self' 'unsafe-inline'",
)
  .replace("connect-src 'self'", "connect-src 'self' blob: data:")
  .replace("img-src", "media-src 'self' blob: data:; img-src");
// Cross-origin isolation enables the threaded emulators; credentialless keeps third-party images working.
const ISOLATION = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "credentialless",
};

const MAX_BYTES = 4_000_000;
const PRIVATE_HOST =
  /^(localhost|.*\.(local|internal|localhost|lan|home\.arpa))$/i;

function blockedHost(host: string): boolean {
  if (PRIVATE_HOST.test(host) || host.includes(":") || host.startsWith("["))
    return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return !host.includes(".");
}

const NAV_SCRIPT = (
  base: string,
) => `(()=>{const p=u=>parent.postMessage({aph:"nav",url:u},"*");
parent.postMessage({aph:"nav",url:${JSON.stringify(base)},title:document.title},"*");
addEventListener("click",e=>{const a=e.target.closest&&e.target.closest("a[href]");if(!a||e.defaultPrevented||e.ctrlKey||e.metaKey)return;
if(/^https?:/i.test(a.href)){e.preventDefault();p(a.href)}});
addEventListener("submit",e=>{const f=e.target;if((f.method||"get").toLowerCase()!=="get")return;e.preventDefault();
const u=new URL(f.action||${JSON.stringify(base)});for(const [k,v] of new FormData(f))if(typeof v==="string")u.searchParams.set(k,v);p(u.href)});})();`;

async function browse(
  request: Request,
  fetchPage: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<Response> {
  const target = new URL(request.url).searchParams.get("url") ?? "";
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return new Response("Invalid URL", { status: 400 });
  }
  if (
    !/^https?:$/.test(url.protocol) ||
    blockedHost(url.hostname) ||
    url.username ||
    url.password
  ) {
    return new Response("This address cannot be opened here.", { status: 403 });
  }
  const upstream = await fetchPage(url.href, {
    method: "GET",
    redirect: "follow",
    headers: {
      "user-agent": `Mozilla/5.0 (compatible; AphrodyBunBrowser/1.0; +${ROUTES.origin})`,
      accept: "text/html,image/*;q=0.8,*/*;q=0.1",
      "accept-language": request.headers.get("accept-language") ?? "en",
    },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
  if (!upstream)
    return new Response("The page did not answer in time.", { status: 504 });
  const finalUrl = new URL(upstream.url);
  if (blockedHost(finalUrl.hostname))
    return new Response("Blocked redirect.", { status: 403 });
  const type = upstream.headers.get("content-type") ?? "";
  const length = Number(upstream.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES)
    return new Response("Page too large.", { status: 413 });
  const headers = new Headers({
    "cross-origin-embedder-policy": "credentialless",
    "cross-origin-resource-policy": "same-origin",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  if (type.startsWith("image/")) {
    headers.set("content-type", type);
    headers.set("content-security-policy", "sandbox");
    return new Response(upstream.body, { status: upstream.status, headers });
  }
  if (!/text\/html|application\/xhtml/i.test(type))
    return new Response("Only web pages can be shown here.", { status: 415 });

  const nonce = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12))),
  );
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set(
    "content-security-policy",
    `sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' https:; img-src https: data:; font-src https: data:; media-src https:; base-uri 'self'; frame-ancestors 'self'`,
  );
  const rewritten = new HTMLRewriter()
    .on(
      "script, iframe, frame, object, embed, base, meta[http-equiv], noscript",
      { element: (e) => void e.remove() },
    )
    .on("head", {
      element: (e) =>
        void e.prepend(
          `<base href="${finalUrl.href.replaceAll('"', "%22")}"><meta name="referrer" content="no-referrer">`,
          { html: true },
        ),
    })
    .on("a", { element: (e) => void e.removeAttribute("target") })
    .on("*", {
      element: (e) => {
        for (const [name] of e.attributes)
          if (name.startsWith("on")) e.removeAttribute(name);
      },
    })
    .on("body", {
      element: (e) =>
        void e.append(
          `<script nonce="${nonce}">${NAV_SCRIPT(finalUrl.href)}</script>`,
          { html: true },
        ),
    })
    .transform(
      new Response(upstream.body, { headers: { "content-type": type } }),
    );
  return new Response(rewritten.body, {
    status: upstream.status === 404 ? 404 : 200,
    headers,
  });
}

/** Per-path search metadata on the shell document, streamed through HTMLRewriter (no buffering). */
function withPathMeta(res: Response, pathname: string): Response {
  const meta = pathMeta(pathname);
  if (!meta || !(res.headers.get("content-type") ?? "").includes("text/html"))
    return res;
  const url = `${ORIGIN}${pathname === "/" ? "/" : pathname.replace(/\/+$/, "")}`;
  const attributes: [string, string, string][] = [
    ['meta[name="description"]', "content", meta.description],
    ['link[rel="canonical"]', "href", url],
    ['meta[property="og:url"]', "content", url],
    ['meta[property="og:title"]', "content", meta.title],
    ['meta[property="og:description"]', "content", meta.description],
    ['meta[name="twitter:title"]', "content", meta.title],
    ['meta[name="twitter:description"]', "content", meta.description],
  ];
  let rewriter = new HTMLRewriter().on("title", {
    element: (e) => void e.setInnerContent(meta.title),
  });
  for (const [selector, attr, value] of attributes)
    rewriter = rewriter.on(selector, {
      element: (e) => void e.setAttribute(attr, value),
    });
  return rewriter.transform(res);
}

/** Routes of the former aphrody.app Worker, now served under aphrody.com (same handler, same bindings). */
const LEGACY_ROUTES = ["/api/site/", "/api/yolo/", "/mcp", "/v1/"];
/** Origin the legacy Worker answers on (its former apex host); the request goes through the service binding. */
const LEGACY_ORIGIN = `https://${Object.keys(ROUTES.hosts).find((host) => ROUTES.hosts[host]!.kind === "legacy-apex")}`;

const PATH_BY_PACKAGE = new Map(
  Object.entries(ROUTES.apps).map(([path, pkg]) => [pkg, path]),
);

/** Old product hosts redirect to a path of the canonical origin (infra/config/routes.catalog.json). */
function redirectFor(url: URL): string | undefined {
  const route = ROUTES.hosts[url.hostname];
  if (route && !route.keep && route.path) {
    const rest = url.pathname === "/" ? "" : url.pathname;
    const base = route.passthrough && rest ? "" : route.path;
    const path = (base.endsWith("/") ? base.slice(0, -1) : base) + rest;
    return `${ROUTES.origin}${path || "/"}${url.search}`;
  }
  // Legacy deep link /?app=<package> becomes the package path.
  if (url.hostname === "aphrody.com" && url.pathname === "/") {
    const path = PATH_BY_PACKAGE.get(url.searchParams.get("app") ?? "");
    if (path) {
      const rest = new URL(url);
      rest.searchParams.delete("app");
      return `${ROUTES.origin}${path}${rest.search}`;
    }
  }
  return undefined;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const game = await gameContentResponse(request, env.ASSETS, env.VM);
    if (game) return game;
    if (APP_SERVER_PATHS.has(url.pathname)) return appServerResponse(request);
    const legacyPath = LEGACY_ROUTES.some(
      (prefix) =>
        url.pathname === prefix ||
        url.pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
    );
    // API clients of the old hosts keep working (no redirect): the same routes answer on every host.
    const moved = legacyPath ? undefined : redirectFor(url);
    if (moved) return Response.redirect(moved, 301);
    const gaming = await playResponse(request, env.ASSETS);
    if (gaming) {
      const out = new Response(gaming.body, gaming);
      for (const [key, value] of Object.entries(ISOLATION))
        out.headers.set(key, value);
      out.headers.set("x-content-type-options", "nosniff");
      return out;
    }
    if (legacyPath) {
      const target = new Request(
        `${LEGACY_ORIGIN}${url.pathname}${url.search}`,
        request,
      );
      return env.LEGACY.fetch(target);
    }
    if (url.pathname === "/api/catalog") {
      return env.ASSETS.fetch(
        new Request(new URL("/catalog.json", url).href, request),
      );
    }
    // Read-only Workspace catalogs (Documentation, Templates), assembled by build.ts from their owners.
    if (url.pathname === "/api/docs" || url.pathname === "/api/templates") {
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response("Method not allowed", {
          status: 405,
          headers: { allow: "GET, HEAD" },
        });
      const res = await env.ASSETS.fetch(
        new Request(new URL(`${url.pathname}.json`, url).href, request),
      );
      const out = new Response(res.body, res);
      out.headers.set("cache-control", "no-cache");
      return out;
    }
    if (
      url.pathname === "/api/health" ||
      url.pathname === "/health" ||
      url.pathname === "/healthz"
    ) {
      const cf = (request as Request & { cf?: { colo?: string } }).cf;
      return Response.json(
        {
          ok: true,
          service: "aphrody-webos",
          sourceCommit: env.SOURCE_COMMIT ?? null,
          colo: cf?.colo ?? null,
          time: new Date().toISOString(),
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    if (url.pathname === "/api/downloads") return downloadsResponse(request);
    if (url.pathname === "/api/browse") {
      if (request.method !== "GET")
        return new Response("Method not allowed", { status: 405 });
      return browse(request, env.BROWSE_FETCH);
    }
    if (
      url.pathname === "/vm/alpine.iso" &&
      (request.method === "GET" || request.method === "HEAD")
    )
      return iso(request, env);
    if (url.pathname.startsWith("/api/"))
      return new Response("Not found", { status: 404 });
    const workspace =
      url.pathname === "/workspace" || url.pathname.startsWith("/workspace/");
    const res = workspace
      ? await workspaceResponse(request, env.ASSETS)
      : withPathMeta(await env.ASSETS.fetch(request), url.pathname);
    const out = new Response(res.body, res);
    out.headers.set(
      "content-security-policy",
      workspace
        ? PAGE_CSP.replace("base-uri 'none'", "base-uri 'self'")
        : url.pathname.startsWith("/apps/")
          ? APP_CSP
          : PAGE_CSP,
    );
    for (const [k, v] of Object.entries(ISOLATION)) out.headers.set(k, v);
    out.headers.set("x-content-type-options", "nosniff");
    out.headers.set("referrer-policy", "strict-origin-when-cross-origin");
    out.headers.set(
      "strict-transport-security",
      "max-age=31536000; includeSubDomains",
    );
    if (
      workspace ||
      url.pathname === "/catalog.json" ||
      url.pathname === "/registry.json" ||
      url.pathname.endsWith("/app.json") ||
      url.pathname.endsWith("/manifest.json") ||
      url.pathname.endsWith(".html") ||
      url.pathname === "/"
    )
      out.headers.set("cache-control", "no-cache");
    else if (res.ok && /\/[a-f0-9]{12,64}\//.test(url.pathname))
      out.headers.set("cache-control", "public, max-age=31536000, immutable");
    else if (!out.headers.has("cache-control"))
      out.headers.set("cache-control", "no-cache");
    return out;
  },
};
