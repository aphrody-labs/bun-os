import {
  getPublicSiteDocument,
  getPublicSiteGraph,
  getPublicSiteReleases,
  getPublicSiteSnapshot,
  searchPublicSiteDocs,
  type SiteQuery,
} from "./site-neon";
import { buildBunRag, type RagOptions } from "./rag";

export async function publicSiteAPI(
  request: Request,
  sql: SiteQuery,
  options: { rag?: Pick<RagOptions, "client" | "generate"> } = {},
): Promise<Response> {
  const url = new URL(request.url),
    query = url.searchParams;
  const head = request.method === "HEAD";
  const json = (value: unknown, status = 200) =>
    new Response(head ? null : JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-cache", "x-content-type-options": "nosniff" },
    });
  if (!["GET", "HEAD"].includes(request.method))
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  if (url.search.length > 4096) return json({ error: "Public query is too long" }, 400);
  const snapshotId = query.get("snapshot") ?? undefined;
  let value: unknown;
  try {
    switch (url.pathname) {
      case "/api/site/rag":
        value = await buildBunRag(
          sql,
          {
            ...(head ? {} : options.rag),
            query: query.get("q") ?? "",
            ...(query.has("limit") ? { limit: Number(query.get("limit")) } : {}),
          },
          request.signal,
        );
        break;
      case "/api/site/snapshot":
        value = await getPublicSiteSnapshot(sql, snapshotId);
        break;
      case "/api/site/docs":
        value = query.has("path")
          ? await getPublicSiteDocument(sql, query.get("path")!, snapshotId)
          : await searchPublicSiteDocs(sql, {
              query: query.get("q") ?? "",
              ...(query.has("limit") ? { limit: Number(query.get("limit")) } : {}),
              ...(snapshotId === undefined ? {} : { snapshotId }),
            });
        break;
      case "/api/site/graph":
        value = await getPublicSiteGraph(sql, {
          ...(query.has("domain") ? { domain: query.get("domain")! } : {}),
          ...(query.has("q") ? { query: query.get("q")! } : {}),
          ...(query.has("limit") ? { limit: Number(query.get("limit")) } : {}),
          ...(snapshotId === undefined ? {} : { snapshotId }),
        });
        break;
      case "/api/site/releases":
        value = await getPublicSiteReleases(sql, snapshotId);
        break;
      default:
        return json({ error: "Public route not found" }, 404);
    }
  } catch (error) {
    if (error instanceof TypeError) return json({ error: error.message }, 400);
    return json({ error: "Public site data unavailable" }, 503);
  }
  if (value === null || (typeof value === "object" && value !== null && "snapshot" in value && value.snapshot === null))
    return json({ error: "Public site snapshot unavailable" }, 503);
  return json(value);
}
