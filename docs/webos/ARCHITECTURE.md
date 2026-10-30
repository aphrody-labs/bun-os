# WebOS architecture (ADR-001, amended by ADR-002)

Status: accepted 2026-10-30; section 2 onward superseded the same day by ADR-002 (native desktop, thin client). Scope: `apps/webos`, served at https://aphrody.com. Repository docs only: WebOS does not serve documentation.

## 1. Audit (2026-10-30, commit 7624729916 deployed)

| Area | Finding |
| --- | --- |
| Languages | TypeScript (about 14.5k lines in `src/`, 1.2k in `worker/`, 1.5k in `store/`, 5k in root build/deploy scripts), Rust crate `aphrody-webos-wasm` compiled to WASM (OPFS file system, shell, Alpine guest), plus the shared `packages/webos-wasm` glue. No UI framework: DOM helper `h()`, Material Web components, M3 CSS. |
| UI frameworks in the tree | Shell: vanilla TS. Rich apps: React 19 `packages/app-ui` (mounted as an iframe at `/workspace/*`). |
| Backend | `serve.ts` is a Bun HTTP host (port 8790, behind nginx) that wraps `worker/index.ts`, a Cloudflare-Worker-shaped fetch handler with fake `ASSETS` and `VM` (R2) bindings. There is no separate Rust HTTP service for WebOS: the Rust part is the WASM module. The Cloudflare Worker (`wrangler.jsonc`) duplicates the same handler for `*.aphrody.app` hosts. |
| Build chain | `build-product.ts` -> `packages/app-ui/build.ts` + `build.ts` -> `build-craft.ts`, `build-wasm.ts`, `packages.ts`, `seo.ts`, `vm.ts`, `workspace.ts`, `games-content.ts`, `wasm-modules.ts`, `inventory.ts`. Sequential, no content-hash cache, one `Bun.build` call, `splitting: false`. |
| Bundle | `main.js` 1.2 MB minified in one file (all 17 apps, CodeMirror, settings 2.2k lines, atlas, store). `dist/` 502 MB (VM image, engine, games). Warm boot DCL 411 ms, load 421 ms, 12 requests. |
| Shell and apps | `src/main.ts` 1985 lines holds a `builtins[]` table with an ad-hoc `Builtin` (backing `wasm|app-ui|api|browser`) plus launcher, dock, boot, shortcuts, routing. 17 desktop apps; `settings.ts` 2205 and `files.ts` 1114 are the largest modules. Window manager `src/wm.ts` (tile and float, 10 workspaces) is sound and tested. |
| Inventory | `inventory.ts` (1151 lines) generates `/api/inventory`, `/api/rpc` (JSON-RPC) and the Atlas data, 1941 members; `deploy.ts` runs the coverage gate on the release. |
| Store | `store/` (npm, cargo, pacman, flatpak, apk catalogs) plus `src/apps/appstore.ts` (569 lines, vanilla). |
| Deploy | `deploy.ts` builds an immutable release under `build/webos-deploy/releases`, writes `receipt.json` with sha256 of every file, keeps four releases; a root-owned activator flips `~/apps/webos/current` and writes `deployment.json`. The root-owned activator (`infra/config/host/libexec/aphrody-webos-activate.ts`) verifies the receipt and ancestry, flips the symlink, restarts the service and gates on `/api/health` (matching `sourceCommit`) plus public routes. `/api/health` now returns 503 when assets or inventory are missing and the service logs one JSON line per API request (`contracts/api.ts`). |
| Tests | 16 test files (wm, tile, files, editor, terminal keys, pkg, markdown, fend, isolation, inventory, workspace, assistant). No browser e2e in the repository flow, no coverage gate on `backing`. |
| Layering | Good: `src/` never imports `worker/`; `worker/` imports only `src/config` and `src/inventory-kinds`. Violations: `src/apps/appstore` reaches `../../store/types` (server catalog types) and the root has 30 loose scripts mixing build, server and data. |
| Type safety | `strict` through `tsconfig.base.json`; 27 `any`, 0 `ts-ignore`. Client and server share no API types: `/api/*` responses are cast on both sides. |
| Dead or duplicated | Cloudflare Worker deploy path (still wired in `package.json` `dev` script and `wrangler.jsonc`), two `Builtin`/`CatalogApp`/`MemberConfig` app models, three inventory kind tables, `win11/` is an in-flight import (zstd/format helpers, unreferenced). |

## 2. ADR-002: native desktop, thin browser client (supersedes the first draft)

Owner decision 2026-10-30: the desktop is a real Hyprland and Omarchy session running COSMIC and other native apps on the Bun OS host, streamed to the browser. The JavaScript desktop (shell, window manager, dock, 17 JS apps) is retired after the cutover is verified. The audit in section 1 is the baseline for what is removed and what is kept.

### Layers

| # | Layer | Owner | Technology |
| --- | --- | --- | --- |
| 1 | Native session layer | Hyprland session agent | Hyprland (headless Wayland) with the Omarchy configuration, COSMIC apps (Files, Terminal, Edit, Store, Settings, Player, Calculator), Rio, Spacedrive, Craft; one session per user as a systemd user unit inside a cgroup slice (CPU, memory, pids limits), per-user home and runtime dir. |
| 2 | Streaming gateway | Hyprland session agent | Rust service: auth (session cookie to user mapping), capture of each Wayland toplevel, H.264 or AV1 encode, WebRTC (WebCodecs fallback over WebSocket), input, clipboard and audio channels, per-window surfaces. Exposed at `/api/session/*`. |
| 3 | Thin browser client | WebOS | Minimal TypeScript built by `bun build`: login, session connect, one video or canvas per Wayland window placed in a window frame, input capture, clipboard, audio, reconnect. No framework, no app code. |
| 4 | Server APIs | WebOS services | Bun HTTP service kept: `/api/health`, `/api/inventory`, `/api/rpc`, repositories and store catalogs (`/api/store`), objects. Consumed by native apps over loopback and by the client; typed in `contracts/`. |
| 5 | Deploy, rollback, observability | WebOS | Atomic releases with health gate and automatic rollback, JSON request logs, `/api/health` checks for session layer, gateway and APIs, signed receipts. |

### Decisions

1. Runtime: Bun and TypeScript strict for the client and the APIs (Bun APIs only; no tsc, eslint, prettier or bunx); Rust for the gateway and any native service. One native backend per concern: the gateway owns media and input, the Bun service owns catalogs and RPC. No Cloudflare Worker (no unique role; retired with `wrangler.jsonc`).
2. UI framework: none. The thin client is plain TypeScript. Evidence: every pixel of the desktop and the apps is produced by native apps, so a framework has nothing to render. Store, Files and the rest are COSMIC Store and COSMIC Files plus the flathub-style catalog served by `/api/store`.
3. Design system: native apps use the Omarchy and COSMIC themes, generated from `packages/m3-tokens` where an M3 palette is needed (one source); the thin client chrome uses only the token CSS (`m3.css`).
4. App model: `contracts/app-manifest.ts` stays the single description of an app (real name, real upstream icon, backing). Backing `wayland` is the default for the desktop; `wasm`, `webview`, `stream`, `app-ui`, `api`, `browser` stay valid for apps that must run in the page (WebView windows, offline wasm tools). The session layer reads manifests to build launcher entries and desktop files; the client reads them only for window titles and icons.
5. Typed API contract in `contracts/`, shared by the client, the Bun service and (through Rust types generated from the same definitions) the gateway. Routing: `/` client, `/api/*` services, `/api/session/*` gateway, one deep-link key per manifest id. State: all user state lives in the user's session home on the host; the client keeps only a connection token. Plugin boundary: apps are manifests, never code in the client.
6. Build graph: one `bun webos` entry with cached tasks (client bundle, tokens, catalog, seo, inventory, wasm modules, gateway cargo build through the serialized wrapper on the VPS). Tests: unit (`bun test`), browser end-to-end qualification (connect, open each manifest app, first frame, no console errors, input round trip), coverage gate on `backing` (every manifest resolves to a real artifact or desktop entry).
7. Budgets: client at most 60 KB gzip; connect to first frame under 1.5 s cold on 4G; input to photon under 80 ms in region; per-session memory limit from the cgroup slice; gateway at most one core per 4 concurrent software encodes.
8. Observability and security: `/api/health` with `checks` (assets, objects, session layer, gateway, store); JSON line logs per request and per session event to journald. CSP on the client document; per-user sessions isolated by cgroup, namespace and file permissions; the gateway authenticates every WebSocket and WebRTC offer; WebView windows sandboxed, never `allow-same-origin` for third-party content; signed release receipts verified by the activator.
9. Deploy: build release, verify receipt, run the new service on a staging port, health gate (APIs and a gateway handshake), flip `current`, probe, automatic rollback on failure. Session processes belong to systemd and survive a web release flip.

### App model reference

```
{ id, name, icon{src,origin,license}, backing, entry, wasm?, stream?, wayland?{command,appId,perWindow?},
  webview?, permissions[], capabilities[], desc, group, window? }
```

Backings: `wayland` (real Wayland client in the Hyprland session, own WebOS window per toplevel), `wasm`, `stream`, `webview` (real WebOS window with chrome, sandbox and navigation; never a tab or Chrome window), `app-ui`, `api`, `browser`. Real product names and license-compliant upstream icons are enforced by `validateManifest`.

### Target layout of apps/webos

```
apps/webos/
  contracts/   typed API and AppManifest (shared)
  client/      thin client (connect, window frames, input, clipboard, audio)
  services/    Bun service: health, inventory, rpc, store, objects, logging
  build/       one task graph, deploy, rollback, receipts
  public/      static assets for the client
```

The Rust gateway lives in `crates/` (owner: session agent) and is referenced, not copied.

### Retirement plan (after cutover is verified)

Cutover gate, set with the session owner: the client connects to a live Hyprland session on aphrody.com, every manifest app opens as its own window with first frame, input and clipboard work, the health gate is green, and the previous release stays available for rollback for one week. Then, one commit per step, with `bun check`, lint and format on the VPS after each:

1. Remove the JS apps and shell from `src/` (wm, tile, dock, launcher, settings, files, terminal, atlas, store UI, engine, linux, calculator, media, storage, activity, keys, wallpaper, themes, sounds, prefs, assistant); keep boot and the connection client.
2. Remove `worker/` (the Cloudflare handler) and `wrangler.jsonc`; move the surviving routes (health, inventory, rpc, store, objects) into `services/`.
3. Delete `build-craft.ts`, `packages.ts`, `workspace.ts`, `games-content.ts`, `vm.ts`, the 14 MB `public/engine`, and `build-wasm.ts` unless wasm modules are still served.
4. One build entry; layer and manifest gates in `bun check`.

Until the gate passes, the current JS desktop stays deployed and gets no new features. Landed so far (kept because small and reversible): the manifest contract, shell code splitting with hashed chunks, service worker chunk precache.

### Stages and owners

1. Done: audit, manifest contract (with `wayland`), this ADR, shell code splitting.
2. Session owner: Hyprland session, gateway, per-user cgroups, manifest-driven launcher. WebOS: thin client, `/api/session/*` types in `contracts/`.
3. WebOS: `services/` extraction, health v2, JSON logs, deploy health gate and rollback, signed receipts, one build entry.
4. Cutover verification in the browser, then the retirement list.
