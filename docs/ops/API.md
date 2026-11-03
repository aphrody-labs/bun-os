# API standard

Every Bun OS HTTP API follows one contract, so any of our sites (aphrody.com, aphrody.app hosts, the WebOS client,
Store, downloads) and any agent can consume it the same way. The live inventory of servers, ports, units and hosts is
generated in [SERVICES.md](SERVICES.md).

## Topology

```text
site / app / agent ──HTTPS──> api.aphrody.com (nginx on bunos) ──/v1/<service>/...──> service on 127.0.0.1 or the mesh
                                       │
                                       └── /openapi.json   merged OpenAPI 3.1 document of every service
```

- **Build on `vps`, serve on `bunos`.** `vps` is the build farm ([BUILD.md](BUILD.md)); `bunos` runs production and
  receives only qualified releases ([DEPLOY.md](DEPLOY.md)). Until the move is finished, `vps` still fronts
  aphrody.com.
- **One public entry** per environment: `api.aphrody.com`. Services never bind a public address; they listen on
  loopback or the mesh and are routed by path prefix `/v1/<service>/`.
- **Real time**: Server-Sent Events for one-way streams, WebSocket for interactive sessions (WebOS stream, terminal),
  both under the same prefix and the same authentication. No polling endpoints for live state.

## Contract (every service)

| Concern       | Rule                                                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Description   | OpenAPI 3.1, generated from code (`utoipa` for axum services, a typed route table for Bun services), served at `/v1/<service>/openapi.json`; `--check` in CI fails on drift        |
| Versioning    | path major version (`/v1/`); additive changes only within a major; a new major runs beside the old one for one stable release                                                      |
| Health        | `GET /v1/<service>/health` → `{ "status": "ok", "version", "commit", "channel" }` (see [RELEASES.md](RELEASES.md))                                                                 |
| Errors        | `application/problem+json` (RFC 9457): `type`, `title`, `status`, `detail`, `instance`                                                                                             |
| Auth          | bearer tokens from the account service; browser sites use the same token through a `Secure; HttpOnly` cookie; agents use scoped tokens; Cloudflare Access in front of admin routes |
| CORS          | allow-list of our own origins, generated from the site catalog; no `*` on authenticated routes                                                                                     |
| Limits        | per-token rate limits at nginx; `429` with `Retry-After`                                                                                                                           |
| Pagination    | cursor based: `?cursor=&limit=`, response `next_cursor`                                                                                                                            |
| Time and ids  | RFC 3339 UTC timestamps; opaque string ids                                                                                                                                         |
| Observability | `traceparent` (W3C Trace Context) accepted and propagated; structured JSON logs to journald                                                                                        |

## MCP and A2A

MCP and A2A are protocols over the same services, not separate stacks: one MCP endpoint
(`/v1/mcp`, streamable HTTP) aggregates the tools of every service, and A2A agent cards are served at
`/.well-known/agent.json` per agent. Both reuse the API's authentication and are listed in SERVICES.md.

## Adoption

Services move to this contract in the order of the matrix: public ones first (WebOS server, Store, downloads,
search, Google bridge), then internal ones. A service counts as done when its OpenAPI document is published, its
health endpoint answers the standard shape, and it is routed only through `api.aphrody.com`.
