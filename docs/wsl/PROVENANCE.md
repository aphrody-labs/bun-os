# Provenance of the Bun OS WSL manager

Derived from [octasoft-ltd/wsl-ui](https://github.com/octasoft-ltd/wsl-ui), fork `aphrody-labs/wsl-ui`.

- Upstream commit imported: `b9b45e235829931a0edec50045d47b59c86646d9` (branch `main`, last push 2026-10-26, version 0.21.0).
- Licence: **GPL-3.0** (decision of the owner, 2026-10-29). `LICENSE` (GPL-3.0 text), `package.json` and `crates/wsl-core` say GPL-3.0-only and are authoritative.
  Inconsistency recorded: upstream `src-tauri/Cargo.toml` says `BUSL-1.1` and upstream `TRADEMARK` says "alongside the BUSL-1.1 license".
  No file was found with an explicit BUSL header; the imported code is treated as GPL-3.0-only. Re-check headers on every resync.
- `apps/bunos-wsl/{LICENSE,CREDITS.md,TRADEMARK}` are kept unchanged. The trademark policy forbids the name "WSL UI", "Octasoft" and their logos:
  the product is renamed **Bun OS WSL** (`bunos-wsl`). The upstream icons in `apps/bunos-wsl/src-tauri/icons` and `public/` still have to be replaced (open item).

## Mapping

| Upstream | Here |
| --- | --- |
| `crates/wsl-core` | `crates/bunos-wsl-core` |
| `src-tauri/src/*` except `main.rs`, `commands.rs` | `crates/bunos-wsl/src` (no Tauri dependency; `download.rs` emits through `ProgressEmitter`) |
| `src-tauri/{main.rs,commands.rs,tauri.conf.json,capabilities,icons,resources}` | `apps/bunos-wsl/src-tauri` (excluded from the root workspace, like `apps/aphrody-app`) |
| `src/`, `public/`, `index.html`, `popup.html`, vite/tsconfig, wdio | `apps/bunos-wsl/` |
| `docs/*.md` (not screenshots, videos, plans) | `docs/wsl/` |
| `scripts/` | `apps/bunos-wsl/scripts/` |
| new | `crates/bunos-wsl/src/bunos/` (manifest + sha256, `.wslconfig` kernel, `wsl --status`, detection, session, limits, install plan) and `bunos-wsl-cli` |

## Audit (honest)

- Real: wsl.exe executor trait with real and mock implementations, OCI/LXC/Store catalogs, import/export, VHD resize/compact/move, mount, settings, i18n (14 locales), vitest and wdio tests.
- External services: Docker/OCI registries, images.linuxcontainers.org, cloud-images.ubuntu.com, Microsoft Store catalog.
- Telemetry: Aptabase (`@aptabase/web`, key from `VITE_APTABASE_KEY`, opt-in, off by default). **To remove** (service, opt-in dialog, privacy settings, `PRIVACY.md`): not done yet.
- Updater: none found in the Rust code.
- Signing: MSIX signing secrets in upstream `release.yml`, `msix-signing.yml`, `scripts/sign-msix.ps1`: not imported as workflows; the scripts are present and must be dropped or reworked.
- Rebrand: text, identifiers and URLs rewritten by script; upstream doc URLs inside `docs/wsl` are kept as references to upstream issues.

## Resync

```
git clone https://github.com/octasoft-ltd/wsl-ui /tmp/wsl-ui-new
git -C /tmp/wsl-ui-new diff b9b45e2..HEAD --stat   # review, then port by path using the mapping above
```
Re-apply the rename (`WSL UI`, `wsl-ui`, `Octasoft` -> Bun OS WSL / bunos-wsl / Aphrody Labs), keep GPL notices, update the commit above.

## State at the pause (2026-10-29)

Nothing in this tree has been compiled or tested yet (the workstation was saturated). Not done: `Cargo.lock` update, cargo check/test on the VPS,
Tauri shell port to the unified Tauri 3 (`commands.rs` still uses `crate::` paths and `AppHandle` as `ProgressEmitter`), telemetry/signing removal, icons,
frontend "Bun OS" tab, `@aphrody/windows` API, `bunos wsl` CLI routing, `factory/bunos/components.json`, workflow `wsl-ui.yml`, fixtures tests for list/version/.wslconfig/wsl.conf.
