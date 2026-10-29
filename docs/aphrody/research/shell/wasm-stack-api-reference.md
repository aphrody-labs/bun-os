> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

# WASM / web / Tauri shell stack: API reference

Date: 2026-10-02. Sources: Context7 (wasm-bindgen `/wasm-bindgen/wasm-bindgen`,
Tauri `/tauri-apps/tauri-docs` (v2 docs), xterm.js `/xtermjs/xterm.js`,
ghostty-web `/coder/ghostty-web`, Bun `/oven-sh/bun`) cross-checked against the
vendored crate sources in `~/.cargo/registry` where marked "verified in source".

Pins in the workspace `Cargo.toml`: wasm-bindgen 0.2.128, js-sys 0.3.105,
web-sys 0.3.105, wasm-bindgen-futures 0.4.78, tauri =3.0.0-alpha.3,
tauri-plugin =3.0.0-alpha.2.

## Context7 coverage gaps

- Tauri 3.0.0-alpha.3: Context7 only has v2 docs. Channel, plugin Builder and
  permission APIs below were confirmed against
  `tauri-3.0.0-alpha.3/src/ipc/{channel,mod}.rs` in the cargo registry.
  `withGlobalTauri` is not documented for v3 in Context7; the repo already uses
  `window.__TAURI__.core.invoke` and `window.__TAURI__.event.listen`
  (`crates/ui/app/examples/shell_e2e/frontend/index.html`), so `window.__TAURI__.core.Channel`
  is expected but not verified.
- brush-core: not in Context7 ("brush" resolves to a Gaussian-splatting engine;
  `brush-core` returns nothing). Not in `~/source` or the cargo registry either.
  Section 4 is therefore unverified recollection; check docs.rs/brush-core and
  the pinned source before use.
- wasm-bindgen: Context7 snippets are from `main` (it showed 0.2.121+ typed
  `Function<fn(..)>` APIs); the `Closure::wrap` / `spawn_local` forms below are the
  long-stable ones and work on 0.2.128.

## 1. wasm-bindgen 0.2.128

Existing surface in `crates/shell/web/src/lib.rs`: `WebTerminal::{new, ingest(&[u8]),
resize, take_replies() -> Vec<String>, lines() -> Vec<String>, snapshot_json()}`.

- `&[u8]` argument: JS passes a `Uint8Array` (copied into wasm memory). Use
  `js_sys::Uint8Array` as the parameter type to avoid the copy-in when you need a view.
- Returning `Vec<String>`: supported directly; JS receives `string[]` (copied out
  with `__wbindgen_free`). Returning `Vec<u8>` gives a `Uint8Array`.
- Build: `bun wasm build --target web` (the aphrody-labs/bun replacement for `wasm-pack`, see
  https://bun.com/docs/bundler/wasm; `scripts/build/rust/wasm-package.ts` for workspace crates) emits
  `init(moduleOrPath?)` (async default export) and `initSync({ module })`; use
  `--target bundler` when a bundler (Bun build/Vite) handles the `.wasm` import.
  With `--target web`, call `await init()` before constructing `WebTerminal`.

JS callback via `js_sys::Function`:

```rust
#[wasm_bindgen]
pub fn on_replies(&mut self, cb: &js_sys::Function) {
    for r in self.inner.take_replies() {
        let _ = cb.call1(&JsValue::NULL, &JsValue::from_str(&r));
    }
}
```

Rust closure handed to JS (owned, retained by JS: `forget` or keep the `Closure` alive):

```rust
let onmessage = Closure::wrap(Box::new(move |e: web_sys::MessageEvent| {
    // binary frames: set ws.set_binary_type(web_sys::BinaryType::Arraybuffer)
    if let Ok(buf) = e.data().dyn_into::<js_sys::ArrayBuffer>() {
        let bytes = js_sys::Uint8Array::new(&buf).to_vec();
        /* feed WebTerminal::ingest(&bytes) */
    } else if let Some(text) = e.data().as_string() { /* control JSON */ }
}) as Box<dyn FnMut(web_sys::MessageEvent)>);
ws.set_onmessage(Some(onmessage.as_ref().unchecked_ref()));
onmessage.forget();
```

Newer typed form (Context7, main; check it exists in 0.2.128 before use):
`Function::closure_ref(&ScopedClosure::borrow_mut(&mut f))` for borrowed callbacks,
`Function::from_closure` for owned ones.

Async: `wasm_bindgen_futures::spawn_local(async move { ... })` for fire-and-forget;
`future_to_promise` or an `async fn` under `#[wasm_bindgen]` to return a `Promise`;
`JsFuture::from(promise).await` to await JS promises.

web-sys WebSocket (Cargo features: `WebSocket`, `MessageEvent`, `BinaryType`,
`CloseEvent`, `ErrorEvent`): `WebSocket::new(url)?`, `set_binary_type(Arraybuffer)`,
`set_onopen/onmessage/onerror/onclose`, `send_with_str`, `send_with_u8_array(&[u8])`.
Matches the existing wire protocol (binary = raw bytes, text = JSON control from
`wire.rs::resize_frame`).

## 2. Tauri 3.0.0-alpha.3

### (a) Replace `app.emit` with `tauri::ipc::Channel`

Verified in source: `Channel<TSend = InvokeResponseBody>`; `send(&self, data: TSend)`
requires `TSend: IpcResponse`; `Channel` implements `CommandArg` (a command parameter),
`Clone`, `Serialize`, and exposes `id()`. A blanket `impl<T: Serialize> IpcResponse`
serializes to JSON, so `Channel<Vec<u8>>` would send a JSON number array. For raw
bytes (arrives in JS as `ArrayBuffer`) use `tauri::ipc::Response`:

```rust
use tauri::ipc::{Channel, InvokeResponseBody, Response};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
enum ShellEvent { Exit { code: Option<u32> } }

// Option A: one typed JSON channel (simple; bytes become number arrays, slow for bulk).
// Option B (recommended): Channel<InvokeResponseBody>; send Raw for output, Json for exit.
#[tauri::command]
async fn aphrody_shell_open(
    sessions: State<'_, Sessions>,
    session: String, cols: u16, rows: u16, shell: Option<String>,
    on_output: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let cfg = PtyConfig { cols, rows, shell, ..PtyConfig::default() };
    let (tx, mut rx) = mpsc::channel(256);
    let pty = PtySession::spawn(&cfg, tx).map_err(|e| e.to_string())?;
    if let Some(old) = sessions.0.lock().await.insert(session, pty) { old.close().await; }
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            let sent = match ev {
                PtyEvent::Output(bytes) => on_output.send(InvokeResponseBody::Raw(bytes)),
                PtyEvent::Exit { code } => on_output.send(InvokeResponseBody::Json(
                    serde_json::json!({ "exit": code }).to_string())),
            };
            if sent.is_err() { break; }   // webview closed / channel dropped
        }
    });
    Ok(())
}
```

Notes: `InvokeResponseBody::{Json(String), Raw(Vec<u8>)}` exist (verified in the doc
example in `channel.rs`). `Response::new(Vec<u8>)` is the alternative for a
`Channel<Response>`. The `app: AppHandle<R>` and `Emitter` import become unnecessary;
the session id is no longer needed in the payload because each session owns its channel.
No permission change: the Channel rides the existing `invoke` of `aphrody_shell_open`
(`allow-aphrody-shell-open`). The unit test that listens for `aphrody-shell-output`
must instead build a Rust-side `Channel::new(|body| ...)` (documented in source: "consume
channel messages in Rust") and pass it as the argument.

JS side (v2 docs form; `Channel` import is `@aphrody/api/core`):

```ts
import { invoke, Channel } from '@aphrody/api/core';
const onOutput = new Channel<ArrayBuffer | { exit: number | null }>();
onOutput.onmessage = (m) => {
  if (m instanceof ArrayBuffer) term.ingest(new Uint8Array(m));
  else onExit(m.exit);
};
await invoke('plugin:aphrody-shell-tauri|aphrody_shell_open', { session, cols, rows, onOutput });
```

Global (no bundler): `const { invoke, Channel } = window.__TAURI__.core;` (Channel on
`core` is expected; verify in the e2e). Channel messages are ordered and queued per
webview; ordering is the reason to prefer it over events for terminal output.

### Plugin / permissions (unchanged, confirmed)

`tauri::plugin::Builder::new("name").setup(|app, _api| { app.manage(State); Ok(()) })
.invoke_handler(tauri::generate_handler![...]).build()`. `build.rs`:
`tauri_plugin::Builder::new(COMMANDS).build()` generates `allow-<cmd>` / `deny-<cmd>`
(underscores become dashes). `permissions/default.toml` groups them; the app capability
lists `"aphrody-shell-tauri:default"` (as in `crates/ui/app/capabilities/main.json`).
Plugin commands are invoked as `plugin:<plugin-name>|<command>`.

## 3. xterm.js and ghostty-web

xterm.js (`@xterm/xterm`, `@xterm/addon-fit`):

```ts
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
const term = new Terminal({ cursorBlink: true });
const fit = new FitAddon();
term.loadAddon(fit);
term.open(container);
fit.fit();
term.write(uint8Array);                 // write(data: string | Uint8Array, cb?)
term.onData((s: string) => send(s));    // user input, string
term.onResize(({ cols, rows }) => send(resizeFrame(cols, rows)));
```

ghostty-web (xterm.js-compatible API, Ghostty VT parser compiled to WASM):

```ts
import { init, Terminal, FitAddon } from 'ghostty-web';
await init();                           // loads WASM; idempotent; must precede new Terminal
const term = new Terminal({ fontSize: 14, scrollback: 10000, theme: { background: '#1e1e1e' } });
const fit = new FitAddon();
term.loadAddon(fit);
term.open(el);                          // throws if already open/disposed
fit.fit(); fit.observeResize();
term.onData((d) => ws.send(d));
term.onResize(({ cols, rows }) => ws.send(JSON.stringify({ type: 'resize', cols, rows })));
ws.onmessage = (e) => term.write(e.data);
```

Context7 did not state the `write` argument type for ghostty-web or how to override
the WASM URL passed to `init`; confirm in `lib/terminal.ts` before relying on
`Uint8Array` writes (the README only shows string data).

### (b) Rendering `WebTerminal` snapshots in a browser

Two distinct designs; do not combine them on one stream.

1. Our WASM `WebTerminal` is the emulator; the DOM view is a dumb renderer of
   `snapshot_json()` / `lines()` (use a `<pre>` or canvas; no xterm.js needed). Input
   comes from keyboard events; replies from `take_replies()` go back over the transport.
2. xterm.js or ghostty-web is the emulator and renders itself; `WebTerminal` is then
   redundant for display and only useful for headless snapshots (tests, agents). In
   Tauri this is why the plugin uses `PtySession::spawn` without native VT state: one
   emulator answers terminal queries.

Minimal snapshot loop (design 1): on each transport message call
`wt.ingest(bytes)`, forward `wt.take_replies()` to the PTY via the write command, then
re-render from `JSON.parse(wt.snapshot_json())` inside `requestAnimationFrame`
(coalesce multiple chunks per frame). Size changes: `wt.resize(cols, rows)` plus the
resize command/frame. Feeding an xterm.js instance from the same stream is only valid
if `WebTerminal` is not also answering queries (double replies).

## 4. brush-core embedding (UNVERIFIED, not in Context7)

From memory of the 0.3/0.4-era API; signatures changed between releases, so treat as
a sketch to check against the pinned source:

```rust
let mut shell = brush_core::Shell::builder()
    .no_profile(true).no_rc(true).interactive(false)
    .build().await?;                    // async builder; older: Shell::new(&CreateOptions{..}).await
let params = shell.default_exec_params();   // brush_core::ExecutionParameters (stdio via open files map)
let result = shell.run_string("echo hi", &params).await?;  // ExecutionResult: exit code
```

Custom stdio: set `ExecutionParameters` file descriptors (`set_fd(OpenFiles::STDOUT_FD,
OpenFile::...)`) to a pipe/`PipeWriter` whose reader feeds the terminal. In
`crates/shell/web`, note brush-core targets native std (processes, fs, tokio); it does
not build for `wasm32-unknown-unknown` without heavy feature gating, so a
wasm wrapper must either run it behind the Tauri/Bun backend or stay with the
existing `local.rs` WebShell. Verify wasm support before planning that wrap.

## 5. Bun backend

Bun.serve websocket (Context7, Bun main; repo canary is newer than the listed bun-v1.4.x):

```ts
const server = Bun.serve<{ id: string }>({
  fetch(req, server) {
    if (server.upgrade(req, { data: { id: crypto.randomUUID() } })) return;
    return new Response('ok');
  },
  websocket: {
    open(ws) {}, message(ws, msg) { /* string | Buffer */ }, close(ws) {},
  },
});
```

Bun.spawn with a PTY (types from `bun-types`): `terminal` option on `Bun.spawn`:

```ts
const proc = Bun.spawn(['bash'], {
  terminal: {
    cols: 80, rows: 24, name: 'xterm-256color',
    data: (t, chunk /* Uint8Array */) => ws.send(chunk),
    exit: (t, code, signal) => {},
    drain: (t) => {},
  },
});
proc.terminal!.write(input);      // string | BufferSource, returns bytes written
proc.terminal!.resize(cols, rows);
proc.terminal!.setRawMode(true);
proc.terminal!.close();           // also `await using`
await proc.exited;
```

Wire it to the existing protocol: binary ws frames -> `terminal.write`, text JSON
`{type:"resize"}` -> `terminal.resize`, `data` callback -> binary ws send.
Unix-only as documented in tests; check Windows support in the Bun canary before use.
