<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-mcp

## What is `aphrody-mcp`?

`aphrody-mcp` is the Aphrody MCP (Model Context Protocol) server. It exposes
forensics, reconnaissance, and host-introspection tools to any MCP-aware agent
host (Claude Desktop, Cursor, Continue, Zed) through stdio or HTTP. The server
is built on `rmcp` (the official MCP Rust SDK), `axum` for HTTP, and the local
`backend` crate for real DNS / Chromium / process work. Every tool issues real
OS calls — no stubs.

## Install

Add to `Cargo.toml`:

```toml
[dependencies]
aphrody-mcp = { path = "crates/aphrody-mcp", version = "1.0.0-canary" }
```

The crate also ships a binary; install from the workspace with:

```bash
cargo install --path crates/aphrody-mcp --locked
```

## Quick start

Run the server over the default stdio transport (used by Claude Desktop and
most MCP clients):

```bash
cargo run -p aphrody-mcp
```

Then point your MCP client at the binary. Example `mcp.json` snippet:

```json
{
  "mcpServers": {
    "aphrody": { "command": "aphrody-mcp" }
  }
}
```

## Exposed tools

The registry is assembled from feature-gated Rust modules and internal
providers. `tools/list` from the running binary is the exact catalog; tool names
and schemas can change with enabled features. Web's native crawl tool is
`aphrody_web_crawl` and is served by this MCP or proxied by the unified kernel.

### Crawl limits

`aphrody_web_crawl` validates HTTP(S) seed URLs, caps input URLs and allowed
domains at 100, bounds depth, request count and concurrency, and obeys robots
by default. Call execution has a 120-second budget. The response returns at
most 100 pages (default 50) and 50 errors, with counts and truncation flags.
Use `resultLimit` to request fewer pages. These limits bound the MCP response;
`maxRequests` controls crawl work. Persistent SQLite frontier paths should be
provided only when the caller intends to retain crawl state.

## Transports

`stdio` is the default (line-delimited JSON-RPC over `stdin`/`stdout`). To run
the same tool catalog using the official RMCP Streamable HTTP transport:

```bash
aphrody-mcp http --bind 127.0.0.1:8789
```

The endpoint is `http://127.0.0.1:8789/mcp`. The bind address must be loopback;
the HTTP transport is for local clients or an authenticated, tool-filtering
gateway. Its default session mode may return SSE and `Mcp-Session-Id`; a gateway
must forward the MCP session and protocol headers and stream response bodies.

### Authentication of `/mcp`

`/mcp` exposes every tool, so it answers only to `Authorization: Bearer <token>`. The token is read once at start from
`APHRODY_MCP_HTTP_TOKEN`, else from the AI HTTP token (`APHRODY_AI_HTTP_TOKEN`), so a
gateway that already injects that bearer keeps working; the dedicated name scopes `/mcp` apart from the REST bridge. It
must be at least 32 bytes (`openssl rand -hex 32`) and belongs in a host `EnvironmentFile`, never in a repository or a
command line. Without a usable token `/mcp` answers 503 (fail-closed); a missing or wrong header is 401; the comparison is
constant time. `/healthz` and the REST routes are outside this layer. A client reads the token from its environment, for
example in a `.mcp.json`:

```json
{ "mcpServers": { "aphrody-http": { "type": "http", "url": "http://127.0.0.1:8793/mcp",
  "headers": { "Authorization": "Bearer ${APHRODY_MCP_HTTP_TOKEN}" } } } }
```

`bun scripts/tools/infra/mcp-tools-count.ts <url> --token-env APHRODY_MCP_HTTP_TOKEN` counts the tools of a running server.

### AI REST gateway

The same loopback listener serves the REST routes below. `/healthz`, the model
lists, `/api/v1/aphrody/status` and the RAG routes answer without a token.
`POST /v1/chat/completions` requires `Authorization: Bearer <token>` matching
`APHRODY_AI_HTTP_TOKEN` whenever the chat upstream has its own credential
(`APHRODY_AI_CHAT_API_KEY`); an unset gateway token returns HTTP 503 in that
case, a missing or incorrect header returns 401. Keep this listener private and
apply authentication on any gateway.

| Route | Response |
| --- | --- |
| `GET /healthz` | `{status:"ok",service}` |
| `GET /api/v1/models` | Registered local models |
| `GET /v1/models` | OpenAI-format model list |
| `POST /v1/chat/completions` | Relay (JSON or SSE) to the chat upstream at `APHRODY_AI_CHAT_BASE_URL`; 503 when unconfigured |
| `GET /api/v1/aphrody/status` | Subsystem status and chat upstream reachability |
| `GET /api/v1/rag/query?q=...&limit=5` | Keyword hits over `aphrody_rag_documents` (`limit` capped at 20) |
| `GET /api/v1/rag/stats` | Document and chunk counts, `unavailable` without the database |

RAG routes use `APHRODY_MCP_DATABASE_URL`.

## Cross-platform

Linux (cible #1) and Windows 11 Canary are fully supported. Windows-only tools
(`auth_extract`, `chrome_autopsy`) return an explicit `unsupported` message on
Linux instead of failing the request, so an agent can probe capability cleanly.

## License

Apache-2.0. Copyright aphrody-code contributors.

## Related

- `aphrody` — the CLI binary that consumes the same `backend` primitives.
- `a2a` / `a2a-client` / `a2a-server` — peer-to-peer agent protocol used in
  parallel with MCP for cross-agent coordination.
- `rmcp` — upstream Rust SDK powering the tool router and stdio transport.
