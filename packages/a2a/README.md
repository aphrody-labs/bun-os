<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/a2a

A2A **1.0** client for Bun and the web platform: Agent Card discovery, the JSON-RPC and HTTP+JSON
bindings, Server-Sent Events streaming, task management, push notification configs, and a shim for
the pre-1.0 dialect. Zero runtime dependencies, standard `fetch` only.

Specification: [A2A Protocol 1.0](https://a2a-protocol.org/latest/specification/) (latest released
version `1.0.0`, checked on 2026-10-06). Server side: the Rust crates `aphrody-a2a`,
`aphrody-a2a-pb`, `aphrody-a2a-server`, `aphrody-a2a-coord` (`aphrody a2a serve`), documented in
[docs/products/contracts/a2a](../../docs/aphrody/products/contracts/a2a/README.md).

Status: source and tested behavior only. The package is **not published** to npm; publication is
the owner's decision. `npm pack --dry-run` lists exactly `src/`, `README.md` and `package.json`.

```ts
import { A2AClient, collectStream, responseText } from "@aphrody/a2a";

const client = await A2AClient.connect("http://127.0.0.1:8788"); // Agent Card discovery
const answer = await client.sendMessage("@claude: summarise PLAN.md");
console.log(responseText(answer)); // task artifacts, else the agent message

for await (const event of client.sendStreamingMessage(
  "@agy: review the diff",
)) {
  if (event.statusUpdate) console.log(event.statusUpdate.status.state);
}
const final = await collectStream(
  client.sendStreamingMessage("@grok: refactor"),
); // task or message
```

## Operations

`A2AClient` exposes one method per operation of the specification. Requests are the generated
ProtoJSON types without `tenant` (the client fills it from the selected interface).

| Method                                          | JSON-RPC method                    | REST route                                              |
| :---------------------------------------------- | :--------------------------------- | :------------------------------------------------------ |
| `sendMessage(request \| text)`                  | `SendMessage`                      | `POST /message:send`                                    |
| `sendStreamingMessage(request \| text)`         | `SendStreamingMessage`             | `POST /message:stream`                                  |
| `getTask(id \| {id, historyLength})`            | `GetTask`                          | `GET /tasks/{id}`                                       |
| `listTasks(params)` / `listAllTasks(params)`    | `ListTasks`                        | `GET /tasks`                                            |
| `cancelTask(id \| {id, metadata})`              | `CancelTask`                       | `POST /tasks/{id}:cancel`                               |
| `subscribeToTask(id)`                           | `SubscribeToTask`                  | `POST /tasks/{id}:subscribe`                            |
| `createPushNotificationConfig(config)`          | `CreateTaskPushNotificationConfig` | `POST /tasks/{id}/pushNotificationConfigs`              |
| `getPushNotificationConfig({taskId, id})`       | `GetTaskPushNotificationConfig`    | `GET /tasks/{id}/pushNotificationConfigs/{configId}`    |
| `listPushNotificationConfigs(taskId \| params)` | `ListTaskPushNotificationConfigs`  | `GET /tasks/{id}/pushNotificationConfigs`               |
| `deletePushNotificationConfig({taskId, id})`    | `DeleteTaskPushNotificationConfig` | `DELETE /tasks/{id}/pushNotificationConfigs/{configId}` |
| `getExtendedAgentCard()`                        | `GetExtendedAgentCard`             | `GET /extendedAgentCard`                                |

- `sendMessage` blocks until the task reaches a terminal or interrupted state, unless
  `configuration.returnImmediately` is true; mind `timeoutMs` (default 120 s, `0` disables).
- Streams are `AsyncGenerator<StreamResponse>`: a `task` (or a single `message`), then
  `statusUpdate` / `artifactUpdate` events. Stop with `break` or an `AbortSignal`; the connection is
  closed either way. `applyStreamResponse` folds events into a task, `collectStream` drains a stream.
- `listTasks` normalises the members ProtoJSON omits when empty (`tasks`, `nextPageToken`, ...).
- Helpers: `userMessage`, `sendMessageRequest`, `textPart`, `dataPart`, `rawPart`, `urlPart`,
  `responseText`, `taskText`, `messageText`, `isTerminalState`.

## Discovery, bindings, versions

`A2AClient.connect(baseUrl)` fetches `/.well-known/agent-card.json` and picks the **first** interface
of `supportedInterfaces` whose binding is `JSONRPC` or `HTTP+JSON` and whose `protocolVersion` is `1.0`
(spec 8.3.2). There is no silent fallback to older versions: a card that only offers 0.3 fails with an
`A2ADiscoveryError` listing what was offered. `gRPC` interfaces are skipped (not implemented).

- `bindings: ["HTTP+JSON"]` restricts the choice; `A2AClient.fromCard(card)` reuses a known card;
  `new A2AClient({ url, binding })` skips discovery.
- `AgentCardCache` honours `Cache-Control: max-age`, `no-store`, `ETag` and `Last-Modified`
  (conditional requests, spec 8.6). It is opt-in: pass it to `connect` / `fetchAgentCard`.
- Pre-1.0 cards (`url`, `preferredTransport`, `additionalInterfaces`, `supportsAuthenticatedExtendedCard`)
  are lifted to the 1.0 shape by `normalizeAgentCard`.
- Every request carries `A2A-Version: 1.0` (and `A2A-Extensions` when `extensions` is set). The tenant
  of the selected interface goes in the request (JSON-RPC) or in the path (REST).
- Credentials: `headers` is a `HeadersInit` or a function awaited before each request. Redirects are
  refused so credentials never follow one to another host.

Not implemented: the gRPC binding, Agent Card signature verification (JWS, spec 8.4), and the
OAuth / in-task authorisation flows (credentials are the caller's, through `headers`).

## Errors

| Class               | Meaning                                                                                                                                                                                                                 |
| :------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `A2AError`          | The agent answered with an error: `code`, `reason` (`ErrorInfo.reason`, for example `TASK_NOT_FOUND`), `domain`, `metadata` (`taskId`, `timestamp`), `details`, `httpStatus` (REST). `error.is("TASK_NOT_CANCELABLE")`. |
| `A2ATransportError` | `kind`: `network`, `timeout`, `aborted`, `http` (non-A2A status, for example 401 from a gateway), `protocol` (malformed body), `stream` (cut stream).                                                                   |
| `A2ADiscoveryError` | `kind`: `fetch`, `invalid`, `no-interface`.                                                                                                                                                                             |

`A2A_ERROR_CODES` holds the codes of spec section 5.4 and JSON-RPC (`-32001` to `-32009`, `-32700` to
`-32603`); a test compares them with `crates/contracts/a2a/src/errors.rs`.

## Push notifications

Configs are managed with the four `*PushNotificationConfig` methods (or `configuration.taskPushNotificationConfig`
in a send request). A webhook receiver decodes a delivery with `parsePushNotification(body)` (a
`StreamResponse`) and authenticates it with `verifyPushAuthorization(request.headers, config.authentication)`
(scheme case-insensitive, credentials compared in constant time). The package ships no HTTP server.

## Generated types

`src/generated/a2a.ts` is generated from `crates/os/kernel/comps/a2a-pb/proto/a2a.proto`, the schema the Rust
crates compile with prost, so both sides share one source: camelCase members, enum names as
strings (`TASK_STATE_COMPLETED`), `oneof` as exclusive unions (`Part`, `StreamResponse`), required
fields from `google.api.field_behavior`, and the method tables (`A2A_METHODS`, `A2AMethodTypes`).

```sh
bun run generate        # rewrite src/generated/a2a.ts after a proto change
bun run generate:check  # exit 1 when it is stale (also asserted by `bun test`)
```

The reader in `scripts/proto-to-ts.ts` understands the proto3 subset of the A2A schema and throws on
anything else. Tests also compare the TypeScript method names, error codes and task states with the
Rust sources (`jsonrpc.rs`, `errors.rs`, the proto).

## Legacy dialect shim (`@aphrody/a2a/legacy`)

Older peers speak `message/send`, `tasks/get`, `tasks/update` with `kind`/`type` part discriminators
and lower-case states. `LegacyBridge` serves such requests **from an A2A 1.0 agent**: a legacy
request comes in, the 1.0 method is called through `A2AClient`, the answer goes back in the legacy
shape. It replaces a method-renaming proxy (which left the payloads untranslated).

```ts
import { A2AClient } from "@aphrody/a2a";
import { LegacyBridge, HUB_PROFILE } from "@aphrody/a2a/legacy";

const bridge = new LegacyBridge(await A2AClient.connect(url), {
  profile: HUB_PROFILE,
});
// route handler of a legacy endpoint:
const body = await request.json();
if (bridge.isStreaming(body)) {
  for await (const reply of bridge.handleStream(body))
    send(`data: ${JSON.stringify(reply)}\n\n`);
} else {
  return Response.json(await bridge.handle(body)); // never throws: errors are JSON-RPC errors
}
```

The pure functions (`upgradeRequest`, `upgradeMessage`, `upgradePart`, `downgradeTask`,
`downgradeStreamResponse`, `downgradeSendResponse`, state mappers) are exported for callers that
need only one direction.

**Methods**

| Legacy method                                        | A2A 1.0 method                                       | Notes                                                                               |
| :--------------------------------------------------- | :--------------------------------------------------- | :---------------------------------------------------------------------------------- |
| `message/send`                                       | `SendMessage`                                        | message form, or flat fleet form `{target, sourceAgent, instruction, yolo, data}`   |
| `message/stream`                                     | `SendStreamingMessage`                               | `handleStream`                                                                      |
| `tasks/get`                                          | `GetTask`                                            | `id` or `taskId`                                                                    |
| `tasks/list`                                         | `ListTasks`                                          | `status` mapped; `target` filter applied to `task.metadata.target` / `aphrody_peer` |
| `tasks/cancel`                                       | `CancelTask`                                         |                                                                                     |
| `tasks/resubscribe`                                  | `SubscribeToTask`                                    | `handleStream`                                                                      |
| `tasks/pushNotificationConfig/{set,get,list,delete}` | `{Create,Get,List,Delete}TaskPushNotificationConfig` | `get`/`delete` need `pushNotificationConfigId`                                      |
| `agent/getAuthenticatedExtendedCard`                 | `GetExtendedAgentCard`                               |                                                                                     |
| `agent/card`, `agent/getCard`                        | answered from the connected card                     | pre-1.0 `url`, `preferredTransport`, `protocolVersion` added                        |
| `tasks/update`                                       | `SendMessage`                                        | Aphrody hub convention, see below                                                   |

**Payloads (legacy to 1.0)**

| Legacy                                                           | 1.0                                                                                 |
| :--------------------------------------------------------------- | :---------------------------------------------------------------------------------- |
| `{kind\|type: "text", text}`                                     | `{text}`                                                                            |
| `{kind\|type: "data", data}`                                     | `{data, mediaType: "application/json"}`                                             |
| `{kind\|type: "file", file: {name, mimeType, bytes\|uri}}`       | `{raw\|url, filename, mediaType}`                                                   |
| `role: "user"`, `"agent"`, `"system"`                            | `ROLE_USER`, `ROLE_AGENT`, `ROLE_USER` + `metadata.legacyRole: "system"`            |
| `configuration.blocking: false`                                  | `configuration.returnImmediately: true`                                             |
| `configuration.pushNotificationConfig.authentication.schemes[0]` | `taskPushNotificationConfig.authentication.scheme`                                  |
| `target`, `sourceAgent`, `yolo` (params or message metadata)     | request `metadata`; `aphrody_peer` only through `options.peerForTarget`             |
| state `input-required` or `input_required`                       | `TASK_STATE_INPUT_REQUIRED` (same for `auth-required`, `canceled`/`cancelled`, ...) |

**`tasks/update`** is not an A2A method: a worker reports on a task. It is carried as a
`SendMessage` whose message is `ROLE_AGENT`, bound by `taskId`, with the text, data and artifacts
(`json`, `markdown`, `code`, `file`) as parts and `metadata: {legacyMethod, sourceAgent, status, verdict}`.
The receiving agent must interpret that metadata; the legacy answer is the hub style result. A legacy
`message/send` that already carries a `taskId` (the hub's worker reply) is passed through the same
way: the role and `metadata` (`status`, `verdict`, ...) are kept as sent.

**Results (1.0 to legacy).** Two profiles choose the spelling: `A2A_03_PROFILE` (default: `kind`
discriminators, `input-required`, `message/send` answers the task or message itself) and
`HUB_PROFILE` (`type` discriminators, `input_required`, `message/send` answers
`{taskId, status, verdict?, response: {role, parts}, task}`). Stream events become `status-update`
(with `final`) and `artifact-update`. A non-object `data` part is wrapped as `{value}`.

**Errors.** `A2AError` keeps its code and details (`-32001` to `-32009`); unknown methods are
`-32601`, invalid params `-32602`, invalid requests `-32600`, transport failures `-32603`.

Not reproduced: the hub's bespoke task record (`target`, `description`, `resultMarkdown`,
`createdAt`) and its non-A2A methods (`envelope/send`, `msg/send`, `envelopes/list`,
`mailbox/list`); legacy consumers read `task.status.state` instead.

## Tests

```sh
bun test                 # fake A2A agent (both bindings) + real Rust server when `aphrody` is on PATH
bun check --noEmit && bun lint src test scripts && bun scripts/generate-types.ts --check
```

- `test/fake-agent.ts` is an in-process agent (card, JSON-RPC, REST, SSE, push configs).
- `test/rust-server.test.ts` starts `aphrody a2a serve` in dry-run mode (no peer CLI is invoked) in a
  temporary directory and runs the client and the legacy bridge against it; skipped without the binary.
  Divergences of the installed binary from the specification are asserted loosely and marked
  `DIVERGENCE` in the test: `SubscribeToTask` on a finished task answers `TASK_NOT_FOUND` (spec:
  `UNSUPPORTED_OPERATION`) and `GetExtendedAgentCard` answers `-32004` (spec: `-32007`); both are
  fixed in the Rust sources and show up once the binary is rebuilt. Still open server-side: the
  `A2A-Version` header is not validated (a request without it is served, spec 3.6.2 asks for 0.3
  semantics) and a message with no parts is accepted (spec: `INVALID_PARAMS`).
