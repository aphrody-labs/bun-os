export interface SiteQuery {
  query<T extends Record<string, unknown>>(text: string, parameters?: readonly unknown[]): Promise<T[]>;
}
export type SiteSnapshotInfo = {
  id: string;
  profile: "bun";
  repository: "aphrody-labs/bun";
  source: string;
  sourceDate: string;
  importedAt: string;
  counts: Record<string, number>;
};
export type SiteDocumentHit = {
  path: string;
  title: string;
  description: string;
  sha256: string;
  score: number;
  url: string;
  chunks: { ordinal: number; body: string; sha256: string }[];
};
export type SiteGraphResult = {
  snapshot: SiteSnapshotInfo | null;
  domains: Record<string, unknown>[];
  links: Record<string, unknown>[];
  qualification?: string;
  native?: {
    nodes: Record<string, unknown>[];
    edges: Record<string, unknown>[];
    coverage: { nodes: number; edges: number; sourceNodes: number; sourceEdges: number; truncated: boolean };
  };
};

const SEARCH_CONNECTIVES = new Set(
  "a an and are as at avec ce ces comment dans de des do does du en est et for how is la le les of on or ou par pour que quel quelle the to un une use using with".split(
    " ",
  ),
);
function searchAlternatives(query: string): string {
  const terms = [
    ...new Set(
      (query.match(/[\p{L}\p{N}][\p{L}\p{N}_.:-]*/gu) ?? []).filter(
        term => term.length > 1 && !SEARCH_CONNECTIVES.has(term.toLowerCase()),
      ),
    ),
  ].slice(0, 16);
  const apiNames = terms.filter(term => /^(?:Bun[.:]|bun:|node:)/i.test(term));
  return (apiNames.length ? apiNames : terms).map(term => `"${term}"`).join(" OR ");
}
export async function getPublicSiteSnapshot(sql: SiteQuery, id?: string): Promise<SiteSnapshotInfo | null> {
  if (id !== undefined && !/^[a-f0-9]{64}$/.test(id)) throw new TypeError("Invalid public snapshot identifier");
  const rows = await sql.query<SiteSnapshotInfo & Record<string, unknown>>(
    `SELECT s.id,s.profile,s.repository,s.source_sha AS source,s.source_date::text AS "sourceDate",s.imported_at::text AS "importedAt",s.counts
     FROM aphrody_site.snapshots s WHERE s.profile='bun' AND s.id=COALESCE($1,(SELECT snapshot_id FROM aphrody_site.current_snapshots WHERE profile='bun'))`,
    [id ?? null],
  );
  return rows[0] ?? null;
}
export async function searchPublicSiteDocs(
  sql: SiteQuery,
  options: { query: string; limit?: number; snapshotId?: string },
) {
  const query = options.query.trim(),
    limit = options.limit ?? 8;
  if (!query || query.length > 500 || !Number.isInteger(limit) || limit < 1 || limit > 8)
    throw new TypeError("Invalid public documentation query");
  const snapshot = await getPublicSiteSnapshot(sql, options.snapshotId);
  if (!snapshot) return { snapshot, documents: [] as SiteDocumentHit[] };
  type Row = {
    path: string;
    title: string;
    description: string;
    sha256: string;
    score: number;
    chunks: SiteDocumentHit["chunks"];
  } & Record<string, unknown>;
  const statement = `WITH ranked AS (
       SELECT c.path,c.ordinal,c.body,c.sha256,ts_rank_cd(c.search,websearch_to_tsquery('simple',$2)) AS score,
         row_number() OVER (PARTITION BY c.path ORDER BY ts_rank_cd(c.search,websearch_to_tsquery('simple',$2)) DESC,c.ordinal) AS position
       FROM aphrody_site.doc_chunks c WHERE c.snapshot_id=$1 AND c.search @@ websearch_to_tsquery('simple',$2)
     ), hits AS (SELECT path,max(score) AS score,jsonb_agg(jsonb_build_object('ordinal',ordinal,'body',body,'sha256',sha256) ORDER BY score DESC,ordinal) AS chunks
       FROM ranked WHERE position<=2 GROUP BY path)
     SELECT d.path,d.title,d.description,d.sha256,h.score,h.chunks FROM hits h JOIN aphrody_site.documents d ON d.snapshot_id=$1 AND d.path=h.path
     ORDER BY h.score DESC,d.path LIMIT $3`;
  let rows = await sql.query<Row>(statement, [snapshot.id, query, limit]);
  if (!rows.length) {
    const alternatives = searchAlternatives(query);
    if (alternatives) rows = await sql.query<Row>(statement, [snapshot.id, alternatives, limit]);
  }
  return {
    snapshot,
    documents: rows.map(row => ({
      ...row,
      url: `https://github.com/${snapshot.repository}/blob/${snapshot.source}/${row.path}`,
    })) as SiteDocumentHit[],
  };
}
export async function getPublicSiteDocument(sql: SiteQuery, path: string, snapshotId?: string) {
  if (!/^docs\/[A-Za-z0-9_./-]+\.mdx?$/.test(path) || path.split("/").some(part => part.startsWith(".")))
    throw new TypeError("Invalid public documentation path");
  const snapshot = await getPublicSiteSnapshot(sql, snapshotId);
  if (!snapshot) return { snapshot, document: null };
  const rows = await sql.query<SiteDocumentHit & Record<string, unknown>>(
    `SELECT d.path,d.title,d.description,d.sha256,0 AS score,COALESCE(jsonb_agg(jsonb_build_object('ordinal',c.ordinal,'body',c.body,'sha256',c.sha256) ORDER BY c.ordinal),'[]') AS chunks
     FROM aphrody_site.documents d LEFT JOIN aphrody_site.doc_chunks c ON c.snapshot_id=d.snapshot_id AND c.path=d.path
     WHERE d.snapshot_id=$1 AND d.path=$2 GROUP BY d.snapshot_id,d.path`,
    [snapshot.id, path],
  );
  const row = rows[0];
  return {
    snapshot,
    document: row
      ? { ...row, url: `https://github.com/${snapshot.repository}/blob/${snapshot.source}/${row.path}` }
      : null,
  };
}
export async function getPublicSiteGraph(
  sql: SiteQuery,
  options: { domain?: string; query?: string; limit?: number; snapshotId?: string } = {},
): Promise<SiteGraphResult> {
  const limit = options.limit ?? 100;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (options.domain !== undefined && !/^(?:src|packages|docs|scripts)(?:\/[\w.-]+)*$/.test(options.domain))
  )
    throw new TypeError("Invalid public graph query");
  if (options.query !== undefined && options.query.length > 500) throw new TypeError("Invalid native symbol query");
  const snapshot = await getPublicSiteSnapshot(sql, options.snapshotId);
  const qualification =
    "Source domain references and bounded native extracted symbols and relations; provenance retained, no measured runtime call graph";
  if (!snapshot) return { snapshot, domains: [], links: [], qualification };
  const domains = await sql.query(
    `SELECT name,files FROM aphrody_site.graph_domains WHERE snapshot_id=$1 AND ($2::text IS NULL OR name=$2) ORDER BY name LIMIT $3`,
    [snapshot.id, options.domain ?? null, limit],
  );
  const links = await sql.query(
    `SELECT source,target,references_count FROM aphrody_site.graph_links WHERE snapshot_id=$1 AND ($2::text IS NULL OR source=$2 OR target=$2) ORDER BY references_count DESC,source,target LIMIT $3`,
    [snapshot.id, options.domain ?? null, limit],
  );
  const words = options.query
    ?.match(/[\p{L}\p{N}]+/gu)
    ?.filter(word => word.length > 1)
    .slice(0, 32);
  const symbolQuery = words?.map(word => `"${word}"`).join(" OR ") || null;
  const nodes = await sql.query(
    `SELECT id,domain,kind,left(label,256) AS label,length(label)>256 AS label_truncated,path,line,file_sha256,provenance FROM aphrody_site.native_graph_nodes
    WHERE snapshot_id=$1 AND ($2::text IS NULL OR domain=$2) AND ($3::text IS NULL OR search @@ websearch_to_tsquery('simple',$3))
    ORDER BY CASE WHEN $3::text IS NULL THEN 0 ELSE ts_rank_cd(search,websearch_to_tsquery('simple',$3)) END DESC,id LIMIT $4`,
    [snapshot.id, options.domain ?? null, symbolQuery, Math.min(limit, 32)],
  );
  const nodeIds = nodes.map(node => node.id);
  const edges = nodeIds.length
    ? await sql.query(
        `SELECT source,target,kind,provenance,confidence FROM aphrody_site.native_graph_edges
        WHERE snapshot_id=$1 AND (source IN (SELECT jsonb_array_elements_text($2::jsonb)) OR target IN (SELECT jsonb_array_elements_text($2::jsonb))) ORDER BY confidence DESC,source,target LIMIT $3`,
        [snapshot.id, JSON.stringify(nodeIds), Math.min(limit, 64)],
      )
    : [];
  const neighbors = [...new Set(edges.flatMap(edge => [edge.source, edge.target]))]
    .filter(id => !nodeIds.includes(id))
    .slice(0, 32);
  if (neighbors.length)
    nodes.push(
      ...(await sql.query(
        `SELECT id,domain,kind,left(label,256) AS label,length(label)>256 AS label_truncated,path,line,file_sha256,provenance FROM aphrody_site.native_graph_nodes
        WHERE snapshot_id=$1 AND id IN (SELECT jsonb_array_elements_text($2::jsonb)) ORDER BY id`,
        [snapshot.id, JSON.stringify(neighbors)],
      )),
    );
  const coverage = {
    nodes: snapshot.counts.nativeNodes ?? 0,
    edges: snapshot.counts.nativeEdges ?? 0,
    sourceNodes: snapshot.counts.nativeSourceNodes ?? 0,
    sourceEdges: snapshot.counts.nativeSourceEdges ?? 0,
    truncated:
      (snapshot.counts.nativeNodes ?? 0) < (snapshot.counts.nativeSourceNodes ?? 0) ||
      (snapshot.counts.nativeEdges ?? 0) < (snapshot.counts.nativeSourceEdges ?? 0),
  };
  return { snapshot, domains, links, qualification, native: { nodes, edges, coverage } };
}
export async function getPublicSiteReleases(sql: SiteQuery, snapshotId?: string) {
  const snapshot = await getPublicSiteSnapshot(sql, snapshotId);
  return {
    snapshot,
    releases: snapshot
      ? await sql.query("SELECT facts FROM aphrody_site.release_facts WHERE snapshot_id=$1 ORDER BY tag LIMIT 100", [
          snapshot.id,
        ])
      : [],
  };
}
