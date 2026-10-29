<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR: SQL convergence for all of Aphrody

Status: **accepted 2026-10-01** (owner directive: "tranche tout le côté SQL de
A à Z"). Inputs: [docs/research/ai/sqllm](../../research/ai/sqllm/README.md),
the host inventory and dedup run (`docs/operations/infra/db-dedup-2026-10-01.md` (not in repo)). Development phase:
private, non-commercial; every licence is acceptable but recorded.

## Decisions

| # | Topic | Decision |
|---|---|---|
| D1 | Engines | **PostgreSQL 18** for shared/server data. **SQLite** (bundled 3.53, never the 3.45 system CLI for writes) for local, embedded, per-agent and per-app state. **Neon project `aphrody`** for training/experiment metadata only. **Redis** is cache/session only, never a system of record. |
| D2 | Supabase | Not a new target. Legacy Supabase data is kept as one verified backup and runs only as a **self-hosted dev stack** in WSL Docker. No Supabase cloud project. New code uses PostgreSQL directly. |
| D3 | Topology | Production PostgreSQL databases are limited to those with a live owner (owner decision 2026-10-01). Unused databases are retired after a final verified dump in the unique backup; the WSL copies go too. WSL PG18 `18/main` is a dev mirror only; WSL cluster `16/main` is retired after backup. Stale SQLite copies are archived after the unique backup. Training metadata lives in Neon `aphrody` (D11), not on the hosts. |
| D4 | Rust clients | `tokio-postgres` 0.7 + `deadpool-postgres` 0.14 (one pool per process) + `tokio-postgres-rustls` 0.14 (TLS for any non-loopback URL) + `pgvector` 0.4 (typed `Vector`/`HalfVector` binds). SQLite: `rusqlite` 0.40 bundled, `sqlite-vec` 0.1.9 for vectors. **No sqlx or sea-orm in the root workspace** (libsqlite3-sys conflict); `crates/os/kernel/comps/drive` stays an isolated workspace. |
| D5 | Shared Rust owner | New crate **`aphrody-sql`** at `crates/infra/sql`: Postgres pool builder (TLS by URL, pooled vs direct URL), SQLite open policy (WAL, `busy_timeout=5000`, `foreign_keys=ON`, `temp_store=MEMORY`, `optimize=0x10002`, optional `vec0` registration), an embedded plain-SQL migration runner (checksummed `aphrody_migrations` table, one transaction per file, advisory lock on PG), and env resolution. `crates/ai/rag`, `crates/ai/mcp`, `crates/ai/memory` and `crates/ai/train` consume it. |
| D6 | Bun clients | `Bun.SQL` for PostgreSQL at runtime; `postgres` (postgres.js) only where COPY is needed; `bun:sqlite` for SQLite; npm `sqlite-vec` 0.1.9. ORMs are not unified; new code needs no ORM. |
| D7 | Shared Bun owner | New package **`@aphrody/sql`** at `packages/infra/sql`: env/URL resolution, a `Bun.SQL` client factory, Redis client factory, SQLite open policy (same pragmas as D5). |
| D8 | Migrations | One owner per database, each with its own SQL migrations. Rust services and the training registry: `aphrody-sql` runner with files under the owning crate's `migrations/`. Schema diffs with `stripe/pg-schema-diff`; rehearse on a 7-day Neon branch or the WSL mirror. No schema is created before its code and migrations exist. |
| D9 | Env naming | `<DOMAIN>_DATABASE_URL` (direct) and `<DOMAIN>_DATABASE_URL_POOLED` (runtime), e.g. `APHRODY_TRAINING_DATABASE_URL`. Existing contracts (`APHRODY_MCP_DATABASE_URL`, …) are kept, not renamed. Credentials live only in ignored env files or host stores. |
| D10 | Vectors and search | PostgreSQL: pgvector 0.8, `halfvec` + HNSW, iterative scan for filtered queries. SQLite: `vec0` (same layout from Rust and Bun). Lexical: `tsvector` + GIN by default; `pg_textsearch` optional on self-hosted PG; **no ParadeDB (AGPL)**. One fusion implementation: `aphrody-rag-core::fusion::rrf`. |
| D11 | Training | Generic registry (any model, any domain) in `crates/ai/train` behind a `registry` feature: datasets with lineage and `content_sha256`, runs with `code_commit`, artifacts, generic eval metrics, promotions with one live promotion per alias. Leak/dedup gates by normalised-text SHA-256 anti-join plus MinHash in `aphrody-py`. Hard negatives mined, not positional. |
| D12 | Backups | Per-host nightly `pg_dump -Fc` (existing timers, keep newest per DB after verification). **One consolidated, sha256-verified backup set, stored once** in WSL `~/.aphrody/private/backups/aphrody-unique/<date>/` (owner rule 2026-10-02: no duplicate backup across WSL, Windows, vps, dbfr; amended from the earlier per-host copies). No second copy on vps, dbfr or the Windows disk; GitHub repository backups live under `~/.aphrody/private/backups/github/`. SQLite: nightly `VACUUM INTO`; Litestream later. Restore-test monthly. |
| D13 | Dedup | Keep the most complete copy (rows, then freshness, integrity OK). Remove byte-identical duplicates only after the verified unique backup. Never drop or modify a live production database. |
| D14 | Tooling | SQLite diffs: `sqldiff --primary-key`, `sqlite-utils`. |

## Execution (2026-10-01)

- Rust: `aphrody-sql` crate, consumers in rag/mcp/memory, training registry in
  `crates/ai/train` (workers never run Cargo; the lead validates through
  `scripts/build/rust/cargo-serial.sh`).
- Bun: `@aphrody/sql`, sqlite-vec 0.1.9.
- Python: `aphrody-py` hard-negative mining and hash-based leak gates.
- Ops: unique backups, dedup, WSL Supabase dev stack (see the operations
  docs).

Claim: `.coord/claims/sql-convergence.json` (not in repo).
