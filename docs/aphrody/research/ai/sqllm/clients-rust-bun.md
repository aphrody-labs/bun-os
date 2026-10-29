-->
# Rust and Bun database clients (2026-10-01)

Versions come from crates.io, npm and GitHub on 2026-10-01. Workspace
observations come from `Cargo.toml`, `Cargo.lock` and `package.json` files
in this checkout. `UNVERIFIED` marks claims without a primary source.

## 1. Summary

| Library | Lang | Version (date) | Licence | Role | Caveat |
|---|---|---|---|---|---|
| tokio-postgres | Rust | 0.7.18 (2026-06-12) | MIT OR Apache-2.0 | low-level PG, binary COPY, pipelining | no automatic statement cache |
| deadpool-postgres | Rust | 0.14.2 (2026-08-26) | MIT OR Apache-2.0 | pool + `prepare_cached` | `RecyclingMethod::Fast` skips health checks |
| tokio-postgres-rustls | Rust | 0.14.0 (2026-05-21) | MIT | rustls TLS | third-party crate |
| pgvector | Rust | 0.4.2 (2026-05-22) | MIT OR Apache-2.0 | `Vector`, `HalfVector`, `SparseVector`, `Bit` | `halfvec` feature is opt-in |
| sqlx | Rust | 0.9.0 (2026-05-21) | MIT OR Apache-2.0 | async SQL, `query!` checked at compile time, migrations | **its sqlite driver needs libsqlite3-sys < 0.38, so it conflicts with rusqlite 0.40**; MSRV 1.94; `SqlSafeStr` breaking change; repo moved to transact-rs/sqlx |
| sea-orm | Rust | 2.0.4 (2026-09-27) | MIT OR Apache-2.0 | ORM on sqlx 0.9 | `sea-orm-sync` needs rusqlite ^0.38 |
| rusqlite | Rust | 0.40.2 (2026-08-08) | MIT | sync SQLite; bundles 3.53.2 | `links = "sqlite3"`: one libsqlite3-sys per graph |
| tokio-rusqlite / deadpool-sqlite / r2d2_sqlite | Rust | 0.8.0 / 0.14.0 / 0.35.0 | MIT / MIT OR Apache-2.0 / MIT | async or pooled rusqlite | all require rusqlite 0.40, so they fit the workspace |
| sqlite-vec | Rust/C | 0.1.9 (2026-03-31); 0.1.10-alpha.4 | MIT/Apache-2.0 | `vec0` extension | pre-1.0; registration needs an `unsafe` transmute |
| turso | Rust | 0.8.1 (2026-09-29) | MIT | SQLite rewrite with vectors | pre-1.0 |
| libsql | Rust | 0.9.30 (2026-03-19) | MIT | SQLite fork | new development goes into Turso |
| Bun (`Bun.SQL`, `bun:sqlite`) | TS | 1.4.2 (2026-09-05) | MIT | PG/MySQL/SQLite client; embedded SQLite 3.53.2 | **no COPY**; set `prepare:false` behind PgBouncer |
| drizzle-orm | TS | 0.45.3 (2026-09-21); 1.0.0-rc.4 | Apache-2.0 | ORM, pgvector helpers | in 0.45, `bun-sql` is Postgres-only |
| drizzle-kit | TS | 0.31.11 (2026-09-21) | MIT per npm (UNVERIFIED in repo) | migrations | |
| postgres (postgres.js) | TS | 3.4.9 (2026-04-05) | Unlicense | PG client with COPY streams | unusual licence |
| @neondatabase/serverless | TS | 1.2.0 (2026-10-01) | MIT | Neon HTTP and WebSocket driver | tagged template only since 1.0 |

## 2. Rust: PostgreSQL

### tokio-postgres 0.7.18 (already the workspace standard)

- **`query_typed` / `execute_typed` / `query_typed_one|opt`** (0.7.11+, 0.7.17).
  The caller passes `(value, Type)` pairs, so the query runs **without
  prepare, execute and close round trips**. That makes it safe behind
  PgBouncer transaction mode (the Neon `-pooler` endpoint).
  [CHANGELOG](https://github.com/sfackler/rust-postgres/blob/master/tokio-postgres/CHANGELOG.md)
- **Binary COPY:** `client.copy_in("COPY t (a,b,emb) FROM STDIN BINARY")`
  returns a sink. Wrap it in `binary_copy::BinaryCopyInWriter::new(sink,
  &[Type::TEXT, Type::BYTEA, vector_type])`, then call `.write(&[..])` for each
  row and `.finish()` at the end. This is the fastest ingest path from Rust.
  [binary_copy.rs](https://github.com/sfackler/rust-postgres/blob/master/tokio-postgres/src/binary_copy.rs)
- **Pipelining:** concurrent futures on one `Client` are pipelined
  automatically.
- **Statements:** there is no built-in statement cache. Hold the `Statement`,
  or use deadpool's `prepare_cached`.
- **Pooling:** deadpool-postgres 0.14.2 with `RecyclingMethod::Verified` for
  long-lived daemons. `Clean` resets session state and is useful when code
  uses `SET`.
  [config.rs](https://github.com/deadpool-rs/deadpool/blob/main/crates/deadpool-postgres/src/config.rs)
- **Vectors:** the `pgvector` crate (feature `postgres`, plus `halfvec`)
  implements `ToSql`/`FromSql`, so vectors bind as values instead of
  `$1::text::vector` string literals.
  [pgvector-rust](https://github.com/pgvector/pgvector-rust/blob/master/Cargo.toml)

```rust
// Pooler-safe, typed, binary vector parameter (pgvector crate, feature "postgres").
let emb = pgvector::Vector::from(query_embedding);
let rows = client.query_typed(
    "SELECT id FROM chunks ORDER BY embedding <=> $1 LIMIT $2",
    &[(&emb, vector_type.clone()), (&20_i64, Type::INT8)],
).await?;
// vector_type: look up once via `SELECT 'vector'::regtype::oid`; Type::new(...) or prepare once on the direct endpoint.
```

The vector OID is not fixed, because `vector` is an extension type. Resolve
it once per connection or pool. Whether `query_typed` accepts a custom `Type`
built from a looked-up OID was not verified (UNVERIFIED). The fallback is
`prepare_typed` on a direct connection.

### sqlx 0.9.0

- `query!` macros are checked against a live database or the `.sqlx`
  offline cache (`cargo sqlx prepare --workspace`, `SQLX_OFFLINE=true`).
- `copy_in_raw` provides raw COPY bytes; `PgListener` handles LISTEN/NOTIFY.
  PgBouncer transaction mode needs `statement_cache_capacity(0)`
  (UNVERIFIED that this alone is enough).
  [CHANGELOG](https://github.com/launchbadge/sqlx/blob/v0.9.0/CHANGELOG.md)
- **The SQLite conflict.** libsqlite3-sys declares `links = "sqlite3"`, so
  only one version may exist in a Cargo graph.
  - sqlx 0.9.0 requires `libsqlite3-sys >=0.30.1,<0.38.0`.
  - The root workspace locks **0.38.2** (rusqlite 0.40.2).
  - transact-rs/sqlx#4402 (merged 2026-09-09, unreleased) only raises the
    cap to `<0.39`.
  - **Conclusion:** do not enable sqlx's `sqlite` feature in the root
    workspace. Postgres-only sqlx is fine.
  - [sqlx-sqlite Cargo.toml](https://github.com/launchbadge/sqlx/blob/v0.9.0/sqlx-sqlite/Cargo.toml)
- `crates/os/kernel/comps/drive` (an imported Spacedrive tree) is a **separate workspace**
  excluded from the root. Its sqlx 0.8 sqlite, sea-orm 1.1 and rusqlite 0.32
  share libsqlite3-sys 0.30 and do not affect the root graph.

**Recommendation:** stay on tokio-postgres plus deadpool-postgres plus
pgvector in the root workspace. Adopting sqlx only for compile-time checked
queries would add a second Postgres stack without enough gain. Revisit if a
crate needs checked macros across many queries.

## 3. Rust: SQLite

- **rusqlite 0.40.2** with `bundled` provides SQLite 3.53.2, which includes the
  WAL-reset fix.
  [Cargo.toml](https://github.com/rusqlite/rusqlite/blob/v0.40.2/Cargo.toml)

  | rusqlite | libsqlite3-sys | bundled SQLite |
  |---|---|---|
  | 0.40.2 | 0.38.2 | 3.53.2 |
  | 0.40.0 | 0.38.0 | 3.53.1 |
  | 0.39.0 | 0.37.0 | 3.51.3 |
  | 0.38.0 | 0.36.0 | 3.51.1 |
- **Useful features:** `backup` (online backup API), `blob` (incremental blob
  I/O for embeddings), `functions` (register `sha256` or vector UDFs), `vtab`,
  `load_extension`, `serialize`, `session` (changesets, as used by `sqldiff`).
- **Async:** tokio-rusqlite 0.8.0, which runs a dedicated thread per
  connection. Aphrody crates currently use a `tokio::sync::Mutex<Connection>`
  and call blocking functions inside async code. That is acceptable for short
  queries; a brute-force vector scan should move to `spawn_blocking` or
  tokio-rusqlite.
- **sqlite-vec from Rust:** call `sqlite3_auto_extension(Some(transmute(sqlite3_vec_init as *const ())))`
  once at startup, and every later connection gets `vec0`. The crate compiles
  the C source with `cc` and has no libsqlite3-sys dependency, so there is no
  `links` conflict.
  [rust guide](https://github.com/asg017/sqlite-vec/blob/main/site/using/rust.md)
- **Turso / libSQL:** these replace the engine. They do not fit
  rusqlite-based crates. Watch Turso toward 1.0; do not adopt yet.

## 4. Bun / TypeScript

### Bun 1.4.2: `Bun.SQL`

[docs](https://bun.com/docs/runtime/sql)
- **Adapters:** `postgres`, `mysql`, `mariadb`, `sqlite` (MySQL and SQLite
  since 1.2.21).
- **Queries:** tagged template `` sql`...${v}` ``; bulk insert with
  `` sql`INSERT INTO t ${sql(rows)}` ``; `sql.begin`, `savepoint`,
  `sql.reserve()`, `sql.listen`/`notify`, `sql.unsafe`, `sql.file`.
- **Options:** `max` (default 10), `idleTimeout`, `maxLifetime`,
  `prepare: false` for the PgBouncer/Neon pooler.
- **No COPY.** Use postgres.js `.writable()`/`.readable()` or a Rust path for
  bulk ingest.

### `bun:sqlite`

[docs](https://bun.com/docs/runtime/sqlite)
- Embedded SQLite 3.53.2 in Bun 1.4.2 (observed locally).
- `new Database(path, {strict: true, safeIntegers})`; prepared
  `query().all/get/run`; `db.transaction(fn)`; `serialize()`/`deserialize()`.
- `loadExtension` works on Linux. macOS needs `Database.setCustomSQLite()`.
- Set `PRAGMA journal_mode=WAL` explicitly.

### drizzle-orm 0.45.3

- **Drivers:** `bun-sql` (Postgres only in 0.45), `bun-sqlite`, `postgres-js`,
  `neon-http`, `neon-serverless`.
- **pgvector:**
  - Columns: `vector`, `halfvec`, `sparsevec`, `bit`.
  - Distance helpers: `cosineDistance`, `l2Distance`, `innerProduct`,
    `hammingDistance`, and others.
  - HNSW index: `index().using('hnsw', t.emb.op('vector_cosine_ops'))`.
  - `CREATE EXTENSION vector` must be added to the migration by hand.
  - [guide](https://orm.drizzle.team/docs/guides/vector-similarity-search)
- **1.0** is at rc.4 (2026-06-27). It splits `bun-sql` into postgres, mysql
  and sqlite drivers and adds Turso.

## 5. What the workspace uses today

| Owner | Client(s) | Store | Notes |
|---|---|---|---|
| `crates/ai/rag` | rusqlite 0.40 (FTS5 + `vectors` BLOB table), tokio-postgres 0.7.18 (`aphrody_rag_documents`, lexical only) | SQLite + PG | Dense search is an exact in-process scan over all BLOBs (`store.rs::search_vector`); PG connects per call with `NoTls` and a 5 s timeout |
| `crates/ai/memory` | rusqlite (`sqlite.rs`, `sqlite_local.rs`), optional lancedb 0.29 | SQLite | Tags as JSON text matched with `LIKE`; hand-rolled brute-force "hnsw" module |
| `crates/os/kernel/comps/jobs`, `fsindex`, `ocr-core`, `web-*`, `x`, `google`, `antigravity`, `winclean` | rusqlite | SQLite | `busy_timeout = 5000` already set in jobs and ocr-core |
| `crates/os/kernel/comps/drive` (separate workspace) | sqlx 0.8 sqlite, sea-orm 1.1, rusqlite 0.32 | SQLite | Imported Spacedrive; isolated graph |
| `iecode/packages/rg/db` | kysely + pg + `@supabase/ssr` | Supabase PG | RG product, Supabase-managed |
