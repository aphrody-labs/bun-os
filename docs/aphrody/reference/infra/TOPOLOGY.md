# Aphrody topology — historical architecture snapshot

> **Historical snapshot:** the deployment state below predates the 2026-10-02
> VPS observation. The active allocation declares `aphrody-web` and
> `aphrody-ai` retired; use the root `config/` catalogues and the dated
> VPS observation and
> topology observation
> for current deployment and host state. This page is retained to preserve
> migration and architecture history; it is not a live service inventory.

## Authorities

| Surface | Repository | Responsibility |
|---|---|---|
| Public web origin, Web API, BXC, browser/render FFI | `aphrody-web` | `aphrody-site` on `127.0.0.1:8083`; the integrated Web API on `127.0.0.1:3007` with `libaphrody_web_ffi.so` and the V8 renderer `libbxc_render.so`; BXC has one source tree under `apps/bxc` (not in repo). |
| AI agents, A2A, RAG, MCP, embeddings | `aphrody-ai` | `aphrody a2a serve` on `127.0.0.1:8788`; `aphrody-mcp http` on `127.0.0.1:8789` (MCP on `/mcp` with the `dragonball.*` tools, REST under `/api/v1`); `aphrody-embed serve` (E5) on `127.0.0.1:8794`. |
| Agent console, M3 design system, `bun_rs` | `aphrody-ui` | Tracked `crates/ui/app/ui-dist` embedded into the `aphrody` binary at build time; `@aphrody/bun` over the `aphrody-bun` crate. |
| OS control plane | `aphrody-os` | `aphrody-kernel`; not deployed on the VPS (a build-time path dependency of the category workspaces). |
| Deployment and host inventory | `aphrody-infra` | Catalogs, unit and vhost templates, release build, deploy adapters, probes and migration evidence. |

The superproject `aphrody-src` pins all 13 repositories; a release is built from
one superproject commit (`docs/operations/infra/IMMUTABLE-RELEASES.md`).

## VPS boundary

Release planes run on the VPS: `/home/ubuntu/apps/aphrody/current` (five Aphrody
services); the all-in-one bundle
state lives in `/home/ubuntu/apps/infra` (`bundles/`, `state/`, `BUNDLE.json`,
`BUNDLE.previous.json`). As of 2026-09-26 the
Aphrody plane is retired (removed 2026-09-25) until the first bundle
activation; `tools/config/host/inventory/vps-source.json` records the observed state.

Nginx serves `/ai.json` byte-for-byte from `/home/ubuntu/apps/aphrody/current/ai.json` and
routes A2A and AI REST paths directly to their loopback services; the site
does not host an AI protocol or read AI data. Persistent Aphrody paths: Web
SQLite, crawler storage and cookies in `/home/ubuntu/apps/aphrody/shared/bxc`, A2A VFS in
`shared/a2a`, mailbox in `shared/coord`, AI state in `shared/ai`, E5 weights in
`shared/models/e5-native`. BXC SQLite is the source for Web crawl, page and
index data; the site and BXC share `APHRODY_WEB_DATABASE_URL` for rankings and
SEO in PostgreSQL `aphrody_web`. AI HTTP RAG uses
`APHRODY_MCP_DATABASE_URL` for PostgreSQL `aphrody`; with that DSN,
`aphrody rag web-ingest`, `search` and `stats` use AI PostgreSQL, while an
explicit `--db` selects a local SQLite index. Secrets live in root-owned
`/etc/aphrody/*.env` files with mode `0600`.

The site accepts public Web clients with `APHRODY_SITE_WEB_API_TOKEN` (equal
alias `APHRODY_BXC_API_TOKEN`); its upstream token
`APHRODY_SITE_WEB_BACKEND_TOKEN` equals the Web API's `BXC_API_TOKEN`, which
the AI client receives as `APHRODY_WEB_API_TOKEN`. Release staging and activation
check these relationships.

## Migration gates

1. Freeze writes and checksum private backups outside Git.
2. Build and validate a new release from a clean, pinned superproject commit.
3. Install into a versioned release directory with an atomic `current` link.
4. Probe health, routes, logs and restart behavior.
5. Keep rollback to the previous release until post-deploy observation completes.
