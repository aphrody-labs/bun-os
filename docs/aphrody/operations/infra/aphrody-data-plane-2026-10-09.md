<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody shared data plane, 2026-10-09

The new owner request targets PostgreSQL `aphrody-db`, Redis acceleration and a shared Better Auth contract for product/AI authentication. [The desired contract](../../../../tools/aphrody/config/aphrody-data-plane.json) is an inert, additive declaration. No database, role, schema, service, credential or migration was created by this batch.

## Current owners and evidence

| Owner | Current source contract | Qualification |
| --- | --- | --- |
| `crates/infra/sql` (`aphrody-sql`) | PostgreSQL pool/TLS, environment resolution, checksummed migrations and PostgreSQL advisory lock; bundled SQLite policy | Source inspected; no installed SQL CLI exposed through `aphrody sql --help` (A2A transport failure) |
| `packages/infra/sql` (`@aphrody/sql`) | Bun.SQL, RedisClient and bun:sqlite factories | Existing reusable owner; no new client library needed |
| `crates/ai/store` (`aphrody-store`) | Per-home SQLite schema migrations 0001–0007; RAG, graph, memory, session metadata and training tables | Installed native `aphrody home status` succeeds, schema 7 |
| RAG/code graph/training | Typed consumers of local store plus existing server-side capabilities | PostgreSQL home adapter and cross-backend parity not established |
| Better Auth | Desired new product auth contract | No installed/source Better Auth integration found in current manifests/source; provider credentials and callbacks unqualified |
| Workspace/Infra | Service, container, host, backup and deploy catalogs | Existing DBFR PostgreSQL/Redis runtime is cataloged; connectivity does not allocate a new Aphrody database |

Native global home metadata at inspection: 89,467 files, 15,765 docs, 152,497 chunks, zero vectors, 514,533 graph nodes, 1,217,058 edges, 14,332 memories, 1,186 sessions, zero messages and 18 backup ledger entries. Only aggregate status was read. Profile homes remain separate; no SQLite contents or transcript text were exported.

Read-only `aphrody infra ssh exec --host dbfr` checks report healthy `aphrody-postgres-1` and `aphrody-redis-1`; `pg_isready` accepts connections and Redis PING returns PONG. These prove service reachability only, not Aphrody database grants, schema availability, backup restore readiness or administrator authority. No PostgreSQL query or data export ran. Existing persistent PostgreSQL/Redis directories remain untouched. The VPS retains its current build role.

## Authority and revised direction

The [SQL convergence ADR](../../decisions/infra/sql-convergence.md) retains valid mechanics: shared/server PostgreSQL, local/offline SQLite, Redis as cache, existing client owners, checked migrations and backups. Its dated D3 topology retired duplicate `aphrody` databases; the new request is a new desired shared database identity, not permission to restore historical duplicates or delete current stores. Host allocation must be explicit. Yoyo administers Aphrody Labs; Omar administers DBFR. SSH/sudo access alone does not grant a database allocation on DBFR.

The [agent-home plan](../../plans/agent-home-pipeline/PLAN.md) uses one canonical SQLite file per isolated profile. Preserve its offline behavior and checksum-backed additive migrations. PostgreSQL migration requires a real adapter with measured parity; a configuration entry or renamed database does not provide it. The Bun fork remains a consumer/runtime owner, not another catalog or source of provider credentials.

## Bounded execution sequence

1. Allocate the host, database identity, least-privilege roles and profile isolation. Reuse existing PostgreSQL/Redis infrastructure only after its owning administrator allocates capacity and grants. Plan in Infra before apply.
2. Implement the Better Auth adapter under the product owner, using `@aphrody/sql`; install only the required version through the declared Bun toolchain. Register exact Google/GitHub/Discord callbacks; validate email transport and Aphrody OAuth behavior independently. Tokens/session secrets live in protected auth stores, never in RAG/training/catalog/graph data.
3. Assign one PostgreSQL schema migration owner and introduce a checksummed additive migration. Do not invent Better Auth tables before its supported schema and adapter are verified.
4. Implement a durable SQL outbox/version for catalog/index changes, then profile-scoped Redis keys with TTL and content hashes. Commit SQL first, publish invalidation afterwards; rebuild missed events from durable state. Redis loss is cache loss, not data loss.
5. Back up and checksum-verify eligible SQLite stores. Dry-run approved metadata export only, compare counts/hashes and enforce exclusions. Raw provider sessions, cookies, protected conversation data, credentials, models and unapproved datasets are excluded. Do not delete or overwrite SQLite files.
6. Qualify dual reads, isolation failures, cache outage, offline execution, migration restart and rollback before any cutover. Run real auth login/logout/expiry and OAuth callback tests on web and desktop separately. Provider login is not established by schema creation.
7. Activate only the reviewed allocation through Infra and rerun installed CLI/MCP/home/graph/training consumers. Public site SEO metadata remains an independent deploy batch.

## Additive PostgreSQL foundation

`aphrody_sql::product` exports the versioned metadata migration set and its dedicated `aphrody_product` ledger options for the existing checksummed runner. The initial migration creates profile scopes, protected-auth identity references, catalog metadata (tools/CLI/MCP/repositories/documents/dataset/model references), RAG references, code graph nodes/edges, training run references and a durable outbox. No document text, examples, credentials, cookies, raw sessions, model weights or arbitrary event payloads are stored. Profile-scoped foreign keys reject cross-profile graph links; event version/topic uniqueness supports retry deduplication. PUBLIC receives no schema/table/sequence grants. Per-profile application roles/grants and a real SQLite/PostgreSQL adapter remain required; these foreign keys alone do not establish application authorization.

Validation uses the already installed `postgres:18-alpine` image on the running local Docker Desktop context: a uniquely named disposable container, no network, no published ports and tmpfs database storage. Read-only host bind sharing was unavailable, so only the owned SQL files were streamed on stdin. The migration applies successfully twice (idempotent DDL). `tests/product-schema.sql` verifies successful scoped catalog/graph/outbox inserts, rejects cross-profile links, duplicate events, unknown profiles and escaping relative paths, and confirms PUBLIC lacks schema access. Relative paths reject POSIX absolute paths, UNC, Windows drive paths (both slash forms), URI schemes and parent components. Its transaction rolls back. A separate rehearsal mirrors the runner's two-transaction shape: bootstrap the dedicated ledger, then acquire an advisory transaction lock, execute the migration (including REVOKE), insert the LF-normalized SHA-256 ledger row and commit. The recorded checksum matches. The owned container was stopped afterwards and auto-removed; no shared volumes or host databases were touched. This qualifies PostgreSQL SQL/transaction behavior, not execution through the compiled Rust runner or a deployed product adapter.

The contract JSON parses and contains only identities, environment variable names and policy; it contains no credentials or runtime output. No consumer automatically loads it or applies migrations. Deployment allocation, auth implementation, adapter parity and activation remain explicit outstanding work.

Native Windows MSVC qualification used an isolated checkout with only the owned SQL/site sources, preserving the shared working tree. Scoped check passed; the site library passed 19 tests and SQL passed 25, including the embedded product migration contract. Strict all-target Clippy passed with `-D warnings`. The first SQL run exposed an inherited Unix-socket expectation on Windows: its transport test now asserts socket locality only on Unix and verifies that unsupported socket paths do not disable TLS on Windows. Production pool behavior is unchanged. These gates qualify the metadata foundation and native transport tests; they do not provision `aphrody-db`, migrate existing SQLite stores or activate authentication.
