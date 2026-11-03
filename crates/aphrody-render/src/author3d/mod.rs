// SPDX-License-Identifier: Apache-2.0
//! 3D authoring backend: modeling, sculpting, rigging, animation and
//! materials on top of the renderer.
//!
//! | Module | Role |
//! | --- | --- |
//! | [`poly`] | Editable n-gon meshes: primitives, region extrude, inset, Catmull-Clark, merge, ray pick, topology. |
//! | [`sculpt`] | Draw, inflate, smooth, flatten, pinch and grab brushes with falloff, mask and X symmetry. |
//! | [`rig`] | Skeletons, poses, envelope auto-weights and linear-blend skinning (glTF skin layout). |
//! | [`anim`] | Keyframe clips (step/linear/smooth), sampling and cross-fade blending. |
//! | [`material`] | User-facing PBR definitions, hex/M3-role colours and presets. |
//! | [`doc`] | The document, its JSON [`doc::Op`] command set, atomic undo/redo [`doc::Editor`], evaluation to [`crate::scene3d::Scene3d`], PNG and GLB output. |
//!
//! Everything is dependency-free Rust over this crate's math, so the same
//! backend runs headless (CLI, agents, CI), in Tauri/COSMIC hosts through
//! [`crate::pipeline3d`], and in WASM.

/// Quaternions, `Trs` transforms and affine inverses.
pub mod xform;

/// Editable polygon meshes and modeling operators.
pub mod poly;

/// Sculpting brushes.
pub mod sculpt;

/// Skeletons, skin weights and skinning.
pub mod rig;

/// Keyframe animation clips.
pub mod anim;

/// PBR material definitions and presets.
pub mod material;

/// Authoring document, command set and renderer bridge.
pub mod doc;
