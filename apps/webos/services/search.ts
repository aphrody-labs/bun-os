// SPDX-License-Identifier: Apache-2.0
// /api/search: ranked search over the catalogs this deployment already serves (Documentation, Templates,
// apps and packages). It needs no crawler and no third-party search engine, so it answers from any host.
import { ORIGIN } from "../paths";
import { ROUTES } from "../src/config";

interface Hit {
  title: string;
  url: string;
  snippet: string;
}
interface Entry extends Hit {
  fields: [text: string, weight: number][];
}
interface Assets {
  fetch(request: Request): Promise<Response>;
}

const TTL_MS = 5 * 60_000;
let cache: { at: number; key: string; entries: Entry[] } | undefined;

const words = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

function clip(text: string, length = 200) {
  const flat = text
    .replace(/[#*`>_|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

async function json<T>(
  assets: Assets,
  base: URL,
  path: string,
): Promise<T | undefined> {
  try {
    const res = await assets.fetch(new Request(new URL(path, base).href));
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

async function load(assets: Assets, base: URL): Promise<Entry[]> {
  const key = base.origin;
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS)
    return cache.entries;
  const entries: Entry[] = [];
  const [catalog, inventory] = await Promise.all([
    json<{
      apps?: { id: string; d?: string }[];
      packages?: { id: string; d?: string }[];
    }>(assets, base, "/catalog.json"),
    json<{
      members: {
        kind: string;
        id: string;
        name: string;
        desc: string;
        tags?: string[];
        path?: string;
      }[];
    }>(assets, base, "/api/inventory.json"),
  ]);
  // Every inventory member (apps, packages, crates, factory, engines, tools, infra, ...) is searchable.
  for (const member of inventory?.members ?? [])
    entries.push({
      title: member.name,
      url: `${ORIGIN}/inventory/${member.kind}/${member.id.split("/").map(encodeURIComponent).join("/")}`,
      snippet: clip(member.desc),
      fields: [
        [member.name, 6],
        [member.id, 4],
        [(member.tags ?? []).join(" "), 3],
        [member.kind, 2],
        [member.desc, 2],
        [member.path ?? "", 1],
      ],
    });
  const pathById = new Map(
    Object.entries(ROUTES.apps).map(([path, id]) => [id, path]),
  );
  for (const app of inventory
    ? []
    : [...(catalog?.apps ?? []), ...(catalog?.packages ?? [])]) {
    const path =
      pathById.get(app.id) ??
      `${ROUTES.memberPath}${encodeURIComponent(app.id)}`;
    entries.push({
      title: app.id,
      url: `${ORIGIN}${path}`,
      snippet: clip(app.d ?? ""),
      fields: [
        [app.id, 6],
        [app.d ?? "", 2],
      ],
    });
  }
  cache = { at: Date.now(), key, entries };
  return entries;
}

function rank(entries: Entry[], query: string): Hit[] {
  const terms = [...new Set(words(query))];
  if (!terms.length) return [];
  const scored: [number, Entry][] = [];
  for (const entry of entries) {
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      let hit = 0;
      for (const [text, weight] of entry.fields) {
        const tokens = words(text);
        if (tokens.includes(term)) hit += weight * 2;
        else if (tokens.some((token) => token.startsWith(term))) hit += weight;
      }
      if (hit) matched++;
      score += hit;
    }
    // Every term must match somewhere.
    if (matched === terms.length) scored.push([score, entry]);
  }
  return scored
    .sort((a, b) => b[0] - a[0] || a[1].title.localeCompare(b[1].title))
    .map(([, { title, url, snippet }]) => ({ title, url, snippet }));
}

/** Same request contract as the Google-backed owner (query, vertical, hl, safe, start, num). */
export async function searchResponse(
  request: Request,
  assets: Assets,
): Promise<Response> {
  const headers = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  if (request.method !== "GET" && request.method !== "HEAD")
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { ...headers, allow: "GET, HEAD" } },
    );
  const url = new URL(request.url);
  const query = (
    url.searchParams.get("query") ??
    url.searchParams.get("q") ??
    ""
  ).trim();
  const start = Number(url.searchParams.get("start") || 0);
  const num = Number(url.searchParams.get("num") || 10);
  if (
    !query ||
    query.length > 512 ||
    !Number.isInteger(start) ||
    start < 0 ||
    start > 1000 ||
    !Number.isInteger(num) ||
    num < 1 ||
    num > 20 ||
    (url.searchParams.get("vertical") ?? "web") !== "web"
  )
    return Response.json(
      { error: "Invalid search request" },
      { status: 400, headers },
    );
  const hits = rank(await load(assets, url), query);
  return Response.json(
    { query, organic: hits.slice(start, start + num), total: hits.length },
    { headers },
  );
}
