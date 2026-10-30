<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/sql

Shared Bun database mechanics for Aphrody. The package implements decisions
D6, D7, D9 and D10 of
ADR sql-convergence. The
Rust counterpart is the `aphrody-sql` crate (`crates/infra/sql`), which applies
the same SQLite policy.

The package exports TypeScript sources. It has no ORM: consumers keep theirs
(Drizzle, Kysely or none).

## Modules

| Subpath                 | Runtime                                           | Contents                                                                                                   |
| ----------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `@aphrody/sql/env`      | any (no `bun`, `node:` or DOM import)             | env/URL resolution, `redactUrl`, pooler and loopback detection, dotenv `lastAssignment`, `resolvePoolSize` |
| `@aphrody/sql/postgres` | Bun                                               | `sqlOptions`, `createSql`, `withTransaction`, `transactionMode` over `Bun.SQL`                             |
| `@aphrody/sql/redis`    | importable anywhere; client creation requires Bun | `createRedisClient`, `redisOptions`, `resolveRedisUrl` over Bun's `RedisClient`                            |
| `@aphrody/sql/sqlite`   | Bun                                               | `openSqlite`, `closeSqlite`, `loadSqliteVec`, `sqliteVecVersion`, `vacuumInto` over `bun:sqlite`           |
| `@aphrody/sql`          | Bun                                               | re-exports all of the above                                                                                |

Import a subpath rather than the root, so that browser or Next bundles never
pull in `bun:sqlite`.

## Environment naming (D9)

- `<DOMAIN>_DATABASE_URL` is the direct URL. Use it for migrations, `COPY`,
  `LISTEN` and advisory locks.
- `<DOMAIN>_DATABASE_URL_POOLED` is the runtime URL behind a pooler.
- Existing contract names are kept, never renamed. Pass them as `fallbacks`.

```ts
import { requireDatabaseUrl, redactUrl } from "@aphrody/sql/env";

// Tries APHRODY_TRAINING_DATABASE_URL_POOLED, APHRODY_TRAINING_DATABASE_URL, then DATABASE_URL.
const { url, name } = requireDatabaseUrl({
  prefix: "APHRODY_TRAINING",
  pooled: true,
  fallbacks: ["DATABASE_URL"],
});
console.log(`database from ${name}: ${redactUrl(url)}`);
```

Resolution trims values. It skips empty strings, the literals
`"undefined"`/`"null"` and dotenvx payloads that were never decrypted
(`eyJ2Ijo…`). If no URL resolves, the error names the variables tried and never
their values.

## PostgreSQL (`Bun.SQL`)

```ts
import { createSql, withTransaction } from "@aphrody/sql/postgres";

const sql = createSql(url, { applicationName: "aphrody-train" });
await withTransaction(sql, async tx => tx`SELECT 1`, {
  readOnly: true,
  statementTimeoutMs: 5000,
});
```

- **Pool defaults:** `max` 4, `idleTimeout` 30 s, `maxLifetime` 1800 s,
  `connectionTimeout` 10 s.
- **`tls: "auto"` (default):**
  - A non-loopback host gets `"require"`.
  - Loopback hosts and Unix sockets (`?host=/run/postgresql`) stay plain.
  - A URL that already sets `sslmode`, `ssl` or `tls` keeps its own mode.
  - `false` opts out; any Bun TLS value can be passed explicitly.
- **`prepare: "auto"` (default):** sets `prepare: false` behind a transaction
  pooler, which is any of:
  - PgBouncer on port 6432;
  - Supavisor on port 6543;
  - a Neon `-pooler.` host;
  - a URL with `?pgbouncer=true`.
- **`"inherit"`** leaves either setting to the URL and to Bun's defaults.
- `Bun.SQL` has no `COPY`. Use postgres.js or a Rust path for bulk ingest.

## Redis

```ts
import { createRedisClient } from "@aphrody/sql/redis";
const redis = createRedisClient(); // REDIS_URL, VALKEY_URL, then redis://127.0.0.1:6379
```

- The defaults are spelled out and equal Bun's own: `connectionTimeout`
  10 000 ms, `autoReconnect`, `maxRetries` 20, offline queue and
  auto-pipelining. Caller options override them.
- Once `maxRetries` is exhausted, a Bun client stays closed. Long-lived services
  should rebuild it.
- Redis is a cache or session store only (D1).

## SQLite (`bun:sqlite`)

`openSqlite(path, { readonly, vec, busyTimeoutMs, create, strict, safeIntegers })`
applies the same pragmas as the Rust crate:

| Pragma         | Value     | Note                                          |
| -------------- | --------- | --------------------------------------------- |
| `busy_timeout` | 5000      | set first                                     |
| `journal_mode` | `WAL`     | skipped for read-only and in-memory databases |
| `foreign_keys` | `ON`      |                                               |
| `temp_store`   | `MEMORY`  |                                               |
| `optimize`     | `0x10002` | at open; skipped for read-only connections    |

- `closeSqlite(db)` runs `PRAGMA optimize` before it closes the connection.
- `vec: true` loads sqlite-vec through the npm `sqlite-vec` package
  (`load(db)`, version `^0.1.9`), which provides `vec0` and `vec_version()`.
  On macOS, call `Database.setCustomSQLite()` before opening, because the system
  SQLite cannot load extensions.
- `vacuumInto(db, path)` makes a consistent online copy with `VACUUM INTO`.
  This is the nightly SQLite backup path (D12). SQLite refuses to write over an
  existing, non-empty target.

## Checks

```sh
bun test                              # in packages/infra/sql (no network)
bun check -p tsconfig.json --noEmit
bun lint -c ../../.oxlintrc.json src test
```
