# WebOS architecture (ADR-003)

Status: accepted 2026-10-30. Supersedes ADR-001 and ADR-002 of the same day. Scope: https://aphrody.com.

## Decision

The aphrody.com WebOS site (a JavaScript desktop with 17 JS apps, a Cloudflare-Worker-shaped Bun service and TypeScript build scripts) was never the owner's choice. It is demolished without compatibility preservation. What replaces it: real operating systems in the browser (Arch Linux, Alpine, Android, Wine and Proton), streamed from containers on the Bun OS host, with everything in Rust.

## What is removed

The JS shell, window manager and all JS apps (`apps/webos/src`), the Atlas, Store and Emulators JS UIs, `worker/` and `services/` (the Bun HTTP service), `wrangler.jsonc`, the TypeScript build and deploy scripts (`build*.ts`, `make.ts`, `deploy.ts`, `packages.ts`, `seo.ts`, `vm.ts`), `public/`, the tests of removed code, and the OPFS wasm of the shell (`crates/aphrody-webos-wasm`, `packages/webos-wasm`). Temporary exceptions, deleted by their owners as soon as the Rust ports land: `inventory.ts`, `store/`, `services/wayland.ts`, `contracts/` (type reference only).

Audit baseline of what was removed (2026-10-30): 14.5k lines of shell TypeScript, a 1.2 MB `main.js`, a 502 MB `dist/`, warm boot DOMContentLoaded 411 ms, 12 requests.

## Crates

| Crate | Kind | Owns |
| --- | --- | --- |
| `crates/aphrody-webos-protocol` | lib (std and wasm32) | The typed contract shared by server and client: OS catalog ids, session state, signalling, input, clipboard, audio and gamepad messages, health, API error shape. serde types, versioned. Replaces `contracts/`. |
| `crates/aphrody-webos-server` | bin `aphrody-webos` | One axum/tokio binary on 127.0.0.1:8790 behind nginx: static client assets, `/api/health`, auth, and the modules below. |
| `crates/aphrody-webos-client` | cdylib wasm32 | The thin client in Rust (wasm-bindgen, web-sys; no JS framework, only the glue wasm-bindgen emits and a minimal bootstrap HTML): OS picker, fullscreen stream, keyboard, pointer, gamepad, clipboard, audio, session state and reconnect. |

Server modules and owners:

| Module | Owner | Content |
| --- | --- | --- |
| `assets`, `health`, `auth`, `log` | WebOS architect | Static client files with immutable caching and CSP; `/api/health` with checks; session tokens (scheme of `crates/aphrody-remote-desktop` tokens); one JSON log line per request. |
| `sessions` | session agent | Session manager over the Docker Engine API (bollard): one container per user session from the OS images (Arch, Alpine, Android via Waydroid/redroid, Wine, Proton), cgroup limits, lifecycle, idle reaping. |
| `gateway` | session agent | Streaming: WebRTC (webrtc-rs) with H.264/Opus from the container (GStreamer pipeline of `packages/bun-gamestream` ported with gstreamer-rs), WebSocket with WebCodecs-decodable frames as fallback; input, clipboard, audio and gamepad channels. Based on `crates/aphrody-remote-desktop` (axum, protocol, tokens). |
| `repos` | store agent | Package repositories API (`/api/store`, pacman, flatpak, npm, cargo, apk) ported from `apps/webos/store`. |
| `inventory` | inventory agent | `/api/inventory` and `/api/rpc` ported from `apps/webos/inventory.ts`. |

Wine and Proton images and gaming input belong to the emulators agent; native app packaging in the images belongs to the native-apps agent.

## Rules

- Rust only for product code. The client has no hand-written JavaScript beyond the wasm-bindgen bootstrap. No Bun service, no Cloudflare Worker.
- One contract: every message crossing the wire is a type in `aphrody-webos-protocol`; server and client both depend on it.
- Builds run on the VPS through the serialized Cargo wrapper (`scripts/aphrody/build/rust/cargo-serial.sh`, at most four jobs); the client is built for `wasm32-unknown-unknown`, then `wasm-bindgen --target web` and `wasm-opt -Oz`.
- Deploy: an atomic release directory (`aphrody-webos` binary, `client/` assets, `receipt.json` with sha256), a systemd unit `aphrody-webos.service` running the Rust binary, the root activator flips `current`, gates on `/api/health` (matching `sourceCommit`) and rolls back on failure. nginx keeps `aphrody.com` on 8790.
- Until the client and gateway are complete, the server serves a minimal Rust-rendered page at `/` (no JavaScript desktop).
- Budgets: client wasm at most 300 KB gzip; first frame under 2 s after picking an OS on a warm host; input to photon under 80 ms in region.
- Security: CSP `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'`, per-session bearer tokens, containers without host privileges, signed release receipts.

## Stages

1. ADR-003, protocol crate, server crate with assets, health, auth, placeholder page; deploy it in place of the Bun service (removes the JS site from production).
2. Rust client: picker, WebSocket stream and input against the gateway.
3. Sessions over Docker and the WebRTC gateway (session agent); repos and inventory ports (store and inventory agents).
4. Delete the temporary TypeScript exceptions.

## Assets reused and dead ends

Reused: `crates/aphrody-remote-desktop` (axum JPEG-over-WS gateway, protocol, tokens), `packages/bun-gamestream` (proven WebRTC on the VPS: GStreamer webrtcbin, x264 and Opus, input data channel), `factory/images/bunos-omarchy` (Omarchy rootfs, headless Hyprland and wayvnc), `container/` (COSMIC packages). Dead ends: c2w Omarchy is terminal-only; the wasmos compositor is a toy; nested Hyprland in WSLg is impossible; `aphrody-desktop-xvfb` is X11 only; the fork-only bun:cosmic, bun-webview-core and bun-chromium repos are abandoned.
