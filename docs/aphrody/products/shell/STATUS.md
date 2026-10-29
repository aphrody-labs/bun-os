<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shell, terminal and OS: consolidated status (2026-10-02)

Source of truth for what exists. Older plans and audits are kept as history and link here.
Evidence: repo read, native tests, wasm32 checks, a real Chrome run and a real Tauri webview run.
The combined [`check-all.sh`](../../../../scripts/aphrody/build/shell/check-all.sh) gate passed on 2026-10-02:
WASM release build, six Bun tests, TypeScript typecheck and real Tauri LOCAL/REMOTE markers.

## Layers

| Layer | Crate / package | State | Targets |
| --- | --- | --- | --- |
| VT state | `aphrody-terminal-core` (rio-vt 0.5.28) | real, tested | native, wasm32 |
| Session seam | `aphrody-shell-session` | real, tested; `LocalShell` implements it and `LocalEngine` creates sessions | native, wasm32 (checked) |
| Virtual FS | `aphrody-shell-vfs` (`MemVfs`, conformance) | real, tested; `LocalShell` uses it for cwd and file commands | native, wasm32 (checked) |
| OPFS VFS | `aphrody-shell-vfs-opfs` (`OpfsVfs`, shared image binding) + dedicated browser worker | two checksummed image slots; shared conformance and persistence across a reload pass in real Chromium | native tests, wasm32 release, Chromium |
| Web bindings | `aphrody-shell-web` (`WebTerminal`, `WebShell`, `LocalShell`) | T3: session/VFS engine, quoting, env expansion, history recall, cwd, globbing, pipes, redirects, conditionals and command registry; native tests and generated WASM smoke pass | wasm32 (built) |
| WASM utilities | `aphrody-shell-wasm-utils` | T7: 16 VFS-backed commands with declared `own` source; pinned uutils 0.12.0 golden fixtures pass; native and wasm32 checks pass | native, wasm32 |
| TS client | `@aphrody/shell-web` (WebSocket, Tauri Channel, OPFS worker, sandbox, local transports) | worker and sandbox paths pass Bun tests; OPFS worker passes real Chromium; authenticated reconnect retains the native PTY working directory in a live round trip | web |
| Desktop panel | `m3/packages/app-ui/src/ShellTerminalPanel.tsx` (not in repo) | Tauri, browser and hosted transport selection; xterm parses and renders raw bytes. Production build emits the worker and WASM. Browser DOM, screenshot and `echo panel-ok` round trip pass; full Tauri app checks, but the requested `aphrody_tauri_*` screenshot/DOM gate has not run | browser, Tauri source |
| PTY + WebSocket server | `aphrody-terminal-backend` (auth, Origin/Host, session/idle/frame/output limits) | named sessions survive a disconnect for 30 seconds with bounded buffered output; live reconnect and native tests pass | native only |
| Sandbox host, cloud sandbox | none | `aphrody-shell-sandbox-host` (`MockHost`, `LocalPtyHost`, E2B adapter) removed on 2026-10-09: no consumer | - |
| Tauri plugin | `aphrody-shell-tauri` (`open`, `open_channel`, `write`, `resize`, `close`) | real, tested, wired in `crates/ui/app` | native (Tauri 3 alpha.3) |
| Webview e2e | `aphrody-app` example `shell_e2e` + `bun run desktop:e2e` | CEF under Xvfb (X11); not re-run since the WebKitGTK→CEF migration | Linux |
| Nushell | `aphrody-nu` (nu 0.115.1) | real | native only; no upstream wasm32 target |
| TUI | `aphrody-tui` | real | native only |
| Systemd | `aphrody-systemd` | virtual DAG, journal, `sd_notify`; `start_unit`/`stop_unit` only flip state. Restart policy is parsed, not enforced. Real control only via `HostSystemdBackend` | native |

## Not built yet (wave B-D of the plan)

Live cloud adapter qualification (T12) and the Tauri screenshot/DOM gate for the UI panel (T13). The
[T9 Nushell wasm spike](../../research/shell/nushell-wasm.md)
passed compile checks but deferred browser integration.
Staying native on purpose: Nushell, TUI, PTY.

## Fact-check against upstreams

| Item | Finding | Consequence |
| --- | --- | --- |
| brush-core 0.5.0 / brush-parser 0.4.0 | compile for wasm32-unknown-unknown (scratch check); upstream only smoke-tests wasip2 | candidate engine behind `ShellEngine`; unproven in a browser |
| uutils | `uucore` and `uu_echo` 0.12.0 compile for wasm32; `uu_wc` 0.12.0 fails on `errno`. Their process stdout/filesystem entry points do not accept this shell's VFS/pipeline contract. | T7 uses small `own` implementations and records the source per command; no os-owner bump required. |
| Nushell | 0.116.0 parser, engine and command crates pass scratch wasm32 compile checks with default features off; browser execution and VFS integration remain unproven | keep native; stream output to the web terminal |
| xterm.js | 6.0.0, canvas renderer removed, write callback gives flow control | default renderer |
| ghostty-web | 0.4.0, no release since 2025-12 | optional renderer behind the same transport |
| Tauri | v2.12.1 stable; v3 alpha.4 (2026-10-01) drops `macos-private-api`; workspace mixes alpha.2/3/4 | align the Tauri family in one owner-led bump, then drop `macOSPrivateApi` in the e2e config |
| portable-pty | 0.9.0 exists; the 2026-09-27 desktop-PTY note says 0.9.0 breaks headless Windows clients (`ESC[6n`) | stay on 0.8 (kept; a 0.9 bump was tried natively and reverted) |
| getrandom | lock has 0.1, 0.2, 0.3, 0.4 | brush in wasm needs `--cfg getrandom_backend="wasm_js"` for 0.3 |
| Context7 | confirms Tauri v2 plugin/RunEvent/capability shapes and xterm `write` callback; no v3 alpha docs | verify v3 behaviour from crate source |
| `~/source` | `bun run sources` and `sync` (dry run): every managed pin is present and ok, nothing to sync | no change needed |

## Corrected in this pass

Stale paths in the terminal README and NUSHELL.md, broken NUSHELL links, backend line count, nu feature list,
DESKTOP-PTY.md (marked superseded), audit T-01 and T-05 (marked fixed).

## Known doc debt (not fixed here)

- `ARCHITECTURE.md` over-claims the systemd restart policy; `ARCHITECTURE-GAPS-STATUS.md` has stale script paths.
- About 25 os crates have no crate doc (systemd, proc, sandbox, jobs, kernel, search first).
- `docs/plans/os/native-runtime-yolo.md` is transient session state, not a plan.
- Duplicated `_source` / `patches` notes under products and reference; two terminal-design docs disagree on Rio.
- `aphrody-wsl` version is `1.0.0`, other os crates `1.0.0-canary`.
