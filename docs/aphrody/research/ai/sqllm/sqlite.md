<!-- SPDX-License-Identifier: Apache-2.0 -->
# SQLite 3.5x for local AI data, RAG and agent state (2026-10-01)

Sources are linked inline. `UNVERIFIED` marks claims without a primary source.
SQLite versions observed locally on 2026-10-01:

| Component | SQLite version |
|---|---|
| Root Cargo workspace: `rusqlite 0.40.2` → `libsqlite3-sys 0.38.2` (bundled) | 3.53.2 |
| Bun 1.4.2 `bun:sqlite` | 3.53.2 |
| Ubuntu 24.04 `sqlite3` CLI | 3.45.1 (older than the WAL-reset fix) |

## 1. Versions ([changes.html](https://sqlite.org/changes.html))

| Version | Date | Relevant changes |
|---|---|---|
| **3.53.4** | 2026-07-24 | Latest. |
| 3.53.0 | 2026-04-09 | Fixes a **WAL-reset database corruption bug**. `ALTER TABLE` can add or drop NOT NULL and CHECK. Adds `REINDEX EXPRESSIONS`, `json_array_insert()`, a `reserve` option for `VACUUM INTO`, and `sqlite3_rsync --port`. 3.52.0 was withdrawn. |
| 3.51.3 | 2026-03-13 | Backport of the WAL-reset fix. |
| 3.51.0 | 2025-11-04 | `jsonb_each()` and `jsonb_tree()`; carray and percentile built in (off by default); `PRAGMA wal_checkpoint=NOOP`. |
| 3.50.0 | 2025-05-29 | `unistr()`; `sqlite3_setlk_timeout()`; `sqlite3_rsync` no longer needs WAL mode. |
| 3.47.0 | 2024-10-21 | `sqlite3_rsync` first ships. |

**Minimum version for WAL databases: 3.51.3 or 3.53.x.** Every process that
writes a database must use a fixed library. The old system CLI is fine for
reading and `.backup`, but do not use it to write a WAL database that the
application also writes.

## 2. Connection profile

[pragma.html](https://sqlite.org/pragma.html)

```sql
PRAGMA journal_mode = WAL;          -- persistent, per database
PRAGMA synchronous = NORMAL;        -- safe from corruption in WAL; last commit may roll back on power loss
PRAGMA busy_timeout = 5000;         -- per connection
PRAGMA foreign_keys = ON;           -- per connection, off by default
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -65536;         -- 64 MiB
PRAGMA mmap_size = 268435456;       -- 256 MiB, size to available RAM
PRAGMA optimize = 0x10002;          -- long-lived connections: at open, then periodically
-- after bulk load:
PRAGMA wal_checkpoint(TRUNCATE);
```

- **Tables:** use `STRICT` tables for typed columns, and `WITHOUT ROWID` for
  narrow tables keyed by hash or natural key (for example
  `content_sha256 BLOB PRIMARY KEY`).
- **Writes:** SQLite has a single writer. Use one writer connection (or a
  mutex) and many readers. Batch inserts in one transaction with a prepared
  statement.
- **Dedup:** a `content_sha256 BLOB UNIQUE` column with
  `INSERT ... ON CONFLICT DO NOTHING`. Compute SHA-256 in the application,
  because core SQLite has no SHA-256 function. The CLI's `shathree` extension
  is SHA-3.

## 3. Backup and replication

| Method | Properties |
|---|---|
| `.backup` CLI / online backup API | Consistent copy of a live database; restarts if the source changes mid-copy (classic API). |
| `VACUUM INTO 'file'` | Consistent, compacted copy in one statement. Good for nightly snapshots and as a "clean" artifact for training datasets. |
| `sqlite3_rsync` (3.47+) | Copies a live database to a replica over SSH, transferring only changed pages. One database per call. The replica is read-only while it runs. [doc](https://sqlite.org/rsync.html) |
| Litestream **0.5.17** (2026-08-31), Apache-2.0 | Continuous replication to S3-compatible storage. The v0.5 rewrite (2025-09-30) uses the LTX format, hierarchical compaction, point-in-time restore and no cgo. Windows is not officially supported. [repo](https://github.com/benbjohnson/litestream), [v0.5 blog](https://fly.io/blog/litestream-v050-is-here/) |
| LiteFS 0.5.14 (2025-04-22), Apache-2.0 | FUSE-based; "beta", no release for over 17 months. Avoid. [repo](https://github.com/superfly/litefs) |

## 4. FTS5 (lexical, BM25)

[fts5.html](https://sqlite.org/fts5.html)
- **Ranking:** `bm25(table, w1, w2, ...)` with per-column weights. Lower is
  better, so use `ORDER BY rank` or `bm25()` ascending.
- **External content tables** (`content=chunks, content_rowid=id`) with
  insert, delete and update triggers. Aphrody's `crates/ai/rag/src/schema.rs`
  already uses exactly this pattern with
  `unicode61 remove_diacritics 2`.
- **Tokenizers:** `trigram` gives substring and fuzzy search over code and
  identifiers, at about 3x the index size. Contentless-delete tables
  (`content='', contentless_delete=1`, 3.43+) save space when the text is
  stored elsewhere.
- **Maintenance:** after large loads,
  `INSERT INTO chunks_fts(chunks_fts) VALUES('optimize')`.

## 5. Vectors

### sqlite-vec ([repo](https://github.com/asg017/sqlite-vec))

- **Version and licence:** stable **v0.1.9** (2026-03-31), dual MIT/Apache-2.0,
  pre-1.0. v0.1.7 (2026-03-17) restarted development with Mozilla support and
  fixed `DELETE` so space is reclaimed. **v0.1.10-alpha.1..4** (latest
  2026-05-18) add ANN indexes (rescore, DiskANN, IVF); these are experimental.
- **`vec0` columns:** `float[N]`, `int8[N]`, `bit[N]` (via
  `vec_quantize_binary`). Metadata, partition-key and auxiliary (`+col`)
  columns arrived in v0.1.6.
- **KNN query:** `WHERE embedding MATCH ? AND k = 10 ORDER BY distance`.
  [knn doc](https://github.com/asg017/sqlite-vec/blob/main/site/features/knn.md)
- **Search is exact brute force with SIMD.** It is interactive up to roughly
  10^5–10^6 vectors at 384 dimensions (order-of-magnitude estimate,
  UNVERIFIED for specific hardware). Use `bit[N]` plus float re-rank for
  larger sets.
- **sqlite-vss is deprecated.**

```sql
CREATE VIRTUAL TABLE vec_chunks USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  model TEXT partition key,          -- one partition per embedding space
  embedding float[384] distance_metric=cosine,
  +source_url TEXT                   -- auxiliary column, not filterable
);
SELECT chunk_id, distance FROM vec_chunks
WHERE embedding MATCH :q AND k = 20 AND model = 'multilingual-e5-small'
ORDER BY distance;
```

### libSQL and Turso ([docs](https://docs.turso.tech/features/ai-and-embeddings))

- **libSQL:** type `F32_BLOB(N)` (plus F16, F8 and F1BIT variants),
  `vector32()`, `vector_distance_cos`, and a DiskANN index via
  `libsql_vector_idx(emb, 'metric=cosine')` queried with `vector_top_k()`.
  Licence MIT. Last libSQL server tag 0.24.32 (2025-02).
- **Turso Database** (the Rust rewrite, formerly Limbo): **v0.8.1**
  (2026-09-29), MIT. Its README says it "replaces libSQL as our intended
  direction" and lists vector search and indexing.
  [repo](https://github.com/tursodatabase/turso) It is a full engine
  replacement, so it is not a drop-in extension for rusqlite or bun:sqlite.

### Hybrid search in SQLite

RRF over the FTS5 and `vec0` CTEs, each with `row_number()`, combined with a
`FULL OUTER JOIN` (3.39+) and scored as `1/(60+r_fts) + 1/(60+r_vec)`.
[Alex Garcia, sqlite-vec hybrid search](https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/index.html)

## 6. Compare, inspect and dedup tools

| Tool | Version | Licence | Use |
|---|---|---|---|
| `sqldiff` | ships with 3.53 | Public domain | `--primary-key` pairs rows by declared PK; `--schema`; `--changeset FILE`; `--vtab` for FTS tables. [doc](https://sqlite.org/sqldiff.html) |
| sqlite-utils | 4.2.1 (2026-08-13) | Apache-2.0 | `insert --pk`, `upsert`, `enable-fts`, `extract`, `analyze-tables`, `duplicate`; 4.0 added migrations. [repo](https://github.com/simonw/sqlite-utils) |
| Datasette | 0.65.5 / 1.0a41 | Apache-2.0 | Read-only exploration of RAG and memory databases. [repo](https://github.com/simonw/datasette) |

## 7. Placement guidance

- **SQLite fits** per-user or per-agent state: memory, local RAG over a
It is a single file, has no server, and can be backed up with   `VACUUM INTO`.
- **Move to PostgreSQL** when several hosts or processes write concurrently,
  when vectors exceed about 10^6, or when you need server-side BM25 plus ANN in
  one query.
