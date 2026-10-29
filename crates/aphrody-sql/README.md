<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-sql

Shared SQL owner of Aphrody (ADR `docs/decisions/infra/sql-convergence.md`,
D4/D5/D8/D9). One crate for the PostgreSQL pool, the SQLite open policy, the
migration runner and database URL resolution. Consumers: `aphrody-rag`,
`aphrody-mcp`, `aphrody-memory`, `aphrody-train` (feature `registry`).

No sqlx or sea-orm: the root workspace stays on `tokio-postgres` 0.7 and
`rusqlite` 0.40 (bundled SQLite 3.53). `crates/os/kernel/comps/drive` remains an isolated
workspace.

| Feature | Default | Adds |
|---|---|---|
| `postgres` | yes | `pg`: `deadpool-postgres` 0.14, `tokio-postgres-rustls` 0.14 (+ native and Mozilla roots), `pgvector` 0.4 (`vector`, `halfvec`) |
| `sqlite` | no | `sqlite`: `rusqlite` open policy, `VACUUM INTO`, WAL checkpoint, SQLite migrations |
| `vec` | no | `sqlite` + `sqlite-vec` 0.1.9 (`vec0`) registered once as an auto extension |

`env` and `migrate` (pure parts) are always available. Dependents declare
`aphrody-sql = { workspace = true, features = ["postgres", "sqlite"] }`
(the workspace entry has `default-features = false`).

## Database URLs (`env`)

```rust
use aphrody_sql::DatabaseEnv;

let env = DatabaseEnv::new("APHRODY_TRAINING").legacy("DATABASE_URL");
let runtime = env.runtime();      // pooled first
let migrations = env.migration(); // direct first
```

| Variable | Role |
|---|---|
| `<PREFIX>_DATABASE_URL` | direct URL: migrations, `COPY`, `LISTEN`, DDL |
| `<PREFIX>_DATABASE_URL_POOLED` | runtime URL behind a pooler (PgBouncer, Neon `-pooler`) |

Resolution order, empty or whitespace-only values counting as unset:

* runtime: `_POOLED`, direct, then legacy variables in declaration order;
* migrations: direct, legacy variables, then `_POOLED` as a last resort.

Pre-convention variables (`DATABASE_URL`, `APHRODY_MCP_DATABASE_URL`,
`RG_DATABASE_URL`, ...) are declared with `.legacy(..)` and never renamed.
`require_runtime()` / `require_migration()` return `SqlError::MissingEnv`
listing every candidate.

URLs are wrapped in `DatabaseUrl`: `Display` and `Debug` redact the password
(`postgres://u:***@host/db`, `password=***`, `sslpassword=***`, libpq
key/value strings). `redact_url` is exported for log call sites. Error values
never embed a URL. Credentials live only in ignored env files or host stores.

## PostgreSQL (`pg`)

```rust
let pool = aphrody_sql::shared_pool(url)?;           // one pool per process and URL
let client = pool.get().await?;                      // derefs to tokio_postgres::Client
let mut client = pool.get().await?;
let tx = client.transaction().await?;                // deadpool Transaction
```

* `PgPool::builder(url)` configures `max_size` (default 8), timeouts (5 s
  wait/create/recycle), `application_name`, recycling and TLS. Pools are lazy:
  building one never connects.
* Recycling is `RecyclingMethod::Verified`: a connection that died while idle,
  or whose creating runtime ended, is replaced instead of handed out. Use
  `RecyclingMethod::Clean` when callers issue session-level `SET`.
* TLS follows the URL (`TlsPolicy::Auto`): loopback hosts (`localhost`,
  `127.0.0.0/8`, `::1`, `*.localhost`) and Unix sockets use `NoTls`; every other
  host uses rustls (platform roots + Mozilla `webpki-roots`) and `sslmode` is
  raised to `require`. An explicit `sslmode=disable` or `sslmode=require` wins.
  Chain and host name are always verified, so `sslmode=verify-ca|verify-full`
  are accepted and mapped to `require`. Private CA: `sslrootcert=<path>` in the
  URL, `PGSSLROOTCERT`, or `PgPoolBuilder::root_cert_pem`. libpq options that
  `tokio-postgres` rejects (`sslcert`, `sslkey`, ...) are dropped.
* Behind a transaction pooler use unnamed typed statements
  (`query_typed`, `execute_typed`); the migration runner and the training
  registry already do.

Vectors bind as typed values, not `$1::text::vector` strings:

```rust
use aphrody_sql::pg::vector;
let embedding = vector::from_f64(&values).ok_or("non-finite")?; // or from_f32 / half_from_f32
client.query("SELECT id FROM chunks ORDER BY embedding <=> $1::vector LIMIT $2",
             &[&embedding, &20_i64]).await?;
```

`vector::set_iterative_scan_local(&tx, true)` issues `SET LOCAL
hnsw.iterative_scan = relaxed_order` for filtered HNSW queries (pgvector 0.8+).
Indexes use `USING hnsw ((embedding::halfvec(384)) halfvec_cosine_ops)` (ADR
D10).

## SQLite (`sqlite`)

```rust
use aphrody_sql::sqlite::{self, OpenPolicy};

let conn = sqlite::open(path, OpenPolicy::read_write())?;
let reader = sqlite::open(path, OpenPolicy::read_only())?;   // scans that must not block the writer
let vec = sqlite::open(path, OpenPolicy::read_write().with_vec())?; // feature `vec`
sqlite::vacuum_into(&conn, backup_path)?;      // nightly backup, atomic rename, never overwrites
sqlite::checkpoint_truncate(&conn)?;           // after bulk indexing
```

Applied by `open` / `apply_policy`, in this order:

| Pragma | Value |
|---|---|
| `busy_timeout` | 5000 ms |
| `journal_mode` | `WAL` (skipped read-only and in memory) |
| `synchronous` | `NORMAL` |
| `foreign_keys` | `ON` |
| `temp_store` | `MEMORY` |
| `optimize` | `0x10002` (skipped read-only and in memory) |

Only engines at SQLite 3.51.3 or later may write WAL databases (WAL-reset fix):
the bundled 3.53 qualifies, the 3.45 system CLI must not write them.
`open` creates missing parent directories (`create_parent_dirs`).
`with_vec()` registers sqlite-vec before opening and verifies `vec_version()`;
without the `vec` feature it fails with `SqlError::FeatureDisabled("vec")`.
`vacuum_into` writes `<backup>.partial` then renames.

## Migrations (`migrate`)

Contract (ADR D8):

* Files are named `NNNN_name.sql` (four or more digits) and embedded in the
  binary. Pass `(file name, contents)` pairs to `MigrationSet::from_files`, or
  use the macro (paths relative to the invoking file, like `include_str!`):

  ```rust
  let set = aphrody_sql::embed_migrations!(
      "../migrations/0001_init.sql",
      "../migrations/0002_index.sql",
  )?;
  ```
* Progress is tracked in `aphrody_migrations(version, name, sha256, applied_at)`.
  `MigrateOptions::in_schema("training")` scopes it to `training.aphrody_migrations`
  (schema created if missing). Identifiers are validated.
* `sha256` is the SHA-256 of the file with CRLF normalised to LF. A recorded
  checksum that differs from the embedded file is `SqlError::ChecksumMismatch`:
  applied migrations are immutable, fix forward.
* A database ahead of the binary (`UnknownAppliedMigration`) and a pending file
  older than an applied one (`OutOfOrderMigration`) are errors.
* One transaction per file; a failing file rolls back as a whole and stops the
  run (`MigrationFailed`). Files must not contain `BEGIN`/`COMMIT` nor
  statements that cannot run in a transaction (`CREATE INDEX CONCURRENTLY`,
  `VACUUM`). On SQLite `PRAGMA foreign_keys` is a no-op inside a transaction.
* PostgreSQL serialises concurrent runners with `pg_advisory_xact_lock` (key
  derived from the tracking table name), taken inside every transaction;
  SQLite uses `BEGIN IMMEDIATE`. The runner uses only the simple protocol and
  unnamed typed statements, so it also works behind a pooler, but run it on the
  direct URL.
* One owner per database or schema: the tracking table is keyed by version.
  Shenron (drizzle-kit) and RG (its SQL migrations) keep their own tools.

```rust
let mut client = pool.get().await?;
let report = aphrody_sql::migrate_postgres(&mut client, &set, &MigrateOptions::default()).await?;
let report = aphrody_sql::migrate_sqlite(&mut conn, &set, &MigrateOptions::default())?;
```

## Tests

`cargo test -p aphrody-sql --all-features` needs no server: environment
parsing, redaction, pool/TLS decisions (no connection), migration parsing,
ordering, checksums and planning, SQLite policy, in-memory migrations and
`vec0`. PostgreSQL behaviour against a live server is exercised through the
consumers. Run Cargo through `scripts/aphrody/build/rust/cargo-serial.sh`.
