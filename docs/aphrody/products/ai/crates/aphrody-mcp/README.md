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

Source of truth: `crates/ai/mcp/src/main.rs` (not in repo) (`#[tool_router]` impl on
`GoogleMcpServer`). The current registry exposes eight tools:

| Tool | Description |
|---|---|
| `coding_style_guide` | Fetches the Google style guide for `cpp`, `python`, `typescript`, `java`, `shell`, `html`, `android_build`, or `chromium_build_win`. |
| `universal_web_fetch` | Generic HTTP-to-Markdown fetcher via the Jina reader proxy for external docs. |
| `dns_recon` | Runs the OSINT DNS pipeline from `backend::dns::DnsRecon`, returning deduplicated subdomains. |
| `advanced_recon` | Native OS DNS resolution plus 200 ms TCP probes across user-supplied ports (defaults: 80/443/8080). |
| `native_hooks` | OS state direct: `GetSystemInfo` + `GlobalMemoryStatusEx` on Windows, `/proc` via `sysinfo` on Linux/macOS. |
| `start_dashboard` | Spawns an `axum` server in a background tokio task exposing `GET /health` and `GET /info`. |
| `auth_extract` | Windows-only: DPAPI Chrome Canary cookie inspection via `backend::chromium::ChromiumParser`. |
| `chrome_autopsy` | Windows-only: `OpenProcess` + `ReadProcessMemory` against a target PID, 4 KiB cap, hex+ASCII dump. |

### NIE (`nie.*`, optional feature `nie`, disabled by default)

The tools of the retired `nie` plugin's `nie-game` server, served by
`aphrody-mcp-nie-bridge` as a process boundary (aphrody-ai never links `nie`
crates):
one long-lived `nie-mcp` child over stdio (`NIE_MCP_BIN`, default `nie-mcp` on
`PATH`, empty disables; `NIE_MCP_TIMEOUT_SECS`, default 120). Typed tools:
`health`, `vfs_{list,search,stat,cat}`, `asset_get`,
`re_{query,function,coverage}`, `repo_read`, `wiki_{search,character_card}`,
`zukan_rank`, `explorer_{status,navigate,open,tab,toast}` and `game_launch`;
`nie.tools` lists the live catalog (every `cli_*` command) and `nie.call`
forwards any of them unchanged. The child inherits `NIE_REPO`,
`NIE_APHRODY_API_URL` and `NIE_MODEL_SERVE_URL`.

NIE is not yet a member of this monorepo, so the default `aphrody-mcp` and
`toolbox` builds do not advertise or link this feature. Keep it disabled until
the NIE source crates and their consumer qualification are integrated here.

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
gateway that already injects that bearer keeps working. It
must be at least 32 bytes (`openssl rand -hex 32`) and belongs in a host `EnvironmentFile`, never in a repository or a
command line. Without a usable token `/mcp` answers 503 (fail-closed); a missing or wrong header is 401; the comparison is
constant time. `/healthz` is outside this layer. A client reads the token from its environment, for
example in a `.mcp.json`:

```json
{ "mcpServers": { "aphrody-http": { "type": "http", "url": "http://127.0.0.1:8793/mcp",
  "headers": { "Authorization": "Bearer ${APHRODY_MCP_HTTP_TOKEN}" } } } }
```

`bun scripts/tools/infra/mcp-tools-count.ts <url> --token-env APHRODY_MCP_HTTP_TOKEN` counts the tools of a running server.

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
