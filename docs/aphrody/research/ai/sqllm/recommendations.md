-->
# Recommendations for Aphrody (2026-10-01)

These recommendations follow from [training.md](training.md),
[inference.md](inference.md), [rag.md](rag.md), [postgres.md](postgres.md),
[sqlite.md](sqlite.md) and [clients-rust-bun.md](clients-rust-bun.md).
Owners follow `docs/plans/ai/native-integration-master.md` (tracks T1 RAG,
T2a/b/c engines, T5 MCP, T11 sweep). Every dependency change goes through
`[workspace.dependencies]` and is validated by the lead through
`scripts/build/rust/cargo-serial.sh`; workers never run Cargo.

## 0. Facts these recommendations rest on

| Fact | Evidence |
|---|---|
| The root workspace bundles SQLite **3.53.2** (rusqlite 0.40.2 / libsqlite3-sys 0.38.2); Bun 1.4.2 also embeds 3.53.2; the system CLI is 3.45.1 | `Cargo.lock`, `bun -e`, `sqlite3 --version` |
| The training registry has DDL but **no writer** in either repository | grep of `aphrody` and `aphrody-py` |
| Triples use **positional negatives** (`(idx + n/2) % n`) and first-sentence queries | `aphrody-py/.../aphrody_train/triples.py` |
| SQLite dense search loads every BLOB and scans exactly, under an async mutex | `crates/ai/rag/src/store.rs::search_vector` |
| `tokio-postgres-rustls` 0.14 is declared in `[workspace.dependencies]` but **no member uses it** | root `Cargo.toml:47` |

## 1. Top 10 (priority order)

1. **Write the generic training registry: code and migrations together, then create the schema.**
   - Owner: `crates/ai/train` for both the migrations (`migrations/0001_*.sql`,
   - Schema changes:
     - `dataset_versions` with `parent_id`, `source_commit` and
       `content_sha256`, checked against `^[0-9a-f]{64}$`.
     - `runs.code_commit`.
     - Generic `eval_metrics(metric, value, baseline, params jsonb)` that
       stores ANN settings.
     - A partial `UNIQUE (kind, alias) WHERE status = 'promoted'`.
     - `uuidv7()` defaults, which PG18 allows.
   - Writer stack: workspace `tokio-postgres` 0.7.18 + `tokio-postgres-rustls`
     0.14 (MIT; Neon requires TLS).
     - Runtime writes use `query_typed` on the `-pooler` URL.
     - Migrations use the direct URL.
   - Keep the Free-plan 1 GiB limit in mind: metadata only, as the README
     already states.

2. **Replace positional negatives with positive-aware hard-negative mining.**
   - Owner: `aphrody-py` `aphrody_train/triples.py`, using the existing
     `crates/ai/train` interface.
   - Use sentence-transformers **6.1** `mine_hard_negatives`:
     - `range_max=50`, `max_score=0.8`, `relative_margin=0.05`,
       `sampling_strategy="top"`.
     - Candidates come from the *production* hybrid retriever.
     - Exclude same-document candidates.
   - For the reranker, emit FlagEmbedding JSONL with `pos_scores`/`neg_scores`
     distilled from `bge-reranker-v2-m3`.
   - Licences: Apache-2.0 and MIT.
   - Raise `sentence-transformers>=6.1`.

3. **Replace substring gold-leak checks with content-hash anti-joins.**
   - Owners: `aphrody-py` (`triples.py`, `dataset.py`) and the registry.
   - Persist `text_sha256` (NFC-normalised) for every gold row and every
     training row. The leak gate then becomes one SQL anti-join (must return
     0).
   - Add MinHash near-dup clustering (datasketch 2.0, MIT, or datatrove
     0.10.1, Apache-2.0) *before* split assignment, and keep whole clusters in
     one split.

4. **Use pgvector-native binding and `halfvec` HNSW for the PostgreSQL dense
   channel.**
   - Add `pgvector = { version = "0.4.2", features = ["postgres", "halfvec"] }`
     (MIT OR Apache-2.0) to `[workspace.dependencies]`.
   - Bind `Vector` values instead of building `[..]::text::vector` strings.
   - Index with `USING hnsw ((embedding::halfvec(384)) halfvec_cosine_ops)`.
     For filtered queries, set `hnsw.iterative_scan = relaxed_order` and
     re-sort.
   - Target pgvector **0.8.7** for self-hosted PG and 0.8.6 on Neon.

5. **Pool and secure PostgreSQL connections.**
   - Owners: `crates/ai/rag` and `crates/ai/mcp`.
   - Replace per-call `tokio_postgres::connect(.., NoTls)` with one
     `deadpool-postgres` 0.14.2 pool (MIT OR Apache-2.0) per process, using
     `RecyclingMethod::Verified`.
   - Choose TLS through `tokio-postgres-rustls` when the URL is not
     loopback.
   - Declare `deadpool-postgres` in the workspace.

6. **Do not enable sqlx `sqlite` in the root workspace.**
   - Owner: lead / Cargo policy.
   - sqlx 0.9.0 caps `libsqlite3-sys` below 0.38, while the root locks
     0.38.2, and `links = "sqlite3"` forbids two versions in one graph.
   - Stay on rusqlite 0.40 for SQLite and tokio-postgres for PG.
   - `crates/os/kernel/comps/drive` stays an isolated workspace with sqlx 0.8 / sea-orm 1.1
     / rusqlite 0.32.
   - Use tokio-rusqlite 0.8 or deadpool-sqlite 0.14 if async SQLite is needed;
     both already require rusqlite 0.40.

7. **Add BM25 to PostgreSQL with permissive licences and keep RRF in one
   owner.**
   - Owner: T1, with `aphrody-rag-core::fusion::rrf` (k=60) as the single
     fusion implementation.
   - Self-hosted PG18: `pg_textsearch` 1.4.0 (PostgreSQL licence) rather than
     ParadeDB 0.25 (AGPL-3.0).
   - Neon: `lakebase_text` (pg_search was removed 2026-09-21).
   - RG on self-hosted Supabase (PG17, no BM25 extension): `tsvector` + GIN +
     the `hybrid_search()` RRF function.
   - pgvectorscale 0.9.1 (PostgreSQL licence) only if a corpus outgrows RAM;
     if adopted, 0.9.1 is the minimum because it is a security fix.

8. **Harden SQLite stores.**
   - Owners: `crates/ai/rag` (`schema.rs`, `store.rs`) and `crates/ai/memory`
     (T1).
   - Add `busy_timeout=5000`, `foreign_keys=ON` (already in rag),
     `temp_store=MEMORY`, `PRAGMA optimize=0x10002` at open, and
     `wal_checkpoint(TRUNCATE)` after bulk indexing.
   - Move the brute-force vector scan in `search_vector` into
     `spawn_blocking`, or a dedicated reader connection, so it does not hold
     the async mutex.
   - Policy: only engines at version 3.51.3 or later may write WAL databases.
     Bundled 3.53.2 qualifies; the system CLI (3.45.1) must not write them.
   - Backups: nightly `VACUUM INTO`. Use Litestream 0.5.17 (Apache-2.0) for
     continuous replication on Linux hosts.

10. **Backup and comparison tooling.**
    - Owners: Infra (`packages/infra/workspace`, `scripts/release`).
    - Self-hosted PG: nightly `pg_dump -Fc` of the metadata schemas, plus
      pgBackRest 2.59.2 (MIT; funded again since 2026-05) or PG17+
      `pg_basebackup --incremental` + `pg_combinebackup` for the
      chunk/vector cluster. Restore-test monthly.
    - Schema diffs: `stripe/pg-schema-diff` 1.0.9 (MIT); migra is deprecated,
      and Atlas Community Edition lacks extensions and partitions.
    - Migrations: rehearse on a Neon TTL branch (already 7 d in `neon.ts`),
      over the direct URL.
    - SQLite: `sqldiff --primary-key` and `sqlite-utils` 4.2.1
      (Apache-2.0).

## 2. Further recommendations

- **Inference caches stay out of SQL** (T2a/b/c). Log `template_sha256`,
  `model_sha256` (from the `aphrody-models` `ModelStore`) and request params,
  so prefix-cache hit rates and evals can be split by version.
  - If llama.cpp slot persistence is used, store only slot file metadata in
    SQL.
  - If an LLM response cache is ever added, key it on
    `(prompt_sha256, model_id, params_sha256)` and never serve semantic hits
    across models.
- **Ingest path** (T1):
  - Rust bulk loads use tokio-postgres `BinaryCopyInWriter` into an `UNLOGGED`
    staging table, then `INSERT ... ON CONFLICT (content_sha256) DO NOTHING`.
    Build HNSW after the first load with a large `maintenance_work_mem`.
  - `Bun.SQL` has no COPY, so Bun bulk loads use postgres.js 3.4.9.
- **Dedup columns:** PG18 generated columns default to VIRTUAL and cannot be
  indexed. Declare `content_sha256 ... GENERATED ALWAYS AS (sha256(...))
  STORED UNIQUE`. On SQLite, compute SHA-256 in Rust or Bun (`sha2` is
  already in the workspace).
- **Drizzle:** keep `drizzle-orm` 0.45.3 until 1.0 reaches GA (1.0.0-rc.4 is
  the current release candidate). Add pgvector columns with drizzle's
  `vector`/`halfvec` types, and put `CREATE EXTENSION vector` in a migration
  by hand.
- **Registry UI:** adopt MLflow 3.16 (Apache-2.0) with its Postgres backend
  in a separate schema only if experiment comparison becomes a need. Do not
  adopt lakeFS, which moved to BSL 1.1 on 2026-09-22.
- **Memory** (`crates/ai/memory`): replace the `LIKE '%"tag"%'` tag filter on
  JSON with a `memory_tags(record_id, tag)` table, or `json_each` with an
  index. Keep LanceDB optional; it duplicates sqlite-vec's role.

## 3. Licence summary of proposed adoptions

| Component | Licence | Compatible with Apache-2.0 repo |
|---|---|---|
| pgvector (ext) 0.8.7 / `pgvector` crate 0.4.2 | PostgreSQL / MIT OR Apache-2.0 | yes |
| deadpool-postgres 0.14.2, tokio-postgres-rustls 0.14 | MIT OR Apache-2.0 / MIT | yes |
| pg_textsearch 1.4.0, pgvectorscale 0.9.1 | PostgreSQL | yes |
| ParadeDB pg_search 0.25 | AGPL-3.0 | service-only; avoid linking or modifying |
| sqlite-vec 0.1.9 | MIT / Apache-2.0 | yes |
| Litestream 0.5.17, sqlite-utils 4.2.1 | Apache-2.0 | yes (tools) |
| pgBackRest 2.59.2, pg-schema-diff 1.0.9 | MIT | yes (tools) |
| sentence-transformers 6.1, TRL 1.14, PEFT 0.21 | Apache-2.0 | yes |
| FlagEmbedding 1.4.2, datasketch 2.0 | MIT | yes |
| MLflow 3.16 (optional) | Apache-2.0 | yes |
| lakeFS 1.88 | BSL 1.1 | avoid |
