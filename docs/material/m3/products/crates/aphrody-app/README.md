<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-app — Aphrody Tauri desktop host

`aphrody-app` is the Tauri v2/Wry shell in the root Aphrody OS Cargo workspace.
It owns the native main window, a local app-server broker, the local kernel
subsystems and the desktop-only Drive bridge. The agent remains out of process:
the broker starts `aphrody app-server` and speaks JSON-RPC over stdio.

The trusted main window's core commands include:

| Command | Returns | Use |
|---|---|---|
| `aphrody_meta()` | `{ app_version, target_os, target_arch, family }` | header / about info |
| `aphrody_rpc(request)` | JSON-RPC result | app-server v2 sessions, turns and interruption |
| `aphrody_shell_window(action)` | native window state | main-only window controls and navigation |

Shenron's public, read-only grounded chat is available in the existing Chat
surface with `/shenron <question>`. Its typed `aphrody_shenron_chat` command calls
only `https://dragonballfr.com/api/chat`; it accepts no arbitrary URL or token.
It does not represent an authenticated Shenron account or grant admin access.
See [`../../docs/integrations/SHENRON.md`](../../../reference/integrations/SHENRON.md)
for the API, FFI, auth, and database ownership decisions.

The main window also exposes `koharu_rpc(method, params)`. Its broker starts the
`koharu-sdk` executable from the `aphrody-koharu` sibling checkout on demand,
passes JSON Lines requests over stdio, and emits SDK events as `koharu://event`.
The method must exist in the SDK; this is not a shell execution API. The SDK owns
its Rust model, project, and processing dependencies in its own Cargo workspace,
so Tauri v2 never links Koharu's Tauri 3 alpha desktop runtime. The existing
log, single-instance, window-state, opener, and process plugins already cover
Koharu's plugin set. `aphrody-ops tauri` stages the SDK as a target-suffixed
`externalBin`; `KOHARU_SDK_SIDECAR_SOURCE` may point to a prebuilt binary during
packaging, and `KOHARU_SDK_BIN` overrides resolution at runtime. A packaged SDK
binary and successful IPC compilation do not establish an integrated editor
route or visual behavior.

The shell command takes its invoking `WebviewWindow`, accepts no target label and
rejects every label except `main`. Remote Wry previews have no capability and
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

| Surface | Owner | Contract |
|---|---|---|
| Agent sessions | `aphrody app-server` | broker-managed stdio JSON-RPC |
| Web tools | Aphrody kernel | `aphrody_web` Obscura/provider subsystem |
| Web retrieval and crawl | Aphrody kernel / Obscura | backend capability; no embedded browser or crawler-management view in the public webview |
| File libraries | Spacedrive `sd-daemon` | local socket; daemon stays outside this Cargo graph |

## Capability surface (default-deny)

`capabilities/main.json` is v2 default-deny: it grants only window and application
integration permissions to `main`; it grants no generic filesystem, shell execution,
HTTP or database plugin.
Domain routes use typed Rust commands or the local kernel/Drive RPC boundary; the
webview is not a general system API. The window loads only first-party assets.

Plugin rationale: `docs/reference/ui/tauri/plugins.md`. Integration design:
`docs/reference/ui/tauri/aphrody-integration.md`.

## Build, run and package on Windows

`packages/app-ui/` is the sole frontend source package. Bun builds it to ignored
`ui-dist/` before Tauri packages the Wry shell. It reuses the canonical
`@aphrody/m3-theme/spaceui.css`, `@aphrody/m3-ai` and
`@aphrody/m3-primitives` surfaces. Material Symbols are copied from the one
local canonical font during this build.

`ui-dist/index.html`, `app.js`, `app.css` and the SVGs under `ui-dist/fonts/` are committed.
The binary assets of `ui-dist/fonts/` (webfonts, file-kind icons, sounds) are not: `build.rs`
copies them from their single canonical packages (`packages/m3-fonts`,
`crates/ui/bun/icons/material-symbols`, `packages/assets`) into `ui-dist/fonts/` before
`tauri::generate_context!()` embeds the directory, as listed in `ui-dist.manifest`. A clean
clone therefore builds with no staging command; `cargo test -p aphrody-app --test
ui_dist_assets` checks that every listed file is staged byte-for-byte and that every font
`app.css` loads is present. The shipped configuration (`--features custom-protocol`) fails the
build if a source is missing; a plain `cargo check` only warns.

The file service daemon is Spacedrive (`vendor/spacedrive`). The checked-in `tauri.drive.conf.json` declares no daemon sidecar until it is staged; treat sidecar packaging and installed startup as open gates.

The supported serialized Cargo entry point is
`bun scripts/aphrody/build/rust/cargo-serial.ts`; qualification must run through the VPS factory.
Keep a single cross-platform package command as an open delivery requirement until it bundles and
launches `sd-daemon` with the same App UI on Windows and Linux.
