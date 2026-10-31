<!-- SPDX-License-Identifier: Apache-2.0 -->

# Tauri documentation hub

Current line: Tauri 3 alpha (`tauri =3.0.0-alpha.3`, runtime `tauri-runtime-wry` by default,
`tauri-runtime-cef` for Koharu only), pinned in the root `Cargo.toml` and described in
[`docs/operations/ui/tauri-upstream.md`](../../operations/tauri-upstream.md) and
[`config/tauri-apps.json`](https://github.com/aphrody-labs/aphrody/blob/main/config/tauri-apps.json) (registry of every Tauri project).
Tauri 2 pages below are kept as historical or compatibility context and carry a banner. Parent map:
[`../../../architecture/ui/README.md`](../../architecture/README.md).

## Desktop host (Tauri 3)

| Document | Contenu | Statut | Mis à jour |
| --- | --- | --- | --- |
| [Desktop GUI contract](../GUI.md) | Desktop webview boundary and user areas hosted by the Tauri 3 app in crates/ui/app. | active | 2026-10-01 |
| [Native desktop and distribution boundary](../NATIVE-DESKTOP.md) | Tauri 3 (tauri-runtime-wry) is the current host for Aphrody's public Chat, Files, Models and Settings webview. | active | 2026-10-01 |
| [Tauri 3 plugins and capabilities](plugins.md) | The plugins in use, capabilities and security boundaries. | active | 2026-10-01 |

## MCP and webview inspection

- [`tauri-mcp.md`](../integrations/tauri-mcp.md): ownership, transport and tool list (the upstream
  MIT notice is kept in [`tauri-mcp-upstream.LICENSE`](../integrations/tauri-mcp-upstream.LICENSE)).
- [`tauri-mcp-parity.md`](../../research/integrations/tauri-mcp-parity.md): dated parity table
  against the upstream reference revision.

## Material Web and Tauri

Owner documents in `packages/material-web/docs/tauri/`
(prerequisites, project setup, desktop and mobile platforms, type safety) and the French guide
`tauri-2.0.md` (Tauri 2.0 and Material Design 3; historical).

## Koharu

[`KOHARU.md`](../integrations/KOHARU.md) (integration), the Koharu crates under
[`crates/koharu`](https://github.com/aphrody-labs/aphrody/blob/main/crates/koharu/koharu/README.md) and the user docs in
[`packages/koharu/docs`](https://github.com/aphrody-labs/aphrody/blob/main/packages/koharu/docs/en/index.mdx). Koharu keeps the CEF runtime.

## Historical records

- [`iecode/docs/rg/products/azalee-tauri.md`](https://github.com/aphrody-labs/iecode/blob/main/docs/rg/products/azalee-tauri.md): archived Azalee Tauri client (no longer part of the monorepo).
- [`docs/plans/ai/plans/tauri-app.md`](https://github.com/aphrody-labs/aphrody/blob/main/docs/plans/ai/plans/tauri-app.md): superseded in-process Tauri plan (2026-09-20 snapshot).
- Agent skill for Tauri 2 (owned by the AI domain): [`plugins/aphrody/skills/tauri-v2`](https://github.com/aphrody-labs/plugins/blob/main/aphrody/skills/tauri-v2/SKILL.md).
