> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Desktop and web engines: Obscura, Tauri/CEF and browser automation

> Qualification du 2026-10-09 : les owners IA retirés du checkout sont signalés « not in repo ». Les constats datés ci-dessous ne prouvent pas leur présence ou leur fonctionnement actuel.

Canonical plan, consolidated on 2026-10-09. It replaces the former `tauri-cef` plan, the superseded in-process
Tauri plan, the "Playwright killer" plan, the `bxc-bridge` plan, the `@aphrody/bxc-test` package plan and the
roadmap parts of the Obscura reference notes (all in Git history). Exhaustive record of the wry/tao/GTK 3 removal
and of the 2026-10-09 cut: [INVENTORY.md](INVENTORY.md). Decision of record for the cut:
[D28](../../decisions/runtime/DECISIONS.md). Dated evidence lives in [MEMORY.md](../../MEMORY.md).

## Scope and owners

| Surface                     | Owner (verified 2026-10-09)                                                                                                                                                                                                                                          |
| :-------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop app                 | `crates/ui/app` (`aphrody-app`), one runtime `tauri-runtime-cef` (`crates/tauri/aphrody-tauri-runtime-cef`, `cef =152.3.0`)                                                                                                                                          |
| Vendored Tauri              | `crates/tauri/*`: core, CLI, bundler, `aphrody-create-tauri-app`, and the 15 plugins the app registers (single-instance, deep-link, window-state, os, process, dialog, clipboard-manager, notification, global-shortcut, log, store, opener, fs, autostart, updater) |
| Desktop debug bridge        | `crates/ui/tauri-plugin-mcp-bridge` (CDP capture `src/screenshot/cef.rs`), host plugin `crates/ui/tauri-wrap` feature `debug-bridge`, Bun client `@aphrody/agent-browser/tauri`; guide [TAURI-DEBUG](../../guides/web/TAURI-DEBUG.md)                                |
| Headless engine             | `crates/web/obscura*` (facade `obscura` features `api`/`stealth`/`render`; `obscura-browser`, `-cdp`, `-dom`, `-js` on `deno_core 0.412`/V8, `-net`, `-render`, `-ssrf`, `-mcp` library)                                                                             |
| MCP exposure                | the single `aphrody-mcp` (`aphrody_browser_*`, `aphrody_tauri_*`); no standalone Obscura binary (D28)                                                                                                                                                                |
| Rust CLI                    | `aphrody web` (`crates/infra/aphrody-command/src/pillars_cmd/web.rs`: fetch, scrape, recon, extract, browser, crawl…)                                                                                                                                                |
| Playwright-compatible tests | `@aphrody/web-test` (`packages/web/aphrody-web-test`) over the Obscura CDP server; `@aphrody/agent-browser`                                                                                                                                                          |
| Scaffolds                   | `m3/packages/scaffold`, `m3/packages/web-to-tauri` (engine `cef` only)                                                                                                                                                                                               |

Obscura reference (feature inventory, CDP domains, MCP schemas, local fork differences):
[obscura-integration-spec](../../reference/web/web/obscura-integration-spec.md) and
[aphrody-obscura](../../reference/web/crates/aphrody-obscura/OBSCURA-UPSTREAM.txt).

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                    | Where                                                                                     |
| :-- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------- |
| 1   | One desktop runtime, `tauri-runtime-cef` (CEF + `tauri-winit` + GTK 4); owner order 2026-10-05, plan decision 21, reversing decision 20. Removed: `aphrody-wry`, `aphrody-tao`, `aphrody-tao-macros`, `aphrody-tauri-runtime-wry`, `aphrody-tauri-driver`, their sources and workspace dependencies.                                                                                        | `crates/tauri`, `Cargo.toml`, `vendor.toml`                                               |
| 2   | GTK 3 is out of the graph (`gtk3`, `gtk 0.18`, `linux-libappindicator` gone; dialog defaults to `xdg-portal`; tray on `ksni`). Acceptance: `cargo tree -i gtk@0.18.2 --target x86_64-unknown-linux-gnu` finds nothing.                                                                                                                                                                      | `vendor.toml`, `crates/ui/tauri-plugin-mcp-bridge`                                        |
| 3   | No WebDriver. CEF is driven over CDP; the debug bridge captures with `Page.captureScreenshot`, one observer per webview.                                                                                                                                                                                                                                                                    | `crates/ui/tauri-plugin-mcp-bridge/src/screenshot/cef.rs`                                 |
| 4   | `aphrody-app` and its runtime host build their CEF profile in one module: sandbox `Auto` (`APHRODY_CEF_UNSAFE_NO_SANDBOX=1` for CI images), DevTools off unless `APHRODY_CEF_REMOTE_DEBUGGING_PORT` names a loopback port, `accept_language_list` `fr-FR,fr,en-US,en`, no `locale`, one throwaway profile per runtime-host session; `main` carries `#[tauri_runtime_cef::cef_entry_point]`. | `crates/ui/app/src/cef.rs`, `main.rs`, `runtime_host.rs`                                  |
| 5   | Linux idle CPU fix (tauri-apps/tauri#16189) applied to the vendored runtime as a patch with provenance in `tools/config/upstream-sources.json` and `tools/config/tauri-upstream.json`; drop it when upstream merges.                                                                                                                                                                        | `patches/tauri-runtime-cef-3.0.0-alpha.5-glib-work-source.patch`                          |
| 6   | Hidden windows never flash (#16205): `visible: false` windows are created parked at (-32000, -32000), revealed by `parking::reveal`, kept off the window-state plugin; hidden once loaded, off the event-loop thread.                                                                                                                                                                       | `crates/ui/app/src/parking.rs`, `integration.rs`                                          |
| 7   | `libcef.so` is the first `DT_NEEDED` entry of `aphrody-app` (Chromium resolves libc through `dlsym(RTLD_NEXT)` from libcef).                                                                                                                                                                                                                                                                | `crates/ui/app/build.rs`                                                                  |
| 8   | Ship deb and rpm (setuid `chrome-sandbox`); no AppImage (#16204). Linux bundles carry the `fr` locale paks.                                                                                                                                                                                                                                                                                 | `crates/ui/app/tauri.conf.json`, `aphrody-tauri-bundler`                                  |
| 9   | Scaffolds produce CEF apps only; no mobile scaffolding (CEF has no mobile). The upstream examples are not vendored (D28).                                                                                                                                                                                                                                                                   | `bun/packages/bun-tauri/crates/aphrody-tauri-cli`, `aphrody-create-tauri-app`, `m3/packages`               |
| 10  | Only the 15 plugins `crates/ui/app` registers stay vendored; server-side capabilities (http, websocket, upload, shell, cli, sql, stronghold) belong to Bun and Yolo (D28).                                                                                                                                                                                                                  | `vendor.toml`, [INVENTORY §H](INVENTORY.md#h-unification-cut-2026-10-09)                  |
| 11  | The Bun fork declares no Tauri or Obscura API until a runtime binding backs it (`Bun.tauri` types removed, fork `491b447cc7f`) (D28).                                                                                                                                                                                                                                                       | `aphrody-labs/bun`                                                                        |
| 12  | Obscura is an in-process library family, not an external binary facade (the 2026-05 "binary facade" recommendation is superseded). It is served through the one `aphrody-mcp`; `obscura-ssrf` stays separate so the paint path keeps its synchronous fetch (D28). `render` is optional and `stealth` implies it.                                                                            | `crates/web/obscura*`                                                                     |
| 13  | Browser automation is Rust: the Bun "Aphrody Web" engine (Zig DOM, Lightpanda, `src/cdp/**` TS server, `bxc_rust_bridge` cdylib) is gone; HTML to Markdown runs in-process through `aphrody-web-extract`, and `@aphrody/web-test` drives the Obscura CDP server.                                                                                                                            | `crates/web`, `crates/ai/tools/src/builtin/web_fetch.rs` (not in repo), `packages/web/aphrody-web-test` |

## Accepted limits

- Linux windows are GTK 4 over X11 or XWayland (`--ozone-platform=x11`, `GDK_BACKEND=x11`); native Wayland is not
  promised; fractional scaling under XWayland is unmeasured.
- Windows runs without the Chromium sandbox (Chromium M138+ needs a broker only a Chromium-toolchain binary creates).
  Remote pages stay in dedicated webviews with the navigation allowlist; Windows builds must not claim sandboxing.
- Transparent frameless windows (pet, widget, quickbar) are unqualified on Linux CEF (#15718).
- CEF weighs about 1 GB of distribution per platform; levers are the idle fix, on-demand windows and Alloy style for
  auxiliary windows (the last two unmeasured).
- `dbfr` has no GTK 4 development libraries and stays refused for desktop packages; the VPS builds them with
  `CEF_PATH=/srv/aphrody-build/cache/cef`.
- CEF keeps its own GPU process for page WebGPU; the process-wide GPU hub cannot merge it.
- The Obscura CDP server implements a subset of Chrome domains; unlisted commands are no-ops or `-32601`.

## Open items

Desktop (Tauri/CEF):

1. Bump `cef` 152.3.0 to 154 behind an e2e gate (Playwright or `@aphrody/web-test` over the CEF remote-debugging
   port); the gate does not exist yet.
2. Qualify transparent windows, HTML5 drag and drop (#16131), title-bar drag on X11 (#14936) and hardware WebGPU
   (#16203) on a real X11 desktop and under XWayland.
3. Owner decision: a third-party patched CEF binary for transparency on Windows and macOS (supply-chain choice).
4. The v1/v2 `migrate` code of `aphrody-tauri-cli` (`src/migrate/migrations`) still emits the upstream wry runtime
   for third-party projects.
5. Re-run `yolo import --check` where the `vendor/*` checkouts exist.
6. Debug bridge: compile `aphrody-tauri-wrap --features debug-bridge`, drive a live window and record the output;
   run the bridge `security_tests`. The CEF capture backend is compiled on Linux only.
7. Give `aphrody_tauri_*` in `aphrody-mcp` a backend that reads the bridge discovery files (today they forward to the
   per-user kernel only).
8. GPU: `aphrody-tauri-plugin-gpu` exposing `gpu_info`/`gpu_wgsl`/`gpu_cuda` on the hub of
   [the GPU plan](../gpu-hub/PLAN.md) (not created; needs a CEF-capable build host; page access behind capabilities).

Obscura and browser automation:

9. Obscura `navigator.gpu`: `deno_webgpu 0.226` matches `deno_core 0.412` but pins wgpu-core 29.0.1 while the hub is
   wgpu 30.0.1. Port it to wgpu 30 as an integrated patch under `crates/web/obscura-js` with provenance, share the hub
   device, gate it per context, apply `apply_limit_buckets` for remote pages.
10. Engine choice (V8 today, JSC seam to write) follows the runtime fusion plan; no Obscura engine swap before parity.
11. [x] Exit-code contract for `aphrody web` (fetch, scrape, recon): empty output fails; stdout contains result content only; requested and obtained profiles are reported. Verified 2026-10-11 by `cargo-serial.ts --msvc nextest run --locked -p aphrody-web-service -p aphrody --test web_cli_contract` (5 passed).
12. Playwright parity for `@aphrody/web-test`: actionability checks need layout, so visibility stays "adapted"
    (attribute and style based) until the `render` feature backs `DOM.getBoxModel`; semantic `getByRole` maps to CSS,
    not to a full ARIA tree.
13. TLS impersonation (`stealth`, `wreq`) prefixes BoringSSL symbols on Linux and Android only; qualify it on Windows
    before claiming parity. HTTP/3 is absent from `obscura-net`.
