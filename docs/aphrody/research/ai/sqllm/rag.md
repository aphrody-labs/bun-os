<!-- SPDX-License-Identifier: Apache-2.0 -->
# Local RAG on SQL stores (2026-10-01)

Scope: dense vector, lexical/BM25 and hybrid retrieval inside PostgreSQL and
SQLite. Versions were checked against GitHub tags, changelogs and vendor docs on
2026-10-01. `UNVERIFIED` marks claims without a primary source. The SQLite side
(sqlite-vec, FTS5, libSQL) is in [sqlite.md](sqlite.md); this page summarises
it only for comparison.

## 1. Decision matrix

| Need | Self-hosted PG 18 | Neon (Lakebase) | Self-hosted Supabase | SQLite |
|---|---|---|---|---|
| Dense ANN | pgvector HNSW (`halfvec`) | pgvector 0.8.6 (PG18) | pgvector (<= 0.8.2) | sqlite-vec `vec0` (brute force) |
| Large dense (> RAM) | pgvectorscale DiskANN | not offered | not offered | not applicable |
| BM25 | pg_textsearch (PostgreSQL licence) or ParadeDB (AGPL) | `lakebase_text` (pg_search removed) | none, use `tsvector` + `ts_rank_cd` | FTS5 `bm25()` |
| Hybrid | RRF in SQL | RRF in SQL | `hybrid_search()` RRF function | RRF in app or SQL |

## 2. pgvector

- **Version and licence:** latest 0.8.7, dated 2026-10-01 (it fixes an IVFFlat
  build overflow). Before it: 0.8.6 (2026-07-29), and 0.8.1 (2025-09-04), which
  added PG18. pgvector publishes tags only, no GitHub releases. Licence:
  PostgreSQL. Supports Postgres 13+.
  [CHANGELOG](https://github.com/pgvector/pgvector/blob/master/CHANGELOG.md),
  [LICENSE](https://github.com/pgvector/pgvector/blob/master/LICENSE),
  [README](https://github.com/pgvector/pgvector#readme)
- **Types:** `vector` and `halfvec` store up to 16,000 dimensions; `sparsevec`
  up to 16,000 non-zero elements. Index limits are lower: vector 2,000,
  halfvec 4,000, bit 64,000, sparsevec 1,000 non-zero (HNSW only). Size on
  disk: vector is 4·d+8 bytes, halfvec 2·d+8 bytes.
- **HNSW defaults:** `m=16`, `ef_construction=64`, `hnsw.ef_search=40`.
  **IVFFlat:** set `lists` at build time and `ivfflat.probes` at query time
  (default 1; start near sqrt(lists)).
- **Iterative index scans (0.8.0, 2024-10-30)** fix filtered queries that
  return too few rows:
  - Settings: `hnsw.iterative_scan = strict_order | relaxed_order`,
    `hnsw.max_scan_tuples` (default 20000), `hnsw.scan_mem_multiplier`,
    `ivfflat.iterative_scan`, `ivfflat.max_probes`.
  - With `relaxed_order`, re-sort in a materialized CTE with
    `ORDER BY distance + 0` (the `+ 0` is needed on PG17+).
- **Build speed:** set `maintenance_work_mem` large enough for the graph to
  fit (a NOTICE appears when it does not). `max_parallel_maintenance_workers`
  enables parallel builds. In Docker, `--shm-size` must be at least
  `maintenance_work_mem`.

```sql
-- Store full precision, index half precision (halves index RAM, 4000-dim limit).
CREATE TABLE chunks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_id bigint NOT NULL,
  content text NOT NULL,
  content_sha256 bytea NOT NULL UNIQUE,        -- dedup key, see postgres.md
  model text NOT NULL,
  embedding vector(384) NOT NULL
);
CREATE INDEX ON chunks USING hnsw ((embedding::halfvec(384)) halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

SET hnsw.ef_search = 100;
SET hnsw.iterative_scan = relaxed_order;      -- filtered search keeps returning rows
SELECT id FROM chunks WHERE model = 'multilingual-e5-small'
ORDER BY embedding::halfvec(384) <=> $1::halfvec(384) LIMIT 20;

-- Binary quantization + exact re-rank (binary_quantize since 0.7.0).
CREATE INDEX ON chunks USING hnsw ((binary_quantize(embedding)::bit(384)) bit_hamming_ops);
SELECT * FROM (
  SELECT id, embedding FROM chunks
  ORDER BY binary_quantize(embedding)::bit(384) <~> binary_quantize($1) LIMIT 100
) c ORDER BY embedding <=> $1 LIMIT 10;
```

## 3. pgvectorscale (Timescale / Tiger Data)

- **Version and licence:** 0.9.1 (2026-09-04), PostgreSQL licence. Built in
  Rust with pgrx 0.16.1 for PG14–18. It reuses pgvector's `vector` type.
  [release](https://github.com/timescale/pgvectorscale/releases/tag/0.9.1),
  [README](https://github.com/timescale/pgvectorscale#readme)
- **0.9.1 is a security fix** (DiskANN type confusion and malformed datums,
  which could read or write out of bounds). Columns without a `vector(N)`
  typmod can no longer be indexed. Indexes with an invalid stored dimension
  must be dropped and recreated; `REINDEX` does not fix them.
- **Index:** `USING diskann (embedding vector_cosine_ops)`.
  - Build options: `storage_layout` (`memory_optimized` = SBQ, the default),
    `num_neighbors` (50), `search_list_size` (100), `num_bits_per_dimension`.
  - Query settings: `diskann.query_search_list_size` and
    `diskann.query_rescore`.
  - Label filtering: add a `smallint[]` labels column to the index, then query
    with `WHERE labels && ARRAY[...]`.
- **When to use it:** corpora much larger than RAM. For millions of 384–1024-dim
  chunks on one host, pgvector HNSW on `halfvec` is enough.

## 4. BM25 inside PostgreSQL

| Extension | Version | Licence | Syntax | PG | Notes |
|---|---|---|---|---|---|
| ParadeDB `pg_search` | 0.25.11 (2026-09-29), 0.26.0-rc.4 | AGPL-3.0 (Enterprise: commercial) | `CREATE INDEX ... USING paradedb (id, body) WITH (key_field='id')` (`bm25` is an alias since 0.25); operators `@@@`, `\|\|\|` (any), `&&&` (all), `===`, `###`; score with `pdb.score(id)` | 15–18 | Tantivy-based; needs `shared_preload_libraries='pg_search'`; vector support in beta. [releases](https://github.com/paradedb/paradedb/releases), [operators](https://github.com/paradedb/paradedb/blob/main/docs/reference/operators-and-functions.mdx) |
| Timescale `pg_textsearch` | 1.4.0 (2026-08-18) | PostgreSQL | `CREATE INDEX ... USING bm25(content) WITH (text_config='english')`; `ORDER BY content <@> to_bm25query('q','idx')` (scores are negative, sort ascending) | 17–18 | Block-Max WAND; needs `shared_preload_libraries`. [repo](https://github.com/timescale/pg_textsearch) |
| Neon `lakebase_text` | 0.1.3 | UNVERIFIED (Neon only) | `USING lakebase_bm25 (tsv)`; `<@> to_bm25query(...)` | 16–18 | Replaced pg_search on Neon. [migration guide](https://neon.com/docs/extensions/migrate-pg-search-to-lakebase-text) |
| VectorChord-bm25 | 0.3.0 (2025-12-15) | AGPLv3 or ELv2 | `bm25vector` type | 14–18 | Companion to the VectorChord `vchordrq` (RaBitQ) index, 1.1.1. [repo](https://github.com/tensorchord/VectorChord) |
| Core FTS | PG built-in | PostgreSQL | `tsvector` + GIN + `ts_rank_cd` | all | Not BM25 (no IDF saturation), but needs no extension. |

- **ParadeDB on Neon:** `pg_search` was deprecated for new Neon projects on
  2026-03-19 and removed from existing ones on 2026-09-21.
  [neon docs](https://neon.com/docs/extensions/pg_search)
- **pgvecto.rs** is superseded by VectorChord (last release 0.4.0,
  2024-11-21). Do not adopt it.
- **Licence note:** under AGPL, network use of a modified ParadeDB triggers
  source-offer obligations. Aphrody is private and non-commercial, but
  `pg_textsearch` (PostgreSQL licence) keeps the stack fully permissive.

## 5. Hybrid retrieval with Reciprocal Rank Fusion

score(d) = Σ 1/(k + rank_i(d)), summed over the result lists d appears in.
`k = 60` is the value from the original paper and is the default in
pgvector-python and ParadeDB. Supabase defaults to `rrf_k = 50`.
[pgvector-python rrf.py](https://github.com/pgvector/pgvector-python/blob/master/examples/hybrid_search/rrf.py),
[ParadeDB RRF](https://github.com/paradedb/paradedb/blob/main/docs/reference/hybrid/rrf.mdx),
[Supabase hybrid search](https://supabase.com/docs/guides/ai/hybrid-search)

```sql
WITH semantic AS (
  SELECT id, row_number() OVER (ORDER BY embedding::halfvec(384) <=> $1::halfvec(384)) AS r
  FROM chunks ORDER BY embedding::halfvec(384) <=> $1::halfvec(384) LIMIT 50
), lexical AS (
  SELECT id, row_number() OVER (ORDER BY ts_rank_cd(tsv, q) DESC) AS r
  FROM chunks, websearch_to_tsquery('simple', $2) q
  WHERE tsv @@ q ORDER BY ts_rank_cd(tsv, q) DESC LIMIT 50
)
SELECT COALESCE(s.id, l.id) AS id,
       COALESCE(1.0/(60 + s.r), 0) + COALESCE(1.0/(60 + l.r), 0) AS rrf
FROM semantic s FULL OUTER JOIN lexical l USING (id)
ORDER BY rrf DESC LIMIT 20;
```

Practice:
- Fetch 3–5 times the final `k` from each channel before fusing.
- Re-rank the fused top 20–50 with a cross-encoder (bge-reranker family).
- Apply weights (ParadeDB uses 1.0 for text and 0.7 for vector) only after you
  have measured on a gold set.
- Keep fusion in one place. Aphrody's `aphrody-rag-core::fusion::rrf` already
  owns it for the Rust side.

## 6. Hosted and managed Postgres for RAG

**Neon**
- Branching is copy-on-write. `--schema-only` branches are root branches, so
  they cannot be reset from a parent.
  [branching](https://neon.com/docs/introduction/branching),
  [schema-only](https://neon.com/docs/guides/branching-schema-only)
- The pooled endpoint (`-pooler` in the host name) is PgBouncer in transaction
  mode. It does not support session-level `SET`, `LISTEN/NOTIFY`, SQL
  `PREPARE`, temp tables or session advisory locks. Protocol-level prepared
  statements work (`max_prepared_statements=1000`). Use the direct endpoint
  for migrations, `pg_dump` and long index builds.
  [pooling](https://neon.com/docs/connect/connection-pooling)
- pgvector 0.8.6 is available on PG18. pgvectorscale, pg_textsearch and
  VectorChord are not offered.
  [extensions](https://neon.com/docs/extensions/pg-extensions)
- Ownership: Databricks announced the Neon acquisition on 2025-05-14, and the
  product now appears as "Lakebase Postgres".
  [press release](https://www.databricks.com/company/newsroom/press-releases/databricks-agrees-acquire-neon-help-developers-deliver-ai-systems)

**Self-hosted Supabase**
- Licence Apache-2.0. The compose stack (2026-09-30) uses Envoy as the default
  gateway (Kong is optional), plus GoTrue v2.196.0, PostgREST v14.17,
  Realtime, Storage, Supavisor 2.9.12 and Studio.
- The database image is `supabase/postgres:17.6.1.136`, i.e. **PG17**; no PG18
  image is published. The newest pgvector packaged for it is 0.8.2. No BM25
  extension is shipped.
  [docker](https://github.com/supabase/supabase/tree/master/docker),
  [vars](https://github.com/supabase/postgres/blob/develop/ansible/vars.yml)
- Secrets: generate them with `utils/generate-keys.sh`. Never keep the
  `.env.example` defaults.
  [self-hosting](https://supabase.com/docs/guides/self-hosting/docker)

## 7. SQLite RAG (summary, see [sqlite.md](sqlite.md))

- **Lexical:** FTS5 with `bm25()` over an external-content table, kept in sync
  by triggers. Aphrody's `crates/ai/rag/src/schema.rs` already does this.
- **Dense:** sqlite-vec `vec0` (brute-force KNN, SIMD). It suits roughly 10^5–10^6
  vectors at 384 dimensions.
- **Hybrid:** RRF in the application (Aphrody: `aphrody-rag-core`), or in SQL
  with two CTEs as above.

## 8. Evaluation hooks

- Track Recall@k and nDCG@10 per tag, comparing the shadow index with the
  baseline before swapping any index or model.
- Log the ANN parameters (`ef_search`, `iterative_scan`, quantization) next to
  each eval. Recall depends on them as much as on the model.
