# @aphrody/runtime-sdk

Light TypeScript SDK of the YOLO native runtime: loads the precompiled `yolo_runtime` library through
its versioned C ABI with `bun:ffi`. Core modules are `runtime:system` and `runtime:process`;
optional clients are `runtime:desktop` and `runtime:browser`.
Nothing here compiles an engine. See the repository's runtime ABI and runtime decisions.

```ts
import { Runtime } from "@aphrody/runtime-sdk";

using runtime = Runtime.load(); // verified artifact, ABI negotiated first
using child = runtime.spawn({
  program: "server",
  args: ["--port", "8080"],
  stdio: "capture",
});
await child.waitForHttp({ port: 8080, path: "/health" });
await child.stopAsync(2000);
```

Library resolution: `$YOLO_RUNTIME_LIB`, then the installed artifact
(`$YOLO_RUNTIME_HOME/<target>/current`, default `~/.yolo/runtime`), then `target/runtime/` of the
this Bun OS checkout. Install with `just yolo::runtime-install`, roll back with `just yolo::runtime-rollback`.

For one-shot binary output, ABI 1.4 provides lossless capture with an explicit
budget. Overflow rejects with `RuntimeError` / `Status.OutputLimit`; no successful
response is truncated. The existing `capture` mode remains a 64 KiB diagnostic tail.

```ts
using runtime = Runtime.load();
using child = runtime.spawn({
  program: "converter",
  args: ["input"],
  stdio: "capture-lossless",
  maxOutputBytes: 8 * 1024 * 1024, // per stream, total across all drains
});
const { stdout, stderr, status } = await child.collectOutput({
  timeoutMs: 30_000,
});
// stdout/stderr are owned Uint8Arrays; arbitrary bytes survive without UTF-8 decoding.
```

`collectOutput` stops the child on timeout, abort or capture error, and drains
terminal output after joined-reader shutdown. The caller releases the handle.
Native capture workers are joined before process release/runtime destroy returns.
After runtime close, SDK handles reject further native calls and can be disposed
without entering unloaded code. Unix shutdown covers the owned process group;
Windows process-tree shutdown and runtime behavior on other targets still need
execution qualification.

Optional clients load without activating either engine. Desktop opens a separately
installed `yolo-desktop` CEF host through the shared process supervisor.
Import `@aphrody/runtime-sdk/desktop` and call `desktop.open` with explicit
`grants` and exact `allowedOrigins`; dispose the session to close its windows and
join its host. Verified desktop installation helpers are exported from
`@aphrody/runtime-sdk/desktop-artifact`.

Import `@aphrody/runtime-sdk/browser` and call `BrowserRuntime.load` to use the
optional native browser provider. Core ABI and `browser.*` capabilities are
negotiated before any extension symbol is bound. Each context requires exact
HTTP(S) `allowedOrigins`; private-network access needs an explicit context opt-in.
Contexts own isolated in-memory cookies and JavaScript realms. Navigation,
extraction, evaluation and PNG capture accept cancellation; disposing their owner
joins the native workers before library unload.

These SDK APIs do not establish native rendering or distribution qualification.
An ABI 1.4 core artifact lacks browser capabilities, and desktop requires its own
verified native executable (it ships its CEF payload) plus the platform GTK 4 prerequisites on Linux. Native provider
and target support remain subject to their actual build and execution gates.
