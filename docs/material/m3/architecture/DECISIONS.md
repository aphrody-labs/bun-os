# Design and UI repository decisions (2026-10-04)

- **Name:** `aphrody-labs/aphrody-m3` is the single design and UI repository (private). No separate `aphrody-design` or `aphrody-ui` repo.
- **Layout:** `packages/` (m3-*, app-ui, scaffold, material-design-icons, m3-mcp), `forks/` (submodules: tailwindcss, base-ui, material-web, material-color-utilities, material-design-icons), `templates/` (base, web, desktop, react, elysia, hono), `examples/`, `docs/` (including `research/GOOGLE-LINKS.md`).
- **App UI:** `packages/nie-ui` (submodule `aphrody-labs/nie-ui`); Aphrody mounts this repo at `m3/` (owner decision, 2026-10-05); other consumers retain their own mount points.
- **MCP:** `packages/m3-mcp` is the only design MCP (10 tools, including `m3_os_themes_list` and `m3_os_themes_generate`); the Claude plugin `aphrody-m3` launches it.
- **Icons:** `bun packages/material-design-icons/scripts/svg-to-ico.ts <symbol|file.svg> --out src-tauri/icons` produces ICO, ICNS and PNG sets for Tauri apps; `templates/desktop/src-tauri/icons` is generated this way.
- **Ownership split:** Bun FFI in yolo (`@aphrody/runtime-sdk/ffi`), Rust in aphrody, systemd/nginx/host config in yolo `config/host`.

## Standalone install (2026-10-04)

This repository's own workspace manifest and lockfile define its install graph. Packages bound to host workspaces (`app-ui`, `web-to-tauri`) are excluded here and resolve from the host monorepo (Aphrody) that mounts this repo at `m3/`.

## Complete framework (2026-10-04)

- **New packages:** `@aphrody/m3-front` (web component layer), `@aphrody/m3-baseui` (Base UI + M3), `@aphrody/m3-tailwind` (Tailwind v4 `@theme` from tokens), `@aphrody/m3-os-themes` (Windows 11, GNOME, COSMIC, Chromium). See `docs/guides/FRAMEWORK.md`.
- **Orchestration:** build, serve and compile run through the yolo CLI (`yolo web|tauri`) via `scripts/yolo.ts` and `apps/web`; the old root `lint` and `typecheck` scripts now go through the same runner. `YOLO_ROOT` (default `$HOME/yolo`) selects the yolo checkout.
- **OS themes:** colour roles come only from `m3-tokens/dynamic-color`. `install`/`uninstall` are dry-run unless `--apply`; every installer snapshots prior state and reverts.
- **Expressive tokens in CSS:** `m3-tokens/expressive.css` carries the 15 emphasized type styles, Expressive spatial springs (0.6/800, 0.8/380, 0.8/200) and directional shapes, generated from `src/expressive.ts`. `display-large` emphasized tracking is 0 (Rust `typography.rs` fixed to match; the generated `m3-tokens.css` golden is unchanged until the next Rust regeneration).
- **Window height classes:** compact < 480, medium 480-899, expanded >= 900 (`breakpoints.ts`, `breakpoints.css`).
- **Navigation kinds:** `bar`, `rail-collapsed`, `rail-expanded` in TypeScript, matching `adaptive.rs` (`Bar`, `RailCollapsed`, `RailExpanded`); `rail` is gone.
- **State layers (divergence):** focus and pressed stay at `0.10`, as in Compose; Material Web v0_192 uses `0.12`. Hover `0.08` and dragged `0.16` agree. The tokens keep Compose values on purpose; change them in the Rust sheets generator if parity with Material Web is wanted.
