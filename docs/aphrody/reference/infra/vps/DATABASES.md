<!-- SPDX-License-Identifier: Apache-2.0 -->
# VPS databases and storage

> **Historical application detail.** This imported page predates the 2026-10-01
> database retirement and 2026-10-02 host observation. In the latest observation,
> PostgreSQL 18 and Redis were active on VPS; PostgreSQL 18 and Redis were also
> active on DBFR, the declared data/backup host. The root topology describes
> host-role policy; it does not catalog database names or prove their integrity.
> The old Aphrody databases and paths below must not be assumed to exist. For
> dated evidence, see `TOPOLOGY-OBSERVATION-2026-10-02.md`
> and [`db-dedup-2026-10-01.md`](../../../operations/workspace/HISTORY.md).

The VPS combines PostgreSQL (primary relational store), Redis (in-memory cache) and embedded
SQLite files (bounded local caches and crawl indexes). Policy: PostgreSQL is primary, SQLite is a
bounded local cache (`deduplication.database` in
[`tools/config/application-contracts.json`](../../../../../infra/config/application-contracts.json)). Ports and
private paths are declared in [`tools/config/production-topology.json`](../../../../../infra/config/production-topology.json)
and the catalog; connection strings are operator secrets and never appear in this repository.
Restored from the retired `aphrody` monolith (`docs/reference/infra/vps/DATABASES.md`); the remote database host
it used to print was removed.

## 1. PostgreSQL

Distribution PostgreSQL (`postgresql@<major>-main.service`), reachable through the local Unix
socket and loopback TCP only; the local `ubuntu` role uses `peer` authentication.

| Database | Consumer | DSN variable |
|---|---|---|
| `aphrody_web` | `aphrody-site` and the BXC Web API (Web rankings, SEO) | `APHRODY_WEB_DATABASE_URL` |
| `aphrody` | `aphrody-ai-http` RAG (`aphrody rag web-ingest`, `search`, `stats`) | `APHRODY_MCP_DATABASE_URL` |

DSNs live in the root-owned `/etc/<plane>/*.env` files (mode `0600`). The relationships between
the Web and AI databases are described in [`docs/reference/infra/TOPOLOGY.md`](../TOPOLOGY.md).

## 2. Redis

`redis-server.service` on loopback, without a password for local clients. Redis is a cache: nothing in it is the only copy of
application data, and it is excluded from the backup data classes unless
[`tools/config/scheduler-policy.json`](../../../../../tools/aphrody/config/scheduler-policy.json) says otherwise.

## 3. SQLite

Embedded `bun:sqlite` stores for crawl, inference and scraping logs.

### A. `x-store.sqlite` (X crawling and RAG)

- Path: `$HOME/.aphrody/x-store.sqlite` (resolved by `packages/web/x/src/db/store.ts`).
- WAL journal with `synchronous = NORMAL` for concurrent readers.
- Tables: `tweets` (id, username, text, created_at, like/retweet/reply counts, conversation_id,
  raw JSON), `users`, `edges` (`authored`, `liked`, `bookmarked`, `timeline`, `mention`),
  `follows`, the FTS5 virtual table `tweets_fts`, and `tweet_embeddings` (`tweet_id` and a BLOB
  of 768-dimensional `gemini-embedding-001` vectors).

### B. BXC stores (`bxc.sqlite`, `bxc-memory.sqlite`)

- Path: the shared Web state directory of the `aphrody` plane (`/home/ubuntu/apps/aphrody/shared/bxc`, see
  `docs/reference/infra/TOPOLOGY.md`); crawler queues are under `BXC_STORAGE_DIR` next to it.
- WAL journal, 5 s busy timeout, 16 MB page cache (`aphrody-web/apps/bxc/src/db/BxcDB.ts`).
- Tables: `scrapes` (id, url, profile, status, content, metadata JSON, timestamp, canonical URL,
  content hash and SimHash bands), `chunks`, and `cookie_jars` (browser cookie JSON by id). Indexes
  cover URL, timestamp, canonical URL, content hash and each SimHash band.
- Cookie jars are sensitive runtime state: they are never copied into Git or agent memory
  ([`docs/operations/infra/COOKIE-OPERATIONS.md`](../../../operations/infra/COOKIE-OPERATIONS.md)).
