# WebOS architecture (ADR-001)

Status: accepted 2026-10-30. Scope: `apps/webos`, served at https://aphrody.com. Repository docs only: WebOS does not serve documentation.

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
| Deploy | `deploy.ts` builds an immutable release under `build/webos-deploy/releases`, writes `receipt.json` with sha256 of every file, keeps four releases; a root-owned activator flips `~/apps/webos/current` and writes `deployment.json`. Atomic by symlink, but rollback and the health gate live outside the repository flow. |
| Tests | 16 test files (wm, tile, files, editor, terminal keys, pkg, markdown, fend, isolation, inventory, workspace, assistant). No browser e2e in the repository flow, no coverage gate on `backing`. |
| Layering | Good: `src/` never imports `worker/`; `worker/` imports only `src/config` and `src/inventory-kinds`. Violations: `src/apps/appstore` reaches `../../store/types` (server catalog types) and the root has 30 loose scripts mixing build, server and data. |
| Type safety | `strict` through `tsconfig.base.json`; 27 `any`, 0 `ts-ignore`. Client and server share no API types: `/api/*` responses are cast on both sides. |
| Dead or duplicated | Cloudflare Worker deploy path (still wired in `package.json` `dev` script and `wrangler.jsonc`), two `Builtin`/`CatalogApp`/`MemberConfig` app models, three inventory kind tables, `win11/` is an in-flight import (zstd/format helpers, unreferenced). |

## 2. Decisions

1. **One runtime.** Bun and TypeScript strict, Bun APIs only (`bun build`, `Bun.serve`, `bun test`, `bun check`, `bun lint`, `bun fmt`). No tsc, eslint, prettier, bunx, no Node-only dependencies.
2. **One backend: the Bun service.** `services/` owns API, RPC, object store, WASM hosting, Wayland/stream session brokering and the store catalogs, started by `serve.ts` as a plain `Bun.serve` fetch handler with no Cloudflare binding shims. Rust is not a second HTTP service: Rust is compiled to WASM (client and server) or runs as host-side native programs the service starts (Hyprland session, native apps). The Cloudflare Worker has no unique role (aphrody.com and the app host aliases are served natively and redirected by nginx per `infra/config/routes.catalog.json`), so `wrangler.jsonc`, the `ASSETS`/`VM` shims and `wrangler dev` are retired in stage 5.
3. **UI framework by evidence.** The shell and light apps stay vanilla TypeScript with Web Components: that is what keeps boot under budget (the shell is the critical path; a framework runtime would add 40 to 150 KB before first paint). Rich apps, in particular the Store, are React islands built from `packages/app-ui` (React 19 plus M3), each in a sandboxed iframe or worker with a `postMessage` contract. This is also what lets the Store reuse flathub-infra/website parts, which are React and TypeScript. The boundary is the manifest backing `app-ui`, so the choice is per app, not global.
4. **One design system.** `packages/m3-tokens` is the only token source (CSS custom properties `--md-sys-*`); `themes.ts` only emits values for it; apps never define colors, radii or type. Components: Material Web for the shell, `app-ui` M3 primitives for islands.
5. **One window manager and shell.** `wm.ts` plus `tile.ts` in `shell/`; every app opens through `shell.open(manifest)`; native streams, WebViews and Wayland clients get the same window chrome.
6. **One app model** (section 3).
7. **Typed API contract.** `contracts/` holds the TypeScript types and a runtime validator for every route (`/api/health`, `/api/inventory`, `/api/rpc`, `/api/store`, `/api/browse`, `/api/wayland/*`); server handlers return `Contract[K]['response']` and the client calls through one typed `api()` function. No second schema language.
8. **One state pattern.** Preferences, installed packages and window layout live in the existing IndexedDB-backed `prefs` store with typed keys, and cross-app state is a small typed event bus (`core/events.ts`); apps keep local state in closures. No global singletons besides `prefs`, `wm`, `bus`.
9. **One routing scheme.** Path routing from `infra/config/routes.catalog.json`: `/` desktop, `/<app-path>` opens that app's window, `/workspace/*` the App UI island, `/api/*` the service. The manifest id is the deep-link key.
10. **Plugin boundary.** Emulators, Store, Craft apps, native apps and WebViews are all manifests; nothing in `shell/` imports an app, and apps import only `core/`, `ui/` and `contracts/`. Enforced by the layer gate (section 6).
11. **One build graph with caching.** A single `bun webos` entry (`build/index.ts`) runs a task graph (tokens, wasm, shell, apps, catalog, seo, inventory) where each task hashes its inputs and skips when the hash matches under `build/webos-cache/`; independent tasks run concurrently within the four-job VPS lane limit. `build-product.ts` becomes `bun webos build`.
12. **Tests.** Unit (`bun test`), browser end-to-end qualification on the VPS (opens every manifest app, asserts no console errors, boot time), and a coverage gate: every manifest has a real backing artifact and every member in the inventory has a surface (the existing gate, extended).
13. **Performance budgets.** Critical path JS (boot.js + main shell chunk) at most 250 KB gzip; each app chunk at most 200 KB gzip, loaded on first open; warm boot DOMContentLoaded under 400 ms, cold under 1.5 s on 4G profile; total first-load transfer under 400 KB; no app code in the shell chunk.
14. **Observability.** `/api/health` returns `{ok, service, sourceCommit, uptime, inventory, checks}` where checks cover assets, object store, wayland session and store catalogs; the service logs one JSON line per request (`ts, id, method, path, status, ms`) to stdout (journald); the shell reports uncaught errors to `/api/log` (rate limited).
15. **Security.** CSP on every document (no `unsafe-eval` outside the v86 and WASM iframes, which get their own origin-isolated document with COOP/COEP); app iframes and WebViews are sandboxed (`allow-scripts allow-forms`, never `allow-same-origin` for third-party content); each manifest declares permissions and the shell grants only those; releases are signed (sha256 `receipt.json` plus a detached signature verified by the activator before the symlink flip).
16. **Deploy.** Atomic: build release, verify receipt, start the new release on a staging port, health gate (`/api/health` and a smoke list of manifest apps), flip `current`, probe again, and auto-rollback to the previous release if the probe fails. Kept as `bun webos deploy`; the root-owned activator remains the only privileged step.

## 3. App model

Every app is a directory `apps/<id>/` with `manifest.ts` exporting an `AppManifest` (`contracts/app-manifest.ts`) and its entry module. The shell, dock, launcher, Store, inventory gate and server read manifests only.

```
{ id, name, icon{src,origin,license}, backing, entry, wasm?, stream?, wayland?, webview?,
  permissions[], capabilities[], desc, group, window? }
```

Backing kinds:

| backing | meaning |
| --- | --- |
| `wasm` | native code compiled to WebAssembly (Rust crates, native app cores), in page or worker |
| `wayland` | real Wayland client in the headless Hyprland session on the host; every toplevel is surfaced as its own WebOS window and streamed to the browser |
| `stream` | other host-side native program streamed into a window |
| `webview` | real web content in a WebOS window with its own chrome, sandbox and history/navigation; never a browser tab or Chrome window |
| `app-ui` | React island from `packages/app-ui` in a sandboxed iframe |
| `api` | UI over a typed API of the service |
| `browser` | web-platform feature only |

Rules: real product name and real, license-compliant upstream icon with recorded origin (generic labels fail `validateManifest`); native-first (Rio, Spacedrive, COSMIC apps, Craft, Aphrody chat and search are `wasm`, `wayland` or `stream`, not JavaScript reimplementations); a manifest with no real backing artifact fails the gate.

## 4. Target layout

```
apps/webos/
  contracts/   typed API + AppManifest (shared by client and server)
  core/        dom, prefs, events, pkg, config, appearance, notify, keys   (no app or shell imports)
  ui/          M3 components, themes, wallpaper, sounds                     (imports core)
  shell/       main, wm, tile, dock, launcher, boot, sw                     (imports core, ui, contracts)
  apps/<id>/   manifest.ts + index.ts + css                                 (imports core, ui, contracts)
  services/    serve, http, inventory, rpc, store, browse, emulators, wayland, health   (imports contracts)
  build/       one task graph, deploy, activator hooks
  public/      static assets
```

Dependency rule: `contracts` <- `core` <- `ui` <- `shell`/`apps`; `services` imports only `contracts` and `core/config`. Checked by `build/layers.ts` in `bun check`.

## 5. Migration stages (each deployable)

1. contracts/ and the manifest (landed), ADR.
2. Code-split the build: shell chunk plus per-app dynamic imports; budgets asserted in the build.
3. Manifest registry replaces the `builtins[]` table in `main.ts`; the 17 apps move to `apps/<id>/` one commit each.
4. `services/` extraction, typed `api()` client, health v2, JSON request logs.
5. Retire the Cloudflare Worker path; one `bun webos` build graph with cache; deploy health gate and rollback.
6. Layer gate, browser e2e qualification, signed receipts.

Other agents own: Store UI, emulators, inventory/WASM, native apps and identity, Wayland session. They work against `contracts/` and manifests.
