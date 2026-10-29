<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-app — Aphrody Tauri desktop host

`aphrody-app` is the Tauri 3 (`tauri-runtime-cef`: CEF + tauri-winit + GTK 4) shell in the root Aphrody OS Cargo workspace.
It owns the native main window, a local app-server broker, the local kernel
subsystems and the desktop-only Drive bridge. The linked `aphrody-app-server`
runs inside the host process; the broker exchanges JSON-RPC through Tokio duplex
streams. The browser version talks to the same protocol over loopback HTTP/SSE.

The trusted main window's core commands include:

| Command                        | Returns                                           | Use                                         |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------- |
| `aphrody_meta()`               | `{ app_version, target_os, target_arch, family }` | header / about info                         |
| `aphrody_rpc(request)`         | JSON-RPC result                                   | app-server sessions, turns and interruption |
| `aphrody_shell_window(action)` | native window state                               | main-only window controls and navigation    |

The shell command takes its invoking `WebviewWindow`, accepts no target label and
rejects every label except `main`. Remote CEF previews have no capability and
cannot control desktop windows.

## Canonical runtime layout

`aphrody_runtime_layout` is the only desktop layout resolver. It materializes
Tauri's platform-specific application directories and exposes these child
directories under `app_data_dir`: `profiles/`, `assets/`, `binaries/` and
`sqlite/`. The UI, kernel clients, Bun packages and uv clients must use this
contract instead of creating `.aphrody`, repository-local databases or ad-hoc
sidecar directories. Tauri's `resource_dir` remains read-only packaged input;
runtime state is never written into the repository or bundle.

Existing SQLite databases and non-regenerable assets require an explicit,
checksum-preserving migration into this layout. The resolver intentionally does
not copy or delete them during startup.

## Runtime boundary

| Surface                 | Owner                         | Contract                                                                                 |
| ----------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| Agent sessions          | `aphrody-app-server`          | in-process broker; loopback HTTP/SSE for web clients                                     |
| Web tools               | Aphrody kernel                | `aphrody_web` Obscura/provider subsystem                                                 |
| Web retrieval and crawl | Aphrody kernel / Obscura      | backend capability; no embedded browser or crawler-management view in the public webview |
| File libraries          | Spacedrive `sd-daemon`          | local socket; daemon stays outside this Cargo graph                                      |

## Capability surface (default-deny)

`capabilities/main.json` is v2 default-deny: it grants only window and application
integration permissions to `main`; it grants no generic filesystem, shell execution,
HTTP or database plugin.
Domain routes use typed Rust commands or the local kernel/Drive RPC boundary; the
webview is not a general system API. The window loads only first-party assets.

Plugin rationale: `docs/tauri/plugins.md`. Integration design:
`docs/tauri/aphrody-integration.md`.

## Build, run and package on Windows

[`@aphrody/app-ui`](../../packages/app-ui/) is the sole frontend source package. Bun builds it to ignored
`ui-dist/` before Tauri packages the CEF shell. It reuses the canonical
`@aphrody/m3-theme/spaceui.css`, `@aphrody/m3-ai` and
`@aphrody/m3-primitives` surfaces. Material Symbols are copied from the one
local canonical font during this build.

`ui-dist/index.html`, `app.js`, `app.css` and the SVGs under `ui-dist/fonts/` are committed.
The binary assets of `ui-dist/fonts/` (webfonts, file-kind icons, sounds) are not: `build.rs`
copies them from their single canonical packages (`packages/m3-fonts`, whose
`fonts/upstream/material-symbols` also feeds aphrody-bun, and `packages/assets`) into `ui-dist/fonts/` before
`tauri::generate_context!()` embeds the directory, as listed in `ui-dist.manifest`. A clean
clone therefore builds with no staging command; `cargo test -p aphrody-app --test
ui_dist_assets` checks that every listed file is staged byte-for-byte and that every font
`app.css` loads is present. The shipped configuration (`--features custom-protocol`) fails the
build if a source is missing; a plain `cargo check` only warns.

The file service daemon is Spacedrive (`vendor/spacedrive`, Apache-2.0, see `docs/spacedrive/PROVENANCE.md`). `tauri.drive.conf.json` declares its `externalBin`; staging and packaged startup are open release gates.

```pwsh
bun install --frozen-lockfile
bun check packages/app-ui
bun scripts/aphrody/build/rust/cargo-serial.ts check -p aphrody-app
```

The same `bun run desktop:check|build|run|dev|bundle` entries serve Linux. They require the
Drive Cargo graph and the OS Cargo graph to compile on the host. They fail when the daemon
cannot be built, instead of delivering a desktop bundle with an empty Drive view.

The PowerShell helper clears any user-level Rust compiler wrapper. The Tauri
package command executes the same frontend build and does not load a CDN.
