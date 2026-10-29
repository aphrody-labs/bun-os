<!-- SPDX-License-Identifier: Apache-2.0 -->
# VPS REST and GraphQL APIs — historical inventory

> **Historical snapshot:** this document describes the retired Aphrody public
> API plane and is not a current VPS deployment inventory. The active
> production allocation marks `aphrody-web` and `aphrody-ai` retired. Use the
> dated VPS observation,
> [`service-catalog.json`](../../../../../tools/aphrody/config/service-catalog.json), and
> `yolo/tools/config/host/nginx/routes.json` for current
> deployment and route state. The API details below are retained as migration
> history and must not be used for operational probes or deployment decisions.

API servers exposed, configured or consumed on the production VPS: what each one serves, which
repository owns its code, how it is authenticated and how Nginx exposes it. Listener ports and
public hosts are not repeated here: read them from
[`tools/config/service-catalog.json`](../../../../../infra/config/service-catalog.json) (`health`, `port`) and
`yolo/tools/config/host/nginx/routes.json` (`routes`, `internal`). Restored from
the retired `aphrody` monolith (docs/vps/APIS.md) and updated to the category repositories.

## 1. API servers

| Catalog service | Server | Code owner | Exposure |
|---|---|---|---|
| `aphrody-web-api` | BXC REST + GraphQL (Elysia, GraphQL Yoga), compiled to one Bun binary | `aphrody-web` apps/bxc/src/server/ (bxc retiré du monorepo) | Loopback; Nginx forwards only the `internal` paths of `aphrody.com` |
| `aphrody-site` | Public `aphrody.com` origin (Rust) | `aphrody-web` crates/aphrody-site (hors du monorepo) | Public host route |
| `aphrody-a2a` | A2A JSON-RPC listener (`aphrody a2a serve`) | `aphrody-ai` `crates/infra/aphrody` over the `aphrody-contracts` A2A stack | Loopback; RPC path and agent card routed on `aphrody.com` |
| `aphrody-ai-http` | AI REST gateway (`aphrody-mcp http`) | `aphrody-ai` `crates/ai/mcp` | Loopback; model and RAG read paths routed on `aphrody.com` |

## 2. BXC browser-automation API (`aphrody-web-api`)

Built by `scripts/build/build-aphrody-stack-release.sh` from `aphrody-web/apps/bxc/src/server/index.ts`
(`bun build --compile`). The route table is the `ENDPOINTS` list in
`aphrody-web/apps/bxc/src/server/app.ts`; `GET /` returns it as JSON.

### REST (`/api/v1`)

- `GET /health` (plain `OK`) and `GET /healthz` (`{ ok: true }`): liveness, never authenticated.
- Scraping and crawling: `POST /scrape`, `POST /crawl`, `GET /crawl/stats`, `GET /crawl/failed`,
  `POST /crawl/replay`.
- Page views: `GET /page`, `/page/markdown`, `/page/openapi`, `/page/types`.
- Search and index: `GET /search`, `/search/keyword`, `/search/semantic`, `/index/search`,
  `/autocomplete`; extraction `POST /extract`; reconnaissance `GET /recon`, `GET /detect`.
- FIFA Ultimate Team scrapers: `GET /fut/player`, `GET /fut/price`, `ALL /fut/ut/*`.
- OpenAPI UI under `/swagger`.

### GraphQL (`/graphql`)

Typed interface for agent integrations, built with Type-GraphQL:

- `ScrapeResolver`: crawl, snapshot rendering and page-metadata extraction.
- `FutResolver`: FIFA Ultimate Team market indexing and search.

## 3. AI REST gateway (`aphrody-ai-http`)

Routes are defined in `aphrody-ai/crates/aphrody-mcp/src/http_rest.rs`: `GET /healthz`, the
OpenAI-compatible `/v1/models` and `/v1/chat/completions`, `/api/v1/models`,
`/api/v1/rag/{query,stats}`, `/api/v1/aphrody/status`. Only the
paths listed for this service in `yolo/tools/config/host/nginx/routes.json` are public; the compute surface is
consumed privately through the contract in [`tools/config/local-ai.json`](../../../../../tools/aphrody/config/local-ai.json)
(gateway `ai-http`).

## 4. Authentication and security

- Application listeners bind loopback. Nginx is the only public entry point and never exposes a
  loopback service without a route entry.
- The BXC API requires `Authorization: Bearer <BXC_API_TOKEN>` on every route except `/health`
  when a token is configured; the site authenticates public Web clients separately (token
  relationships are described in [`docs/reference/infra/TOPOLOGY.md`](../../../reference/infra/TOPOLOGY.md)).
- Public routes authenticate at their application boundary and accept no secret in the URL.
- Inter-service tokens live in root-owned environment files under `/etc/<plane>/` with mode
  `0600`, provisioned by `scripts/tools/infra/provision-aphrody-stack-env.sh`; they are rotated
  explicitly and never committed.
