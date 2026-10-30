// SPDX-License-Identifier: Apache-2.0
// /api/inventory[/<kind>[/<id>]] and the kind aliases (/api/apps, /api/packages, /api/crates, ...): the machine-readable
// inventory of every Bun OS member, built by apps/webos/inventory.ts into dist/api/inventory*. Read-only, same
// answer on every host. /api/docs keeps the Workspace documentation contract; /api/docs/<page> serves one docs member.
import { KIND_IDS, KINDS } from "../src/inventory-kinds";
import type { PathMeta } from "../paths";

interface Assets {
  fetch(request: Request): Promise<Response>;
}

const ALIASES = new Set<string>(KIND_IDS.filter((kind) => kind !== "docs"));

/** Asset path of an API path, or undefined when the path is not an inventory route. */
function assetFor(pathname: string): string | undefined {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts.length < 2) return undefined;
  let rest: string[];
  if (parts[1] === "inventory") rest = parts.slice(2);
  else if (ALIASES.has(parts[1]!)) rest = parts.slice(1);
  else if (parts[1] === "docs" && parts.length > 2) rest = ["docs", ...parts.slice(2)];
  else return undefined;
  if (rest.some((part) => part === "." || part === ".." || /[\\0]/.test(part))) return "";
  if (!rest.length) return "/api/inventory.json";
  return `/api/inventory/${rest.join("/")}.json`;
}

export async function inventoryResponse(request: Request, assets: Assets): Promise<Response | undefined> {
  const url = new URL(request.url);
  let asset: string | undefined;
  try {
    asset = assetFor(decodeURIComponent(url.pathname));
  } catch {
    return undefined;
  }
  if (asset === undefined) return undefined;
  const headers = { "cache-control": "no-cache", "x-content-type-options": "nosniff" };
  if (request.method !== "GET" && request.method !== "HEAD")
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: { ...headers, allow: "GET, HEAD" } });
  const res = asset ? await assets.fetch(new Request(new URL(asset, url).href, { method: request.method })) : undefined;
  if (!res?.ok) return Response.json({ error: "No such inventory member" }, { status: 404, headers });
  const out = new Response(res.body, res);
  for (const [key, value] of Object.entries(headers)) out.headers.set(key, value);
  out.headers.set("content-type", "application/json; charset=utf-8");
  out.headers.set("access-control-allow-origin", "*");
  return out;
}

/** Title and description of an /inventory page for the document head. */
export async function inventoryMeta(pathname: string, assets: Assets): Promise<PathMeta | undefined> {
  let parts: string[];
  try {
    parts = decodeURIComponent(pathname).split("/").filter(Boolean).slice(1);
  } catch {
    return undefined;
  }
  const kind = parts[0] as keyof typeof KINDS | undefined;
  if (!kind || !(kind in KINDS)) return undefined;
  const site = "Aphrody Bun OS";
  if (parts.length === 1)
    return { title: `${KINDS[kind].label} · Bun OS inventory · ${site}`, description: KINDS[kind].desc };
  const res = await assets
    .fetch(new Request(`https://assets.invalid/api/inventory/${parts.join("/")}.json`))
    .catch(() => undefined);
  const member = res?.ok ? ((await res.json().catch(() => undefined)) as { name?: string; desc?: string } | undefined) : undefined;
  if (!member?.name) return undefined;
  return {
    title: `${member.name} · ${KINDS[kind].label} · ${site}`,
    description: (member.desc ?? KINDS[kind].desc).slice(0, 300),
  };
}
