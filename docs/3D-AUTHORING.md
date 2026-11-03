# 3D authoring backend

Bun OS has one 3D owner, `crates/aphrody-render`. Its 3D renderer stack is `math3d`,
`mesh3d`, `scene3d`, `raster3d`, `gpu3d`, `pipeline3d` and `model`. The `author3d`
module is the authoring layer on top of it: modeling, sculpting, rigging, animation
and materials. Authored documents evaluate into the same `Scene3d`, so these
renderers draw them without any changes:

- the CPU reference rasterizer;
- the `wgpu` backend;
- the browser lane (`md-3d-scene`);
- Tauri hosts (`aphrody-tauri-3d`, `aphrody-model-view`).

There is no second engine or renderer. The module adds no dependencies.

## What is implemented

The test column counts unit tests in that module; everything listed runs today.

| Area | Module | Implemented (tested) |
| --- | --- | --- |
| Modeling | `author3d::poly` | n-gon `PolyMesh` with these operators: cube, grid, quad sphere, import of any `Geometry` with seam welding, region extrude along averaged normals, per-face inset, Catmull-Clark subdivision (with the boundary crease rule), merge by distance, ray picking, face selection by normal, flat or smooth export, and a topology report (Euler characteristic, boundary and non-manifold edges, signed volume). Tests: 11. |
| Sculpting | `author3d::sculpt` | Draw, inflate, smooth, flatten, pinch and grab brushes. Options: smooth, linear, constant or sharp falloff; per-vertex mask; X symmetry; dab spacing along the stroke; invert. Tests: 6. |
| Rigging | `author3d::rig` | Skeleton (parents before children, unique names, at most 256 bones), rest and posed global matrices, inverse bind matrices, envelope auto-weights (inverse distance to bone segments, top 4 influences), linear-blend skinning of positions and normals, pose blending. The skin layout is glTF (`JOINTS_0`/`WEIGHTS_0`). Tests: 3. |
| Animation | `author3d::anim` | Clips of per-bone translation, rotation and scale channels. Interpolation is step, linear (slerp for rotations) or smooth (Catmull-Rom for vectors, eased slerp for rotations). Looping or clamped playback, and cross-fade blending between two clips. Tests: 3. |
| Materials | `author3d::material` | `MaterialDef` takes hex colours or M3 roles (snake or kebab case) and lowers to the renderer's metallic/roughness `Material`. 12 presets: clay, plastic, rubber, gold, silver, copper, iron, chrome, glass, emissive, skin, primary. Tests: 2. |
| Document | `author3d::doc` | `Document3d` holds objects, a material library, the skeleton and clips. It has a serde-tagged JSON `Op` command set of 14 ops. `Editor` applies ops atomically (a failed op changes nothing) with 64 levels of undo/redo. Evaluation at a clip and time produces `Scene3d`, a CPU-rendered PNG and a posed GLB. Animated frames are framed on the rest pose so the camera stays still. Tests: 5. |
| Math | `author3d::xform` | Quaternions matching `Mat4::rotation_xyz`, `Trs`, and affine inverse. Tests: 3. |

The user-facing surface is the JSON op/script contract. CLIs, agents, MCP tools and UIs
all send the same `Op` values. The runnable entry point is the `studio3d` example:

```sh
cargo run -p aphrody-render --release --example studio3d -- \
  crates/aphrody-render/examples/studio3d/character.json out/
```

`examples/studio3d/character.json` runs the whole slice: it models a body (extrude,
subdivide), sculpts it with ray-placed draw strokes plus a smooth pass, defines and assigns
materials, insets and extrudes a plinth, builds a three-bone rig, binds automatic weights
and adds a looping "wave" clip. It writes a rest render, 8 animation frames, a posed GLB,
the document JSON and its stats.

## Upstream evaluation (primary sources, 2026-11-03)

Sources were the upstream repositories, their LICENSE and Cargo.toml files, and the
crates.io API.

| Project | Identity | License | Shipped (verified in code) | Roadmap or unproven | Decision |
| --- | --- | --- | --- | --- | --- |
| Bevy | github.com/bevyengine/bevy, v0.20.1 (2026-10-28), wgpu 30, MSRV 1.97.1 | MIT OR Apache-2.0 | wgpu renderer; PBR (`bevy_pbr`); skinning and morph targets (`bevy_mesh`); animation graph with blending (`bevy_animation`); glTF import | No editor app; `bevy_inspector` exists only on `main`. No modeling, sculpting or glTF export. | Already in the workspace (0.20.1, sub-crates, used by `aphrody-nie-bevy`; `vendor/bevy`). Keep it as an optional runtime and import target. Do not use it as the authoring core. |
| Fyrox | github.com/FyroxEngine/Fyrox, 1.0.1 | MIT | OpenGL (glow) renderer; PBR; skinning; animation state machine with blend spaces; FBX and glTF import; `fyroxed_base` editor | wgpu backend only on `main` (2.0 rc). No modeling, sculpting or export. | Do not adopt. It would be a second engine and renderer stack. Its FBX importer is the reference to study if FBX import is added. |
| Blackjack | Original `setzer22/blackjack` deleted by its author. Surviving copies are `timschmidt/blackjack` (2024) and `therustmonk/blackjack`. The crates.io `blackjack` crate is an unrelated GPL card game. | MPL-2.0 | Half-edge mesh and edit ops (`blackjack_engine/src/mesh/halfedge/edit_ops.rs`: extrude, bevel, chamfer, subdivide, bridge, dissolve); node graph with Luau | Unmaintained; wgpu 0.13 / egui 0.19 forks; cannot be published | Do not vendor. Its bevel, chamfer and bridge algorithms are the reference for the next operators. Any copied file stays MPL-2.0 with its notice, file by file. |
| SolidCraft | github.com/tangency-labs/solidcraft, v0.30.1 release, 0.40.0-rc.1 on `main`. Kernel `bherbruck/solidcore` (Apache-2.0). | MIT OR Apache-2.0 (+ NOTICE, THIRD-PARTY-LICENSES) | Parametric B-rep CAD: sketch and constraints, extrude, revolve, sweep, loft, fillet, chamfer, shell, assemblies; STEP, IGES, 3MF, STL, OBJ, glTF | ROADMAP defers mesh modeling, T-splines, render, animation and simulation | Not a mesh, sculpt or animation tool. Its domain overlaps CADCraft (`crates/cadcraft-*`). Evaluate it there, not here. |
| Clide3D | github.com/addamb/clide3d, 0.1.0, created 2026-10-21, 4 commits, binary only | MIT OR Apache-2.0 (assets: MakeHuman CC0, CC0 scans) | Present in code: SDF clay and brushes, Catmull-Clark, LBS rig and keyframes, glTF and FBX writers with skins, WGSL path tracer | Six days old, apparently bulk-generated, no tests or releases checked; material, cloth and hair claims not verified | Not a dependency (no library target). Its skinned glTF and FBX writers are worth reading when skinned export is added here. |

All copied code must keep its license and notice. Nothing was copied from these projects
for this slice. `author3d` is first-party Apache-2.0 code.

## Gaps and next steps

1. **Skinned glTF export.** `export_glb` writes the evaluated (posed, baked) mesh. It
   still has to write `skins`, `JOINTS_0`/`WEIGHTS_0`, inverse bind matrices and
   `animations`. The data layout already matches glTF, so this goes into `model::write_glb`.
2. **More operators.** Bevel and chamfer, loop cut, bridge, knife, and edge and vertex
   selections. Dynamic topology and remeshing for sculpting. Concave n-gon triangulation:
   `to_geometry` fan-triangulates, which is exact only for the convex faces the current
   operators produce.
3. **Better weights.** Heat-diffusion or geodesic weights, weight painting, and IK (two-bone
   and FABRIK). Dual-quaternion skinning to avoid candy-wrapper twisting.
4. **Animation graph.** State machine and blend spaces, morph targets, and object-level
   (non-bone) tracks.
5. **Materials.** Texture slots (base colour, normal, ORM) need texture support in
   `scene3d`/`raster3d`/`gpu3d` first; the renderer has none today.
6. **Interactive surface.** An iced/libcosmic or Tauri editor that sends `Op`s to `Editor`
   and presents through `pipeline3d`/`aphrody-tauri-3d`, plus an `aphrody` CLI subcommand
   and MCP tools wrapping the same ops. The `wgpu` path was not exercised here; it renders
   the same `Scene3d` and has pixel-parity tests against the CPU path in `gpu3d`.
7. **Interop.** Import through `model::load_model` into `Primitive::Geometry` works for meshes.
   Rig and animation import from glTF (and FBX after studying Fyrox's loader) is missing.

## Validation

```sh
cargo test -p aphrody-render --locked --lib author3d   # 33 tests
cargo test -p aphrody-render --locked                  # whole crate
cargo clippy -p aphrody-render --locked --all-targets
```
