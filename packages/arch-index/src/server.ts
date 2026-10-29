// SPDX-License-Identifier: MIT
// HTTP API over the index (Bun.serve): JSON queries, Server-Sent Events and WebSocket event streams.
// Binds to loopback unless a bearer token is configured.
import { timingSafeEqual } from "node:crypto";
import { checkPins, closure, depTree, info, resolveName, search, type Pin, type SearchBy } from "./query.ts";
import { parseSrcinfo } from "./srcinfo.ts";
import type { Context } from "./sync.ts";
import { wslImage } from "./sync.ts";
import type { DepKind, IndexEvent } from "./store.ts";

export interface ServeOptions {
  port?: number;
  hostname?: string;
  /** Required when hostname is not loopback. Compared in constant time. */
  token?: string;
  /** Extra status fields (watch loop state). */
  status?: () => Record<string, unknown>;
}

const SEARCH_BY = new Set<SearchBy>(["name", "provides", "depends", "makedepends", "optdepends", "desc", "file", "maintainer", "group", "base"]);
const DEP_KINDS = new Set<DepKind>(["depends", "makedepends", "checkdepends", "optdepends", "provides", "conflicts", "replaces"]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const bad = (message: string, status = 400) => json({ error: message }, status);

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function authorised(req: Request, token: string | undefined): boolean {
  if (!token) return true;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? new URL(req.url).searchParams.get("token") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function startServer(ctx: Context, options: ServeOptions = {}) {
  const hostname = options.hostname ?? "127.0.0.1";
  if (!isLoopback(hostname) && !options.token) throw new Error("Refusing to listen on a non-loopback address without a token.");
  const encoder = new TextEncoder();
  const server = Bun.serve({
    port: options.port ?? 0,
    hostname,
    async fetch(req, srv) {
      if (!authorised(req, options.token)) return bad("unauthorized", 401);
      const url = new URL(req.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const q = url.searchParams;
      try {
        if (req.method === "GET" && path === "/v1/ws") {
          return srv.upgrade(req) ? undefined : bad("websocket upgrade required", 426);
        }
        if (req.method === "GET" && path === "/v1/events/stream") {
          const lastId = Number(req.headers.get("last-event-id") ?? q.get("since") ?? NaN);
          let unsubscribe = () => {};
          let beat: ReturnType<typeof setInterval> | undefined;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              const send = (e: IndexEvent) => controller.enqueue(encoder.encode(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
              controller.enqueue(encoder.encode("retry: 3000\n\n"));
              if (Number.isFinite(lastId)) for (const e of ctx.store.listEvents({ sinceId: lastId, limit: 1000 })) send(e);
              unsubscribe = ctx.bus.subscribe(send);
              beat = setInterval(() => controller.enqueue(encoder.encode(": keep-alive\n\n")), 15_000);
            },
            cancel() {
              unsubscribe();
              if (beat) clearInterval(beat);
            },
          });
          return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
        }
        if (req.method === "GET" && path === "/v1/status") {
          return json({
            schema: 1,
            counts: ctx.store.repoCounts(),
            events: ctx.store.listEvents({ limit: 1 })[0]?.id ?? 0,
            fetches: ctx.store.db.query("SELECT url, etag, last_modified AS lastModified, checked_at AS checkedAt, changed_at AS changedAt, bytes FROM fetch_state ORDER BY url").all(),
            snapshot: ctx.store.getMeta("snapshot_date"),
            rpcUsedToday: ctx.store.rpcUsed(),
            client: ctx.client.stats,
            ...options.status?.(),
          });
        }
        if (req.method === "GET" && path.startsWith("/v1/packages/")) {
          const name = decodeURIComponent(path.slice("/v1/packages/".length));
          const source = q.get("source");
          if (source && source !== "repo" && source !== "aur") return bad("source must be repo or aur");
          const pkg = info(ctx.store, name, { source: (source as "repo" | "aur" | null) ?? undefined, repo: q.get("repo") ?? undefined, testing: q.get("testing") === "1" });
          if (!pkg) {
            const r = resolveName(ctx.store, name);
            return json({ error: "not found", resolution: r.kind === "missing" ? null : { kind: r.kind, name: r.package.name, repo: r.package.repo, version: r.package.version } }, 404);
          }
          return json(pkg);
        }
        if (req.method === "GET" && path === "/v1/search") {
          const term = q.get("q");
          if (!term) return bad("q is required");
          const by = (q.get("by") ?? "name") as SearchBy;
          if (!SEARCH_BY.has(by)) return bad(`by must be one of ${[...SEARCH_BY].join(", ")}`);
          const rows = search(ctx.store, term, { by, source: (q.get("source") as "repo" | "aur" | null) ?? undefined, testing: q.get("testing") === "1", limit: Math.min(500, Number(q.get("limit") ?? 50)) });
          return json({ count: rows.length, results: rows });
        }
        if (req.method === "GET" && path.startsWith("/v1/deps/")) {
          const name = decodeURIComponent(path.slice("/v1/deps/".length));
          const kinds = (q.get("kinds") ?? "depends").split(",") as DepKind[];
          if (kinds.some(k => !DEP_KINDS.has(k))) return bad("unknown dependency kind");
          const opts = { kinds, depth: Number(q.get("depth") ?? 8), aur: q.get("aur") !== "0" };
          return json(q.get("flat") === "1" ? closure(ctx.store, [name], opts) : depTree(ctx.store, name, opts));
        }
        if (req.method === "POST" && path === "/v1/check") {
          const body = (await req.json()) as { pins?: Pin[]; aur?: boolean };
          if (!Array.isArray(body.pins) || body.pins.some(p => typeof p?.name !== "string")) return bad("pins must be an array of { name, version? }");
          if (body.pins.length > 5000) return bad("at most 5000 pins per request", 413);
          return json({ results: checkPins(ctx.store, body.pins, { aur: body.aur ?? true }) });
        }
        if (req.method === "GET" && path === "/v1/events") {
          return json({ events: ctx.store.listEvents({ sinceId: q.has("since") ? Number(q.get("since")) : undefined, type: q.get("type") ?? undefined, name: q.get("name") ?? undefined, limit: Math.min(1000, Number(q.get("limit") ?? 100)) }) });
        }
        if (req.method === "GET" && path.startsWith("/v1/sources/")) {
          const base = decodeURIComponent(path.slice("/v1/sources/".length));
          const source = q.get("source") === "aur" ? "aur" : "arch";
          const row = ctx.store.getSrcinfoRow(source, base, q.get("version") ?? undefined);
          if (!row?.srcinfo_sha256) return bad("sources not synced for this pkgbase", 404);
          const text = ctx.store.getBlob(row.srcinfo_sha256) ?? "";
          return json({ pkgbase: base, source, version: row.version, ref: row.ref, srcinfo: parseSrcinfo(text), raw: q.get("raw") === "1" ? text : undefined, pkgbuild: q.get("pkgbuild") === "1" && row.pkgbuild_sha256 ? ctx.store.getBlob(row.pkgbuild_sha256) : undefined });
        }
        if (req.method === "GET" && path === "/v1/wsl-image") return json(await wslImage(ctx));
        if (req.method === "GET" && path.startsWith("/v1/schema/")) {
          const name = path.slice("/v1/schema/".length).replace(/[^a-z-]/g, "");
          const file = Bun.file(new URL(`../schema/${name}.schema.json`, import.meta.url));
          return (await file.exists()) ? new Response(file, { headers: { "content-type": "application/schema+json" } }) : bad("unknown schema", 404);
        }
        return bad("not found", 404);
      } catch (error) {
        return bad(error instanceof Error ? error.message : String(error), 500);
      }
    },
    websocket: {
      open(ws) {
        ws.subscribe("events");
      },
      message() {},
    },
  });
  const unsubscribe = ctx.bus.subscribe(e => server.publish("events", JSON.stringify(e)));
  return {
    server,
    url: `http://${hostname.includes(":") ? `[${hostname}]` : hostname}:${server.port}`,
    stop() {
      unsubscribe();
      server.stop(true);
    },
  };
}
