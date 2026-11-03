## Bun OS

This copy of the skill is built by Bun OS (`packages/viz3d`, `@aphrody/viz3d`) from the pinned
`aphrody-labs/3dviz-pro-max` fork. Its helpers are Bun programs; the data, references, kits and rigs are
upstream's. Run every helper from this skill folder with `bun scripts/<name>.js`; `--help` prints its options.

| Script | Does |
| --- | --- |
| `search.js`, `resolve.js`, `design-context.js` | catalog retrieval (same ranking, hashes and records as upstream) |
| `host-probe.js`, `blender-locate.js` | host tools and the shipped-kit quality ceiling; Blender stays optional |
| `hero-tier.js` | T3 hero bake: the kit's own GLB through Blender's CLI, cached |
| `serve.js` | `--kit [id] [--tier T2]`, `--dir dist` or `--study [id]` on 127.0.0.1 with `Bun.serve` |
| `capture.js` | screenshots through headless Chrome, Chromium or Edge (CDP); `--kit <id>` proves one blueprint |
| `validate.js` | manifest, layout, JSON Schema (`schemas/`) and catalog-hash checks |

**Render stack.** Build browser scenes on Three.js r186 `WebGPURenderer`, which falls back to its WebGL2
backend when the browser has no WebGPU adapter; serve them with `Bun.serve`. Start a new scene from
[scaffold-bun-threejs](templates/scaffold-bun-threejs/README.md) (Bun build and dev server, one `three`
aliased to `three/webgpu`, TSL bloom and vignette in `rigs/post-stack-webgpu.js`). Kits run unchanged on it:
`bun scripts/serve.js --kit` lists the 22 blueprints, and
`bun scripts/capture.js --kit knowledge.blueprint-timber-cottage --all-views` captures one; the capture log
names the scene backend, the WebGPU adapter and the WebGL renderer that drew. GLSL `ShaderMaterial` does not run
on WebGPU: write custom shading as TSL node materials. Keep the Vite scaffold only for a project already on it.

**Native.** For a native Bun OS app, export the scene or kit as glTF (the kit export page behind `hero-tier.js`,
or `GLTFExporter`) and load it with Bevy on wgpu (`crates/aphrody-nie-bevy`, `vendor/bevy`) or the Bun OS scene
renderer `crates/aphrody-render` (`model::load_model`; authoring ops in `docs/3D-AUTHORING.md`). Do not add a
second engine.

**Chrome around a scene.** Panels, buttons, HUDs and readouts use the Bun OS Material 3 roles: `runtime/m3.css`
(generated from the product theme by `@aphrody/m3-os-themes`) or `@aphrody/m3-tokens`, never hardcoded UI
colours. Scene, material and light colours are content and stay free. For the interface itself use the
`ui-ux-pro-max` skill and the M3 design tools.

**MCP.** The Bun OS MCP server (`aphrody-mcp`, design tool host `@aphrody/m3-mcp`) serves the same operations as
`viz3d_search`, `viz3d_resolve`, `viz3d_design_context`, `viz3d_blueprints`, `viz3d_host_probe`,
`viz3d_validate` and `viz3d_capture`, with structured results.
