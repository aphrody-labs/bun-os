# API standard

Every Bun OS HTTP API follows one contract, so any of our sites (aphrody.com, aphrody.app hosts, the WebOS client,
Store, downloads, CDN) and any agent can consume it the same way. The live inventory of servers, ports, units and
hosts, and the API catalogue, are generated in [SERVICES.md](SERVICES.md).

## Topology

```text
site / app / agent ──HTTPS──> api.aphrody.com (nginx on vps) ──/v1/<service>/<path>──> 127.0.0.1:<port><upstream><path>
                                    │
                                    ├── /v1/                    catalogue index (services, bases, documents)
                                    ├── /v1/openapi.json        merged OpenAPI 3.1 document of every service
                                    ├── /v1/openapi/<svc>.json  committed document of one service
                                    └── /v1/health              gateway health
```

- **One host, one public entry**: `vps` builds and serves ([BUILD.md](BUILD.md), [DEPLOY.md](DEPLOY.md));
  `api.aphrody.com` is the API entry. Services never bind a public address; they listen on loopback (or the mesh)
  and are routed by path prefix `/v1/<service>/`, declared in [`infra/fleet/api.toml`](../../infra/fleet/api.toml).
- **Upstream mount**: `upstream` in `api.toml` is where a service mounts its public base (`/api/store/` for the
  Store, `/` by default). The service serves the same routes on its own legacy hosts (aphrody.com `/api/...`).
- **Real time**: Server-Sent Events for one-way streams, WebSocket for interactive sessions (WebOS stream, terminal),
  both under the same prefix and the same authentication. No polling endpoints for live state.

## Contract (every HTTP service)

| Concern       | Rule                                                                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Description   | OpenAPI **3.1**, generated from the service's typed route table, served at `GET <base>/openapi.json`; `servers[0].url` is `https://api.aphrody.com/v1/<service>`; every operation has `operationId`, `summary`, `responses` |
| Versioning    | path major version (`/v1/`); additive changes only within a major; a new major runs beside the old one for one stable release                                                                                               |
| Health        | `GET <base>/health`, public, no auth: `{ "status": "ok" \| "degraded" \| "down", "service", "version", "commit", "channel", "uptimeSeconds", "checks"? }`; 200 unless a required check fails (503)                          |
| Readiness     | `GET <base>/ready`, same shape, only for services with dependencies that must answer before traffic (503 until ready)                                                                                                       |
| Errors        | `application/problem+json` (RFC 9457): `type`, `title`, `status`, `detail`, `instance`; extension members are allowed (e.g. a legacy `error` field kept for existing clients)                                               |
| Protocols     | protocol-compatible surfaces keep their protocol's error body and declare it as `x-error-format` in the document: OpenAI (`chat`), JSON-RPC and A2A (`a2a`, inventory RPC), winget REST (`store`)                           |
| Auth          | bearer tokens (`components.securitySchemes.bearer`), declared per operation; `/health`, `/openapi.json` and discovery documents stay public                                                                                 |
| CORS          | only the gateway emits `Access-Control-*`: upstream CORS headers are dropped, preflights are answered at the gateway, origins come from `origins` in `api.toml`; no `*` on authenticated routes                             |
| Limits        | per-token rate limits at nginx; `429` with `Retry-After`                                                                                                                                                                    |
| Pagination    | cursor based: `?cursor=&limit=`, response `next_cursor`                                                                                                                                                                     |
| Time and ids  | RFC 3339 UTC timestamps; opaque string ids                                                                                                                                                                                  |
| Observability | `traceparent` (W3C Trace Context) accepted and propagated; `X-Forwarded-Prefix: /v1/<service>` set by the gateway; structured JSON logs to journald                                                                         |

## Helpers (new services get the contract for free)

- **Bun**: [`packages/bun-os-platform/src/api`](../../packages/bun-os-platform/src/api/index.ts)
  (`@bun-os/platform/api`). `defineApi(info, routes)` turns a route table (`"GET /items/{id}": { summary, auth,
params, body, responses, stream, errorFormat }`) into the OpenAPI document; `apiContract(api, { base, checks })`
  answers `/openapi.json`, `/health` and `/ready`; `problem()` builds problem+json responses; `matchRoute()`
  dispatches on the same table; `checkDocument()` is the validator used by the catalogue.
- **Rust (axum)**: [`aphrody_http_error::api`](../../crates/aphrody-http-error/src/api.rs). A `const API: Service`
  of `Op::get(...)`, `Op::post(...)` (`.auth()`, `.sse()`, `.websocket()`, `.query(..)`, `.errors(..)`) is the
  route table; `API.routes_at("/api")` serves the document, `health(...)` the standard body, `problem(...)` /
  `problem_with(...)` the errors. A crate test calls `API.check_snapshot(workspace)`, which keeps
  `docs/generated/openapi/<service>.json` in step (`APHRODY_OPENAPI_WRITE=1 cargo test -p <crate> openapi`).

The route table lives next to the router it describes; a route added without its table entry is a review finding.

## Catalogue and checks

`bun scripts/service-map.ts` classifies every member (HTTP role: gateway, deployed, server, library, dev, client),
generates the Bun documents, reads the Rust snapshots, validates all of them with `checkDocument()` and writes
`docs/generated/openapi/` (`<service>.json`, `index.json`, the merged `openapi.json`) and [SERVICES.md](SERVICES.md).
`--check` fails when an output is stale or a document breaks the standard; `--check-api` (the VPS gate step
`api-standard`, run when an API path changes) checks the catalogue only.

## Deploy and verify

```sh
bun infra/fleet/api.ts apply                 # nginx site + catalogue (index, merged and per-service documents)
bun infra/fleet/api.ts deploy store          # build from origin/main, install, restart, gate, roll back on failure
bun infra/fleet/api.ts verify                # every /v1/<service>/{health,openapi.json} against the standard
```

`deploy` follows the recipe of `[services.<name>.deploy]`: Bun services are bundled (`bun build --target bun`)
with `APHRODY_COMMIT` defined, after checking that every bundled source equals `origin/main`; Rust services build
through the lane wrapper; `command` recipes (WebOS `release.sh` and its activator, the Bun OS product server build)
build by themselves. Every recipe ends with the same gate: `<upstream>health` must report the new commit with
status `ok` or `degraded` and `<upstream>openapi.json` must be a 3.1 document, otherwise the previous binary (and
unit) is restored and the service restarted. `verify` also reports a live document that differs from the committed
one (a deploy is pending).

## MCP and A2A

MCP and A2A are protocols over the same services, not separate stacks: one MCP endpoint (streamable HTTP) aggregates
the tools of every service, and A2A agent cards are served at `/.well-known/agent-card.json` per agent
(`/v1/a2a/.well-known/agent-card.json` for the hub). Both reuse the API's authentication and are listed in
SERVICES.md.

## Adoption

A service counts as done when its OpenAPI document is published, its health endpoint answers the standard shape, its
errors are problem+json (or a declared protocol format) and it is routed only through `api.aphrody.com`. Every
gateway service in `api.toml` is done; internal services (`deployed` in SERVICES.md) adopt the helpers when they
join the gateway.
