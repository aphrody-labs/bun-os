// SPDX-License-Identifier: MIT
/**
 * Native Bun caching edge proxy: a route table maps a request to an upstream URL and a cache key;
 * the first request fetches and stores it (concurrent misses coalesced, a brotli-11 `.br` twin for
 * compressible types), later requests are served from disk with `Bun.file`. Immutable entries
 * never expire; text entries are refreshed after `ttlMs` while the stale copy keeps being served.
 *
 * Each fill writes a new generation (`<key>~<n>`, `<key>~<n>.br`) and then `<key>.meta.json`
 * naming it, so a reader never sees a half-written body; the previous generation is deleted.
 */

export type EdgeKind = "immutable" | "text";

export interface EdgeRoute {
  upstream: URL;
  /** Cache key relative to the cache root: `[A-Za-z0-9._-]` segments joined by `/`. */
  cacheKey: string;
  kind: EdgeKind;
  /** Rewrites a text body before it is stored (e.g. upstream URLs → this origin). */
  transform?: (body: string) => string;
  /** Request headers sent upstream (a fixed User-Agent selects the upstream variant). */
  headers?: Record<string, string>;
}

export interface EdgeProxyOptions {
  cacheDir: string;
  route: (url: URL, req: Request) => EdgeRoute | Response | null;
  ttlMs?: number;
  timeoutMs?: number;
  maxBytes?: number;
  /** Headers added to every response. */
  headers?: Record<string, string>;
  cacheControl?: Record<EdgeKind, string>;
}

interface Meta {
  type: string;
  fetchedAt: number;
  /** Generation file name (sibling of the meta file). */
  body: string;
  br: boolean;
}

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml)|image\/svg\+xml)/;
const KEY = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

export const validEdgeKey = (key: string): boolean =>
  KEY.test(key) && !key.split("/").some(s => s === "." || s === "..");

// Bun's CompressionStream accepts brotli and a level; the DOM lib types know neither.
const BrotliStream = CompressionStream as unknown as new (
  format: "brotli",
  options: { level: number },
) => CompressionStream;

async function brotli(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new BrotliStream("brotli", { level: 11 }));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

/** Longest key segment stored verbatim: generation (`~<base36>`, `.br`) and `.meta.json` suffixes stay under
 * NAME_MAX (255); longer ones (variable-font file names on gstatic reach 262) become prefix + digest. */
const MAX_SEGMENT = 200;

export function edgeDiskPath(root: string, key: string): string {
  const cut = key.lastIndexOf("/") + 1;
  const name = key.slice(cut);
  if (Buffer.byteLength(name) <= MAX_SEGMENT) return `${root}/${key}`;
  const digest = new Bun.CryptoHasher("sha256").update(name).digest("hex").slice(0, 32);
  return `${root}/${key.slice(0, cut)}${name.slice(0, 64)}-${digest}`;
}

const acceptsBrotli = (req: Request) => /\bbr\b/.test(req.headers.get("accept-encoding") ?? "");

class UpstreamError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createEdgeProxy(options: EdgeProxyOptions) {
  const root = options.cacheDir.replace(/\/+$/, "");
  const ttl = options.ttlMs ?? 86_400_000;
  const timeout = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
  const cacheControl = options.cacheControl ?? {
    immutable: "public, max-age=31536000, immutable",
    text: "public, max-age=86400, stale-while-revalidate=604800",
  };
  const inflight = new Map<string, Promise<Meta>>();

  async function readMeta(path: string): Promise<Meta | null> {
    const f = Bun.file(`${path}.meta.json`);
    if (!(await f.exists())) return null;
    try {
      const meta = (await f.json()) as Meta;
      return (await Bun.file(`${dirOf(path)}/${meta.body}`).exists()) ? meta : null;
    } catch {
      return null;
    }
  }

  async function fill(route: EdgeRoute, path: string): Promise<Meta> {
    const res = await fetch(route.upstream, {
      headers: route.headers,
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) throw new UpstreamError(res.status, `upstream ${res.status}`);
    if (Number(res.headers.get("content-length") ?? 0) > maxBytes) throw new UpstreamError(502, "upstream too large");
    let body = await res.bytes();
    if (body.byteLength > maxBytes) throw new UpstreamError(502, "upstream too large");
    if (route.transform) body = new TextEncoder().encode(route.transform(new TextDecoder().decode(body)));
    const type = res.headers.get("content-type") ?? "application/octet-stream";
    const previous = await readMeta(path);
    const name = `${path.slice(path.lastIndexOf("/") + 1)}~${Date.now().toString(36)}`;
    const generation = `${dirOf(path)}/${name}`;
    await Bun.write(generation, body);
    const br = COMPRESSIBLE.test(type);
    if (br) await Bun.write(`${generation}.br`, await brotli(body));
    const meta: Meta = { type, fetchedAt: Date.now(), body: name, br };
    await Bun.write(`${path}.meta.json`, JSON.stringify(meta));
    if (previous && previous.body !== name) {
      const old = `${dirOf(path)}/${previous.body}`;
      // Readers that opened the old generation keep their descriptor; new ones see the new meta.
      setTimeout(() => {
        Bun.file(old)
          .delete()
          .catch(() => {});
        if (previous.br)
          Bun.file(`${old}.br`)
            .delete()
            .catch(() => {});
      }, 60_000).unref();
    }
    return meta;
  }

  function coalesced(route: EdgeRoute, path: string): Promise<Meta> {
    let p = inflight.get(path);
    if (!p) {
      p = fill(route, path).finally(() => inflight.delete(path));
      inflight.set(path, p);
    }
    return p;
  }

  function respond(req: Request, route: EdgeRoute, path: string, meta: Meta, status: string): Response {
    const headers: Record<string, string> = {
      ...options.headers,
      "content-type": meta.type,
      "cache-control": cacheControl[route.kind],
      "x-edge-cache": status,
    };
    const body = `${dirOf(path)}/${meta.body}`;
    if (meta.br) headers.vary = "Accept-Encoding";
    const useBr = meta.br && acceptsBrotli(req);
    if (useBr) headers["content-encoding"] = "br";
    if (req.method === "HEAD") return new Response(null, { headers });
    return new Response(Bun.file(useBr ? `${body}.br` : body), { headers });
  }

  return async function handle(req: Request): Promise<Response> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    const route = options.route(new URL(req.url), req);
    if (route instanceof Response) return route;
    if (!route || !validEdgeKey(route.cacheKey)) return new Response("Not Found", { status: 404 });
    const path = edgeDiskPath(root, route.cacheKey);
    try {
      const meta = await readMeta(path);
      if (meta) {
        if (route.kind === "text" && Date.now() - meta.fetchedAt > ttl) {
          coalesced(route, path).catch(() => {});
          return respond(req, route, path, meta, "STALE");
        }
        return respond(req, route, path, meta, "HIT");
      }
      return respond(req, route, path, await coalesced(route, path), "MISS");
    } catch (e) {
      const status = e instanceof UpstreamError ? e.status : 502;
      const code = status >= 400 && status < 500 ? status : 502;
      return new Response(code === 502 ? "Bad Gateway" : "Not Found", {
        status: code,
        headers: { ...options.headers, "cache-control": "public, max-age=60" },
      });
    }
  };
}
