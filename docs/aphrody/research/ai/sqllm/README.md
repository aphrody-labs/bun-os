<!-- SPDX-License-Identifier: Apache-2.0 -->
# SQL + LLM research set (2026-10-01)

This is the state of the art as of 2026-10-01 for storing AI training data,
inference state and RAG corpora in PostgreSQL 18 and SQLite 3.5x, with Rust
and Bun clients, mapped onto Aphrody's owners.

**Sourcing:** every non-trivial claim links a primary source (GitHub
releases and tags, crates.io, npm, PyPI, vendor docs). `UNVERIFIED` marks the
rest.

**Method:** four parallel research passes (`gh` CLI, crates.io/npm/PyPI APIs,
WebFetch, Context7), plus a read-only scan of this checkout and
`../aphrody-py`, and one read-only Neon API call.

## Index

| File | Contents |
|---|---|
| [training.md](training.md) | Registries (MLflow, DVC, OpenLineage, lakeFS), reference lineage/eval/promotion schema, exact/MinHash/semantic dedup, E5/BGE hard-negative mining, TRL/PEFT/QLoRA dataset formats, SQL export, current Aphrody registry and trainer state |
| [inference.md](inference.md) | llama.cpp, mistral.rs, Ollama, vLLM, LMCache: APIs, prefix/KV caches, persistence; where SQL belongs (templates, history, response caches) |
| [rag.md](rag.md) | pgvector 0.8.7 (halfvec, HNSW, iterative scan, binary quantization), pgvectorscale 0.9.1, BM25 options (ParadeDB, pg_textsearch, lakebase_text), RRF SQL, Neon and Supabase specifics, SQLite RAG summary |
| [postgres.md](postgres.md) | PG 18.6 features, COPY ingest recipe, partitioning, WAL, autovacuum, backups (pg_dump, incremental pg_basebackup, pgBackRest, Barman, WAL-G), schema/data diff tools, Neon and self-hosted Supabase operations |
| [sqlite.md](sqlite.md) | SQLite 3.53.4, WAL-reset fix, pragma profile, backup (`.backup`, `VACUUM INTO`, sqlite3_rsync, Litestream 0.5), FTS5, sqlite-vec 0.1.9, libSQL/Turso, sqldiff, sqlite-utils |
| [clients-rust-bun.md](clients-rust-bun.md) | tokio-postgres, deadpool, pgvector, sqlx 0.9, sea-orm 2, rusqlite 0.40, sqlite-vec crate, Turso; Bun 1.4.2 `Bun.SQL` / `bun:sqlite`, drizzle 0.45 / 1.0-rc, postgres.js, Neon serverless; current workspace usage |
| [recommendations.md](recommendations.md) | Top 10 actions with owners and licences, further recommendations, licence table |

## Executive summary

1. **No engine keeps inference state in SQL.**
   - llama.cpp, mistral.rs, Ollama and vLLM keep prefix/KV caches in memory,
     files or object stores, keyed by token-block hashes. vLLM's automatic
     prefix caching is on by default; llama.cpp can save slots to files.
   - SQL belongs to the application layer: templates, history, response
     caches, eval traces and the model registry.
   - Ollama's *desktop app* is the exception: it stores chats in SQLite.
2. **PostgreSQL 18.6 is the current minor and the right target.**
   - Useful features: async I/O, `uuidv7()`, B-tree skip scan,
     `RETURNING OLD/NEW`, and statistics kept across pg_upgrade.
   - Generated columns now default to VIRTUAL and cannot be indexed, so dedup
     hash columns must be `STORED`.
   - PG19 is at beta 4.
   - The Aphrody Neon project already runs PG18.
3. **The dense-retrieval default is pgvector 0.8.x with HNSW on `halfvec`.**
   - Use iterative index scans for filtered queries.
   - Add binary quantization plus re-rank at scale, and pgvectorscale
     DiskANN only beyond RAM (0.9.1 is a security fix).
4. **BM25 in Postgres has fragmented.**
   - ParadeDB 0.25 is AGPL; it renamed its access method to `paradedb`.
   - Timescale `pg_textsearch` 1.4 is PostgreSQL-licensed.
   - Neon **removed pg_search on 2026-09-21** in favour of `lakebase_text`.
   - Self-hosted Supabase is still PG17 with no BM25 extension.
   - Fuse lexical and dense results with RRF (k=60).
5. **SQLite 3.53.x and WAL.**
   - Every writer must run at least 3.51.3 because of the WAL-reset
     corruption fix.
   - Aphrody's bundled rusqlite and Bun both ship 3.53.2.
   - sqlite-vec restarted development (0.1.9 stable; ANN in alpha).
   - Litestream 0.5 (LTX format) is the continuous-backup option; Turso 0.8
     is the Rust rewrite with vectors, still pre-1.0.
6. **Client choice.**
   - Stay on tokio-postgres + deadpool-postgres + the `pgvector` crate in
     Rust.
   - sqlx 0.9's SQLite driver cannot coexist with rusqlite 0.40, because
     `libsqlite3-sys` declares `links = "sqlite3"`.
   - Bun 1.4.2 `Bun.SQL` lacks COPY; use postgres.js for bulk ingest.
   - drizzle 1.0 is still a release candidate.
7. **Training data.**
   - sentence-transformers is now **v6.1**. Its `mine_hard_negatives` with
     positive-aware margins (NV-Retriever) is the reference way to mine hard
     negatives.
   - FlagEmbedding `hn_mine` plus reranker-score distillation covers BGE.
   - lakeFS moved to BSL 1.1; MLflow 3 uses aliases instead of stages.
8. **Aphrody gaps found.** See [recommendations.md](recommendations.md).
   - The Neon training registry has no writer.
   - Triples use positional, not hard, negatives.
   - PG vectors are bound as text literals, and PG connections are per-call
     and without TLS.
   - The SQLite dense scan runs under an async mutex.
   - npm `sqlite-vec` is pinned at ^0.1.1.

## Scope notes

- **Read-only:** no Cargo was run, nothing was committed, and nothing outside
  this directory was edited. No credentials appear here; connection strings
  are referenced only by environment-variable name.
- **Neon project facts** (PG 18, Free plan, 1 GiB branch limit) come from the
  Neon API on 2026-10-01 and may change.
- **Postgres RAG DDL not found:** the DDL for `aphrody_rag_documents` and
Its index type and pgvector version on the serving host are   UNVERIFIED.
