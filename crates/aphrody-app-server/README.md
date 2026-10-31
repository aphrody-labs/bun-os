# Aphrody local app server

The server drives `aphrody-agent-runtime` through a subset of the Codex
app-server v2 wire contract. It uses the shared `aphrody-app-protocol` RPC
envelopes and input types. Thread status, response envelopes, notification
names, and the streaming lifecycle were checked against OpenAI Codex source
revision `78245b47af2a7aafcabe025828ceecca69db4df1`:

- `codex-rs/app-server-protocol/src/protocol/v1.rs`
- `codex-rs/app-server-protocol/src/protocol/v2/thread.rs`
- `codex-rs/app-server-protocol/src/protocol/v2/turn.rs`

That revision remains the provenance for the original contract comparison and
fixtures. The current audit checkout is [`thirdparty/codex`](../../thirdparty/codex),
pinned at `a6bd19261c30ce0a0225fe90e646822d29916f11`; it does not change the
provenance of existing ports or establish conformance to the newer revision.
See third-party provenance.
This is a partial implementation, not complete Codex desktop compatibility.

The product integration target and delivery order are maintained in the
AI plan and the owning
[UI specification](../../../m3/docs/reference/GUI.md). The first complete desktop
slice uses explicitly selected full access while restricted policies remain
rejected. OS isolation is a later release gate for advertising restricted modes.

## Transport and lifecycle

Run `aphrody app-server` for newline-delimited stdio. The HTTP alternative is
`aphrody app-server --http --addr <loopback-address>`; send requests to `/rpc`.
The server also serves the shared desktop/web console at `/`. Model selection
uses `~/.aphrody/config.toml`, `modelProvider`, and the `config` request object
through the shared `ModelFactory`. The fallback `local` provider reads
`APHRODY_LOCAL_MODEL_URL`, defaulting to `http://127.0.0.1:11434`, and uses
`/v1/chat/completions`. Configure other Chat Completions or Responses providers
through `model_providers`. Dotted configuration keys are accepted.

Send these frames in order, substituting the returned thread ID:

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"example","version":"1"}}}
{"method":"initialized"}
{"id":2,"method":"thread/start","params":{"model":"llama3.2"}}
{"id":3,"method":"turn/start","params":{"threadId":"RETURNED_THREAD_ID","input":[{"type":"text","text":"Describe this workspace."}]}}
```

`turn/start` with array input returns an `inProgress` turn immediately.
Stdio then emits `thread/started`, `turn/started`, `item/started`,
`item/agentMessage/delta`, `item/completed`, and `turn/completed` frames.
Turn IDs remain stable between the response, notifications, and thread history.
Only one turn may run in each thread at a time. `turn/steer` accepts
`expectedTurnId`; `turn/interrupt` checks a supplied `turnId`.

HTTP provides an SSE notification stream at `GET /events`, plus
`GET /notifications`. The Aphrody extension `turn/events` accepts `threadId`
and returns raw engine events, a `completed` flag, and wire notifications.
There is no WebSocket endpoint in the current router.

These are current transport implementations, not a reliable multi-subscriber
event bus. Stdio checks pending events every 10 ms; SSE drains notifications
every 50 ms. SSE, notification drains, and turn polling consume shared queues;
concurrent consumers can take events from one another. SSE has no sequence ID
or reconnect cursor. Use one notification consumer per server instance until
the subscription/replay contract is implemented. See
[`serve_stdio_with_server`, `http_events`, and `drain_notifications`](src/lib.rs).

The legacy string `input` and explicit `waitForCompletion` extension remain
available. HTTP holds the shared server mutex while handling an RPC, so a
request waiting for turn completion can delay other RPCs and notification
delivery. New clients should use array input and asynchronous turns.

### Embedding in a host process

A host that links this crate runs the same stdio loop over two
`tokio::io::duplex` pipes instead of spawning `aphrody app-server`
(the retired `aphrody-app` desktop broker did exactly that). `serve_stdio_with(reader, writer,
server)` takes a configured `AppServer`; `AppServer::with_models_dir(path)`
selects the model store root for managed local models, so the host never
exports `APHRODY_MODELS_DIR` (mutating the environment of a threaded process is
`unsafe` in edition 2024). Closing the client end of the pipe is the shutdown
signal: every session is joined and its rollout flushed before the future
returns. The managed `llama-server` daemon is started detached by the runtime
by re-executing the current executable as `<exe> __llama-daemon ...`, so an
embedding host must answer that argument at the top of its `main` (see
`crates/ui/app/src/main.rs`).

## Implemented method surface

The dispatch table in [`src/lib.rs`](src/lib.rs) is authoritative. Supported
methods include Codex-shaped methods and Aphrody extensions; their presence
does not imply identical semantics to every upstream method with the same name.

| Surface | Methods |
| --- | --- |
| Handshake and lifecycle | `initialize`, `initialized` notification, `shutdown` |
| Threads | `thread/start`, `thread/resume`, `thread/fork`, `thread/list`, `thread/read`, `thread/archive`, `thread/unarchive`, `thread/close`, `thread/compact/start` |
| Turns | `turn/start`, `turn/steer`, `turn/interrupt`, `turn/events` |
| Discovery | `model/list`, `config/read`, `tools/list`, `mcpServerStatus/list` |
| Local account facade | `account/login/start`, `account/read`, `account/logout` |
| Notification drain | `notifications/drain` |
| Aphrody extensions | `aphrody/status`, `aphrody/rag/search`, `aphrody/rag/context`, `aphrody/rag/status`, `aphrody/llama/status`, `aphrody/train/status` |

Aliases are `models/list` → `model/list`, `aphrody/notifications` →
`notifications/drain`, and `system/status` → `aphrody/status`. RAG operations
require the `rag` feature and the negotiated `capabilities.aphrody` extension.
Local account methods reflect local provider configuration: login validates a
managed provider and logout has no stored account token/session to clear.
They do not implement the upstream hosted-account authentication lifecycle.

## Streamed content and integration work

`ThreadState::observe` currently translates assistant text and turn lifecycle,
plus tool start/end notifications. Tools are represented as `mcpToolCall` items
with `arguments: null` and a final `{ "ok": ... }` result. This projection does
not carry their actual arguments, detailed results, shell output deltas, patch
diffs, or reasoning events. The runtime also constructs the shell tool without
its optional output sink; see
[`build_tool_registry`](../aphrody-agent-runtime/src/tools.rs).

Completing this path requires typed tool events, cancellation propagated into
active tools, independent subscriptions with replay, and measured engine-to-UI
delivery. Preserve the rollout completion durability barrier while improving
latency. Business capabilities such as model lifecycle, OCR, speech, RAG,
training, web, and SSH should connect to their existing owners and job APIs;
status methods alone do not provide their complete UI workflows. The canonical
plan owns that work; this crate does not introduce another job queue or service
registry.

## Current boundaries

- Threads persist under the Aphrody `sessions` directory with a shared runtime
  UUID. Set `ephemeral: true` to opt out. `thread/resume` reloads persisted model
  conversation history after a close or restart and reconstructs UI messages,
  tool calls, and steering from the same rollout records. `thread/list` merges
  loaded and persisted sessions, supports cursor pagination, and reports
  unreadable records through `skipped`. Unloaded sessions have `notLoaded` status.
- Local tools use the validated thread working directory. The server runs with
  full local permissions and no approvals. Requests for restricted sandbox or
  approval policies fail explicitly; they are never silently downgraded.
- `turn/start` rejects a changed per-turn `model` or `cwd`; omitting them or
  repeating the thread's values is accepted. Choose these values when creating
  the thread. Other methods outside the dispatch table return `-32601`.
- YOLO runtime mode has no tool-iteration cap by default; `maxToolIterations`
  selects an explicit bound. The optional `rag` Cargo feature enables the same
  indexed retrieval tools as the CLI through `rag.enabled` and `rag.db_path`.
- HTTP has no authentication and shares one server instance. RPC and event
  handlers require a local Host and reject cross-site requests; same-host
  HTTP(S) origins and `tauri:` origins are accepted. The server rejects
  non-loopback bind addresses. It is intended for trusted local clients.

Focused verification command, with `RUSTC_WRAPPER` empty:
`cargo test -p aphrody-app-server --locked --offline --lib`.
Existing test source covers malformed-frame recovery, initialization ordering, multimodal
inputs, policy rejection, stable event IDs, and a complete asynchronous turn
through the real engine with a deterministic test model. A local HTTP model
fixture also verifies provider selection and persisted history replay.
These tests were not run for this documentation correction; their presence is
not evidence of a current passing run or a completed desktop scenario.
