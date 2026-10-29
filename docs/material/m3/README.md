# aphrody-m3

Private UI framework monorepo of Aphrody-labs. Aphrody mounts this Git submodule
at `m3/`; its product UI is `m3/packages/app-ui`. Yolo and IECODE keep their
own pinned consumer mount points.

- Install: [INSTALL.md](INSTALL.md) (quick start with tokens, theme, fonts and React in a Bun app; Tailwind v4;
  the `m3-bun` plugin; the `m3-design` CLI; Next.js; current npm release status).
- `packages/*`: Bun workspace packages. The `@aphrody/m3-*` family, `@aphrody/material-design-icons` and
  `@aphrody/eslint-plugin-m3` are published on npm; the umbrella `@aphrody/m3` and `@aphrody/libm3`
  stay private.
- Framework: `docs/guides/FRAMEWORK.md` (package map, yolo orchestration, theme install per OS). Root scripts
  `build`, `serve`, `compile`, `test`, `lint`, `typecheck`, `install:theme` run through the yolo CLI.
- App runtime: [`@aphrody/m3-bun`](docs/guides/M3-BUN.md) shares the M3 plugin and owns the UI/API server,
  executable compiler, packaging and deployment configuration. `m3 compile` delegates to this owner.
- Package index: `@aphrody/m3` (CLI, Bun plugin), `m3-bun`, `m3-tokens`, `m3-theme`, `m3-tailwind` (Tailwind v4 preset),
  `m3-front` (web components), `m3-react`, `m3-baseui` (Base UI), `m3-os-themes` (Windows, GNOME, COSMIC,
  Chromium), plus `m3-fonts`, `m3-icons`, `m3-motion`, `m3-primitives`, `m3-forms`, `m3-ai`, `m3-explorer`,
  `m3-design`, `m3-next`, `m3-next-migrate`, `m3-codemods`, `m3-mcp`, `material-design-icons`, `scaffold`.
  `apps/web` is the minimal web example; `apps/m3-showcase` exercises the adaptive components and API.
- `forks/*`: submodules of aphrody-labs forks: tailwindcss, base-ui, material-web,
  material-design-icons, material-color-utilities, fonts (`google/fonts`, sparse on the M3 typefaces).
  `bun scripts/forks.ts` manages them from `.gitmodules`.
- Gates: `bun scripts/check-exports.ts` (manifests, entries, dependencies, first-party imports),
  `bun scripts/check-assets.ts` (asset references, app icons), `bun scripts/check-links.ts` (docs
  links). Fonts: `bun scripts/fonts-sync.ts` (pinned upstream sources of `@aphrody/m3-fonts`). Native
  library of `@aphrody/bun`: `bun scripts/native.ts` and `docs/guides/NATIVE.md`.
- `templates/`, `examples/tauri/`: UI templates and Tauri example apps (copies of the
  Yolo-owned originals; the Rust build keeps using the Yolo paths).
- `docs/`: design docs by category (moved from aphrody `docs/*/ui`), web research in
  `docs/research/M3-WEB-RESEARCH-2026-10.md`.
- Rust UI crates (`crates/ui/*`) stay in aphrody.
- Icons: `bun run icons:ico <symbol|file.svg> --out src-tauri/icons` converts SVG to
  Tauri desktop icons (ico, icns, png) via `tauri icon`.
- Skills and plugin: `aphrody-m3` plugin in the aphrody-labs plugins marketplace.

Read [GOAL.md](GOAL.md), [PLAN.md](PLAN.md) and [MEMORY.md](MEMORY.md) for the current
finalization scope, owner gates and dated results. The
[host matrix](docs/plans/design/M3-MULTI-HOST-PLAN.md) distinguishes tested web behavior
from installed desktop/mobile qualification. Packages and repositories remain private.

Clone: `git clone --recurse-submodules git@github-dev:aphrody-labs/aphrody-m3.git`
(forks are shallow-friendly: `git submodule update --init --depth 1`).
