# Upstream: 3Dviz Pro Max

- Project: 3Dviz Pro Max by Viettranx, https://github.com/viettranx/3dviz-pro-max (MIT, `LICENSE`)
- Fork: https://github.com/aphrody-labs/3dviz-pro-max, vendored as the `vendor/3dviz-pro-max` submodule
- Pin: `upstream/UPSTREAM.json` (commit d077e0e68915c25be8e71d74684d3144fd1c2aca, 2026-09-11)

## What Bun OS changed

- `src/` is a Bun/TypeScript port of the skill's Python helpers (`catalog`, `manifest_contract`, `record_layout`,
  `search`, `resolve`, `design-context`, `quality_brief`, `host-probe`, `blender_locate`, `hero-tier`, `capture`,
  `capture_view_quality`) plus `validate` (JSON Schema 2020-12 over `schemas/`), the `Bun.serve` scene server
  (replacing Vite, the Python static server and the kit-proof scratch harness) and `fetch-assets` (replacing
  `examples/scripts/fetch-assets.sh`). Playwright is replaced by `@aphrody/chromium` (CDP), Blender discovery by
  `@aphrody/bun-blender`. No Python runs; the bpy scripts under `templates/kits/blender/` run inside Blender.
- Parity: `test/golden.test.ts` replays fixed search, resolve, design-context and hero-tier cache-key cases recorded
  from upstream's Python through `uv run` (`scripts/golden.ts`); outputs are equal value for value, including
  `catalog_hash`, `content_catalog_hash`, `layout_hash` and `bundle_hash`.
- `runtime/kit-viewer.js` runs the kit harness on Three.js r186 `WebGPURenderer` (WebGL2 fallback) with M3 chrome;
  `bunos/scaffold-bun-threejs` and `bunos/rigs/post-stack-webgpu.js` are the Bun/WebGPU scaffold and TSL post stack.
- Markdown commands are rewritten to `bun scripts/<name>.js` (`scripts/rewrite.ts`); SKILL.md gains a Bun OS section.
- Studies (`studies/`, upstream `examples/`) are served without Vite; their `node:test` suites, Vite and pnpm files
  are not copied. Data is never edited.
