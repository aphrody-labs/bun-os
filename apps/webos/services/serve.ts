// SPDX-License-Identifier: Apache-2.0
// The WebOS Bun service (ADR-002): Bun.serve with the API routes, the store API, health and the static release.
// Production runs the bundled server.js at the root of an immutable release (deploy.ts); development runs this file.
import { stat } from "node:fs/promises";
import { join, relative, resolve, isAbsolute } from "node:path";
import { apiRoutes, handle, type ServiceContext } from "./router";
import { publicFetch } from "./public-fetch";
import { storeApi } from "../store/api";
import type { HealthResponse, RequestLog } from "../contracts/api";

/** apps/webos in development, the release directory when bundled. */
const home = import.meta.dir.replaceAll("\\", "/").endsWith("/services")
  ? resolve(import.meta.dir, "..")
  : import.meta.dir;
const dist = resolve(Bun.env.WEBOS_DIST ?? join(home, "dist"));
const objects = resolve(
  Bun.env.WEBOS_OBJECTS ?? join(home, "../../build/webos-objects"),
);
async function objectFile(key: string) {
  if (
    !key ||
    key
      .split("/")
      .some(
        (part) =>
          !part || part === "." || part === ".." || /[\\:\0]/.test(part),
      )
  )
    throw new Error("Invalid object key");
  const shared = Bun.file(join(objects, key));
  return (await shared.exists())
    ? shared
    : Bun.file(join(home, "objects", key));
}
const vm = {
  async head(key: string) {
    const file = await objectFile(key);
    return (await file.exists())
      ? {
          size: file.size,
          httpEtag: `"${file.size.toString(16)}-${Math.trunc(file.lastModified).toString(16)}"`,
        }
      : null;
  },
  async get(
    key: string,
    options?: { range?: { offset: number; length?: number } },
  ) {
    const file = await objectFile(key);
    if (!(await file.exists())) return null;
    const r = options?.range;
    const slice = r
      ? file.slice(r.offset, r.offset + (r.length ?? file.size - r.offset))
      : file;
    return {
      body: slice.stream(),
      size: file.size,
      httpEtag: `"${file.size.toString(16)}-${Math.trunc(file.lastModified).toString(16)}"`,
    };
  },
};
const assets = {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response("Bad path", { status: 400 });
    }
    const parts = pathname.split("/").filter(Boolean);
    if (parts.some((part) => part === ".." || /[\\:\0]/.test(part)))
      return new Response("Bad path", { status: 400 });
    const path = parts.join("/");
    const candidates = [
      path,
      join(path, "index.html"),
      ...(!parts.at(-1)?.includes(".") ? ["index.html"] : []),
    ];
    for (const candidate of candidates) {
      const full = resolve(dist, candidate);
      const within = relative(dist, full);
      if (within.startsWith("..") || isAbsolute(within))
        return new Response("Bad path", { status: 400 });
      const file = Bun.file(full);
      if (await file.exists()) {
        const etag = `W/"${file.size.toString(16)}-${Math.trunc(file.lastModified).toString(16)}"`;
        const headers = {
          "content-type": file.type,
          etag,
          "cache-control": "no-cache",
        };
        const matches = request.headers
          .get("if-none-match")
          ?.split(",")
          .some((value) => value.trim() === etag || value.trim() === "*");
        if (matches) return new Response(null, { status: 304, headers });
        return new Response(request.method === "HEAD" ? null : file, {
          headers,
        });
      }
    }
    return new Response("Not found", { status: 404 });
  },
};

const started = Date.now();
const SESSION_HEALTH =
  Bun.env.WEBOS_SESSION_HEALTH ?? "http://127.0.0.1:8793/api/wayland/health";
async function health(): Promise<Response> {
  const inventory = await assets
    .fetch(new Request("http://local/api/inventory.json"))
    .then(async (r) =>
      r.ok
        ? ((await r.json()) as {
            counts: Record<string, number>;
            total: number;
          })
        : undefined,
    )
    .catch(() => undefined);
  const checks: HealthResponse["checks"] = {
    assets: (await Bun.file(join(dist, "index.html")).exists())
      ? { ok: true }
      : { ok: false, detail: "dist/index.html missing" },
    objects: (await stat(objects).then(
      (st) => st.isDirectory(),
      () => false,
    ))
      ? { ok: true, optional: true }
      : {
          ok: false,
          optional: true,
          detail: `object store ${objects} missing`,
        },
    inventory: inventory
      ? { ok: true }
      : { ok: false, detail: "inventory.json unavailable" },
    session: await fetch(SESSION_HEALTH, { signal: AbortSignal.timeout(1500) })
      .then(async (r) =>
        ((await r.json()) as { session?: boolean }).session === true
          ? { ok: true, optional: true }
          : {
              ok: false,
              optional: true,
              detail: "Hyprland session not running",
            },
      )
      .catch(() => ({
        ok: false,
        optional: true,
        detail: "session gateway unreachable",
      })),
  };
  const ok = Object.values(checks).every((c) => c.ok || c.optional);
  const body: HealthResponse = {
    ok,
    service: "aphrody-webos",
    sourceCommit: Bun.env.SOURCE_COMMIT ?? null,
    uptimeSeconds: Math.round((Date.now() - started) / 1000),
    time: new Date().toISOString(),
    inventory: inventory
      ? { total: inventory.total, counts: inventory.counts }
      : null,
    checks,
  };
  return Response.json(body, {
    status: ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}

const ctx: ServiceContext = { assets, objects: vm, browseFetch: publicFetch };

function logged(handler: (request: Request) => Response | Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    const t0 = performance.now();
    const response = await handler(request);
    const entry: RequestLog = {
      ts: new Date().toISOString(),
      id: request.headers.get("x-request-id") ?? crypto.randomUUID(),
      method: request.method,
      path: new URL(request.url).pathname,
      status: response.status,
      ms: Math.round(performance.now() - t0),
    };
    if (entry.path.startsWith("/api/") || entry.status >= 400)
      console.log(JSON.stringify(entry));
    return response;
  };
}

const routes: Record<string, (request: Request) => Promise<Response>> = {};
for (const path of ["/api/health", "/health", "/healthz"])
  routes[path] = logged(health);
for (const [path, handler] of Object.entries(apiRoutes(ctx)))
  routes[path] = logged(handler);

const server = Bun.serve({
  port: Number(Bun.env.PORT ?? Bun.argv[2] ?? 8790),
  hostname: "127.0.0.1",
  maxRequestBodySize: 1024 * 1024,
  idleTimeout: 30,
  routes,
  fetch: logged(
    async (request) => (await storeApi(request)) ?? handle(request, ctx),
  ),
});
console.log(
  JSON.stringify({
    ts: new Date().toISOString(),
    event: "listening",
    url: String(server.url),
  }),
);
