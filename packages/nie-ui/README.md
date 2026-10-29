# @aphrody/nie-ui

Single home of NIE UI and design (private, aphrody-labs).

- `src/` emulator web UI (`@aphrody/nie-ui/ui`, `styles/main.less`)
- `packages/menu-render`, `packages/menu-render-webgpu` pixel-perfect IEVR menu renderers (DOM, WebGPU)
- `packages/nie-web` NIE site/wasm libs, build/audit/release scripts, viewer assets, docs
- `packages/inagle-ui` explorer/maps helpers
- `apps/tauri/model-view` Tauri 3D model viewer; the Azalee wiki frontend lives outside this package
- `rust/` NIE UI crates (`nie-ui` design tokens, render, render3d, viewer-web, wasm, lua-web, tauri-3d reference); serial cargo only via Aphrody
- `tools/pixel-perfect/` validators and examples; `skills/` design skills; `docs/`
- `HISTORY.md` provenance of every file

`bun install && bun run typecheck`.

## Emulator frontend (src/)

Browser UI of the NIE/IECODE emulator frontend (`apps/iecode-web` in iecode): console
switcher, file store, input and touch controls (`src/ui`) and Less styles
(`src/styles`). The webpack app stays in iecode `apps/iecode-web`; it resolves this
package through `design/aphrody-m3/packages/nie-ui` (this repo as submodule) and the `@iecode-web/*`
alias (message protocol and screen shaders stay with the Rust/WASM adapter).

Design tokens of the game UI are owned by the Rust crate `aphrody-nie-ui`
(`crates/nie/aphrody-nie-ui`); no token copy lives here.
