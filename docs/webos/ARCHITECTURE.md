# WebOS architecture (ADR-003)

Status: accepted 2026-10-30. Supersedes ADR-001 and ADR-002 of the same day. Scope: https://aphrody.com.

## Decision

The aphrody.com WebOS site (a JavaScript desktop with 17 JS apps, a Cloudflare-Worker-shaped Bun service and TypeScript build scripts) was never the owner's choice. It is demolished without compatibility preservation. What replaces it: the Bun OS desktop in the browser, streamed from the Bun OS host, with everything in Rust.

Sessions (owner pivot, final): one session type. Bun OS is a single unified image (Android 17 as a native container, ChromiumOS components, COSMIC and Bun OS, one UI, no OS emulators or VMs). A WebOS session is a per-user container of that unified rootfs, COSMIC running in cage with Android inside it, streamed by the Rust gateway. The per-OS session types of the first drafts (Pop!_OS, Redox under QEMU, Android emulator, Googlebook, ChromiumOS VM, separate Wine and Proton sessions) are retired from `aphrody-webos-protocol` (version 2) and the server. The image is `factory/images/bunos-unified` (target `session` for WebOS, `unified` for the bootable disk); its layout and the session container contract (entrypoint `bunos-unified-session`, cage on `wayland-0`, nested cosmic-comp on `wayland-1`, gateway on 8794 inside the container network, private binderfs per session, signed-in users only) are in [`docs/UNIFIED-IMAGE.md`](../UNIFIED-IMAGE.md). Until the unified desktop streams, the session upstream is the Android gateway, the fallback path that sends H.264 for WebCodecs (`ServerEvent::Video`).

## What is removed

The JS shell, window manager and all JS apps (`apps/webos/src`), the Atlas, Store and Emulators JS UIs, `worker/` and `services/` (the Bun HTTP service), `wrangler.jsonc`, the TypeScript build and deploy scripts (`build*.ts`, `make.ts`, `deploy.ts`, `packages.ts`, `seo.ts`, `vm.ts`), `public/`, the tests of removed code, and the OPFS wasm of the shell (`crates/aphrody-webos-wasm`, `packages/webos-wasm`). Temporary exceptions, deleted by their owners as soon as the Rust ports land: `inventory.ts`, `store/`, `services/wayland.ts`, `contracts/` (type reference only).

Audit baseline of what was removed (2026-10-30): 14.5k lines of shell TypeScript, a 1.2 MB `main.js`, a 502 MB `dist/`, warm boot DOMContentLoaded 411 ms, 12 requests.

## Crates

| Crate                           | Kind                   | Owns                                                                                                                                                                                                                             |
| ------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crates/aphrody-webos-protocol` | lib (std and wasm32)   | The typed contract shared by server and client: OS catalog ids, session state, signalling, input, clipboard, audio and gamepad messages, health, API error shape. serde types, versioned. Replaces `contracts/`.                 |
| `crates/aphrody-webos-server`   | bin `aphrody-webos`    | One axum/tokio binary on 127.0.0.1:8790 behind nginx: static client assets, `/api/health`, auth, and the modules below.                                                                                                          |
| `crates/aphrody-webos-client`   | cdylib wasm32 + native | iced/libcosmic client (wasm32 with wgpu; native for in-session tools): OS picker, fullscreen stream, keyboard, pointer, gamepad, clipboard, session state. Only the wasm-bindgen glue and a one-line boot module are JavaScript. |

Server modules and owners:

| Module                            | Owner           | Content                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets`, `health`, `auth`, `log` | WebOS architect | Static client files with immutable caching and CSP; `/api/health` with checks; session tokens (scheme of `crates/aphrody-remote-desktop` tokens); one JSON log line per request.                                                                                                                                                                                                                        |
| `sessions`                        | session agent   | Session manager over the Docker Engine API (bollard): one container of the unified Bun OS rootfs per user (COSMIC in cage, Android inside it), cgroup limits, lifecycle, idle reaping. Until it lands the server bridges one declared stream (`WEBOS_SESSION`, `_MODE=native` for protocol-native upstreams, `_TOKEN_FILE`); `GET /api/session`, `POST /api/sessions`, `GET /api/sessions/{id}/stream`. |
| `gateway`                         | session agent   | Streaming: WebRTC (webrtc-rs) with H.264/Opus from the container (GStreamer pipeline of `packages/bun-gamestream` ported with gstreamer-rs), WebSocket with WebCodecs-decodable frames as fallback; input, clipboard, audio and gamepad channels. Based on `crates/aphrody-remote-desktop` (axum, protocol, tokens).                                                                                    |
| `repos`                           | store agent     | Package repositories API (`/api/store`, pacman, flatpak, npm, cargo, apk) ported from `apps/webos/store`.                                                                                                                                                                                                                                                                                               |
| `inventory`                       | inventory agent | `/api/inventory` and `/api/rpc` ported from `apps/webos/inventory.ts`.                                                                                                                                                                                                                                                                                                                                  |

Wine, Proton and gaming input live inside the unified image (emulators agent); native app packaging in the image belongs to the native-apps agent.

## Client UI decision

Owner decision (overrides the first web-sys draft): the client is an iced application themed with our libcosmic fork (`aphrody-labs/libcosmic`, pinned by revision; its `iced` submodule is our iced fork), compiled to wasm32 with the wgpu backend (WebGPU, WebGL2 fallback). The same codebase compiles natively for the in-session tools (OS picker, session switcher, settings panes, store front extensions). The browser is used only as transport (fetch, WebSocket, Gamepad API, clipboard) in `web.rs`; no hand-built DOM UI and no JavaScript UI. Known costs and the patches they call for in our forks: the wasm bundle is several megabytes (the 300 KB budget becomes 3 MB gzip for the client), frames of the fallback path are decoded in Rust until a custom wgpu video widget fed by WebCodecs frames lands, and wasm clipboard, fullscreen and gamepad integration are patched into the iced winit shell as needed.

## Web content engines

| Engine                                                                   | What it is                                                          | Role in Bun OS                                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Servo (fork `aphrody-labs/servo`, 0.7+)                                  | Embeddable browser engine in pure Rust; lighter, compatibility gaps | Primary embedded engine: an iced/libcosmic widget rendering offscreen into a wgpu texture.                      |
| cef-rs (`vendor/cef-rs`, CEF 156)                                        | Embeddable full Chromium from Rust, offscreen rendering             | Compatibility fallback widget for sites Servo cannot render.                                                    |
| Tauri v3 (`vendor/tauri`, fork on the v3 branch, `tauri-v3.0.0-alpha.5`) | App framework for web frontends, alpha, CEF runtime                 | Apps with web frontends, including `apps/aphrody-app` migrated to v3; a Servo runtime is pushed where possible. |
| Helium (fork)                                                            | Full Chromium browser product, not embeddable                       | The user-facing browser inside sessions.                                                                        |

## Source rule

COSMIC, Redox, Rio, nushell, Obscura and every product component are pinned, patched forks built from source on the VPS (serialized Cargo wrapper) and shipped through the Bun OS repositories; nothing is installed from distribution or upstream binaries. Build graph: fork (pinned revision) -> patch -> build -> package (pacman/apt/flatpak/apk repositories of `crates/aphrody-webos-repos`) -> session image (`factory/images/*`) -> session container.

## Capture and input

Inside each session container a per-session `aphrody-remote-desktop` process (session agent) captures the compositor with wlr-screencopy over shm and injects input with wlr-virtual-pointer and zwp-virtual-keyboard (pure Rust, wayland-client); the Android path (feature `android`) streams scrcpy H.264 framed as `[kind u8][pts u64 BE][Annex B]` and speaks the client protocol natively. Whether cosmic-comp exposes wlr-screencopy or only ext-image-copy-capture is to be verified; the second capture path is added if needed.

## Rules

- Rust only for product code. The client has no hand-written JavaScript beyond the wasm-bindgen bootstrap. No Bun service, no Cloudflare Worker.
- One contract: every message crossing the wire is a type in `aphrody-webos-protocol`; server and client both depend on it.
- Builds run on the VPS through the serialized Cargo wrapper (`scripts/aphrody/build/rust/cargo-serial.sh`, at most four jobs); the client is built for `wasm32-unknown-unknown`, then `wasm-bindgen --target web` and `wasm-opt -Oz`.
- Deploy: an atomic release directory (`aphrody-webos` binary, `client/` assets, `receipt.json` with sha256), a systemd unit `aphrody-webos.service` running the Rust binary, the root activator flips `current`, gates on `/api/health` (matching `sourceCommit`) and rolls back on failure. nginx keeps `aphrody.com` on 8790.
- Until the client and gateway are complete, the server serves a minimal Rust-rendered page at `/` (no JavaScript desktop).
- Budgets: client wasm at most 3 MB gzip (iced, wgpu); first frame under 2 s after picking an OS on a warm host; input to photon under 80 ms in region.
- Security: CSP `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'`, per-session bearer tokens, signed release receipts. Session containers get only the capabilities Android needs (listed in `docs/UNIFIED-IMAGE.md`), a read-only rootfs, no host network and no-new-privileges, and are created only for signed-in users.

## Stages

1. ADR-003, protocol crate, server crate with assets, health, auth, placeholder page; deploy it in place of the Bun service (removes the JS site from production).
2. Rust client: picker, WebSocket stream and input against the gateway.
3. Sessions over Docker and the WebRTC gateway (session agent); repos and inventory ports (store and inventory agents).
4. Delete the temporary TypeScript exceptions.

## Assets reused and dead ends

Reused: `crates/aphrody-remote-desktop` (axum JPEG-over-WS gateway, protocol, tokens), `packages/bun-gamestream` (proven WebRTC on the VPS: GStreamer webrtcbin, x264 and Opus, input data channel), `factory/images/bunos-omarchy` (Omarchy rootfs, headless Hyprland and wayvnc), `container/` (COSMIC packages). Dead ends: c2w Omarchy is terminal-only; the wasmos compositor is a toy; nested Hyprland in WSLg is impossible; `aphrody-desktop-xvfb` is X11 only; the fork-only bun:cosmic, bun-webview-core and bun-chromium repos are abandoned.
