// SPDX-License-Identifier: Apache-2.0
// /api/rpc: JSON-RPC 2.0 over the inventory. Members that cannot run in a browser (native crates, servers, tools) are
// still callable here: list, get, search, dependencies, features and the WebAssembly module table, read-only, any host.
import { KIND_IDS } from "../src/inventory-kinds";

interface Assets {
  fetch(request: Request): Promise<Response>;
}
interface Index {
  generated: string;
  commit: string;
  counts: Record<string, number>;
  total: number;
  members: { kind: string; id: string; name: string; desc: string; tags: string[]; path?: string; surface: { type: string; module?: string } }[];
}
type Params = Record<string, unknown>;

const METHODS = {
  "inventory.counts": "Member counts per kind and the source commit.",
  "inventory.list": "{kind?, query?, offset?, limit?} Members of a kind, filtered by words of the query (limit at most 200).",
  "inventory.get": "{kind, id} One member with its README, text, data and members.",
  "crate.dependencies": "{id} Direct dependencies of a crate with their version requirements.",
  "crate.features": "{id} Cargo features of a crate.",
  "wasm.modules": "Crates served as WebAssembly modules with the module URL.",
} as const;

const error = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export async function rpcResponse(request: Request, assets: Assets): Promise<Response> {
  const headers = { "cache-control": "no-store", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" };
  if (request.method === "GET") return Response.json({ jsonrpc: "2.0", endpoint: "/api/rpc", methods: METHODS }, { headers });
  if (request.method !== "POST")
    return Response.json(error(null, -32600, "Use POST (or GET for the method list)"), { status: 405, headers: { ...headers, allow: "GET, POST" } });
  let call: { id?: unknown; method?: string; params?: Params };
  try {
    const text = await request.text();
    if (text.length > 16_384) throw new Error("too large");
    call = JSON.parse(text);
  } catch {
    return Response.json(error(null, -32700, "Parse error"), { status: 400, headers });
  }
  const base = new URL(request.url);
  const fetchJson = async <T>(path: string): Promise<T | undefined> => {
    const res = await assets.fetch(new Request(new URL(path, base).href)).catch(() => undefined);
    return res?.ok ? ((await res.json()) as T) : undefined;
  };
  const params = call.params ?? {};
  const kind = typeof params.kind === "string" ? params.kind : "";
  const id = typeof params.id === "string" ? params.id : "";
  const safe = (v: string) => v && !v.split("/").some((p) => !p || p === "." || p === ".." || p.includes(":") || p.includes(String.fromCharCode(92)));
  const result = async (): Promise<unknown> => {
    switch (call.method) {
      case "inventory.counts": {
        const index = await fetchJson<Index>("/api/inventory.json");
        return index && { counts: index.counts, total: index.total, commit: index.commit, generated: index.generated, kinds: KIND_IDS };
      }
      case "inventory.list": {
        const index = await fetchJson<Index>("/api/inventory.json");
        if (!index) return undefined;
        const terms = String(params.query ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        const hits = index.members.filter(
          (m) => (!kind || m.kind === kind) && terms.every((t) => `${m.name} ${m.id} ${m.desc} ${m.tags.join(" ")} ${m.path ?? ""}`.toLowerCase().includes(t)),
        );
        const offset = Math.max(0, Number(params.offset) || 0);
        const limit = Math.min(200, Math.max(1, Number(params.limit) || 50));
        return { total: hits.length, offset, members: hits.slice(offset, offset + limit) };
      }
      case "inventory.get":
        return safe(id) && KIND_IDS.includes(kind as never) ? fetchJson(`/api/inventory/${kind}/${id}.json`) : undefined;
      case "crate.dependencies":
      case "crate.features": {
        const crate = safe(id) ? await fetchJson<{ data?: { dependencies?: unknown; features?: unknown } }>(`/api/inventory/crates/${id}.json`) : undefined;
        return crate && (call.method === "crate.features" ? crate.data?.features ?? [] : crate.data?.dependencies ?? {});
      }
      case "wasm.modules": {
        const index = await fetchJson<Index>("/api/inventory.json");
        return index?.members.filter((m) => m.kind === "crates" && m.surface.module).map((m) => ({ crate: m.id, module: m.surface.module }));
      }
      default:
        throw new RangeError("Method not found");
    }
  };
  try {
    const value = await result();
    return Response.json(value === undefined ? error(call.id, -32602, "No such member or invalid params") : { jsonrpc: "2.0", id: call.id ?? null, result: value }, { headers });
  } catch (e) {
    return Response.json(error(call.id, e instanceof RangeError ? -32601 : -32603, e instanceof Error ? e.message : "Internal error"), { headers });
  }
}
