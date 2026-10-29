# @aphrody/tauri

Tauri 3 for Bun OS: a Cargo workspace that tracks the upstream `tauri-apps/tauri`
`v3` line, the consolidated plugin crate `tauri-plugin-aphrody`, and the
JavaScript side (`@aphrody/tauri`). Everything here runs with the **unmodified
upstream Bun** (`bun`, `bunx`, `bun build --compile`); no Bun fork API is used.
The native crates live in a separate Cargo workspace in this directory (excluded
from the repository workspace) and are not built into any Bun executable.

## Upstream tracking

Pins and dates are in [`upstream.json`](./upstream.json) (machine readable).

| Upstream                                   | Version / ref                                          | Date       |
| ------------------------------------------ | ------------------------------------------------------ | ---------- |
| `tauri-apps/tauri` branch `v3`             | `78f49ba3993f` (`tauri` 3.0.0-alpha.5)                 | 2026-10-21 |
| `tauri-apps/tauri` stable (`dev`, 2.x)     | `tauri` 2.12.5 (`993038c49185`), CLI 2.12.4            | 2026-10-21 |
| `tauri-apps/plugins-workspace` branch `v3` | `3d836244bcb9` (plugins 3.0.0-alpha.3, dialog alpha.4) | 2026-10-14 |
| `tao` / `wry`                              | 0.37.2 / 0.57.1 (used by `tauri-runtime-wry`)          | 2026-10-23 |
| `@tauri-apps/cli` / `@tauri-apps/api`      | `next` 3.0.0-alpha.5 / 3.0.0-alpha.3 (`latest` 2.12.4) | 2026-10    |

The `crates/aphrody-tauri*` directories are the upstream `crates/tauri*` of the
`v3` branch with the package renamed (`aphrody-tauri`, version `1.4.7`),
formatted with the repository `rustfmt.toml`, plus the local changes listed
below. They are re-synced by a three-way merge (upstream release tag the crate
was last synced from, current upstream, local tree), see `upstream.json` (`previousBase`, `syncedTo`) for the
base of each crate. `tauri-runtime-wry` is not vendored: use the crates.io
`tauri-runtime-wry` 3.0.0-alpha.5 (apps pick a runtime with `.runtime(...)`).

Local changes on top of upstream:

- `tauri-utils` / `tauri-plugin` / `tauri-build`: a plugin crate may ship several
  plugins (`bundle:<name>` package names, `DEP_*___BUNDLE__*` metadata); used by
  `tauri-plugin-aphrody` (`#![plugin(name)]` in `generate_handler!`).
- `tauri-runtime-cef`: the `cef` crates come from crates.io (`=154.5.0`), not from
  a vendored `cef-rs` checkout.
- `tauri-cli`: `tauri migrate` uses the published `oxc_*` 0.153.0 crates (no
  `bun_ecma_*` / `bun_arena`).

## Using it with upstream Bun

JavaScript tooling: the official `@tauri-apps/cli` runs under Bun (the CLI is a
native N-API module; `tauri info` detects `bun` and `bun.lock`).

```sh
bun add -d @tauri-apps/cli@next @tauri-apps/api@next
bun add @aphrody/tauri
bun run tauri dev          # or: bunx tauri dev
```

```json tauri.conf.json
{
  "build": {
    "beforeDevCommand": "bun run dev",
    "beforeBuildCommand": "bun run build",
    "devUrl": "http://localhost:5173",
    "frontendDist": "../dist"
  }
}
```

`cargo tauri` from the `tauri-cli` crate works the same way; the commands in
`beforeDevCommand` / `beforeBuildCommand` are plain shell commands, so any Bun
script works. `tauri init` offers `bun dev` / `bun build` for Bun projects.

### Bun as the backend

`tauri-plugin-aphrody` starts a Bun server next to the app, on a free loopback
port (`PORT` and `BUN_TAURI_PORT`), and the webview reaches it over IPC
(`bunFetch` from `@aphrody/tauri/bun`: no CORS, no CSP entry). Two modes:

```json tauri.conf.json
{ "plugins": { "aphrody": { "bun": { "entry": "server.ts", "hot": true } } } }
```

runs `bun --hot server.ts` (development; `bun` from `PATH`, or `binary` /
`BUN_TAURI_BUN`). For a shipped app, compile the server into a self-contained
executable with the official `bun build --compile` and register it as a Tauri
sidecar (`bundle > externalBin`), which the bundler installs next to the app
executable:

```sh
bunx bun-tauri-sidecar server.ts binaries/server   # -> src-tauri/binaries/server-<host-triple>[.exe]
bunx bun-tauri-sidecar server.ts binaries/server --triple aarch64-unknown-linux-gnu
```

```json tauri.conf.json
{
  "bundle": { "externalBin": ["binaries/server"] },
  "plugins": { "aphrody": { "bun": { "sidecar": "server" } } }
}
```

`bun-tauri-sidecar` maps the Rust target triple to the `--target` of
`bun build --compile` (`bun-windows-x64`, `bun-linux-arm64-musl`, ...) and names
the file as Tauri requires (`<name>-<triple>`). The server side:

```ts server.ts
import { serveForTauri } from "@aphrody/tauri/server";
serveForTauri({ fetch: () => new Response("hello") });
```

```ts
import { bunFetch } from "@aphrody/tauri/bun";
const text = await (await bunFetch("/")).text();
```

### Other imports

```ts
import { menu, window, webviewWindow } from "@aphrody/tauri";
import { invoke } from "@aphrody/tauri/api/core";
import { Store } from "@aphrody/tauri/plugins/store";
```

All API namespaces are also available from `@aphrody/tauri/api`. Plugin guest
bindings require the corresponding Cargo feature and initialization of the
native `tauri-plugin-aphrody` crate. The JavaScript package alone does not
create a native application.

## Checks

```sh
cargo check -p tauri-plugin-aphrody --tests
cargo test -p tauri-plugin-aphrody          # unit, e2e (MockRuntime + a real `bun` server), doctests
bun install && bun run typecheck            # JavaScript side
```
