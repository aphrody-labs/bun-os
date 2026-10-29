<!-- SPDX-License-Identifier: Apache-2.0 -->

# Bun agent client

[`src/agent.ts`](src/agent.ts) (export `@aphrody/bun/agent`) provides a Bun-native app-server client alongside the
synchronous FFI binding. It starts `aphrody app-server` through
`Bun.spawn` and exchanges newline-delimited v2 protocol frames.

```typescript
import { AgentClient } from "@aphrody/bun/agent";

const client = new AgentClient({ executable: "aphrody" });
try {
  await client.initialize();
  const { thread } = await client.startThread({
    model: "your-installed-model",
  });
  const turn = await client.startTurn(
    thread.id,
    "Explain the current workspace.",
  );
  for await (const event of turn.events()) {
    if (event.method === "item/agentMessage/delta") {
      await Bun.stdout.write(event.params?.delta ?? "");
    }
  }
} finally {
  await client.close();
}
```

Constructor options include `executable`, `args`, `cwd`, `env` and
`requestTimeoutMs` (default 30,000). Environment overrides merge with the current
environment. The server selects models using `$APHRODY_HOME/config.toml`.
Turn streams impose no duration cap. RPC timeouts stop waiting, not execution.
Call `turn.interrupt()` to interrupt an active turn. Inspect the terminal
`turn/completed` notification's status and error; a model failure is a terminal
event, whereas RPC and transport failures reject their promises.

`client.request(method, params)` exposes the server's remaining supported
methods, such as `thread/resume`. One reader routes concurrent replies and
buffers early turn notifications. One event consumer may own each thread.
Unexpected server approval requests receive an explicit unsupported error.
Always await `close()` to reap the owned process.

## Source and validation

This is a Bun port of the transport/router in OpenAI Codex
[`sdk/python/src/openai_codex`](https://github.com/openai/codex/tree/78245b47af2a7aafcabe025828ceecca69db4df1/sdk/python/src/openai_codex),
revision `78245b47af2a7aafcabe025828ceecca69db4df1`, licensed Apache-2.0.
The Python client and its real Rust integration suite live in
`py/aphrody`.

- FAIT: handshake, threads, streaming turns, interruption, structured errors,
  timeouts and process shutdown; seven real-child tests, TypeScript and Oxlint
  checks cover the implementation.
- INCOMPLET: generated protocol typing and browser transports. This file requires
  Bun and cannot be imported directly into a browser. A browser UI must use an
  HTTP or desktop IPC bridge to the same app-server contract.

From the repository root:

```text
bun test packages/interop/native/test/agent.test.ts
```

The Python integration suite also launches this SDK through Bun against the
real Rust app-server and a local HTTP SSE model fixture. Set
`APHRODY_TEST_BINARY` and run `test_agent_live.py -k bun` from the Python
workspace to verify that boundary without downloading model weights.
