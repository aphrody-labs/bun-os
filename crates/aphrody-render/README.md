# aphrody-render

Native rendering for Aphrody OS: the M3 2D scene, the M3 3D scene graph, a
deterministic CPU reference for both, and a `wgpu` backend (feature `gpu`) with
pixel parity against it. Design, benchmarks and validation are in
[`docs/design/M3-RENDER.md`](../../../m3/docs/architecture/design/M3-RENDER.md).

## Surfaces and backends

`RenderSurface` is the single geometry contract for native 2D canvas and native
3D scenes: logical size, scale factor and the M3 adaptive layout are resolved
once, then `renderer_for_surface` / `select_backend` pick a backend.
`backend_order` is per platform (Windows DX12, Vulkan, CPU; Apple Metal, CPU;
wasm WebGPU, WebGL, CPU); GPU backends are reported only when `gpu` is compiled.

| Module | Role |
| --- | --- |
| `scene`, `geometry`, `text`, `raster` | 2D M3 scene and CPU rasterizer (`rgba8_len` / `fill_rgba8_rows` guard every allocation). |
| `gpu` | Shared `wgpu` context (`shared_context`, DX12 first on Windows, reopened after device loss) and the 2D GPU lane. |
| `math3d`, `mesh3d`, `scene3d` | 3D math, tessellation + `MeshCache`, the retained `Scene3d` graph and its single preparation (`prepare_with`: validation, culling, instanced `DrawBatch`es). |
| `raster3d` | CPU 3D reference: PBR, shadow map, 4x MSAA, visibility buffer, rayon bands (bit-identical with or without threads). |
| `gpu3d` | Persistent GPU 3D renderer: instanced draws, shadow pass, MSAA, `render_to_texture` / `render_to_view` for hosts that present themselves. |
| `pipeline3d` | `Pipeline3d` with `CpuOnly` / `Auto` / `GpuRequired`. |
| `model` | glTF/GLB (`gltf`) and OBJ (`tobj`) import, `inspect`, `write_glb`, `studio_scene`, `orbit_camera`. |
| `author3d` | Authoring backend: editable n-gon meshes (extrude, inset, Catmull-Clark, merge, ray pick), sculpt brushes, skeletons + auto-weights + linear-blend skinning, keyframe clips + blending, PBR material presets, and the undoable JSON `Op` document that evaluates to `Scene3d`, PNG and GLB. Design and upstream evaluation: [`docs/3D-AUTHORING.md`](../../docs/3D-AUTHORING.md). |

## Features

- `cpu` (default): the CPU rasterizers.
- `parallel` (default): rayon row bands for the CPU 3D rasterizer.
- `gpu`: `wgpu`, the shared context and the GPU lanes.

## Consumers

- Native: `m3/packages/canvas` and `@aphrody/bun` (`m3Render`, `m3Render3d`).
- Browser: `m3/packages/canvas/site` and `m3/packages/material-web` (`md-3d-scene`,
  `md-native-3d`).
- Tauri hosts: `aphrody-tauri-3d` (wgpu scene under a transparent M3 webview) and
  `apps/aphrody-model-view` consume this crate; the former `aphrody-render3d` kernel tools were removed.
  This crate is the single render owner and a new host must call it rather than reimplement it.

Hosts never duplicate backend policy; they call this crate.

## Validation

```sh
cargo test -p aphrody-render --locked
cargo run -p aphrody-render --release --example studio3d -- crates/aphrody-render/examples/studio3d/character.json out/
cargo test -p aphrody-render --features gpu --locked
cargo clippy -p aphrody-render --all-targets --features gpu -- -D warnings
cargo bench -p aphrody-render --bench frame --features gpu
```
