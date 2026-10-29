<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-a2a

## What is `aphrody-a2a`?

`aphrody-a2a` is the top-level Rust facade for the A2A v1 agent-to-agent
protocol inside Aphrody (derived from the AGNTCY a2a Rust SDK). It bundles the
wire-compatible type system (messages, tasks, artifacts, parts, JSON-RPC
envelopes, streaming events, error details) that every other crate in the
`aphrody-a2a-*` family consumes. It is imported in Rust as `aphrody_a2a`, so a
typical downstream consumer writes `use aphrody_a2a::*;` and gets every
protocol type plus its serde derives ready to go. There is no runtime
dependency on tokio, axum, or reqwest: those land in the companion
`aphrody-a2a-client` and `aphrody-a2a-server` crates.

## Install

```toml
[dependencies]
aphrody-a2a = "0.3"
```

For end-to-end agent loops you usually want the full stack:

```toml
aphrody-a2a-client = "0.1"
aphrody-a2a-server = "0.3"
aphrody-a2a-grpc   = "0.2"
aphrody-a2a-pb     = "0.1"
```

## Quick start

```rust
use aphrody_a2a::{Message, Part, Role};

let message = Message::new(Role::User, vec![Part::text("hello peer")]);
assert_eq!(message.text(), Some("hello peer"));
```

## Re-exports

Source of truth: `crates/aphrody-a2a/src/lib.rs`. The crate re-exports every public
item from seven submodules through `pub use <mod>::*;`:

- `agent_card` — `AgentCard` and the well-known descriptor types served at
  `.well-known/agent-card.json`.
- `types` — `Message`, `Task`, `Artifact`, `Part`, `PartContent`, `Role`,
  `TaskState`, `TaskStatus`, `SendMessageRequest`, `SendMessageResponse`,
  `SendMessageConfiguration`, `GetTaskRequest`, `ListTasksRequest`,
  `ListTasksResponse`, plus ID constructors `new_task_id`, `new_context_id`,
  `new_message_id`, `new_artifact_id`.
- `event` — streaming envelopes `StreamResponse`, `TaskStatusUpdateEvent`,
  `TaskArtifactUpdateEvent` for SSE / gRPC streams.
- `jsonrpc` — `JsonRpcRequest`, `JsonRpcResponse`, `JsonRpcError`, `JsonRpcId`.
- `errors` — `A2AError` plus protocol error code helpers.
- `errordetails` — typed error payload structures for richer client surfaces.
- `coord` — fleet `.coord` envelopes (`CoordEnvelope`, `FleetSendParams`), the
  peer roster and the JSON Schemas of the envelope, JSON-RPC frames and agent card.

Top-level constants: `VERSION = "1.0"`, `SVC_PARAM_VERSION = "A2A-Version"`,
`SVC_PARAM_EXTENSIONS = "A2A-Extensions"`.

## Cross-platform

Linux, Windows and WASM are all supported. The
`wasm32-unknown-unknown` target activates the `uuid/js` feature to delegate
v4/v7 entropy to `Math.random` / browser CSPRNG, so the same `Message::new`
flow runs unchanged inside a browser-hosted agent loop.

## License

Apache-2.0. Copyright AGNTCY Contributors; aphrody-code packaging.

## Related

- `aphrody-a2a-pb` — prost-generated protobuf bindings and pbjson conversion helpers.
- `aphrody-a2a-client` — async client with JSON-RPC / REST / gRPC transports.
- `aphrody-a2a-server` — `axum`-based server framework and task store.
- `aphrody-a2a-grpc` — gRPC binding layer connecting client and server over tonic.

## TypeScript projection

The coordination schema owns the base fields and envelope kinds. A TypeScript
projection of the types can be regenerated with:

```bash
cargo run -q -p aphrody-a2a --example export_coord_types --locked > coord.generated.ts
```

The generator is a development command; consuming a checked-in projection does
not launch Cargo.
