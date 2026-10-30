# Obscura headless browser (bun-obscura)

Bun OS ships a headless browser built on [Obscura](https://github.com/h4ckf0r0day/obscura)
(Apache-2.0, upstream release v0.2.5, merged main `3285fbc2357a`, 2026-10-28). It lives in its own
standalone repository, [`aphrody-labs/bun-obscura`](https://github.com/aphrody-labs/bun-obscura),
not in this tree, and has no dependency on Bun runtime internals.

## Where the code is

| Location | What it holds |
| --- | --- |
| `aphrody-labs/bun-obscura` (`main`) | 18 crates `bun_browser*` (dom, net, ssrf, js/V8, layout, render, browser, cdp, mcp, api, extract, crawl, detect, index, frames, service, engine, process) and the `bun-obscura` / `bun-obscura-worker` binaries |
| root `Cargo.toml`, `[patch.crates-io]` | pins every `bun_browser*` crate to a `bun-obscura` revision; it replaces the crates.io 1.4.7 releases for all workspace members |
| `[workspace.dependencies]` `obscura-dom`, `obscura-net` | aliases of `bun_browser_dom` / `bun_browser_net` (resolved through the patch) |
| `aphrody-labs/obscura` | public fork of the upstream, last synced 2026-10-11, superseded by the merge above |
| fork tag `final-fork-2026-10-29`, `src/browser/` | read-only origin of the snapshot (447 files) |

## Using it from unmodified Bun

```ts
const proc = Bun.spawn(["bun-obscura", "serve", "--port", "9222"]);
// poll http://127.0.0.1:9222/json/version, then open its webSocketDebuggerUrl with WebSocket (CDP)
await using view = new Bun.WebView({ backend: { type: "chrome", url: "ws://127.0.0.1:9222/devtools/browser" } });
```

`Bun.WebView` (upstream `docs/runtime/webview.mdx`) drives an installed Chrome, Edge or Brave. Obscura
adds a browser-free option: one binary with a Rust DOM, embedded V8, CPU layout and paint, Markdown
extraction, crawler, SSRF-guarded network and stealth TLS, which also runs where no Chrome is installed.
Verified 2026-10-29 with the npm canary 1.4.4 (`11c367163a4b`): `Bun.spawn` plus `WebSocket` navigates and
evaluates through CDP, and `Bun.WebView` with an explicit `url` connects and evaluates.

## Updating

Bump the `rev` of the `bun_browser*` entries under `[patch.crates-io]` after a push to `bun-obscura`
and run `cargo update -p bun_browser_service`. See `UPSTREAM.md` in that repository for the merge method.
