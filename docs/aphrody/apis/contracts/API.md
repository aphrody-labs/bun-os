<!-- SPDX-License-Identifier: Apache-2.0 -->
# Unified API reference

Single reference for every wire surface the Aphrody ecosystem exposes: A2A v1
JSON-RPC, the Codex app-server v2 protocol (+ `aphrody/*` extensions), the
agent Submission/Event NDJSON protocol, and the MCP tools / HTTP routes
implemented downstream in `aphrody-ai`, `aphrody-ui` and `aphrody-web`. This
repository owns the Rust types for the first three; downstream repositories
own the transport (stdio JSON-RPC, MCP `registerTool`, axum routers) and, in
practice today, most of their own request/response DTOs too (§6).

This file is hand-maintained (no generator yet); update it whenever a method,
tool or route is added, renamed or its parameters change.

## 1. Naming convention (the one rule)

**Every JSON-RPC / MCP / HTTP wire field is camelCase.** Rust types stay
idiomatic snake_case internally and derive the wire shape with
`#[serde(rename_all = "camelCase")]`. TypeScript/Bun clients and MCP tool
`inputSchema`s use camelCase keys to match.

Concretely, for a field such as the RAG search result limit:

```rust
// aphrody-contracts crates/aphrody-app-protocol/src/types/extensions.rs
#[serde(rename_all = "camelCase")]
pub struct RagSearchParams {
    pub query: String,
    #[serde(default = "default_top_k")]
    pub top_k: usize,   // wire: "topK"
}
```

```ts
// consumer (e.g. an aphrody-ui app)
await aphrodyRpc("aphrody/rag/search", { query, topK: ragTopK });
```

`top_k` vs `topK` is not itself a bug when one side is Rust (snake_case
identifier, camelCase wire) and the other is TypeScript (camelCase
identifier, camelCase wire) — that is the convention working as intended.
It **is** a bug when two wire producers/consumers disagree on the wire
name itself (found and fixed instances in §5), or when the same setting has
two different spellings depending on which surface carries it (e.g. the RAG
`top_k` TOML config key, snake_case by config-file convention, vs the
`aphrody/rag/search` RPC field `topK`, camelCase by wire convention — neither
is wrong in isolation, but a unified doc should say so explicitly, which is
what this sentence is doing).

### Documented exceptions to camelCase

| Surface | Convention | Why |
| --- | --- | --- |
| `aphrody-agent-proto` (Submission/Event NDJSON: `Op`, `EventMsg`, `ReviewDecision`) | `rename_all = "snake_case"` | Mirrors the upstream OpenAI Codex CLI wire protocol this crate is compatible with; renaming would break interop with that protocol family. |
| A2A `Role` / `TaskState` enums (`aphrody-a2a/src/types.rs`) | hand-written `SCREAMING_SNAKE_CASE` (`ROLE_USER`, `TASK_STATE_INPUT_REQUIRED`, …) | Matches the AGNTCY/A2A protobuf enum string convention, not a local choice. |
| `.coord` JSONL mailbox `Envelope` (`aphrody-a2a-coord/src/envelope.rs`) | unrenamed struct fields (`channel_hint`, `ts`, `kind`/`topic` with legacy `type`/`subject` aliases) | On-disk, versioned (`v: 1`) file format written and read by every fleet peer today; changing field casing would break existing `.coord/*.jsonl` mailboxes. Deliberate exception. |
| A2A error code width (`i32`, `aphrody-a2a/src/errors.rs`) vs app-protocol error code width (`i64`, `aphrody-app-protocol/src/rpc.rs`) | historical | Neither protocol exchanges error values with the other directly. Pick `i64` for anything new — it is a strict superset. |
| `aphrody-mcp` REST `ChatRequest`/`OcrRequest`/`VisionRequest` (`aphrody-ai crates/aphrody-mcp/src/http_rest.rs`) | no `rename_all`, fields like `image_base64`, `reasoning_effort` stay snake_case | Not a considered exception — a real gap (§6.4) left as-is in this pass because it's a shipped, unversioned REST surface; flagged for the owning team, not silently changed. |

## 2. A2A v1 (JSON-RPC over HTTP/gRPC/SLIMRPC)

Owner: `aphrody-a2a` (types), `aphrody-a2a-server`/`aphrody-a2a-client`
(transport), `aphrody-a2a-grpc`/`aphrody-a2a-pb` (gRPC binding),
`aphrody-a2a-coord` (fleet `.coord` bridge).

Protocol version: `aphrody_a2a::VERSION = "1.0"` (`crates/contracts/a2a/src/lib.rs`),
carried on HTTP via the `A2A-Version` header (`SVC_PARAM_VERSION`).

| Method | Purpose |
| --- | --- |
| `SendMessage` | Send a message, create/continue a task. |
| `SendStreamingMessage` | Same, with SSE streaming of task/status updates. |
| `GetTask` | Read a task by id. |
| `ListTasks` | List tasks. |
| `CancelTask` | Cancel a running task. |
| `SubscribeToTask` | Subscribe to task events without sending a message. |
| `CreateTaskPushNotificationConfig` / `GetTaskPushNotificationConfig` / `ListTaskPushNotificationConfigs` / `DeleteTaskPushNotificationConfig` | Push-notification webhook config CRUD. |
| `GetExtendedAgentCard` | Authenticated agent-card fetch (capabilities, skills). |

All request/response structs use `#[serde(rename_all = "camelCase")]`
(`crates/contracts/a2a/src/types.rs`, `agent_card.rs`, `event.rs`).

Legacy/fleet alias: `message/send` (`aphrody_a2a::coord::FLEET_MESSAGE_SEND`)
is the lowercase-slash method name used on the `.coord` HTTP bridge; kept
for backward compatibility with existing fleet peers.

**Known duplication (tracked, not fixed in this pass):** the eleven method
name constants are defined twice with identical values — once in
`aphrody-a2a/src/jsonrpc.rs::methods` and again as `METHOD_*` constants in
`aphrody-a2a-slimrpc/src/common.rs`. The SLIMRPC crate is excluded from the
workspace build (blocked on an upstream binding fix), so this was left
alone; when SLIMRPC is re-enabled, its constants should import
`aphrody_a2a::jsonrpc::methods` instead of redeclaring the strings.

## 3. Codex app-server v2 (stdio JSON-RPC, `aphrody app-server`)

Owner (types): `aphrody-app-protocol`. Implemented by `aphrody-ai`
`crates/ai/app-server` (`AppServer::dispatch`,
`crates/ai/app-server/src/lib.rs:531-985`). Every request/response/
notification struct is `#[serde(rename_all = "camelCase")]`.

**Important caveat, found during this audit:** `aphrody-app-server` does
*not* deserialize into `ClientRequest` to route requests — it hand-rolls its
own `RpcRequest { id, method, params }` and matches on the raw method
string. `aphrody-app-protocol::ClientRequest` is only reused there for the
shared JSON-RPC envelope types (`JSONRPCError`, `RequestId`) and the RAG
param/response DTOs. This means the two lists below (contract vs
implementation) can and do drift, and did drift before this pass (§3.3).
Bringing `aphrody-app-server`'s dispatcher onto `ClientRequest::from_jsonrpc`
so drift is caught at compile time is tracked in §6.6 as a follow-up; it is
too large a refactor of a 450-line match arm to do safely inside a naming
audit.

### 3.1 Tier-1 methods (`ClientRequest`, contract-defined and implemented)

`initialize`, `thread/start`, `thread/resume`, `thread/fork`, `thread/list`,
`thread/read`, `thread/archive`, `thread/unarchive`, `thread/close`,
`thread/compact/start`, `turn/start`, `turn/steer`, `turn/interrupt`,
`turn/events`, `model/list` (server also accepts the alias `models/list`),
`config/read` (not in repo), `account/login/start`, `account/read`, `mcpServerStatus/list`,
`tools/list`, `notifications/drain` (server also accepts the alias
`aphrody/notifications`), `shutdown`.

`turn/start` (`TurnStartParams`) requires `threadId` (`thread_id` in Rust) —
it is **not** optional. Start or resume a thread first (`thread/start` /
`thread/resume`), then call `turn/start` with the resulting id. A client
that got this wrong is fixed in §5.

The `models/list` alias of `model/list` and the `aphrody/notifications` alias
of `notifications/drain` are raw-string normalizations done in
`aphrody-ai`'s dispatcher (`AppServer::dispatch` matches both spellings to
the same arm) — there is no second `ClientRequest` variant for either alias,
the same pattern already used for `model/list`/`models/list` before this
pass.

`thread/unarchive` (`ThreadUnarchiveParams`/`ThreadUnarchiveResponse`,
`aphrody-app-protocol/src/types/thread.rs`), `thread/close`
(`ThreadCloseParams`/`ThreadCloseResponse`, same file), `notifications/drain`
(`NotificationsDrainParams`/`NotificationsDrainResponse`), `shutdown`
(`ShutdownParams`/`ShutdownResponse`), `tools/list`
(`ToolsListParams`/`ToolsListResponse`), and `turn/events`
(`TurnEventsParams`/`TurnEventsResponse`, all four in
`aphrody-app-protocol/src/types/extensions.rs`) were added to `ClientRequest`
by this pass — see §3.3. Implemented by `aphrody-ai`
`crates/ai/app-server/src/lib.rs`: `thread/unarchive` (`:653`),
`thread/close` (`:878`), `turn/events` (`:710`), `tools/list` (`:740`),
`notifications/drain` (`:801`), `shutdown` (`:980`).

### 3.2 `aphrody/*` extensions (require `capabilities.aphrody = true` at `initialize`)

| Method | Params | Response | Implemented? |
| --- | --- | --- | --- |
| `aphrody/status` (alias `system/status`) | `{}` | `{ service, version, initialized, threads, home, profile?, capabilities: { threads, turns, localModels, interrupt, steer, events, rag } }` | Yes (`lib.rs:805`) — now also typed in contracts (`AphrodyStatusParams`/`AphrodyStatusResponse`, added by this pass; was previously implemented but undocumented, see §5). |
| `aphrody/rag/search` | `{ query, topK? }` (`topK` defaults to 5, clamps 1..=100 server-side) | `{ results: [{ chunkId, path, content, score }] }` | Yes, feature `rag`. |
| `aphrody/rag/context` | `{ query, maxTokens? }` | `{ promptContext, sources }` | Yes, feature `rag`. |
| `aphrody/rag/status` | `{}` | `{ indexedDocuments, totalChunks, databasePath, embedModel }` | Yes, feature `rag`. |
| `aphrody/llama/status` | `{}` | `{ running, pid?, port?, activeModel?, vramUsageMib? }` | **No** — type exists in contracts, no producer in `aphrody-ai` (§3.3). Contract retained; implementation tracked in `aphrody-ai` (companion change, not verifiable from this repository). |
| `aphrody/train/status` | `{}` | `{ active, jobId?, step?, totalSteps? }` | **No** — same as above; contract retained, implementation tracked in `aphrody-ai`. |

### 3.3 Contract/implementation drift — status after this pass

**Closed, both directions, for the six methods below.** The previous audit
found `aphrody-ai` implementing methods `ClientRequest` did not know about,
and `ClientRequest` declaring methods `aphrody-ai` never dispatched. Both
sides of that drift for these methods are now resolved from the contract
side:

- `thread/unarchive`, `thread/close`, `notifications/drain` (alias
  `aphrody/notifications`), `shutdown`, `tools/list`, and `turn/events` were
  **implemented in `aphrody-ai` but absent from `ClientRequest`**; all six
  now have typed variants, param/response structs and contract tests (§3.1).
- `command/exec`, `command/exec/write`, `command/exec/terminate`, and
  `command/exec/resize` were **declared in `ClientRequest` but never
  dispatched by `aphrody-ai`** (any call 404s with `-32601`), and none of the
  `ServerRequest` approval flows (`item/commandExecution/requestApproval`,
  etc.) were ever emitted either. Implementing them for real means a
  PTY-capable subprocess with stdin write, resize and terminate — a
  feature-sized, greenfield effort, not a naming fix. Rather than fix the
  drift with a stub, this pass **removed the four `command/exec*` variants
  and their param/response types
  (`CommandExecParams`/`CommandExecResponse`/`CommandExecWriteParams`/…,
  formerly `aphrody-app-protocol/src/types/command.rs`, now deleted) from the
  contract entirely.** Re-adding them is tracked as a future `aphrody-ai` PTY-exec
  effort, not here.

**Still open, tracked as a companion change:** `account/logout`
(`ClientRequest::AccountLogout`, no params), `aphrody/llama/status`
(`LlamaStatusParams`/`LlamaStatusResponse`), and `aphrody/train/status`
(`TrainStatusParams`/`TrainStatusResponse`) remain typed in `ClientRequest`
but are not dispatched by `aphrody-ai` today. Contract retained;
implementation is expected in a companion `aphrody-ai` change — this repository
cannot verify that sibling repository's final state, so this note stands as a
pointer, not a confirmation.

### 3.4 Server → client notifications (`ServerNotification`)

`thread/started`, `thread/status/changed`, `thread/closed`,
`thread/archived`, `turn/started`, `turn/completed`, `turn/diff/updated`,
`turn/plan/updated`, `item/started`, `item/completed`,
`item/agentMessage/delta`, `item/plan/delta`,
`item/commandExecution/outputDelta`, `command/exec/outputDelta`,
`item/fileChange/outputDelta`, `error`.

### 3.5 Server → client requests (`ServerRequest`, approvals/elicitation)

`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`,
`item/permissions/requestApproval`, `item/tool/requestUserInput`.

### 3.6 Error envelope

`JSONRPCError { id, error: { code: i64, message, data? }, jsonrpc? }`
(`aphrody-app-protocol/src/rpc.rs`). Standard JSON-RPC codes plus app-server
specific ones: `-32700`/`-32600` parse errors, `-32602` invalid request,
`-32603` other, `-32601` method-not-found, `-32002` not-initialized.

## 4. Agent Submission/Event protocol (NDJSON, `aphrody-agent-proto`)

Codex-compatible local subprocess protocol used by the CLI/TUI/desktop/MCP
surfaces to drive the agent loop. **Intentionally snake_case** (see §1
exceptions table): `Submission { id, op }`, `Event { id, msg }`, with `Op`
and `EventMsg` enums tagged `rename_all = "snake_case"`.

## 5. Cross-repo naming inconsistencies found and fixed in this pass

| # | Where | Problem | Fix |
| --- | --- | --- | --- |
| 1 | `aphrody-contracts` `aphrody-app-protocol` + `aphrody-ui` | `probeAppServer()` called `aphrodyRpc("aphrody/status")`. The method turned out to be real and working (`aphrody-ai lib.rs:805`, aliased `system/status`) but was **not typed in `aphrody-contracts`** — a genuine contracts gap, not a client bug. | Added `AphrodyStatusParams`/`AphrodyStatusCapabilities`/`AphrodyStatusResponse` and a `ClientRequest::AphrodyStatus` (`aphrody/status`) variant to `aphrody-app-protocol`, matching the shape `aphrody-ai` already returns, plus a contract test (`tier1_contract.rs`). The TS client call needed no change. |
| 2 | `aphrody-ui` `runModelInferenceTest` | Called `turn/start` without `threadId`, which `TurnStartParams.thread_id` requires (not `Option`); always failed with an invalid-params error. | Calls `thread/start` first, then `turn/start` with the returned `threadId`, mirroring the working pattern already used in `quickbar.tsx`/`app.tsx`. |
| 3 | `aphrody-ui` | `RagSearchResult.chunkId` read as `r.chunkId ?? r.chunk_id`, a dead fallback masking uncertainty about the wire shape (the contract is unconditionally camelCase). | Removed the `chunk_id` fallback; kept `chunkId` only, with a comment pointing at the contract. |
| 4 | `aphrody-ui` | Local `AppServerThread.updated_at` interface field declared snake_case while the real wire field (`Thread.updatedAt`) is camelCase (latent — the field was never read). | Renamed the interface field to `updatedAt`. |
| 5 | `aphrody-web` `apps/bxc/src/mcp/server.ts` (not in repo) (`bxc_x_algorithm_rank`) | MCP tool schema exposed `top_k` (snake_case) even though the TS binding one layer below (`@aphrody/x` `rankPosts(candidates, context, topK)`, `packages/web/x/src/algo.ts`) already renamed the same value to `topK`. Same concept, casing flipped mid-chain. | Schema's primary field is now `topK`; `top_k` kept as a deprecated optional alias so already-shipped callers keep working (`args.topK ?? args.top_k`). |
| 6 | `aphrody-web` `apps/bxc/src/mcp/server.ts` (not in repo) (`bxc_xpro_deck`) | `deck_id` was the only snake_case field in an otherwise camelCase tool (`name`, `query`, `count`, `cookie`). | Schema's primary field is now `deckId`; `deck_id` kept as a deprecated optional alias. |

Note: `bxc_x_algorithm_rank`'s `context` object (`viewer_id`,
`followed_author_ids`, `recent_engagement_author_ids`, `muted_keywords`,
`blocked_author_ids`) was **not** renamed. Those fields mirror the ported
`xai-org/x-algorithm` data model 1:1 across Rust, TS and the MCP schema
(`packages/x/src/algo.ts::RankingContext`); renaming only the MCP layer
would make it diverge from its own TS binding instead of converging with
it — a deliberate, internally-consistent sub-domain convention, not the
"same concept, different casing between two callers" pattern this pass
targets.

## 6. Known issues (items 1, 3, 4, 7, 8 resolved; 2, 5, 6, 9 remain open)

Open items are recorded so the next pass has a starting point.

1. **DONE — `browser_*` MCP tool name collision.** `aphrody-web`
   `apps/bxc/src/mcp/server.ts` (not in repo) now registers its 13 tools as `bxc_browser_*`
   (canonical) and keeps the old `browser_*` names as deprecated aliases (same
   schema and handler, description flagged deprecated). `obscura-mcp` keeps
   its own `browser_*` names. `capabilities.ts` and `AGENTS.md` updated
   (aphrody-web `9097c26`).
2. **Two independent BXC-tool alias tables in `aphrody-ai`.** `aphrody-mcp`'s
   `bxc_tools.rs` renames `bxc_*` MCP tools to `aphrody_*` for its own
   proxy, while `aphrody-app-server/src/lib.rs:1094-1110` (`BXC_TOOL_NAMES`)
   independently renames a subset of the same underlying BXC tools for the
   agent's `tools/call` path. Two alias tables for one backend is a
   unification risk (they can silently diverge). Needs an `aphrody-ai` owner
   decision to merge into one table.
3. **DONE — search keys `query`/`limit`/`cursor` are canonical.** `query` is
   canonical with `q` kept as an accepted alias on `aphrody-site`
   `/api/v1/search/suggest` (aphrody-web `5731c26`) and on `nie-site`
   `recherche`, `text` search, `wiki` search/names, `ut` and every
   `DemandePage` route (nie `44872df9`). MCP tools (`bxc_semantic_search`,
   `bxc_keyword_search`, `wiki_search`, `vfs_search`) already used
   `query`/`limit`. `cursor` is the base64 of the decimal offset/page and is
   supported only where results are really paged (suggest, recherche, text
   search, `DemandePage` routes); flat top-N searches have no page state, so
   no cursor by design.
4. **DONE — `limit` is canonical.** `limit` (+ `cursor`) is accepted next to
   `page`/`per_page` (`limit` wins over `per_page`, `page` wins over
   `cursor`); `recherche` echoes `next_cursor`. Domain-specific
   `bxc_fut_market`/`bxc_fut_club` (`num`/`start`/`offset`/`count`) were
   deliberately left alone.
5. **Snake_case pockets in otherwise-camelCase files.** `aphrody-site`'s
   `bxc_google_signals` MCP tool and `/api/v1/bxc/rankings` HTTP route both
   return snake_case JSON (`target_url`, `serp_rank`, `estimated_monthly_
   volume`, …, `crates/aphrody-site/src/api.rs`, `src/mcp.rs`) while every
   sibling tool/route in the same files is camelCase. `aphrody-mcp`'s
   `ChatRequest`/`OcrRequest`/`VisionRequest` (`crates/aphrody-mcp/src/
   http_rest.rs:74-96`) have no `rename_all` at all, unlike the camelCase
   structs in the same file. Both need the owning repo to pick a
   compat window (dual-emit or an `/api/v1` version bump) rather than a
   silent rename.
6. **No shared TS wire-type package, and `aphrody-ui` doesn't import
   `aphrody-app-protocol` even in Rust.** Neither `aphrody-web`'s MCP/HTTP
   layer nor `aphrody-ui`'s Tauri/TS layer imports generated types from
   this repository; every surface hand-declares its own Zod schema or TS
   interface. On the Rust side, `aphrody-ui`'s desktop broker
   (`crates/ui/app/src/broker.rs`) forwards raw `serde_json::Value`
   and hand-builds two JSON-RPC envelopes by literal (`initialize`,
   `initialized`) instead of importing `ClientRequest` — even though
   `aphrody-ui`'s own `CLAUDE.md` allows a path dependency on
   `../aphrody-contracts` (it already uses `aphrody-subsystem` from this
   repo, just not `aphrody-app-protocol`). This is why bugs #2 and the
   original #1 in §5 existed undetected: nothing checked the method name or
   required fields at compile time. Recommendation: add
   `aphrody-app-protocol` as a path dependency of `crates/ui/app` and
   have `broker.rs` deserialize into `ClientRequest` for at least
   validation/logging; generate a matching TS package for the frontend
   (e.g. via `ts-rs`) so `tauri-bridge.ts`/`app.tsx`/`quickbar.tsx`
   stop re-typing method names and payload shapes by
   hand. Same root cause applies to `aphrody-web`'s MCP/HTTP layer.
7. **DONE (documented residue) — dispatcher routed through `ClientRequest`.**
   `aphrody-ai` `AppServer::dispatch` now matches `ClientRequest` variants
   (aphrody-ai `1f99ed5`); aliases `models/list`, `aphrody/notifications`,
   `system/status` are normalized before parsing; unknown method is `-32601`,
   malformed params `-32602`. Residue: 16 methods fall back to a lenient parse
   because the contract param types are stricter than the server's real
   behavior (e.g. `initialize` without `clientInfo`, legacy string `turn/start`
   input), and `ToolsListParams` lacks `cwd`/`model`/policy fields. Loosening
   those contract types is the remaining follow-up.
8. **DONE — one HTTP error envelope.** `aphrody-mcp` REST and `aphrody-embed`
   (including health) emit `{"error":{"code","message","data?"}}` through the
   shared `aphrody-http-error` crate in `aphrody-ai` (`5bf77e0`; `code` is the
   HTTP status as a string). JSON-RPC keeps `JSONRPCError` (§3.6).
   Protocol-mandated exceptions, intentionally not unified: `aphrody-gateway`
   (OpenAI `{"error":{"message","type"}}`) and `aphrody-jev` (Anthropic
   `{"detail":{"error_type","message"}}`) — their clients require those
   shapes.
9. **The same "OpenAI chat message" shape is independently defined at least
   three times inside `aphrody-ai`**: `aphrody-gateway`'s
   `OpenAiChatCompletionsRequest`, `aphrody-mcp`'s `ChatRequest`
   (`http_rest.rs`), and `aphrody-jev`'s request type. None import from a
   shared crate. Candidate for a small `aphrody-openai-compat`-style type
   crate (in `aphrody-ai`, not here, since it is not a cross-repo contract).
