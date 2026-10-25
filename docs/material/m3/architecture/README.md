<!-- SPDX-License-Identifier: Apache-2.0 -->

# UI, GUI, wgpu, Tauri, Google design and M3 / M3D: documentation map

Entry point for every document about the user interface stack. It maps each topic to its
canonical document. Rules: documentation lives under `docs/<category>/<domain>`; a README or
guide that ships with a package or crate stays next to the code and is the canonical copy.
Byte-identical copies that used to sit under `docs/` (import snapshots) were removed on
2026-10-01 and recorded as aliases in [`source-map.json`](https://github.com/aphrody-labs/aphrody/blob/main/docs/migration/source-map.json); the
audit trail is [`ui-docs-consolidation-2026-10-01.json`](https://github.com/aphrody-labs/aphrody/blob/main/docs/migration/ui-docs-consolidation-2026-10-01.json).
Status values: canonical, historical (dated evidence or superseded), legacy (Tauri 2 compatibility
context), imported (third-party or source-repository import), generated, notice (license or
attribution, kept in place).

## Topic map

| Topic | Canonical documents | Notes |
| --- | --- | --- |
| UI / GUI contract | [`GUI.md`](../reference/GUI.md), [`UI-RULES.md`](../reference/UI-RULES.md), [`ACCESSIBILITY.md`](../reference/ACCESSIBILITY.md), [`UI-DESIGN.md`](./UI-DESIGN.md), [`UX-DESIGN.md`](./UX-DESIGN.md) | Chat, Files, Models and Settings webview boundary; agent rules in [`AGENTS.md`](../reference/AGENTS.md). |
| Bun upstream alignment & fullstack UI | [`BUN-UPSTREAM-ALIGNMENT.md`](./BUN-UPSTREAM-ALIGNMENT.md), [`BUN-UI-CONVENTIONS.md`](../reference/BUN-UI-CONVENTIONS.md), [`BUN-FULLSTACK-DESKTOP.md`](../guides/BUN-FULLSTACK-DESKTOP.md) | Conventions Bun-first : bundler `Bun.build`, cache SQLite `bun:sqlite`, serveur desktop persistant `Bun.serve` port 1421, WebSockets, zéro-copie I/O. |
| Material Design 3 (M3) | [`M3-FRAMEWORK.md`](./design/M3-FRAMEWORK.md), [`APHRODY-M3-CANONICAL-CONTRACT.md`](./design/APHRODY-M3-CANONICAL-CONTRACT.md), [`M3-COMPONENT-FAMILY-MATRIX.md`](./design/M3-COMPONENT-FAMILY-MATRIX.md), [`M3-PLAN.md`](../plans/design/M3-PLAN.md) | Package docs (Lit `md-*`, MUI migration, strategy): `packages/material-web/docs/`. An older French framework overview lives in [`packages/material-web/docs/design/M3-FRAMEWORK.md`](./design/M3-FRAMEWORK.md) (diverged from the English canonical page; merge pending). |
| Design tokens and themes | [`aphrody-m3-tokens.md`](./design/aphrody-m3-tokens.md) (brand colours), [`aphrody-m3-theme.json`](./design/aphrody-m3-theme.json), [`crates/aphrody-m3-tokens`](https://github.com/aphrody-labs/aphrody/blob/main/crates/aphrody-m3-tokens/README.md), [`@aphrody/m3-theme`](../../packages/m3-theme/README.md), [`@aphrody/m3-design`](../../packages/m3-design/README.md) | A same-named, older document with the legacy seed `#CE422B` is [`packages/material-web/docs/design/aphrody-m3-tokens.md`](./design/aphrody-m3-tokens.md) (historical). |
| Components catalog and matrix | [`M3-COMPONENT-FAMILY-MATRIX.md`](./design/M3-COMPONENT-FAMILY-MATRIX.md), `m3-components.md`, `m3-components-spec.md` | Package READMEs: `packages/m3-*/README.md`. |
| Icons and fonts | [`M3-ICONS.md`](./design/M3-ICONS.md), [`FONTS-AND-ICONS.md`](./design/FONTS-AND-ICONS.md), [`TYPOGRAPHY.md`](./design/TYPOGRAPHY.md), [`crates/ui/bun/icons`](https://github.com/aphrody-labs/aphrody/blob/main/crates/ui/bun/icons/README.md) | Font licenses are kept as notices: [`google-sans-flex`](https://github.com/aphrody-labs/aphrody/blob/main/assets/fonts/google-sans-flex/OFL.txt), [`google-sans-code`](https://github.com/aphrody-labs/aphrody/blob/main/assets/fonts/google-sans-code/OFL.txt), `packages/m3-fonts/fonts/*-OFL.txt`. |
| Google design | `google-design-llms.txt` (design.google index, fetched 2026-05-29), `m3-material-io-llms.txt` (m3.material.io index), `google/ANALYSE.md`, [`gemini/`](./packages/material-web/docs/design/gemini/README.md) | Agent-side design guidance (imported skills, owned by the AI and NIE domains): `google-design`, `design-google-ingest`, `material/DESIGN.md` (design.md style), `m3-design-guide`. |
| wgpu and rendering | [`M3-RENDER.md`](./design/M3-RENDER.md), [`wgpu-webgpu.md`](../reference/WASM/wgpu-webgpu.md) (pins), [`rust-crate-gpu-window-ownership.md`](https://github.com/aphrody-labs/aphrody/blob/main/docs/architecture/rust-crate-gpu-window-ownership.md) | Crates: [`aphrody-render`](https://github.com/aphrody-labs/aphrody/blob/main/crates/ui/render/README.md) (`crates/ui/render`), `aphrody-softraster` (`crates/ui/softraster`), `aphrody-render3d` (`crates/ui/render-tools` (not in repo)). |
| M3D (M3 3D layer) | [`M3-RENDER.md`](./design/M3-RENDER.md) section "3D lane" | `Scene3d` in `crates/ui/render`; `aphrody-tauri-3d` (`crates/ui/tauri-3d` (not in repo)); `aphrody-model-view` (`crates/ui/model-view` (not in repo)); `aphrody-render3d` (`crates/ui/render-tools` (not in repo)); browser elements `md-3d-scene` (`scene3d/scene-3d.ts`) and `md-native-3d` (`native3d/native-3d.ts`); [`@aphrody/canvas`](../../packages/canvas/README.md). |
| Tauri (current line: Tauri 3 alpha) | [`Tauri hub`](../reference/tauri/README.md), [`tauri-upstream.md`](../operations/tauri-upstream.md), [`config/tauri-apps.json`](https://github.com/aphrody-labs/aphrody/blob/main/config/tauri-apps.json) | Tauri 2 pages are marked historical in the hub. |
| Koharu (Tauri + CEF app) | [`KOHARU.md`](../reference/integrations/KOHARU.md), [`crates/koharu`](https://github.com/aphrody-labs/aphrody/blob/main/crates/koharu/koharu/README.md), [`packages/koharu/docs`](https://github.com/aphrody-labs/aphrody/blob/main/packages/koharu/docs/en/index.mdx) | `tauri-runtime-cef` is used for Koharu only. |
| Spacedrive and SpaceUI imports | [`SPACEUI-M3-FUSION.md`](./design/SPACEUI-M3-FUSION.md), [`SPACEUI-SPACEDRIVE-MIGRATION.md`](./design/SPACEUI-SPACEDRIVE-MIGRATION.md), [`DRIVE-UPSTREAM-DIFF.md`](../reference/DRIVE-UPSTREAM-DIFF.md) | Imported Spacedrive documentation stays under each category in `ui/drive/` and is listed in [`IMPORTED-DOCS-INDEX.md`](https://github.com/aphrody-labs/aphrody/blob/main/docs/migration/IMPORTED-DOCS-INDEX.md). |

## Hubs by folder

| Folder | Hub |
| --- | --- |
| `docs/architecture/ui/design/` | [`design/README.md`](./design/README.md) |
| `docs/reference/ui/` | [`README.md`](../reference/README.md) and [`tauri/README.md`](../reference/tauri/README.md) |
| `docs/plans/ui/` | [`README.md`](../plans/README.md) |
| `docs/research/ui/` | [`README.md`](../research/README.md) |
| `docs/guides/ui/` | [`README.md`](../guides/README.md) |
| `docs/operations/ui/` | [`tauri-upstream.md`](../operations/tauri-upstream.md) (Tauri 3 upstream line) |
| `docs/products/ui/` | [`README.md`](../products/README.md) (product overview; per-package READMEs live next to the code) |

## Provenance

The 2026-10-01 consolidation removed 159 byte-identical docs copies (Koharu user docs, UI package
and crate READMEs, Material Web docs, generated permission references) in favour of the owner copy
next to the code, and left in place license notices, upstream changelogs and the near-identical
copies listed as pending in the consolidation report.
